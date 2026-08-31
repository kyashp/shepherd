import { test, expect } from "./support/coverage-test.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DeterministicFixtureExecutor } from "../../apps/server/dist/shepherd/executor.js";
import { ShepherdService } from "../../apps/server/dist/shepherd/service.js";
import { HostTrustedFixtureVerifier } from "../../apps/server/dist/shepherd/test-fixtures/host-trusted-verifier.js";
import { JsonStore } from "../../apps/server/dist/store.js";
import { AUTH_TOKEN, isPortOpen, repositoryRoot, startTestApp } from "./support/test-app.mjs";

const execFileAsync = promisify(execFile);
const PRIVATE_CANARY = "E2E04-PRIVATE-CANARY-MUST-NOT-LEAK";

class UnauthorizedContractExecutor {
  kind = "deterministic_fixture";
  inner = new DeterministicFixtureExecutor();

  async run(request) {
    const result = await this.inner.run(request);
    if (request.operation.kind === "frontend_contract") {
      await writeFile(
        path.join(request.workspacePath, "policy.json"),
        JSON.stringify({ deniedCanary: PRIVATE_CANARY }) + "\n",
        "utf8",
      );
    }
    return result;
  }

  async cancel(executionId) {
    return await this.inner.cancel(executionId);
  }
}

async function seedUnauthorizedDenial({ dataDirectory, shepherdRoot, workspaceRoot }) {
  const store = new JsonStore(path.join(dataDirectory, "launchpad.json"), {
    sensitiveValues: [AUTH_TOKEN, PRIVATE_CANARY],
  });
  await store.initialize();
  const service = new ShepherdService({
    store,
    managedRoot: shepherdRoot,
    agentWorkspaceRoot: workspaceRoot,
    verifier: new HostTrustedFixtureVerifier(),
    executor: new UnauthorizedContractExecutor(),
  });
  await service.initialize();

  let rejection;
  try {
    await service.runDeterministicDemo();
  } catch (error) {
    rejection = error;
  }
  assert.match(String(rejection), /Scoped authority denied contract changes/u);

  const snapshot = store.snapshot();
  const mission = snapshot.shepherd.missions.at(-1);
  assert.equal(mission?.state, "failed");
  const deniedContract = snapshot.shepherd.contracts.find(
    (contract) => contract.missionId === mission?.id && contract.state === "authority_denied",
  );
  assert.equal(deniedContract?.failure?.code, "unauthorized_file_change");
  assert.equal(
    snapshot.shepherd.events.some(
      (event) => event.missionId === mission?.id && event.type === "promotion_started",
    ),
    false,
  );
  assert.equal(
    snapshot.shepherd.planes.some(
      (plane) => plane.missionId === mission?.id && plane.kind === "integration",
    ),
    false,
  );
  const project = snapshot.shepherd.projects.find((item) => item.id === mission?.projectId);
  assert.equal(project?.protectedHeadCommit, mission?.baseCommit);
  assert.ok(mission && deniedContract && project);
  return {
    deniedContractId: deniedContract.id,
    missionId: mission.id,
    protectedHead: project.protectedHeadCommit,
    repositoryPath: project.repositoryPath,
  };
}

function headers() {
  return { Authorization: `Bearer ${AUTH_TOKEN}` };
}

async function assertNoDocumentOverflow(page) {
  const geometry = await page.evaluate(() => ({
    document: [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.documentElement.scrollHeight, document.documentElement.clientHeight],
    body: [document.body.scrollWidth, document.body.clientWidth, document.body.scrollHeight, document.body.clientHeight],
  }));
  for (const [scrollWidth, clientWidth, scrollHeight, clientHeight] of Object.values(geometry)) {
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  }
}

async function assertSafeRenderedSurface(page) {
  await assertNoDocumentOverflow(page);
  const body = await page.locator("body").innerText();
  expect(body).not.toContain(AUTH_TOKEN);
  expect(body).not.toContain(PRIVATE_CANARY);
  expect(body).not.toContain(app.runRoot);
  expect(body).not.toContain(seed.repositoryPath);
  expect(body).not.toMatch(/worktreePath|workspacePath|repositoryPath|executionIdentity|runtimeSessionFingerprint|shepherdPromptVersion/iu);
  expect(body).not.toMatch(/Internal Server Error|TypeError:|ENOENT|EACCES/iu);
}

