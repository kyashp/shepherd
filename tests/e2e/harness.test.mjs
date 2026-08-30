import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
import {
  contrastRatio,
  normalizeEvidenceStage,
  uiGateEvidencePath,
} from "./support/ui-gate.mjs";

const execFileAsync = promisify(execFile);
const fakeCodex = path.join(repositoryRoot, "tests/e2e/fixtures/fake-codex.mjs");
const fakeContainerEngine = path.join(repositoryRoot, "tests/e2e/fixtures/fake-container-engine.mjs");

test("contrastRatio preserves the high contrast of white against the Shepherd surface", () => {
  assert.ok(contrastRatio("#ffffff", "#111827") > 15);
});

test("contrastRatio keeps the Shepherd lavender above the non-text threshold", () => {
  assert.ok(contrastRatio("#8773e8", "#0b1020") >= 3);
});

test("contrastRatio accepts computed rgb and rgba colors", () => {
  assert.ok(contrastRatio("rgb(255, 255, 255)", "rgba(17, 24, 39, 1)") > 15);
});

test("normalizeEvidenceStage produces an ASCII kebab-case evidence filename", () => {
  assert.equal(normalizeEvidenceStage("08 Shepherd / loading"), "08-shepherd-loading");
});

test("uiGateEvidencePath puts the normalized stage beneath its viewport evidence directory", () => {
  assert.ok(
    uiGateEvidencePath("1440x900", "08 Shepherd / loading").endsWith(
      path.join(".tmp", "playwright-evidence", "ui-gate", "1440x900", "08-shepherd-loading.png"),
    ),
  );
});

test("normalizeEvidenceStage rejects punctuation-only stages before they can name an evidence file", () => {
  assert.throws(() => normalizeEvidenceStage("... / !!!"), /evidence stage/i);
});

test("uiGateEvidencePath rejects unsupported viewport names", () => {
  assert.throws(() => uiGateEvidencePath("800x600", "shepherd"), /viewport/i);
});

function verifierCreateArgs({ name, source, target = "contract-fixture" }) {
  return [
    "create", "--init", "--name", name,
    "--label", "io.codejam.shepherd=independent-verifier",
    "--label", `io.codejam.verification-target=${target}`,
    "--label", "io.codejam.verifier-owner=fixture-owner",
    "--network", "none", "--read-only", "--security-opt", "no-new-privileges",
    "--cap-drop", "ALL", "--cpus", "1", "--memory", "256m", "--pids-limit", "64",
    "--user", "65532:65532", "--mount", `type=bind,src=${source},dst=/workspace,readonly`,
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m", "--workdir", "/workspace",
    "--entrypoint", "/usr/bin/env", "fixture.invalid/shepherd:deterministic", "-i",
    "HOME=/tmp", "TMPDIR=/tmp", "NO_COLOR=1", "CI=1",
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "node", "checks/frontend.cjs",
  ];
}

test("fake Codex fixture implements bounded deterministic version, run, and resume", async () => {
  const temporaryRoot = await realpath(os.tmpdir());
  const workspace = await mkdtemp(path.join(temporaryRoot, "shepherd-fake-codex-"));
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

test("fake container engine accepts only the bounded independent-verifier protocol", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shepherd-fake-container-"));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const checks = path.join(project, "checks");
  const environment = { HOME: home, PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" };
  const name = "shepherd-verify-contract-fixture-frontend-fixture";
  try {
    await mkdir(checks, { recursive: true });
    await writeFile(path.join(checks, "frontend.cjs"), "process.stdout.write('verified\\n');\n", "utf8");
    await execFileAsync(fakeContainerEngine, verifierCreateArgs({ name, source: project }), {
      encoding: "utf8",
      env: environment,
    });
    const started = await execFileAsync(fakeContainerEngine, ["start", "--attach", name], {
      encoding: "utf8",
      env: environment,
    });
    assert.equal(started.stdout, "verified\n");
    await execFileAsync(fakeContainerEngine, ["rm", "--force", name], { env: environment });

    const ledger = (await readFile(path.join(home, ".fake-container-engine", "ledger.jsonl"), "utf8"))
      .trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(ledger.map((entry) => entry.operation), ["create", "start", "complete", "remove"]);
    assert.equal(ledger[0].network, "none");
    assert.equal(ledger[0].readOnly, true);

    await assert.rejects(
      execFileAsync(fakeContainerEngine, ["run", "--privileged", "alpine"], { env: environment }),
      (error) => error.code === 2 && /unsupported operation/u.test(error.stderr),
    );
    const unsafe = verifierCreateArgs({ name: `${name}-unsafe`, source: project });
    unsafe[unsafe.indexOf("none")] = "host";
    await assert.rejects(
      execFileAsync(fakeContainerEngine, unsafe, { env: environment }),
      (error) => error.code === 2 && /expected none/u.test(error.stderr),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
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
        shepherdModelReviewConfigured: systemInfo.shepherdModelReviewConfigured,
      },
      {
        arkConfigured: false,
        codexAvailable: true,
        runtimeProvider: "local-process",
        shepherdExecutionMode: "deterministic",
        shepherdModelReviewConfigured: false,
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
