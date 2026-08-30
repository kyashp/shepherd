#!/usr/bin/env node

import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const envPath = path.join(repositoryRoot, ".env");
const stateRoot = path.join(repositoryRoot, ".tmp", "live-demo-recording-state");
const artifactRoot = path.join(repositoryRoot, ".tmp", "demo-recordings", "live");
const stateSentinel = path.join(stateRoot, ".live-demo-state-root");
const artifactSentinel = path.join(artifactRoot, ".live-demo-artifact-root");
const stateSentinelValue = "Shepherd live demo recording state\n";
const artifactSentinelValue = "Shepherd live demo recording artifacts\n";
const videoPath = path.join(artifactRoot, "shepherd-live-demo.webm");
const manifestPath = path.join(artifactRoot, "chapters.json");
const manifestMarkdownPath = path.join(artifactRoot, "CHAPTERS.md");
const serverOutputLimit = 16_384;
const runtimeInstanceId = "shepherd-live-recording";
const viewport = { width: 1_920, height: 1_080 };
const preflightOnly = process.argv.slice(2).includes("--preflight-only");

const frontendPrompt =
  "Implement the browser authentication client using the conventions and interfaces already present in your assigned workspace.";

const backendPrompt =
  "Implement the authentication service using the deployment conventions and interfaces already present in your assigned workspace.";

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

async function readConfiguredState() {
  assert(await exists(envPath), "The ignored .env file is required for the live recording");
  const program = [
    "const usable = (value) => typeof value === 'string' && value.trim().length > 0 && !value.trim().startsWith('replace-');",
    "process.stdout.write(JSON.stringify({",
    "arkKey: usable(process.env.ARK_API_KEY),",
    "arkModel: usable(process.env.ARK_MODEL),",
    "shepherdModel: usable(process.env.SHEPHERD_MODEL),",
    "}));",
  ].join("");
  const result = await execFileAsync(
    process.execPath,
    [`--env-file=${envPath}`, "--input-type=module", "--eval", program],
    {
      cwd: repositoryRoot,
      env: processEnvironment(),
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1_024,
    },
  );
  const configured = JSON.parse(result.stdout);
  assert(configured.arkKey && configured.arkModel && configured.shepherdModel, "Live recording model configuration is incomplete");
  return configured;
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
  await readConfiguredState();
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
  const browser = await chromium.launch({ headless: true, env: processEnvironment() });
  await browser.close();
}

async function assertExactCommittedHead() {
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

async function stopProcessGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGINT");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  if (await waitForExit(child, 30_000)) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await waitForExit(child, 5_000);
}