async function capture(page, testInfo, stage) {
  await assertSafeRenderedSurface(page);
  const viewport = page.viewportSize();
  expect(viewport).toEqual(testInfo.project.use.viewport);
  const root = process.env.E2E_UPDATE_EVIDENCE === "true"
    ? path.join(repositoryRoot, "docs/ui-review/e2e-04")
    : path.join(repositoryRoot, ".tmp/playwright-evidence/e2e-04");
  const directory = path.join(root, `${viewport.width}x${viewport.height}`);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${stage}.png`), fullPage: false });
}

let app;
let seed;

test.beforeEach(async () => {
  app = await startTestApp({
    beforeStart: async (paths) => {
      seed = await seedUnauthorizedDenial(paths);
    },
  });
});

test.afterEach(async () => {
  if (!app) return;
  const { port, runRoot } = app;
  await app.stop();
  expect(await isPortOpen(port)).toBe(false);
  await expect(access(runRoot)).rejects.toMatchObject({ code: "ENOENT" });
  app = undefined;
  seed = undefined;
});

test("visibly denies an unauthorized Contract diff with retained evidence and no promotion", async ({ page, request }, testInfo) => {
  const response = await request.get(`${app.baseURL}/api/shepherd/state`, { headers: headers() });
  expect(response.status()).toBe(200);
  const snapshot = (await response.json()).state;
  const mission = snapshot.missions.find((item) => item.id === seed.missionId);
  const deniedContract = snapshot.contracts.find((item) => item.id === seed.deniedContractId);
  expect(mission).toMatchObject({ state: "failed", baseCommit: seed.protectedHead });
  expect(deniedContract).toMatchObject({
    state: "authority_denied",
    failure: {
      code: "unauthorized_file_change",
      message: "Actual changes exceeded the Contract's scoped authority",
      stage: "contract_authority",
      retryable: false,
    },
  });
  expect(snapshot.events.some((event) => event.missionId === mission.id && event.type === "promotion_started")).toBe(false);
  expect(snapshot.candidates.filter((candidate) => candidate.missionId === mission.id)).toHaveLength(0);
  expect(snapshot.planes.some((plane) => plane.missionId === mission.id && plane.kind === "integration")).toBe(false);
  expect(JSON.stringify(snapshot)).not.toContain(PRIVATE_CANARY);
  const actualHead = (await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: seed.repositoryPath,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  })).stdout.trim();
  expect(actualHead).toBe(seed.protectedHead);

  await page.goto(`${app.baseURL}/shepherd`);
  await expect(page.getByLabel("Access token")).toBeFocused();
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();

  const denialHeading = page.getByRole("heading", { name: "Unauthorized changes denied" });
  await expect(denialHeading).toBeVisible();
  const failurePanel = denialHeading.locator("xpath=ancestor::section");
  await expect(failurePanel).toContainText("Actual changes exceeded the Contract's scoped authority");
  await expect(failurePanel).toContainText("Unauthorized File Change");
  await expect(failurePanel).toContainText("Contract Authority");
  await expect(failurePanel).toContainText("Protected promotion not started");
  await capture(page, testInfo, "01-authority-denied");

  const deniedCard = page.locator("article.event-card").filter({
    has: page.locator(".event-title .state-pill", { hasText: /^Authority Denied$/u }),
  });
  await expect(deniedCard).toHaveCount(1);
  const evidenceSummary = deniedCard.locator("summary", { hasText: "View evidence" });
  await evidenceSummary.scrollIntoViewIfNeeded();
  await evidenceSummary.focus();
  await expect(evidenceSummary).toBeFocused();
  await evidenceSummary.press("Enter");
  await expect(deniedCard.locator("details.event-evidence")).toHaveAttribute("open", "");
  await expect(deniedCard.getByLabel("Agent execution contract")).toContainText("Authority Denied");
  await expect(deniedCard).toContainText("Actual changes exceeded the Contract's scoped authority");
  await capture(page, testInfo, "02-denial-evidence");
});
