#!/usr/bin/env node

import { spawn, execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { parseEnv, promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const repositoryRoot = path.resolve(scriptDirectory, "..");
const envPath = process.env.LIVE_DEMO_ENV_FILE
  ? path.resolve(process.env.LIVE_DEMO_ENV_FILE)
  : path.join(repositoryRoot, ".env");
const stateRoot = path.join(repositoryRoot, ".tmp", "live-demo-recording-state");
const artifactRoot = path.join(
  repositoryRoot,
  ".tmp",
  "demo-recordings",
  "realistic-support-portal",
  "live-hq",
);
const stateSentinel = path.join(stateRoot, ".live-demo-state-root");
const artifactSentinel = path.join(artifactRoot, ".live-demo-artifact-root");
const stateSentinelValue = "Shepherd live demo recording state\n";
const artifactSentinelValue = "Shepherd live demo recording artifacts\n";
const videoPath = path.join(artifactRoot, "northstar-support-portal-live-hq-1080p.webm");
const manifestPath = path.join(artifactRoot, "chapters.json");
const manifestMarkdownPath = path.join(artifactRoot, "CHAPTERS.md");
const authorizationRoot = path.join(repositoryRoot, ".tmp", "demo-recordings", ".live-demo-run-guards");
const serverOutputLimit = 16_384;
const runtimeInstanceId = "shepherd-live-recording";
const viewport = { width: 1_920, height: 1_080 };
const targetFrameRate = 30;
const targetBitrateMbps = 12;
const preflightOnly = process.argv.slice(2).includes("--preflight-only");
const authorizeOnly = process.argv.slice(2).includes("--authorize-only");
const consumeAuthorizationOnly = process.argv.slice(2).includes("--consume-authorization-only");
const runIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/u;

const frontendPrompt =
  "Complete the customer portal authentication client using the repository’s existing conventions and interfaces. Keep the implementation and tests within the frontend-owned files.";

const backendPrompt =
  "Complete the API authentication middleware using the repository’s existing deployment conventions and interfaces. Keep the implementation and tests within the backend-owned files.";

const frontendAgentName = "Customer Portal Frontend";
const backendAgentName = "Support API Backend";

let chromiumType;

function replaceExactlyOnce(source, original, replacement, label) {
  const first = source.indexOf(original);
  assert(first >= 0 && source.indexOf(original, first + original.length) === -1, `${label} is not uniquely patchable`);
  return source.slice(0, first) + replacement + source.slice(first + original.length);
}

async function loadHighQualityChromium() {
  if (chromiumType) return chromiumType;
  const bundlePath = path.join(repositoryRoot, "node_modules", "playwright-core", "lib", "coreBundle.js");
  const metadata = await lstat(bundlePath);
  assert(metadata.isFile() && !metadata.isSymbolicLink(), "Playwright recorder bundle is not a regular file");
  const original = await readFile(bundlePath, "utf8");
  const defaultEncoder = "-an -r ${fps} -c:v vp8 -qmin 0 -qmax 50 -crf 8 -deadline realtime -speed 8 -b:v 1M -threads 1";
  const highQualityEncoder = "-an -r ${fps} -c:v vp8 -qmin 0 -qmax 24 -crf 4 -deadline good -speed 2 -b:v 12M -minrate 10M -maxrate 16M -bufsize 24M -threads 4";
  let patched = replaceExactlyOnce(original, defaultEncoder, highQualityEncoder, "Playwright encoder configuration");
  patched = replaceExactlyOnce(patched, "fps = 25;", `fps = ${targetFrameRate};`, "Playwright frame rate");
  patched = replaceExactlyOnce(patched, "quality: quality ?? 90", "quality: quality ?? 100", "Playwright screencast quality");
  await writeFile(bundlePath, patched, "utf8");
  try {
    ({ chromium: chromiumType } = await import("playwright"));
  } finally {
    await writeFile(bundlePath, original, "utf8");
  }
  assert(chromiumType, "Playwright Chromium did not load");
  return chromiumType;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isStrictChild(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertRealDirectory(target, expectedParent) {
  const metadata = await lstat(target);
  assert(metadata.isDirectory() && !metadata.isSymbolicLink(), "Recording root is not a real directory");
  const canonical = await realpath(target);
  assert(canonical === path.resolve(target), "Recording root is not canonical");
  assert(path.dirname(canonical) === expectedParent, "Recording root escaped its expected parent");
  return canonical;
}

async function prepareManagedRoot(target, sentinelPath, sentinelValue) {
  const tempRoot = path.join(repositoryRoot, ".tmp");
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const canonicalTemp = await assertRealDirectory(tempRoot, repositoryRoot);
  if (await exists(target)) {
    const canonical = await assertRealDirectory(target, path.dirname(target));
    assert(isStrictChild(canonicalTemp, canonical), "Recording cleanup target escaped .tmp");
    assert((await readFile(sentinelPath, "utf8")) === sentinelValue, "Recording root sentinel mismatch");
    await rm(canonical, { recursive: true, force: true });
  }
  await mkdir(target, { recursive: true, mode: 0o700 });
  await writeFile(sentinelPath, sentinelValue, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return await assertRealDirectory(target, path.dirname(target));
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string", "Unable to reserve a loopback port");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function appendBounded(current, chunk) {
  const next = current + chunk.toString("utf8");
  return next.length > serverOutputLimit ? next.slice(-serverOutputLimit) : next;
}

function processEnvironment(overrides = {}) {
  const environment = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    ...overrides,
  };
  for (const name of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "XDG_RUNTIME_DIR",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

async function gitCommonRoot() {
  const result = await execFileAsync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    {
      cwd: repositoryRoot,
      env: processEnvironment(),
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 4_096,
    },
  );
  return path.dirname(result.stdout.trim());
}

export async function readLiveEnvironment(target = envPath) {
  assert(await exists(target), "The ignored .env file is required for the live recording");
  const entry = await lstat(target);
  assert(entry.isFile() || entry.isSymbolicLink(), "The live .env entry is not a regular file or repository symlink");
  const [canonicalTarget, commonRoot] = await Promise.all([
    realpath(target),
    gitCommonRoot(),
  ]);
  assert(isStrictChild(commonRoot, canonicalTarget), "The live .env target escaped the repository");
  const metadata = await stat(canonicalTarget);
  assert(metadata.isFile(), "The live .env target is not a regular file");
  if (typeof process.getuid === "function") {
    assert(metadata.uid === process.getuid(), "The live .env target is not owned by the recording user");
  }
  assert((metadata.mode & 0o077) === 0, "The live .env target must be owner-only");
  assert(metadata.size > 0 && metadata.size <= 65_536, "The live .env target has an unsafe size");
  const handle = await open(
    canonicalTarget,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  let contents;
  try {
    const opened = await handle.stat();
    assert(
      opened.isFile() && opened.dev === metadata.dev && opened.ino === metadata.ino && opened.size === metadata.size,
      "The live .env target changed during validation",
    );
    contents = await handle.readFile({ encoding: "utf8" });
  } finally {
    await handle.close();
  }
  const parsed = parseEnv(contents);
  const usable = (value) =>
    typeof value === "string" &&
    value === value.trim() &&
    value.length > 0 &&
    !value.startsWith("replace-") &&
    !/\p{Cc}/u.test(value);
  assert(usable(parsed.ARK_API_KEY), "Live recording Ark key configuration is incomplete");
  assert(usable(parsed.ARK_MODEL), "Live recording Ark model configuration is incomplete");
  assert(usable(parsed.SHEPHERD_MODEL), "Live recording Shepherd model configuration is incomplete");
  const allowed = {
    ARK_API_KEY: parsed.ARK_API_KEY,
    ARK_MODEL: parsed.ARK_MODEL,
    SHEPHERD_MODEL: parsed.SHEPHERD_MODEL,
  };
  if (parsed.ARK_BASE_URL !== undefined) allowed.ARK_BASE_URL = parsed.ARK_BASE_URL;
  return allowed;
}

async function dockerIds(filters) {
  const args = ["ps", "--all", "--quiet"];
  for (const filter of filters) args.push("--filter", filter);
  const result = await execFileAsync("docker", args, {
    cwd: repositoryRoot,
    env: processEnvironment(),
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 65_536,
  });
  return result.stdout.trim().split(/\r?\n/u).filter(Boolean);
}

async function preflightDependencies() {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  assert(Number.isInteger(nodeMajor) && nodeMajor >= 22, "Node.js 22 or newer is required");
  const liveEnvironment = await readLiveEnvironment();
  await execFileAsync("docker", ["info"], {
    cwd: repositoryRoot,
    env: processEnvironment(),
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 262_144,
  });
  await execFileAsync("docker", ["image", "inspect", "volc-agent-runtime:local"], {
    cwd: repositoryRoot,
    env: processEnvironment(),
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 262_144,
  });
  const chromium = await loadHighQualityChromium();
  const browser = await chromium.launch({ headless: true, env: processEnvironment() });
  await browser.close();
  return liveEnvironment;
}

async function exactHead() {
  const result = await execFileAsync(
    "git",
    ["rev-parse", "HEAD"],
    {
      cwd: repositoryRoot,
      env: processEnvironment(),
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1_024,
    },
  );
  const head = result.stdout.trim();
  assert(/^[a-f0-9]{40}$/u.test(head), "Unable to resolve the exact recording commit");
  return head;
}

async function assertExactCommittedHead(expectedSha) {
  const result = await execFileAsync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    {
      cwd: repositoryRoot,
      env: processEnvironment(),
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 65_536,
    },
  );
  assert(result.stdout.length === 0, "Live recording requires an exact clean committed worktree");
  const head = await exactHead();
  if (expectedSha !== undefined) {
    assert(head === expectedSha, "Live recording HEAD does not match the reviewed commit");
  }
  return head;
}

async function syncDirectory(directory) {
  const handle = await open(
    directory,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function prepareAuthorizationRoot() {
  const tempRoot = path.join(repositoryRoot, ".tmp");
  const recordingRoot = path.join(tempRoot, "demo-recordings");
  await mkdir(recordingRoot, { recursive: true, mode: 0o700 });
  await assertRealDirectory(tempRoot, repositoryRoot);
  await assertRealDirectory(recordingRoot, tempRoot);
  await mkdir(authorizationRoot, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const canonical = await assertRealDirectory(authorizationRoot, recordingRoot);
  await chmod(canonical, 0o700);
  return canonical;
}

function authorizationInput() {
  const approvedSha = process.env.LIVE_DEMO_APPROVED_SHA?.trim() ?? "";
  const runId = process.env.LIVE_DEMO_RUN_ID?.trim() ?? "";
  assert(/^[a-f0-9]{40}$/u.test(approvedSha), "A reviewed exact live demo SHA is required");
  assert(runIdPattern.test(runId), "A safe one-shot live demo run ID is required");
  return { approvedSha, runId };
}

function authorizationPaths(root, runId) {
  return {
    authorized: path.join(root, `run-${runId}.authorized.json`),
    consumed: path.join(root, `run-${runId}.consumed.json`),
  };
}

export async function createRecordingAuthorization() {
  const input = authorizationInput();
  await assertExactCommittedHead(input.approvedSha);
  const root = await prepareAuthorizationRoot();
  const paths = authorizationPaths(root, input.runId);
  assert(!(await exists(paths.consumed)), "The one-shot live demo run ID was already consumed");
  const handle = await open(
    paths.authorized,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(
      `${JSON.stringify({ schemaVersion: 1, approvedSha: input.approvedSha, runId: input.runId })}\n`,
      "utf8",
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(root);
}

export async function consumeRecordingAuthorization() {
  const input = authorizationInput();
  await assertExactCommittedHead(input.approvedSha);
  const root = await prepareAuthorizationRoot();
  const paths = authorizationPaths(root, input.runId);
  assert(!(await exists(paths.consumed)), "The one-shot live demo run ID was already consumed");
  const handle = await open(
    paths.authorized,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await handle.stat();
    assert(metadata.isFile() && metadata.size > 0 && metadata.size <= 512, "Live demo authorization is invalid");
    const parsed = JSON.parse(await handle.readFile({ encoding: "utf8" }));
    assert(
      parsed.schemaVersion === 1 &&
        parsed.approvedSha === input.approvedSha &&
        parsed.runId === input.runId &&
        Object.keys(parsed).length === 3,
      "Live demo authorization does not match this invocation",
    );
  } finally {
    await handle.close();
  }
  await link(paths.authorized, paths.consumed);
  await syncDirectory(root);
  await unlink(paths.authorized);
  await syncDirectory(root);
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(processGroupId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processGroupExists(processGroupId);
}

async function stopProcessGroup(child) {
  if (!Number.isSafeInteger(child.pid) || child.pid <= 1) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000);
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGINT");
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw error;
  }
  if (await waitForProcessGroupExit(child.pid, 30_000)) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw error;
  }
  assert(
    await waitForProcessGroupExit(child.pid, 5_000),
    "Live application process group survived bounded cleanup",
  );
}

export async function startLiveApplication(
  port,
  liveEnvironment,
  authToken,
  { startupTimeoutMs = 180_000, onSpawn } = {},
) {
  const runtimeRoot = path.join(stateRoot, "runtime");
  const homeDirectory = path.join(stateRoot, "home");
  const tempDirectory = path.join(stateRoot, "tmp");
  await Promise.all([
    mkdir(runtimeRoot, { recursive: true, mode: 0o700 }),
    mkdir(homeDirectory, { recursive: true, mode: 0o700 }),
    mkdir(tempDirectory, { recursive: true, mode: 0o700 }),
  ]);
  const environment = processEnvironment({
    ...liveEnvironment,
    HOME: homeDirectory,
    TMPDIR: tempDirectory,
    HOST: "127.0.0.1",
    PORT: String(port),
    LOG_LEVEL: "warn",
    APP_AUTH_TOKEN: authToken,
    LOCAL_POC_STATE_MODE: "host-bind",
    LOCAL_POC_DATA_ROOT: runtimeRoot,
    RUNTIME_INSTANCE_ID: runtimeInstanceId,
    CONTAINER_ENGINE: "docker",
    CONTAINER_RUNTIME_IMAGE: "volc-agent-runtime:local",
    CODEX_SANDBOX_MODE: "workspace-write",
    SHEPHERD_EXECUTION_MODE: "live",
    SHEPHERD_DEMO_MODE: "true",
    SHEPHERD_AUTO_RESOLUTION: "true",
    SHEPHERD_DELETE_COMPLETED_PLANES: "false",
    SHEPHERD_MAX_PARALLEL_PLANES: "2",
    SHEPHERD_CONTRACT_TIMEOUT_MS: "900000",
    SHEPHERD_CANDIDATE_TIMEOUT_MS: "900000",
    SHEPHERD_VERIFICATION_TIMEOUT_MS: "120000",
  });
  const child = spawn(
    process.execPath,
    [path.join(repositoryRoot, "scripts", "start-local-poc-launcher.mjs")],
    {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true,
    },
  );
  onSpawn?.(child);
  let stdout = "";
  let stderr = "";
  let spawnError;
  child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
  child.once("error", (error) => { spawnError = error; });
  const baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + startupTimeoutMs;
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw new Error("Live application process could not start");
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error("Live application exited during fail-closed startup preflight");
      }
      try {
        const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(750) });
        if (response.ok) {
          return {
            baseURL,
            child,
            runtimeRoot,
            outputSizes: () => ({ stdout: stdout.length, stderr: stderr.length }),
          };
        }
      } catch {
        // Startup, Runtime image probing, and production build are still in progress.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Live application did not pass its bounded startup preflight");
  } catch (error) {
    await stopProcessGroup(child);
    throw error;
  }
}

async function apiJson(baseURL, route, options = {}, authToken = "") {
  const response = await fetch(`${baseURL}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Live demo API request failed with status ${response.status}`);
  return body;
}

async function verifyLiveStartup(baseURL, authToken) {
  const unauthorized = await fetch(`${baseURL}/api/shepherd/settings`, {
    signal: AbortSignal.timeout(5_000),
  });
  assert(unauthorized.status === 401, "The recording API accepted an unauthenticated mutation surface request");
  const [auth, system, settings] = await Promise.all([
    apiJson(baseURL, "/api/auth"),
    apiJson(baseURL, "/api/system", {}, authToken),
    apiJson(baseURL, "/api/shepherd/settings", {}, authToken),
  ]);
  assert(auth.required === true, "Recording server must enforce its ephemeral access token");
  assert(system.arkConfigured === true, "Ark Runtime was not configured");
  assert(system.codexAvailable === true, "Container Codex Runtime preflight did not pass");
  assert(system.runtimeProvider === "container", "Recording server is not using the container Runtime");
  assert(system.shepherdExecutionMode === "live", "Recording server is not explicitly live");
  assert(system.shepherdModelReviewConfigured === true, "Shepherd model reviewer was not configured");
  assert(settings.settings.autoResolution === true, "Automatic resolution must be enabled");
  assert(settings.settings.maxConcurrentPlanes === 2, "The recording must use two concurrent Planes");
  assert(settings.settings.modelReviewEnabled === true, "Shepherd model review must remain enabled");
}

function missionEntities(state, missionId) {
  return {
    mission: state.missions.find((item) => item.id === missionId),
    contracts: state.contracts.filter((item) => item.missionId === missionId),
    planes: state.planes.filter((item) => item.missionId === missionId),
    claims: state.claims.filter((item) => item.missionId === missionId),
    collisions: state.collisions.filter((item) => item.missionId === missionId),
    candidates: state.candidates.filter((item) => item.missionId === missionId),
    events: state.events.filter((item) => item.missionId === missionId),
  };
}

async function waitForState(baseURL, authToken, missionId, predicate, label, timeoutMs = 1_200_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    const response = await apiJson(baseURL, "/api/shepherd/state", {}, authToken);
    latest = response.state;
    const entities = missionEntities(latest, missionId);
    if (entities.mission && ["failed", "cancelled", "attention_required"].includes(entities.mission.state)) {
      throw new Error(`Live Mission reached ${entities.mission.state} before ${label}`);
    }
    if (predicate(entities)) return { state: latest, entities };
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Timed out while waiting for ${label}`);
}

async function assertNoDocumentOverflow(page) {
  const geometry = await page.evaluate(() => ({
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    },
    body: {
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
      scrollHeight: document.body.scrollHeight,
      clientHeight: document.body.clientHeight,
    },
  }));
  for (const value of Object.values(geometry)) {
    assert(value.scrollWidth <= value.clientWidth, "Recorded page has document-level horizontal overflow");
    assert(value.scrollHeight <= value.clientHeight, "Recorded page has document-level vertical overflow");
  }
}

async function waitForVisible(locator, timeout = 15_000) {
  await locator.waitFor({ state: "visible", timeout });
  return locator;
}

async function pause(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function installRecordingCursor(page) {
  await page.evaluate(() => {
    document.getElementById("shepherd-recording-cursor")?.remove();
    const cursor = document.createElement("div");
    cursor.id = "shepherd-recording-cursor";
    cursor.setAttribute("aria-hidden", "true");
    Object.assign(cursor.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "28px",
      height: "36px",
      zIndex: "2147483647",
      pointerEvents: "none",
      transform: "translate3d(42px, 42px, 0)",
      transformOrigin: "4px 4px",
      transition: "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)",
      background: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='36' viewBox='0 0 28 36'%3E%3Cpath d='M3 2.5v25.2l6.4-6.1 4.5 11.4 5.2-2.1-4.5-11.2h9.1L3 2.5Z' fill='white' stroke='%23181715' stroke-width='1.8' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat`,
      filter: "drop-shadow(0 1px 1px rgba(0,0,0,.22))",
    });
    document.body.append(cursor);
  });
}

async function smoothCursorTo(page, locator, duration = 650) {
  await locator.evaluate((element) => element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }));
  await pause(700);
  const box = await locator.boundingBox();
  assert(box && box.width > 0 && box.height > 0, "Recording target has no visible bounds");
  const x = box.x + Math.min(Math.max(box.width * 0.5, 8), box.width - 4);
  const y = box.y + Math.min(Math.max(box.height * 0.5, 8), box.height - 4);
  await page.evaluate(({ x: nextX, y: nextY, durationMs }) => {
    const cursor = document.getElementById("shepherd-recording-cursor");
    if (!cursor) throw new Error("Recording cursor is missing");
    cursor.style.transitionDuration = `${durationMs}ms`;
    cursor.style.transform = `translate3d(${nextX}px, ${nextY}px, 0)`;
  }, { x, y, durationMs: duration });
  await page.mouse.move(x, y, { steps: 28 });
  await pause(duration + 180);
}