async function startLiveApplication(port) {
  const runtimeRoot = path.join(stateRoot, "runtime");
  const homeDirectory = path.join(stateRoot, "home");
  const tempDirectory = path.join(stateRoot, "tmp");
  await Promise.all([
    mkdir(runtimeRoot, { recursive: true, mode: 0o700 }),
    mkdir(homeDirectory, { recursive: true, mode: 0o700 }),
    mkdir(tempDirectory, { recursive: true, mode: 0o700 }),
  ]);
  const environment = processEnvironment({
    HOME: homeDirectory,
    TMPDIR: tempDirectory,
    HOST: "127.0.0.1",
    PORT: String(port),
    LOG_LEVEL: "warn",
    APP_AUTH_TOKEN: "",
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
    [`--env-file=${envPath}`, path.join(repositoryRoot, "scripts", "start-local-poc-launcher.mjs")],
    {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  let spawnError;
  child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
  child.once("error", (error) => { spawnError = error; });
  const baseURL = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 180_000;
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
}

async function apiJson(baseURL, route, options = {}) {
  const response = await fetch(`${baseURL}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Live demo API request failed with status ${response.status}`);
  return body;
}

async function verifyLiveStartup(baseURL) {
  const [auth, system, settings] = await Promise.all([
    apiJson(baseURL, "/api/auth"),
    apiJson(baseURL, "/api/system"),
    apiJson(baseURL, "/api/shepherd/settings"),
  ]);
  assert(auth.required === false, "Recording server must not expose an unlock credential");
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

async function waitForState(baseURL, missionId, predicate, label, timeoutMs = 1_200_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    const response = await apiJson(baseURL, "/api/shepherd/state");
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

async function createAgent(page, name, preset) {
  await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
  await waitForVisible(page.getByRole("heading", { name: "Create Agent", exact: true }));
  await page.getByLabel("Agent name").fill(name);
  await page.getByRole("radio", { name: new RegExp(preset, "u") }).locator("..").click();
  await page.getByRole("button", { name: "Create Agent", exact: true }).click();
  await waitForVisible(page.getByRole("heading", { name, exact: true }));
  await waitForVisible(page.getByText("Shepherd route ready", { exact: true }));
}

async function sendManagedPrompt(page, agentName, prompt) {
  const composer = page.getByLabel(`Message ${agentName}`);
  await waitForVisible(composer);
  assert(await page.getByLabel("Route through Shepherd").isChecked(), "Agent was not routed through Shepherd by default");
  await composer.fill(prompt);
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && /\/api\/shepherd\/agents\/[^/]+\/contracts$/u.test(response.url()),
    { timeout: 30_000 },
  );
  await composer.press("Enter");
  const response = await responsePromise;
  const body = await response.json();
  assert([201, 202].includes(response.status()), "Managed Contract intake failed");
  assert(body.executionMode === "live", "Managed Contract intake did not use live execution");
  assert(body.status !== "clarification_required", "Implicit-context prompt unexpectedly required clarification");
  return body;
}

async function clickFilter(page, name) {
  const button = page.getByRole("button", { name, exact: true });
  await button.click();
  assert((await button.getAttribute("aria-pressed")) === "true", `The ${name} event filter did not activate`);
}

async function recordBrowserJourney(baseURL) {
  const rawVideoRoot = path.join(artifactRoot, "raw");
  await mkdir(rawVideoRoot, { recursive: true, mode: 0o700 });
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
  });
  const page = await context.newPage();
  const video = page.video();
  assert(video, "Playwright did not attach a video recorder");
  const startedAt = performance.now();
  const chapter = chapterRecorder(startedAt);
  let missionId;
  let finalSnapshot;
  try {
    await page.goto(`${baseURL}/settings`, { waitUntil: "networkidle" });
    await waitForVisible(page.getByRole("heading", { name: "Settings", exact: true }));
    await waitForVisible(page.getByText("Live", { exact: true }));
    await assertNoDocumentOverflow(page);
    chapter.mark("Live Runtime and trusted-kernel configuration", "Settings visibly reports Live execution; the server preflight independently proved the container Runtime and model reviewer are configured.");
    await pause(8_000);

    await createAgent(page, "Frontend Auth Agent", "Frontend");
    await assertNoDocumentOverflow(page);
    chapter.mark("Create the bounded Frontend Agent", "User-created Frontend Agent is ready and routed through Shepherd by default.");
    await pause(5_000);

    await createAgent(page, "Backend Auth Agent", "Backend");
    await assertNoDocumentOverflow(page);
    chapter.mark("Create the bounded Backend Agent", "User-created Backend Agent is ready with a separate authority preset.");
    await pause(5_000);

    await page.getByRole("link", { name: /Frontend Auth Agent/u }).click();
    const frontendResult = await sendManagedPrompt(page, "Frontend Auth Agent", frontendPrompt);
    assert(frontendResult.status === "awaiting_peer", "The first implicit-context Contract was not held for its peer");
    await waitForVisible(page.locator(".shepherd-contract-status").last());
    await assertNoDocumentOverflow(page);
    chapter.mark("Neutral Frontend request becomes a typed Contract draft", "The user asks for secure browser authentication without prescribing cookies or JWT; Shepherd validates and holds the bounded request.");
    await pause(8_000);

    await page.getByRole("link", { name: /Backend Auth Agent/u }).click();
    const backendResult = await sendManagedPrompt(page, "Backend Auth Agent", backendPrompt);
    assert(backendResult.status === "accepted" && typeof backendResult.missionId === "string", "The peer request did not atomically start a Mission");
    missionId = backendResult.missionId;
    await waitForVisible(page.locator(".shepherd-contract-status").last());
    await assertNoDocumentOverflow(page);
    chapter.mark("Neutral Backend request atomically starts one Mission", "Neither request specifies a transport; each Agent must infer a locally reasonable choice from its scoped context.");
    await pause(8_000);

    await page.getByRole("link", { name: /^Shepherd/u }).click();
    await waitForVisible(page.getByRole("heading", { name: "Shepherd", exact: true }));
    await waitForVisible(page.getByText("Kernel online", { exact: true }));
    await assertNoDocumentOverflow(page);
    chapter.mark("Live execution begins in isolated Contract Planes", "The live timeline and Plane tree expose two independently executing, authority-bounded Agent futures.");
    await pause(8_000);

    await waitForState(
      baseURL,
      missionId,
      ({ contracts, planes }) => contracts.length === 2 && planes.filter((item) => item.kind === "contract").length === 2,
      "two live Contract Planes",
    );
    await page.reload({ waitUntil: "networkidle" });
    await assertNoDocumentOverflow(page);
    chapter.mark("Two live Contract executions are durable", "Both Contracts and their isolated Planes are persisted while the models work; self-report alone cannot mark either verified.");
    await pause(8_000);

    const collisionSnapshot = await waitForState(
      baseURL,
      missionId,
      ({ contracts, collisions }) => contracts.length === 2 && contracts.every((item) => item.state === "verified") && collisions.length === 1,
      "independent Contract verification and semantic collision",
    );
    await page.reload({ waitUntil: "networkidle" });
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
    await reviewCard.scrollIntoViewIfNeeded();
    await assertNoDocumentOverflow(page);
    chapter.mark("Bounded advisory Shepherd model review", "The Shepherd model reviews cross-Contract meaning, but its bounded advisory output cannot verify Agents, select a winner, or promote code.");
    await pause(8_000);

    await clickFilter(page, "Collisions");
    const collisionEvent = collisionSnapshot.entities.events.find((item) => item.type === "collision_detected");
    assert(collisionEvent, "Collision event was not persisted");
    const collisionCard = page.locator("article.event-card").filter({ hasText: collisionEvent.summary });
    await waitForVisible(collisionCard);
    await collisionCard.getByText("View evidence", { exact: true }).click();
    await assertNoDocumentOverflow(page);
    chapter.mark("Semantic collision that Git cannot detect", "Both Agents passed and changed different files, yet their corroborated auth.transport claims are mutually exclusive.");
    await pause(10_000);

    await waitForState(
      baseURL,
      missionId,
      ({ candidates, planes }) => candidates.length === 2 && planes.filter((item) => item.kind === "resolution").length === 2,
      "two same-base Resolution Planes",
    );
    await page.reload({ waitUntil: "networkidle" });
    await clickFilter(page, "Resolution");
    const collision = page.locator(".tree-collision");
    await waitForVisible(collision);
    if ((await collision.getAttribute("open")) === null) await collision.locator("summary").click();
    await assertNoDocumentOverflow(page);
    chapter.mark("Competing futures from one immutable integration commit", "Cookie and bearer Resolution Planes compete from the exact same base and face the same project invariant.");
    await pause(10_000);

    const completed = await waitForState(
      baseURL,
      missionId,
      ({ mission }) => mission.state === "completed",
      "verified selection and protected promotion",
    );
    finalSnapshot = completed.state;
    await page.reload({ waitUntil: "networkidle" });
    await clickFilter(page, "Resolution");
    const { entities } = completed;
    const selected = entities.candidates.find((item) => item.selectionState === "selected");
    const rejected = entities.candidates.find((item) => item.selectionState === "rejected");
    assert(selected && rejected, "Live resolution did not produce selected and rejected candidates");
    const selectedButton = page.locator("button.tree-node").filter({ hasText: selected.targetValue });
    await selectedButton.scrollIntoViewIfNeeded();
    await selectedButton.click();
    const drawer = page.getByRole("dialog");
    await waitForVisible(drawer);
    await assertNoDocumentOverflow(page);
    chapter.mark("Objective candidate evidence and final re-verification", "The selected candidate passed both candidate verification and a distinct final promotion re-verification; the incompatible future remains retained as evidence.");
    await pause(10_000);

    const promotionTab = drawer.getByRole("tab", { name: "Final promotion re-verification" });
    if (await promotionTab.isVisible()) await promotionTab.click();
    await pause(8_000);
    await page.keyboard.press("Escape");
    await clickFilter(page, "All");
    const promotionEvent = entities.events.find((item) => item.type === "promotion_completed");
    assert(promotionEvent, "Protected promotion event was not persisted");
    const promotionCard = page.locator("article.event-card").filter({ hasText: promotionEvent.summary });
    await waitForVisible(promotionCard);
    await promotionCard.scrollIntoViewIfNeeded();
    await assertNoDocumentOverflow(page);
    chapter.mark("Expected-HEAD protected promotion and completed Mission", "Only the independently reverified future advances the protected branch; the complete causal evidence remains inspectable.");
    await pause(12_000);
  } finally {
    await context.close();
    await browser.close();
  }
  await video.saveAs(videoPath);
  await rm(rawVideoRoot, { recursive: true, force: true });
  assert(missionId && finalSnapshot, "Live journey did not reach its acceptance boundary");
  return { missionId, finalSnapshot, chapters: chapter.chapters };
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
    "contract_verified",
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
  await runFfmpeg(ffmpeg, ["-v", "error", "-i", videoPath, "-f", "null", "-"]);
  const probe = await runFfmpeg(ffmpeg, ["-hide_banner", "-i", videoPath], { allowFailure: true });
  const metadataText = `${probe.stdout}\n${probe.stderr}`;
  const durationMatch = metadataText.match(/Duration:\s*(\d+):(\d+):([\d.]+)/u);
  const dimensionMatch = metadataText.match(/Video:[^\n]*?(\d{3,5})x(\d{3,5})/u);
  assert(durationMatch && dimensionMatch, "Recorded video metadata could not be parsed");
  const durationSeconds = Number(durationMatch[1]) * 3_600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  const width = Number(dimensionMatch[1]);
  const height = Number(dimensionMatch[2]);
  assert(width === viewport.width && height === viewport.height, "Recorded video is not 1920x1080");
  assert(Math.abs(width / height - 16 / 9) < 0.001, "Recorded video is not 16:9");
  assert(durationSeconds >= 60, "Recorded live demo is too short to contain the paced evidence tour");

  const frameRoot = path.join(artifactRoot, "frames");
  await mkdir(frameRoot, { recursive: true, mode: 0o700 });
  const requestedFrames = [
    ["live-status", "Live Runtime and trusted-kernel configuration"],
    ["contracts", "Two live Contract executions are durable"],
    ["live-execution", "Live execution begins in isolated Contract Planes"],
    ["collision", "Semantic collision that Git cannot detect"],
    ["candidates", "Competing futures from one immutable integration commit"],
    ["promotion", "Expected-HEAD protected promotion and completed Mission"],
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
    title: "Shepherd live implicit-context authentication demo",
    recordedAt: new Date().toISOString(),
    commit: await gitCommit(),
    executionMode: "live",
    runtimeProvider: "container",
    demoMode: true,
    modelUse: "Four isolated Agent/Candidate turns plus one bounded Shepherd semantic review; no retries are initiated by the recorder.",
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
  let app;
  let completed = false;
  let resultLine = "";
  await preflightDependencies();
  if (!preflightOnly) await assertExactCommittedHead();
  await prepareManagedRoot(stateRoot, stateSentinel, stateSentinelValue);
  if (!preflightOnly) await prepareManagedRoot(artifactRoot, artifactSentinel, artifactSentinelValue);
  const port = await reserveLoopbackPort();
  try {
    app = await startLiveApplication(port);
    await verifyLiveStartup(app.baseURL);
    if (preflightOnly) {
      completed = true;
      resultLine = "live_recording_preflight=passed model_requests=0";
    } else {
      const journey = await recordBrowserJourney(app.baseURL);
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

await main();
