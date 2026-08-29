import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { AUTH_TOKEN, isPortOpen, repositoryRoot, startTestApp } from "./support/test-app.mjs";

const execFileAsync = promisify(execFile);
const fakeCodex = path.join(repositoryRoot, "tests/e2e/fixtures/fake-codex.mjs");

test("fake Codex fixture implements bounded deterministic version, run, and resume", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "shepherd-fake-codex-"));
  try {
    const version = await execFileAsync(fakeCodex, ["--version"], { encoding: "utf8" });
    assert.equal(version.stdout, "codex-cli 0.111.0\n");

    const first = await execFileAsync(
      fakeCodex,
      ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "-C", workspace, "first"],
      { encoding: "utf8" },
    );
    const firstEvents = first.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(firstEvents.map((event) => event.type), [
      "thread.started",
      "item.completed",
      "turn.completed",
    ]);
    const threadId = firstEvents[0].thread_id;
    assert.match(threadId, /^fixture-[a-f0-9]{16}$/u);

    const resumed = await execFileAsync(
      fakeCodex,
      ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "-C", workspace, "resume", threadId, "again"],
      { encoding: "utf8" },
    );
    const resumedEvents = resumed.stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(resumedEvents[0].thread_id, threadId);
    assert.doesNotMatch(resumed.stdout, /first|again/u);

    await assert.rejects(
      execFileAsync(
        fakeCodex,
        ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "-C", workspace, "x".repeat(65_537)],
        { encoding: "utf8" },
      ),
      (error) => error.code === 2 && /invalid thread or prompt/u.test(error.stderr),
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("isolated harness starts the authenticated real app and cleans up", async () => {
  const ambientArkCanary = "ambient-ark-key-must-not-cross-process-boundary";
  const previousArkKey = process.env.ARK_API_KEY;
  process.env.ARK_API_KEY = ambientArkCanary;
  let app;
  try {
    app = await startTestApp();
    const health = await fetch(`${app.baseURL}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "volc-agent-launchpad" });

    const auth = await fetch(`${app.baseURL}/api/auth`);
    assert.deepEqual(await auth.json(), { required: true });
    assert.equal((await fetch(`${app.baseURL}/api/system`)).status, 401);

    const system = await fetch(`${app.baseURL}/api/system`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    assert.equal(system.status, 200);
    const systemInfo = await system.json();
    assert.deepEqual(
      {
        arkConfigured: systemInfo.arkConfigured,
        codexAvailable: systemInfo.codexAvailable,
        runtimeProvider: systemInfo.runtimeProvider,
        shepherdExecutionMode: systemInfo.shepherdExecutionMode,
      },
      {
        arkConfigured: false,
        codexAvailable: true,
        runtimeProvider: "local-process",
        shepherdExecutionMode: "deterministic",
      },
    );

    const html = await fetch(`${app.baseURL}/shepherd`);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /<div id="root"><\/div>/u);
    const persistedState = await app.persistedState();
    assert.doesNotMatch(persistedState, new RegExp(ambientArkCanary, "u"));
    assert.doesNotMatch(persistedState, new RegExp(AUTH_TOKEN, "u"));
    assert.doesNotMatch(JSON.stringify(systemInfo), new RegExp(ambientArkCanary, "u"));
    assert.doesNotMatch(JSON.stringify(systemInfo), new RegExp(AUTH_TOKEN, "u"));
    assert.doesNotMatch(app.readOutput(), new RegExp(ambientArkCanary, "u"));
    assert.doesNotMatch(app.readOutput(), new RegExp(AUTH_TOKEN, "u"));
  } finally {
    if (previousArkKey === undefined) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = previousArkKey;
    if (app) {
      const { port, runRoot } = app;
      await app.stop();
      await assert.rejects(access(runRoot));
      assert.equal(await isPortOpen(port), false);
    }
  }
});