async function humanClick(page, locator, { before = 650, after = 1_650 } = {}) {
  await smoothCursorTo(page, locator);
  await pause(before);
  await page.evaluate(() => {
    const cursor = document.getElementById("shepherd-recording-cursor");
    if (cursor) cursor.style.transform += " scale(.82)";
  });
  await pause(120);
  await locator.click();
  await page.evaluate(() => {
    const cursor = document.getElementById("shepherd-recording-cursor");
    if (cursor) cursor.style.transform = cursor.style.transform.replace(" scale(0.82)", "").replace(" scale(.82)", "");
  });
  await pause(after);
}

async function humanType(page, locator, value, delay = 32) {
  await humanClick(page, locator, { before: 350, after: 550 });
  await locator.fill("");
  await locator.pressSequentially(value, { delay });
  await pause(1_250);
}

function chapterRecorder(startedAt) {
  const chapters = [];
  return {
    chapters,
    mark(title, evidence) {
      chapters.push({
        title,
        evidence,
        offsetSeconds: Number(((performance.now() - startedAt) / 1_000).toFixed(3)),
      });
    },
  };
}

async function createAgent(page, name, preset, description) {
  await humanClick(page, page.getByRole("link", { name: "Create Agent", exact: true }).first(), {
    before: 750,
    after: 2_000,
  });
  await waitForVisible(page.getByRole("heading", { name: "Create Agent", exact: true }));
  await pause(1_800);
  await humanType(page, page.getByLabel("Agent name"), name, 70);
  await humanType(page, page.getByLabel("Description"), description, 35);
  await humanClick(page, page.getByRole("radio", { name: new RegExp(preset, "u") }).locator(".."));
  await humanClick(page, page.getByRole("button", { name: "Create Agent", exact: true }), {
    before: 1_200,
    after: 2_500,
  });
  await waitForVisible(page.getByRole("heading", { name, exact: true }));
  await waitForVisible(page.getByText("Shepherd route ready", { exact: true }));
}

