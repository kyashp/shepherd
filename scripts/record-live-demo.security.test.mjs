import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  consumeRecordingAuthorization,
  createRecordingAuthorization,
  readLiveEnvironment,
  startLiveApplication,
} from "./record-live-demo.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = path.join(repositoryRoot, ".tmp");

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function gitHead() {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return result.stdout.trim();
}

test("live env parsing fails closed on permissions and forwards only required keys", async () => {
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(path.join(tempRoot, "live-env-security-"));
  const fixture = path.join(root, ".env");
  try {
    await writeFile(
      fixture,
      [
        "ARK_API_KEY=test-key-never-send",
        "ARK_MODEL=test-agent-model",
        "SHEPHERD_MODEL=test-review-model",
        "UNRELATED_SECRET=must-not-be-forwarded",
        "SHEPHERD_EXECUTION_MODE=deterministic",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o644 },
    );
    await assert.rejects(readLiveEnvironment(fixture), /owner-only/u);
    await chmod(fixture, 0o600);
    const allowed = await readLiveEnvironment(fixture);
    assert.deepEqual(Object.keys(allowed).sort(), ["ARK_API_KEY", "ARK_MODEL", "SHEPHERD_MODEL"]);
    assert.equal("UNRELATED_SECRET" in allowed, false);
    assert.equal("SHEPHERD_EXECUTION_MODE" in allowed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup timeout kills the detached application process group", async () => {
  const port = await reserveLoopbackPort();
  let childPid;
  await assert.rejects(
    startLiveApplication(
      port,
      {
        ARK_API_KEY: "test-key-never-send",
        ARK_MODEL: "test-agent-model",
        SHEPHERD_MODEL: "test-review-model",
      },
      "ephemeral-test-auth-token",
      {
        startupTimeoutMs: 1,
        onSpawn(child) {
          childPid = child.pid;
        },
      },
    ),
    /bounded startup preflight/u,
  );
  assert(Number.isSafeInteger(childPid));
  assert.throws(() => process.kill(-childPid, 0), { code: "ESRCH" });
  const containers = await execFileAsync(
    "docker",
    [
      "ps",
      "--all",
      "--quiet",
      "--filter",
      "label=io.codejam.launchpad=agent-runtime",
      "--filter",
      "label=io.codejam.instance-id=shepherd-live-recording",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(containers.stdout.trim(), "");
  await rm(path.join(tempRoot, "live-demo-recording-state"), { recursive: true, force: true });
});

test("reviewed SHA authorization is exact and each run ID is consumed once", async () => {
  const previousSha = process.env.LIVE_DEMO_APPROVED_SHA;
  const previousRunId = process.env.LIVE_DEMO_RUN_ID;
  const runId = `security-${process.pid}-${randomBytes(4).toString("hex")}`;
  const guardRoot = path.join(tempRoot, "demo-recordings", ".live-demo-run-guards");
  const authorized = path.join(guardRoot, `run-${runId}.authorized.json`);
  const consumed = path.join(guardRoot, `run-${runId}.consumed.json`);
  try {
    process.env.LIVE_DEMO_APPROVED_SHA = "0".repeat(40);
    process.env.LIVE_DEMO_RUN_ID = runId;
    await assert.rejects(createRecordingAuthorization(), /reviewed commit/u);

    process.env.LIVE_DEMO_APPROVED_SHA = await gitHead();
    await createRecordingAuthorization();
    await assert.rejects(createRecordingAuthorization());
    await consumeRecordingAuthorization();
    assert.equal(JSON.parse(await readFile(consumed, "utf8")).runId, runId);
    await assert.rejects(consumeRecordingAuthorization(), /already consumed/u);
  } finally {
    if (previousSha === undefined) delete process.env.LIVE_DEMO_APPROVED_SHA;
    else process.env.LIVE_DEMO_APPROVED_SHA = previousSha;
    if (previousRunId === undefined) delete process.env.LIVE_DEMO_RUN_ID;
    else process.env.LIVE_DEMO_RUN_ID = previousRunId;
    await rm(authorized, { force: true });
    await rm(consumed, { force: true });
  }
});
