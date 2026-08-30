import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(supportDirectory, "../../..");
export const AUTH_TOKEN = "e2e-harness-token-2026-safe";
export const LEGACY_ARK_KEY = "e2e-fixture-ark-key-never-send";
const OUTPUT_LIMIT = 16_384;

function appendBounded(current, chunk) {
  const next = current + chunk.toString("utf8");
  return next.length > OUTPUT_LIMIT ? next.slice(-OUTPUT_LIMIT) : next;
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve test port");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(baseURL, child, readOutput, readSpawnError) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const spawnError = readSpawnError();
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) {
      const output = readOutput();
      throw new Error(`Test server exited before readiness (${child.exitCode ?? child.signalCode})\n${output}`);
    }
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // A refused connection is expected while Fastify is binding.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Test server did not become ready\n${readOutput()}`);
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

export async function isPortOpen(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

async function canonicalDirectory(directory, expectedParent, { create = false } = {}) {
  if (create) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const entry = await lstat(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error("Harness ancestor has an unsafe filesystem identity");
  }
  const canonical = await realpath(directory);
  if (canonical !== path.resolve(directory) || (expectedParent && path.dirname(canonical) !== expectedParent)) {
    throw new Error("Harness ancestor has an unsafe filesystem identity");
  }
  return canonical;
}

export async function prepareHarnessRoot(managedRepositoryRoot = repositoryRoot) {
  const canonicalRepository = await canonicalDirectory(managedRepositoryRoot);
  const tempRoot = await canonicalDirectory(path.join(canonicalRepository, ".tmp"), canonicalRepository, {
    create: true,
  });
  return await canonicalDirectory(path.join(tempRoot, "playwright-harness"), tempRoot, { create: true });
}

async function resolveRunRoot(harnessRoot, requestedRoot) {
  if (!requestedRoot) {
    const allocated = await mkdtemp(path.join(harnessRoot, "run-"));
    return { runRoot: await canonicalDirectory(allocated, harnessRoot), allocated: true };
  }
  const candidate = path.resolve(requestedRoot);
  if (
    path.dirname(candidate) !== harnessRoot ||
    !path.basename(candidate).startsWith("run-")
  ) {
    throw new Error("Existing harness state must be an allocated run root");
  }
  const entry = await lstat(candidate);
  if (entry.isSymbolicLink() || !entry.isDirectory() || (await realpath(candidate)) !== candidate) {
    throw new Error("Existing harness state has an unsafe filesystem identity");
  }
  return { runRoot: candidate, allocated: false };
}

async function removeManagedRunRoot(harnessRoot, runRoot) {
  const currentHarnessRoot = await prepareHarnessRoot(repositoryRoot);
  if (currentHarnessRoot !== harnessRoot) throw new Error("Harness root identity changed during cleanup");
  const candidate = path.resolve(runRoot);
  if (path.dirname(candidate) !== harnessRoot || !path.basename(candidate).startsWith("run-")) {
    throw new Error("Refusing to remove an unsafe harness path");
  }
  try {
    const entry = await lstat(candidate);
    if (entry.isSymbolicLink() || !entry.isDirectory() || (await realpath(candidate)) !== candidate) {
      throw new Error("Refusing to remove an unsafe harness path");
    }
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await rm(candidate, { recursive: true, force: true });
}

export async function startTestApp({
  agentRuntimeConfigured = false,
  legacyRuntime = false,
  liveLegacyConfig,
  modelReviewConfigured = false,
  runRoot: requestedRoot,
} = {}) {
  const harnessRoot = await prepareHarnessRoot();
  const { runRoot, allocated } = await resolveRunRoot(harnessRoot, requestedRoot);
  const dataDirectory = path.join(runRoot, "data");
  const workspaceRoot = path.join(runRoot, "workspaces");
  const codexHome = path.join(runRoot, "codex-home");
  const shepherdRoot = path.join(runRoot, "shepherd");
  const shepherdCodexHomeRoot = path.join(runRoot, "shepherd-codex-homes");
  const homeDirectory = path.join(runRoot, "home");
  const tempDirectory = path.join(runRoot, "tmp");
  let port;
  const fakeCodex = path.join(repositoryRoot, "tests/e2e/fixtures/fake-codex.mjs");
  const fakeContainerEngine = path.join(
    repositoryRoot,
    "tests/e2e/fixtures/fake-container-engine.mjs",
  );
  try {
    await Promise.all([
      mkdir(dataDirectory, { recursive: true, mode: 0o700 }),
      mkdir(workspaceRoot, { recursive: true, mode: 0o700 }),
      mkdir(homeDirectory, { recursive: true, mode: 0o700 }),
      mkdir(tempDirectory, { recursive: true, mode: 0o700 }),
    ]);
    port = await reserveLoopbackPort();
    await Promise.all([
      access(liveLegacyConfig?.codexBin ?? fakeCodex, constants.X_OK),
      access(fakeContainerEngine, constants.X_OK),
      access(path.join(repositoryRoot, "apps/server/dist/index.js"), constants.R_OK),
      access(path.join(repositoryRoot, "apps/web/dist/index.html"), constants.R_OK),
    ]);
  } catch (error) {
    if (allocated) await removeManagedRunRoot(harnessRoot, runRoot);
    throw error;
  }
  const baseURL = `http://127.0.0.1:${port}`;

  // This allowlist intentionally does not spread process.env: developer .env
  // values, Ark credentials, proxies, and ambient model configuration cannot
  // enter the deterministic server process.
  const childEnvironment = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    HOME: homeDirectory,
    TMPDIR: tempDirectory,
    HOST: "127.0.0.1",
    PORT: String(port),
    LOG_LEVEL: "warn",
    APP_DATA_DIR: dataDirectory,
    AGENT_WORKSPACE_ROOT: workspaceRoot,
    CODEX_HOME: codexHome,
    CODEX_BIN: liveLegacyConfig?.codexBin ?? fakeCodex,
    CODEX_SANDBOX_MODE: "workspace-write",
    CODEX_TIMEOUT_MS: liveLegacyConfig ? "180000" : "5000",
    CODEX_MAX_OUTPUT_BYTES: "65536",
    RUNTIME_PROVIDER: "local-process",
    CONTAINER_ENGINE: fakeContainerEngine,
    CONTAINER_RUNTIME_IMAGE: "fixture.invalid/shepherd:deterministic",
    RUNTIME_INSTANCE_ID: "playwright-harness",
    APP_AUTH_TOKEN: AUTH_TOKEN,
    ARK_API_KEY: liveLegacyConfig?.arkApiKey ?? (legacyRuntime || agentRuntimeConfigured
      ? LEGACY_ARK_KEY
      : modelReviewConfigured ? "fixture-review-key-never-send" : ""),
    ARK_MODEL: liveLegacyConfig?.arkModel ?? (legacyRuntime || agentRuntimeConfigured
      ? "fixture-legacy-model"
      : modelReviewConfigured ? "fixture-agent-model" : ""),
    SHEPHERD_MODEL: legacyRuntime && !liveLegacyConfig
      ? "fixture-shepherd-model"
      : modelReviewConfigured ? "fixture-review-model" : "",
    ARK_BASE_URL: liveLegacyConfig?.arkBaseUrl ?? "https://example.invalid/api/v3",
    SHEPHERD_ROOT: shepherdRoot,
    SHEPHERD_CODEX_HOME_ROOT: shepherdCodexHomeRoot,
    SHEPHERD_EXECUTION_MODE: "deterministic",
    SHEPHERD_DEMO_MODE: "true",
    SHEPHERD_AUTO_RESOLUTION: "true",
    SHEPHERD_DELETE_COMPLETED_PLANES: "false",
    SHEPHERD_MAX_PARALLEL_PLANES: "2",
    NODE_ENV: "production",
  };
  const child = spawn(process.execPath, ["apps/server/dist/index.js"], {
    cwd: repositoryRoot,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let spawnError;
  child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk); });
  child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk); });
  child.once("error", (error) => { spawnError = error; });
  const readOutput = () => [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

  try {
    await waitForHealth(baseURL, child, readOutput, () => spawnError);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await waitForExit(child, 2_000);
    if (allocated) await removeManagedRunRoot(harnessRoot, runRoot);
    throw error;
  }

  let stopped = false;
  return {
    baseURL,
    child,
    dataDirectory,
    port,
    readOutput,
    runRoot,
    async persistedState() {
      return await readFile(path.join(dataDirectory, "launchpad.json"), "utf8");
    },
    async stop({ removeRunRoot = true } = {}) {
      if (!stopped) {
        stopped = true;
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
        if (!(await waitForExit(child, 5_000))) {
          child.kill("SIGKILL");
          if (!(await waitForExit(child, 2_000))) {
            throw new Error("Test server did not terminate after SIGKILL");
          }
        }
      }
      if (removeRunRoot) await removeManagedRunRoot(harnessRoot, runRoot);
    },
  };
}