async function sendManagedPrompt(page, agentName, prompt) {
  const composer = page.getByLabel(`Message ${agentName}`);
  await waitForVisible(composer);
  assert(await page.getByLabel("Route through Shepherd").isChecked(), "Agent was not routed through Shepherd by default");
  await humanType(page, composer, prompt, 31);
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/api\/shepherd\/agents\/[^/]+\/contracts$/u.test(response.url()),
    { timeout: 30_000 },
  );
  await pause(1_000);
  await composer.press("Enter");
  await pause(1_500);
  const response = await responsePromise;
  const body = await response.json();
  assert([201, 202].includes(response.status()), "Managed Contract intake failed");
  assert(body.executionMode === "live", "Managed Contract intake did not use live execution");
  assert(body.status !== "clarification_required", "Implicit-context prompt unexpectedly required clarification");
  return body;
}

async function clickFilter(page, name) {
  const button = page.getByRole("button", { name, exact: true });
  await humanClick(page, button, { before: 650, after: 1_000 });
  assert((await button.getAttribute("aria-pressed")) === "true", `The ${name} event filter did not activate`);
}

async function recordBrowserJourney(baseURL, authToken) {
  const rawVideoRoot = path.join(artifactRoot, "raw");
  await mkdir(rawVideoRoot, { recursive: true, mode: 0o700 });
  const chromium = await loadHighQualityChromium();
  const browser = await chromium.launch({
    headless: true,
    env: processEnvironment(),
  });
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    deviceScaleFactor: 1,
    recordVideo: { dir: rawVideoRoot, size: viewport },
    reducedMotion: "reduce",
    extraHTTPHeaders: { Authorization: `Bearer ${authToken}` },
  });
  await context.route("**/api/auth", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"required":false}' });
  });
  const page = await context.newPage();
  const video = page.video();
  assert(video, "Playwright did not attach a video recorder");
  const startedAt = performance.now();
  const chapter = chapterRecorder(startedAt);
  let missionId;
  let finalSnapshot;
  let journeyCompleted = false;
  try {
    await page.goto(`${baseURL}/shepherd`, { waitUntil: "networkidle" });
    await waitForVisible(page.getByRole("heading", { name: "Shepherd", exact: true }));
    await waitForVisible(page.getByText("Kernel online", { exact: true }));
    await installRecordingCursor(page);
    await assertNoDocumentOverflow(page);
    await pause(3_500);

    await createAgent(
      page,
      frontendAgentName,
      "Frontend",
      "Owns the Northstar customer portal authentication experience.",
    );
    await assertNoDocumentOverflow(page);
    chapter.mark("Create the bounded Frontend Agent", "User-created Frontend Agent is ready and routed through Shepherd by default.");
    await pause(5_000);

    await createAgent(
      page,
      backendAgentName,
      "Backend",
      "Owns authentication at the horizontally scaled support API boundary.",
    );
    await assertNoDocumentOverflow(page);
    chapter.mark("Create the bounded Backend Agent", "User-created Backend Agent is ready with a separate authority preset.");
    await pause(5_000);

    await humanClick(page, page.getByRole("link", { name: new RegExp(frontendAgentName, "u") }));
    const frontendResult = await sendManagedPrompt(page, frontendAgentName, frontendPrompt);
    assert(frontendResult.status === "awaiting_peer", "The first implicit-context Contract was not held for its peer");
    await waitForVisible(page.locator(".shepherd-contract-status").last());
    await assertNoDocumentOverflow(page);
    chapter.mark("Neutral Frontend request becomes a typed Contract draft", "The user asks for secure browser authentication without prescribing cookies or JWT; Shepherd validates and holds the bounded request.");
    await pause(8_000);

    await humanClick(page, page.getByRole("link", { name: new RegExp(backendAgentName, "u") }));
    const backendResult = await sendManagedPrompt(page, backendAgentName, backendPrompt);
    assert(backendResult.status === "accepted" && typeof backendResult.missionId === "string", "The peer request did not atomically start a Mission");
    missionId = backendResult.missionId;
    await waitForVisible(page.locator(".shepherd-contract-status").last());
    await assertNoDocumentOverflow(page);
    chapter.mark("Neutral Backend request atomically starts one Mission", "Neither request specifies a transport; each Agent must infer a locally reasonable choice from its scoped context.");
    await pause(8_000);

    await humanClick(page, page.getByRole("link", { name: /^Project Group/u }));
    await waitForVisible(page.getByRole("heading", { name: "Project Group", exact: true }));
    await assertNoDocumentOverflow(page);
    chapter.mark("One live Project Group binds the two independent requests", "The human intent, Shepherd, and both specialist Agents are now visible in one durable project conversation.");
    await pause(8_000);

    await humanClick(page, page.getByRole("link", { name: /^Shepherd/u }));
    await waitForVisible(page.getByRole("heading", { name: "Shepherd", exact: true }));
    await waitForVisible(page.getByText("Kernel online", { exact: true }));
    await assertNoDocumentOverflow(page);
    chapter.mark("Live execution begins in isolated Contract Planes", "The live timeline and Plane tree expose two independently executing, authority-bounded Agent futures.");
    await pause(8_000);

    const plannedSnapshot = await waitForState(
      baseURL,
      authToken,
      missionId,
      ({ contracts, planes }) => contracts.length === 2 && planes.filter((item) => item.kind === "contract").length === 2,
      "two live Contract Planes",
    );
    await pause(1_800);
    await assertNoDocumentOverflow(page);
    chapter.mark("Two live Contract executions are durable", "Both Contracts and their isolated Planes are persisted while the models work; self-report alone cannot mark either verified.");
    await pause(8_000);

    await clickFilter(page, "Contracts");
    const frontendContract = plannedSnapshot.entities.contracts.find((item) => item.title.toLowerCase().includes("frontend"));
    const backendContract = plannedSnapshot.entities.contracts.find((item) => item.title.toLowerCase().includes("backend"));
    assert(frontendContract && backendContract, "The two production Contracts were not persisted");
    for (const [contract, title, evidence] of [
      [frontendContract, "Inspect the complete Customer Portal execution Contract", "The original natural request is bound to the Frontend Agent, its scoped conventions, authority, expected artifact, semantic claim key, and trusted acceptance profile."],
      [backendContract, "Inspect the complete Support API execution Contract", "The Backend Agent receives a separate deployment context and write boundary; no transport value was supplied by the user."],
    ]) {
      const event = plannedSnapshot.entities.events.find((item) => item.type === "contract_created" && item.contractId === contract.id);
      assert(event, "A Contract creation event is missing");
      const card = page.locator("article.event-card").filter({ hasText: event.summary });
      await waitForVisible(card);
      await humanClick(page, card.getByText("View evidence", { exact: true }), { before: 800, after: 1_500 });
      await waitForVisible(card.getByLabel("Agent execution contract"));
      await assertNoDocumentOverflow(page);
      chapter.mark(title, evidence);
      await pause(10_000);
      await humanClick(page, card.getByText("View evidence", { exact: true }), { before: 700, after: 1_000 });
    }
    await clickFilter(page, "All");
    chapter.mark("Genuine live-model execution remains visible", "The UI continues polling real Runtime state while both model-backed Contract Planes execute; no deterministic result is injected into the browser.");
    await pause(5_000);

    const collisionSnapshot = await waitForState(
      baseURL,
      authToken,
      missionId,
      ({ contracts, collisions }) => contracts.length === 2 && contracts.every((item) => item.state === "verified") && collisions.length === 1,
      "independent Contract verification and semantic collision",
    );
    await pause(1_800);
    await clickFilter(page, "Verification");
    await waitForVisible(page.locator("article.event-card").filter({ hasText: "Verification passed" }).first());
    await assertNoDocumentOverflow(page);
    chapter.mark("Credential-free independent verification", "Both locally correct Agent outputs pass trusted checks outside the model Runtime.");
    await pause(8_000);

    const reviewEvent = collisionSnapshot.entities.events.find((item) => item.type === "model_review_completed");
    assert(reviewEvent, "The bounded live Shepherd model review did not complete");
    assert(!collisionSnapshot.entities.events.some((item) => item.type === "model_review_degraded"), "The live Shepherd model review degraded");
    await clickFilter(page, "All");
    const reviewCard = page.locator("article.event-card").filter({ hasText: reviewEvent.summary });
    await waitForVisible(reviewCard);
    await smoothCursorTo(page, reviewCard, 850);
    await assertNoDocumentOverflow(page);
    chapter.mark("Bounded advisory Shepherd model review", "The Shepherd model reviews cross-Contract meaning, but its bounded advisory output cannot verify Agents, select a winner, or promote code.");
    await pause(8_000);

    await clickFilter(page, "Collisions");
    const collisionEvent = collisionSnapshot.entities.events.find((item) => item.type === "collision_detected");
    assert(collisionEvent, "Collision event was not persisted");
    const collisionCard = page.locator("article.event-card").filter({ hasText: collisionEvent.summary });
    await waitForVisible(collisionCard);
    await humanClick(page, collisionCard.getByText("View evidence", { exact: true }), { before: 700, after: 1_300 });
    await assertNoDocumentOverflow(page);
    chapter.mark("Semantic collision that Git cannot detect", "Both Agents passed and changed different files, yet their corroborated auth.transport claims are mutually exclusive.");
    await pause(10_000);

    await waitForState(
      baseURL,
      authToken,
      missionId,
      ({ candidates, planes }) => candidates.length === 2 && planes.filter((item) => item.kind === "resolution").length === 2,
      "two same-base Resolution Planes",
    );
    await pause(1_800);
    await clickFilter(page, "Resolution");
    const collision = page.locator(".tree-collision");
    await waitForVisible(collision);
    if ((await collision.getAttribute("open")) === null) {
      await humanClick(page, collision.locator("summary"), { before: 650, after: 1_200 });
    }
    await assertNoDocumentOverflow(page);
    chapter.mark("Competing futures from one immutable integration commit", "Cookie and bearer Resolution Planes compete from the exact same base and face the same project invariant.");
    await pause(10_000);

    const completed = await waitForState(
      baseURL,
      authToken,
      missionId,
      ({ mission }) => mission.state === "completed",
      "verified selection and protected promotion",
    );
    finalSnapshot = completed.state;
    await pause(1_800);
    await clickFilter(page, "Resolution");
    const { entities } = completed;
    const selected = entities.candidates.find((item) => item.selectionState === "selected");
    const rejected = entities.candidates.find((item) => item.selectionState === "rejected");
    assert(selected && rejected, "Live resolution did not produce selected and rejected candidates");
    const selectedButton = page.locator("button.tree-node").filter({ hasText: selected.targetValue });
    await humanClick(page, selectedButton, { before: 900, after: 1_500 });
    const drawer = page.getByRole("dialog");
    await waitForVisible(drawer);
    await assertNoDocumentOverflow(page);
    chapter.mark("Objective candidate evidence and final re-verification", "The selected candidate passed both candidate verification and a distinct final promotion re-verification; the incompatible future remains retained as evidence.");
    await pause(10_000);

    const promotionTab = drawer.getByRole("tab", { name: "Final promotion re-verification" });
    if (await promotionTab.isVisible()) await humanClick(page, promotionTab, { before: 900, after: 1_200 });
    await pause(8_000);
    await page.keyboard.press("Escape");
    await clickFilter(page, "All");
    const promotionEvent = entities.events.find((item) => item.type === "promotion_completed");
    assert(promotionEvent, "Protected promotion event was not persisted");
    const promotionCard = page.locator("article.event-card").filter({ hasText: promotionEvent.summary });
    await waitForVisible(promotionCard);
    await smoothCursorTo(page, promotionCard, 850);
    await assertNoDocumentOverflow(page);
    chapter.mark("Expected-HEAD protected promotion and completed Mission", "Only the independently reverified future advances the protected branch; the complete causal evidence remains inspectable.");
    await pause(12_000);

    await humanClick(page, page.getByRole("link", { name: /^Project Group/u }));
    await waitForVisible(page.getByRole("heading", { name: "Project Group", exact: true }));
    await assertNoDocumentOverflow(page);
    chapter.mark("Project Group reports the completed production decision", "The human receives the verified collision, selected resolution, and protected promotion outcome in the shared project history.");
    await pause(10_000);

    await humanClick(page, page.getByRole("link", { name: /^Shepherd/u }));
    await waitForVisible(page.getByRole("heading", { name: "Shepherd", exact: true }));
    await assertNoDocumentOverflow(page);
    chapter.mark("Final live Shepherd overview", "Contracts, isolated Planes, semantic collision, competing futures, independent evidence, and protected promotion remain visible together.");
    await pause(12_000);
    journeyCompleted = true;
  } finally {
    if (journeyCompleted) {
      await finalizeRecordedVideo(context, video, browser, videoPath);
    } else {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }
  await rm(rawVideoRoot, { recursive: true, force: true });
  assert(missionId && finalSnapshot, "Live journey did not reach its acceptance boundary");
  return { missionId, finalSnapshot, chapters: chapter.chapters };
}

