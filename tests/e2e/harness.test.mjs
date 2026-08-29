import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  AUTH_TOKEN,
  isPortOpen,
  prepareHarnessRoot,
  repositoryRoot,
  startTestApp,
} from "./support/test-app.mjs";

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
    assert.equal(persistedState.includes(ambientArkCanary), false, "persisted state excludes ambient credentials");
    assert.equal(persistedState.includes(AUTH_TOKEN), false, "persisted state excludes harness credentials");
    assert.equal(JSON.stringify(systemInfo).includes(ambientArkCanary), false, "public system state excludes ambient credentials");
    assert.equal(JSON.stringify(systemInfo).includes(AUTH_TOKEN), false, "public system state excludes harness credentials");
    assert.equal(app.readOutput().includes(ambientArkCanary), false, "logs exclude ambient credentials");
    assert.equal(app.readOutput().includes(AUTH_TOKEN), false, "logs exclude harness credentials");
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

test("harness rejects a repo-contained symlinked managed ancestor", async () => {
  const caseRoot = await mkdtemp(path.join(repositoryRoot, ".tmp", "harness-security-"));
  const fakeRepository = path.join(caseRoot, "repository");
  const fakeTemp = path.join(fakeRepository, ".tmp");
  const outside = await mkdtemp(path.join(os.tmpdir(), "shepherd-harness-ancestor-"));
  const canary = path.join(outside, "canary.txt");
  try {
    await mkdir(fakeTemp, { recursive: true });
    await writeFile(canary, "unchanged\n", "utf8");
    await symlink(outside, path.join(fakeTemp, "playwright-harness"), "dir");
    await assert.rejects(
      prepareHarnessRoot(fakeRepository),
      /unsafe filesystem identity/u,
    );
    await access(canary);
  } finally {
    await rm(caseRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a retained stopped run root remains removable after restart failure", async () => {
  const app = await startTestApp();
  const { runRoot } = app;
  await app.stop({ removeRunRoot: false });
  try {
    await assert.rejects(
      startTestApp({
        runRoot,
        liveLegacyConfig: {
          arkApiKey: "fixture-only-not-live",
          arkModel: "fixture-only",
          arkBaseUrl: "https://example.invalid/api/v3",
          codexBin: path.join(runRoot, "missing-codex"),
        },
      }),
      /ENOENT/u,
    );
  } finally {
    await app.stop({ removeRunRoot: true });
  }
  await assert.rejects(access(runRoot));
});

test("a fresh run root is removed when pre-spawn setup fails", async () => {
  const harnessRoot = await prepareHarnessRoot();
  const before = (await readdir(harnessRoot)).filter((name) => name.startsWith("run-")).sort();
  await assert.rejects(
    startTestApp({
      liveLegacyConfig: {
        arkApiKey: "fixture-only-not-live",
        arkModel: "fixture-only",
        arkBaseUrl: "https://example.invalid/api/v3",
        codexBin: path.join(harnessRoot, "missing-codex"),
      },
    }),
    /ENOENT/u,
  );
  const after = (await readdir(harnessRoot)).filter((name) => name.startsWith("run-")).sort();
  assert.deepEqual(after, before, "failed setup leaves no newly allocated run root");
});

test("harness rejects a symlinked reusable run root", async () => {
  const harnessRoot = path.join(repositoryRoot, ".tmp", "playwright-harness");
  await mkdir(harnessRoot, { recursive: true, mode: 0o700 });
  const outside = await mkdtemp(path.join(os.tmpdir(), "shepherd-harness-outside-"));
  const link = path.join(harnessRoot, `run-symlink-${process.pid}`);
  try {
    await symlink(outside, link, "dir");
    await assert.rejects(
      startTestApp({ runRoot: link }),
      /unsafe filesystem identity/u,
    );
  } finally {
    await rm(link, { force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
