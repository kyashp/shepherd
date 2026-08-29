import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const supportDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(supportDirectory, "../../..");
export const AUTH_TOKEN = "e2e-harness-token-2026-safe";
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

export async function startTestApp() {
  const harnessRoot = path.join(repositoryRoot, ".tmp", "playwright-harness");
  await mkdir(harnessRoot, { recursive: true, mode: 0o700 });
  const runRoot = await mkdtemp(path.join(harnessRoot, "run-"));
  const dataDirectory = path.join(runRoot, "data");
  const workspaceRoot = path.join(runRoot, "workspaces");
  const codexHome = path.join(runRoot, "codex-home");
  const shepherdRoot = path.join(runRoot, "shepherd");
  const shepherdCodexHomeRoot = path.join(runRoot, "shepherd-codex-homes");
  const homeDirectory = path.join(runRoot, "home");
  const tempDirectory = path.join(runRoot, "tmp");
  await Promise.all([
    mkdir(dataDirectory, { recursive: true, mode: 0o700 }),
    mkdir(workspaceRoot, { recursive: true, mode: 0o700 }),
    mkdir(homeDirectory, { recursive: true, mode: 0o700 }),
    mkdir(tempDirectory, { recursive: true, mode: 0o700 }),
  ]);

  const port = await reserveLoopbackPort();
  const baseURL = `http://127.0.0.1:${port}`;
  const fakeCodex = path.join(repositoryRoot, "tests/e2e/fixtures/fake-codex.mjs");
  const fakeContainerEngine = path.join(
    repositoryRoot,
    "tests/e2e/fixtures/fake-container-engine.mjs",
  );
  await Promise.all([
    access(fakeCodex, constants.X_OK),
    access(fakeContainerEngine, constants.X_OK),
    access(path.join(repositoryRoot, "apps/server/dist/index.js"), constants.R_OK),
    access(path.join(repositoryRoot, "apps/web/dist/index.html"), constants.R_OK),
  ]);

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
    CODEX_BIN: fakeCodex,
    CODEX_SANDBOX_MODE: "workspace-write",
    CODEX_TIMEOUT_MS: "5000",
    CODEX_MAX_OUTPUT_BYTES: "65536",
    RUNTIME_PROVIDER: "local-process",
    CONTAINER_ENGINE: fakeContainerEngine,
    CONTAINER_RUNTIME_IMAGE: "fixture.invalid/shepherd:deterministic",
    RUNTIME_INSTANCE_ID: "playwright-harness",
    APP_AUTH_TOKEN: AUTH_TOKEN,
    ARK_API_KEY: "",
    ARK_MODEL: "",
    SHEPHERD_MODEL: "",
    ARK_BASE_URL: "https://example.invalid/api/v3",
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
    await rm(runRoot, { recursive: true, force: true });
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
    async stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      if (!(await waitForExit(child, 5_000))) {
        child.kill("SIGKILL");
        if (!(await waitForExit(child, 2_000))) {
          throw new Error("Test server did not terminate after SIGKILL");
        }
      }
      await rm(runRoot, { recursive: true, force: true });
    },
  };
}