export async function finalizeRecordedVideo(context, video, browser, target) {
  let failure;
  try {
    await context.close();
    await video.saveAs(target);
  } catch (error) {
    failure = error;
  }
  try {
    await browser.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

function assertLiveEvidence(state, missionId) {
  const entities = missionEntities(state, missionId);
  assert(entities.mission?.state === "completed", "Live Mission was not completed");
  assert(entities.contracts.length === 2 && entities.contracts.every((item) => item.state === "verified"), "Both source Contracts must be verified");
  assert(entities.planes.filter((item) => item.kind === "contract").length === 2, "Two Contract Planes were not retained");
  assert(entities.planes.filter((item) => item.kind === "integration").length === 1, "The integration Plane was not retained");
  const resolutionPlanes = entities.planes.filter((item) => item.kind === "resolution");
  assert(resolutionPlanes.length === 2, "Two Resolution Planes were not retained");
  assert(resolutionPlanes.every((item) => typeof item.runtimeSessionEstablished === "boolean" ? item.runtimeSessionEstablished : true), "A live Resolution Plane did not establish a Runtime session");
  assert(entities.claims.filter((item) => item.key === "auth.transport").length >= 2, "Corroborated auth.transport claims are missing");
  assert(entities.collisions.length === 1 && entities.collisions[0].detectionMechanism === "deterministic", "Deterministic semantic collision evidence is missing");
  assert(entities.candidates.length === 2, "Both resolution candidates are missing");
  const selected = entities.candidates.find((item) => item.selectionState === "selected");
  const rejected = entities.candidates.find((item) => item.selectionState === "rejected");
  assert(selected?.targetValue === "http-only-session-cookie" && selected.executionState === "passed" && selected.promotionState === "promoted", "The expected secure candidate was not promoted");
  assert(rejected?.targetValue === "bearer-jwt" && rejected.executionState === "failed" && rejected.promotionState === "not_started", "The incompatible candidate was not rejected");
  assert(selected.verificationEvidence?.passed === true, "Candidate verification evidence is missing");
  assert(selected.promotionEvidence?.passed === true, "Final promotion re-verification evidence is missing");
  assert(selected.verificationEvidence.id !== selected.promotionEvidence.id, "Candidate and promotion evidence must be distinct");
  const eventTypes = new Set(entities.events.map((item) => item.type));
  for (const type of [
    "contract_created",
    "verification_passed",
    "model_review_completed",
    "collision_detected",
    "candidate_selected",
    "promotion_started",
    "promotion_completed",
    "mission_completed",
  ]) {
    assert(eventTypes.has(type), `Live evidence is missing ${type}`);
  }
  assert(!eventTypes.has("model_review_degraded"), "The live Shepherd model reviewer degraded during the recording");
  return {
    missionState: entities.mission.state,
    verifiedContracts: entities.contracts.length,
    retainedPlanes: entities.planes.length,
    corroboratedClaims: entities.claims.length,
    semanticCollisions: entities.collisions.length,
    resolutionCandidates: entities.candidates.length,
    selectedTransport: selected.targetValue,
    rejectedTransport: rejected.targetValue,
    finalReverification: true,
    protectedPromotion: true,
  };
}

async function findBundledFfmpeg() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
    ? path.resolve(repositoryRoot, process.env.PLAYWRIGHT_BROWSERS_PATH)
    : path.join(repositoryRoot, ".tmp", "playwright-browsers");
  const entries = await readdir(browsersRoot, { withFileTypes: true });
  const directory = entries.find((entry) => entry.isDirectory() && /^ffmpeg-\d+$/u.test(entry.name));
  assert(directory, "Playwright bundled ffmpeg is not installed");
  const executable = path.join(browsersRoot, directory.name, "ffmpeg-linux");
  const metadata = await stat(executable);
  assert(metadata.isFile() && (metadata.mode & 0o100) !== 0, "Playwright bundled ffmpeg is not executable");
  return executable;
}

async function runFfmpeg(ffmpeg, args, { allowFailure = false } = {}) {
  try {
    return await execFileAsync(ffmpeg, args, {
      cwd: repositoryRoot,
      env: processEnvironment(),
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 1_048_576,
    });
  } catch (error) {
    if (allowFailure) return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", failed: true };
    throw new Error("Bundled ffmpeg could not fully decode the recorded video");
  }
}

async function sha256(target) {
  const hash = createHash("sha256");
  hash.update(await readFile(target));
  return hash.digest("hex");
}

async function validateVideo(chapters) {
  const ffmpeg = await findBundledFfmpeg();
  await runFfmpeg(ffmpeg, [
    "-v", "error", "-i", videoPath,
    "-c:v", "png", "-f", "image2", "-update", "1", "-y", "/dev/null",
  ]);
  const probe = await runFfmpeg(ffmpeg, ["-hide_banner", "-i", videoPath], { allowFailure: true });
  const metadataText = `${probe.stdout}\n${probe.stderr}`;
  const durationMatch = metadataText.match(/Duration:\s*(\d+):(\d+):([\d.]+)/u);
  const dimensionMatch = metadataText.match(/Video:[^\n]*?(\d{3,5})x(\d{3,5})/u);
  assert(durationMatch && dimensionMatch, "Recorded video metadata could not be parsed");
  const durationSeconds = Number(durationMatch[1]) * 3_600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  const width = Number(dimensionMatch[1]);
  const height = Number(dimensionMatch[2]);
  const videoMetadata = await stat(videoPath);
  const averageBitrateMbps = videoMetadata.size * 8 / durationSeconds / 1_000_000;
  assert(width === viewport.width && height === viewport.height, "Recorded video is not 1920x1080");
  assert(Math.abs(width / height - 16 / 9) < 0.001, "Recorded video is not 16:9");
  assert(durationSeconds >= 60, "Recorded live demo is too short to contain the paced evidence tour");
  assert(averageBitrateMbps >= 8, "Recorded live demo did not meet the high-bitrate quality floor");

  const frameRoot = path.join(artifactRoot, "frames");
  await mkdir(frameRoot, { recursive: true, mode: 0o700 });
  const requestedFrames = [
    ["frontend-agent", "Create the bounded Frontend Agent"],
    ["backend-agent", "Create the bounded Backend Agent"],
    ["live-execution", "Live execution begins in isolated Contract Planes"],
    ["frontend-contract", "Inspect the complete Customer Portal execution Contract"],
    ["backend-contract", "Inspect the complete Support API execution Contract"],
    ["verification", "Credential-free independent verification"],
    ["collision", "Semantic collision that Git cannot detect"],
    ["candidates", "Competing futures from one immutable integration commit"],
    ["promotion", "Expected-HEAD protected promotion and completed Mission"],
    ["project-group", "Project Group reports the completed production decision"],
  ];
  const frames = [];
  for (const [name, title] of requestedFrames) {
    const chapter = chapters.find((item) => item.title === title);
    assert(chapter, `Missing chapter marker for ${title}`);
    const target = path.join(frameRoot, `${name}.png`);
    const timestamp = Math.min(Math.max(0, chapter.offsetSeconds + 1), Math.max(0, durationSeconds - 0.25));
    await runFfmpeg(ffmpeg, ["-v", "error", "-ss", timestamp.toFixed(3), "-i", videoPath, "-frames:v", "1", "-y", target]);
    const bytes = await readFile(target);
    assert(bytes.length > 24 && bytes.toString("ascii", 1, 4) === "PNG", "Representative frame is not a PNG");
    assert(bytes.readUInt32BE(16) === viewport.width && bytes.readUInt32BE(20) === viewport.height, "Representative frame is not 1920x1080");
    frames.push({ name, file: path.relative(artifactRoot, target), offsetSeconds: timestamp });
  }
  return {
    codecContainer: "WebM",
    width,
    height,
    aspectRatio: "16:9",
    frameRate: targetFrameRate,
    targetBitrateMbps,
    averageBitrateMbps: Number(averageBitrateMbps.toFixed(3)),
    fileSizeBytes: videoMetadata.size,
    durationSeconds,
    sha256: await sha256(videoPath),
    fullDecodePassed: true,
    frames,
  };
}

async function gitCommit() {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    env: processEnvironment(),
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 1_024,
  });
  const commit = result.stdout.trim();
  assert(/^[a-f0-9]{40}$/u.test(commit), "Unable to resolve the exact recording commit");
  return commit;
}

function timestamp(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

async function writeManifest(chapters, evidence, video) {
  const manifest = {
    schemaVersion: 1,
    title: "Shepherd live Northstar Customer Support Portal high-quality demo",
    recordedAt: new Date().toISOString(),
    commit: await gitCommit(),
    executionMode: "live",
    runtimeProvider: "container",
    demoMode: true,
    capture: {
      sourceFrameQuality: 100,
      frameRate: targetFrameRate,
      targetBitrateMbps,
      encoder: "VP8 good deadline, speed 2",
      visibleRecordingCursor: true,
      productUiModified: false,
    },
    modelUse: "Five expected requests: four isolated Agent/Candidate turns plus one bounded Shepherd semantic review. Worst case is seven because each of the two candidates may use its single built-in transient retry; the recorder itself initiates no retries.",
    video: {
      file: path.basename(videoPath),
      ...video,
    },
    chapters,
    evidence,
    limitations: [
      "This artifact proves one exact-head live run on the recorded host and configured model endpoints.",
      "Provider latency and model output remain external dependencies; deterministic verification and promotion gates remain authoritative.",
      "Raw model prompts/output, credentials, Runtime session identifiers, and private absolute paths are intentionally excluded.",
    ],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const markdown = [
    "# Shepherd live demo chapters",
    "",
    `Video: \`${path.basename(videoPath)}\` (${video.width}×${video.height}, ${video.aspectRatio}, ${video.durationSeconds.toFixed(2)} seconds)` ,
    "",
    ...chapters.flatMap((chapter) => [
      `- **${timestamp(chapter.offsetSeconds)} — ${chapter.title}**`,
      `  ${chapter.evidence}`,
    ]),
    "",
    `SHA-256: \`${video.sha256}\``,
    "",
  ].join("\n");
  await writeFile(manifestMarkdownPath, markdown, { encoding: "utf8", mode: 0o600 });
  return manifest;
}

async function assertContainerCleanup(dataDirectory) {
  const { resolveVerifierOwnerId } = await import("../apps/server/dist/config.js");
  const ownerId = await resolveVerifierOwnerId({ dataDirectory, runtimeInstanceId });
  const [runtimeIds, verifierIds] = await Promise.all([
    dockerIds([
      "label=io.codejam.launchpad=agent-runtime",
      `label=io.codejam.instance-id=${runtimeInstanceId}`,
    ]),
    dockerIds([
      "label=io.codejam.shepherd=independent-verifier",
      `label=io.codejam.verifier-owner=${ownerId}`,
    ]),
  ]);
  assert(runtimeIds.length === 0, "A recording-owned live Runtime container survived cleanup");
  assert(verifierIds.length === 0, "A recording-owned verifier container survived cleanup");
}

async function main() {
  const modeCount = [preflightOnly, authorizeOnly, consumeAuthorizationOnly].filter(Boolean).length;
  assert(modeCount <= 1, "Live recording command modes are mutually exclusive");
  if (authorizeOnly) {
    await createRecordingAuthorization();
    process.stdout.write("live_recording_authorization=created\n");
    return;
  }
  if (consumeAuthorizationOnly) {
    await consumeRecordingAuthorization();
    process.stdout.write("live_recording_authorization=consumed model_requests=0\n");
    return;
  }
  let app;
  let completed = false;
  let resultLine = "";
  if (!preflightOnly) await consumeRecordingAuthorization();
  const liveEnvironment = await preflightDependencies();
  const authToken = randomBytes(32).toString("base64url");
  await prepareManagedRoot(stateRoot, stateSentinel, stateSentinelValue);
  if (!preflightOnly) await prepareManagedRoot(artifactRoot, artifactSentinel, artifactSentinelValue);
  const port = await reserveLoopbackPort();
  try {
    app = await startLiveApplication(port, liveEnvironment, authToken);
    await verifyLiveStartup(app.baseURL, authToken);
    if (preflightOnly) {
      completed = true;
      resultLine = "live_recording_preflight=passed model_requests=0";
    } else {
      const journey = await recordBrowserJourney(app.baseURL, authToken);
      const evidence = assertLiveEvidence(journey.finalSnapshot, journey.missionId);
      const video = await validateVideo(journey.chapters);
      await writeManifest(journey.chapters, evidence, video);
      completed = true;
      resultLine = `live_recording=passed duration_seconds=${video.durationSeconds.toFixed(2)} sha256=${video.sha256}`;
    }
  } finally {
    if (app) await stopProcessGroup(app.child);
    const dataDirectory = path.join(stateRoot, "runtime", "data");
    if (await exists(dataDirectory)) await assertContainerCleanup(dataDirectory);
    if (completed || preflightOnly) {
      const canonicalState = await assertRealDirectory(stateRoot, path.join(repositoryRoot, ".tmp"));
      await chmod(canonicalState, 0o700);
      await rm(canonicalState, { recursive: true, force: true });
    }
  }
  if (resultLine) process.stdout.write(`${resultLine}\n`);
}

let executedDirectly = false;
try {
  if (process.argv[1]) {
    executedDirectly = (await realpath(path.resolve(process.argv[1]))) === (await realpath(scriptPath));
  }
} catch {
  executedDirectly = false;
}

if (executedDirectly) {
  try {
    await main();
  } catch {
    // Keep failed live attempts diagnosable through retained repository-local state
    // without allowing an exception stack, private path, provider output, or raw
    // Runtime diagnostic to cross the terminal boundary.
    process.stderr.write("live_recording=failed completion_claim=false\n");
    process.exitCode = 1;
  }
}
