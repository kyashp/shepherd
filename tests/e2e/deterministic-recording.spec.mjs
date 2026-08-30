import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeterministicFixtureExecutor } from "../../apps/server/dist/shepherd/executor.js";
import { ShepherdService } from "../../apps/server/dist/shepherd/service.js";
import { HostTrustedFixtureVerifier } from "../../apps/server/dist/shepherd/test-fixtures/host-trusted-verifier.js";
import { JsonStore } from "../../apps/server/dist/store.js";
import { AUTH_TOKEN, repositoryRoot, startTestApp } from "./support/test-app.mjs";

const ARTIFACT_DIRECTORY = path.join(
  repositoryRoot,
  ".tmp",
  "demo-recordings",
  "deterministic",
);
const VIDEO_PATH = path.join(ARTIFACT_DIRECTORY, "shepherd-deterministic-master-1080p.webm");
const CHAPTER_PATH = path.join(ARTIFACT_DIRECTORY, "chapters.json");
const FRAME_DIRECTORY = path.join(ARTIFACT_DIRECTORY, "chapter-screenshots");
const FRONTEND_PROMPT =
  "Implement the browser authentication client using the conventions and interfaces already present in your assigned workspace.";
const BACKEND_PROMPT =
  "Implement the authentication service using the deployment conventions and interfaces already present in your assigned workspace.";
const RECORDING_CANARY = "DETERMINISTIC-RECORDING-CANARY-MUST-NOT-LEAK";
const RECORDING_PAUSE_SCALE = process.env.DEMO_RECORDING_FAST === "true" ? 0.01 : 1;

let app;
const chapters = [];
let recordingStartedAt = 0;
let chromiumSession;

const headers = () => ({ Authorization: `Bearer ${AUTH_TOKEN}` });

async function state(request) {
  const response = await request.get(`${app.baseURL}/api/shepherd/state`, {
    headers: headers(),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).state;
}

async function waitForState(request, predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let latest;
  while (Date.now() < deadline) {
    latest = await state(request);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} was not reached; latest=${latest?.missions?.at(-1)?.state ?? "missing"}`);
}

async function unlock(page) {
  await page.goto(`${app.baseURL}/shepherd`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
}

async function createAgent(page, name, role) {
  await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
  await page.getByLabel("Agent name").fill(name);
  await page.getByRole("radio", { name: new RegExp(role, "u") }).locator("..").click();
  await page.getByRole("button", { name: "Create Agent", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function assertSafe1080p(page) {
  expect(page.viewportSize()).toEqual({ width: 1920, height: 1080 });
  const geometry = await page.evaluate(() => ({
    document: [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.documentElement.scrollHeight, document.documentElement.clientHeight],
    body: [document.body.scrollWidth, document.body.clientWidth, document.body.scrollHeight, document.body.clientHeight],
  }));
  for (const [scrollWidth, clientWidth, scrollHeight, clientHeight] of Object.values(geometry)) {
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  }
  const body = await page.locator("body").innerText();
  expect(body).not.toContain(AUTH_TOKEN);
  expect(body).not.toContain(RECORDING_CANARY);
  expect(body).not.toContain(app.runRoot);
  expect(body).not.toMatch(/worktreePath|workspacePath|repositoryPath|executionIdentity|runtimeSessionFingerprint|Internal Server Error|TypeError:|ENOENT|EACCES/iu);
}

async function chapter(page, title, narration, pauseMs = 10_000) {
  const effectivePauseMs = Math.max(100, Math.round(pauseMs * RECORDING_PAUSE_SCALE));
  const sidebar = page.locator(".sidebar");
  await sidebar.evaluate((element) => {
    element.scrollTop = 0;
  });
  expect(await sidebar.evaluate((element) => element.scrollTop)).toBe(0);
  await assertSafe1080p(page);
  const startSeconds = Number(((Date.now() - recordingStartedAt) / 1000).toFixed(3));
  chapters.push({ title, startSeconds, narration, pauseSeconds: effectivePauseMs / 1000 });
  await page.screenshot({
    path: path.join(FRAME_DIRECTORY, `${String(chapters.length).padStart(2, "0")}-${title.toLowerCase().replace(/[^a-z0-9]+/gu, "-")}.png`),
    fullPage: false,
  });
  await page.waitForTimeout(effectivePauseMs);
}

async function setPresentationScale(page, scale) {
  chromiumSession ??= await page.context().newCDPSession(page);
  await chromiumSession.send("Emulation.setPageScaleFactor", {
    pageScaleFactor: scale,
  });
  await page.waitForTimeout(500);
}

class UnauthorizedContractExecutor {
  kind = "deterministic_fixture";
  inner = new DeterministicFixtureExecutor();

  async run(request) {
    const result = await this.inner.run(request);
    if (request.operation.kind === "frontend_contract") {
      await writeFile(
        path.join(request.workspacePath, "policy.json"),
        JSON.stringify({ deniedCanary: RECORDING_CANARY }) + "\n",
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
    sensitiveValues: [AUTH_TOKEN, RECORDING_CANARY],
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
  await assert.rejects(service.runDeterministicDemo(), /Scoped authority denied contract changes/u);
  const snapshot = store.snapshot();
  const mission = snapshot.shepherd.missions.at(-1);
  assert.equal(mission?.state, "failed");
  assert.ok(snapshot.shepherd.contracts.some(
    (contract) => contract.missionId === mission.id && contract.state === "authority_denied",
  ));
  assert.ok(!snapshot.shepherd.events.some(
    (event) => event.missionId === mission.id && event.type === "promotion_started",
  ));
}

test.afterEach(async () => {
  if (!app) return;
  await app.stop().catch(() => undefined);
  app = undefined;
});

test("records the complete implicit-context deterministic hero and denial", async ({ page, request }) => {
  test.setTimeout(480_000);
  await rm(FRAME_DIRECTORY, { recursive: true, force: true });
  await mkdir(FRAME_DIRECTORY, { recursive: true });
  app = await startTestApp({ agentRuntimeConfigured: true });
  const video = page.video();
  expect(video).not.toBeNull();
  recordingStartedAt = Date.now();

  await unlock(page);
  await chapter(
    page,
    "opening",
    "Introduce Shepherd as a transactional execution kernel for multi-Agent coding work.",
    12_000,
  );

  await createAgent(page, "Frontend Auth Agent", "Frontend");
  await chapter(page, "frontend-agent", "Create a bounded Frontend specialist; no authentication transport is selected.");
  await createAgent(page, "Backend Auth Agent", "Backend");
  await chapter(page, "backend-agent", "Create a bounded Backend specialist; again, no transport is selected.");

  await page.getByRole("link", { name: /Frontend Auth Agent/u }).click();
  await expect(page.getByLabel("Route through Shepherd")).toBeChecked();
  await page.getByLabel("Message Frontend Auth Agent").fill(FRONTEND_PROMPT);
  await page.getByLabel("Message Frontend Auth Agent").press("Enter");
  await expect(page.getByText(/value is deferred until independently verified implementation evidence/u)).toBeVisible();
  const deferred = await state(request);
  expect(deferred.contracts).toHaveLength(0);
  expect(deferred.groupMessages.find(
    (message) => message.contractAssignment?.preset === "auth-demo-contract",
  )?.contractAssignment.transport).toBeNull();
  await chapter(
    page,
    "value-deferred-intake",
    "The neutral prompt declares the required semantic key, while the value remains unknown until implementation and verification.",
    14_000,
  );

  await page.getByRole("link", { name: /Backend Auth Agent/u }).click();
  await page.getByLabel("Message Backend Auth Agent").fill(BACKEND_PROMPT);
  await page.getByLabel("Message Backend Auth Agent").press("Enter");
  let snapshot = await waitForState(
    request,
    (value) => value.missions.at(-1)?.state === "completed",
    "completed implicit-context Mission",
  );
  const mission = snapshot.missions.at(-1);
  expect(snapshot.contracts.every((contract) => !/cookie|bearer|jwt/iu.test(contract.objective))).toBe(true);
  expect(snapshot.contracts.every((contract) => contract.declaredClaimKeys.includes("auth.transport"))).toBe(true);
  await page.getByRole("link", { name: /^Shepherd/u }).click();
  await page.getByRole("button", { name: "Contracts", exact: true }).click();
  await chapter(
    page,
    "isolated-contracts",
    "Both role-specific Contracts executed in isolated Git Planes and passed a credential-free independent verifier.",
    14_000,
  );

  const frontendCard = page.locator("article.event-card").filter({ hasText: "Created Implement frontend authentication transport" });
  await frontendCard.getByText("View evidence", { exact: true }).click();
  await expect(frontendCard.getByLabel("Agent execution contract")).toContainText("Scoped Frontend conventions");
  await expect(frontendCard.getByLabel("Agent execution contract")).toContainText("auth.transport");
  await frontendCard.scrollIntoViewIfNeeded();
  await setPresentationScale(page, 1.5);
  await chapter(
    page,
    "frontend-contract",
    "Show the neutral objective, exact authority, expected artifact, scoped convention source, acceptance profile, and deferred claim key.",
    15_000,
  );
  await setPresentationScale(page, 1);
  await frontendCard.locator("summary").click();

  const backendCard = page.locator("article.event-card").filter({ hasText: "Created Implement backend authentication transport" });
  await backendCard.getByText("View evidence", { exact: true }).click();
  await expect(backendCard.getByLabel("Agent execution contract")).toContainText("Scoped Backend conventions");
  await backendCard.scrollIntoViewIfNeeded();
  await setPresentationScale(page, 1.5);
  await chapter(
    page,
    "backend-contract",
    "The Backend Agent receives a different bounded context, without being told what value to choose.",
    15_000,
  );
  await setPresentationScale(page, 1);
  await backendCard.locator("summary").click();

  const claims = snapshot.claims.filter((claim) => claim.missionId === mission.id);
  expect(claims.map((claim) => claim.value)).toEqual(
    expect.arrayContaining(["http-only-session-cookie", "bearer-jwt"]),
  );
  await page.getByRole("button", { name: "Verification", exact: true }).click();
  await chapter(
    page,
    "independent-verification",
    "Agent self-reports do not count; trusted checks corroborate each claim from the actual produced artifact.",
    13_000,
  );

  await page.getByRole("button", { name: "Collisions", exact: true }).click();
  const collisionCard = page.locator("article.event-card").filter({ hasText: /Exclusive 'auth\.transport' claims disagree/u });
  await collisionCard.getByText("View evidence", { exact: true }).click();
  await expect(collisionCard).toContainText("http-only-session-cookie");
  await expect(collisionCard).toContainText("bearer-jwt");
  await chapter(
    page,
    "semantic-collision",
    "Both local Contracts pass and Git merges cleanly, but Shepherd detects their system-level semantic incompatibility.",
    15_000,
  );

  await page.getByRole("button", { name: "Resolution", exact: true }).click();
  const integration = snapshot.planes.find((plane) => plane.kind === "integration");
  const resolutionPlanes = snapshot.planes.filter((plane) => plane.kind === "resolution");
  expect(resolutionPlanes).toHaveLength(2);
  expect(resolutionPlanes.every((plane) => plane.baseCommit === integration.headCommit)).toBe(true);
  await chapter(
    page,
    "competing-futures",
    "Shepherd forks two competing Resolution Planes from the same immutable integration commit.",
    15_000,
  );

  expect(snapshot.candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ targetValue: "http-only-session-cookie", executionState: "passed", selectionState: "selected" }),
    expect.objectContaining({ targetValue: "bearer-jwt", executionState: "failed", selectionState: "rejected" }),
  ]));
  const selectedCandidate = snapshot.candidates.find((candidate) => candidate.selectionState === "selected");
  const rejectedCandidate = snapshot.candidates.find((candidate) => candidate.selectionState === "rejected");
  assert.ok(selectedCandidate);
  assert.ok(rejectedCandidate);
  const selectedPlaneButton = page.locator("button.tree-node").filter({ hasText: selectedCandidate.targetValue });
  await selectedPlaneButton.scrollIntoViewIfNeeded();
  await selectedPlaneButton.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText(selectedCandidate.strategy);
  await expect(drawer.getByRole("tab", { name: "Candidate verification" })).toHaveAttribute("aria-selected", "true");
  await chapter(
    page,
    "objective-candidate-decision",
    "Open the selected future's independent evidence: the same objective checks select the passing cookie candidate.",
    15_000,
  );
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  const rejectedPlaneButton = page.locator("button.tree-node").filter({ hasText: rejectedCandidate.targetValue });
  await rejectedPlaneButton.scrollIntoViewIfNeeded();
  await rejectedPlaneButton.click();
  await expect(drawer).toContainText(rejectedCandidate.strategy);
  await expect(drawer).toContainText("Failed");
  await chapter(
    page,
    "rejected-future-evidence",
    "The incompatible future remains inspectable with its failed project-invariant evidence instead of disappearing.",
    13_000,
  );
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator(".timeline-panel .state-pill")).toHaveText("Completed");
  await expect(page.locator(".plane-tree")).toContainText("Promoted");
  await chapter(
    page,
    "verified-promotion",
    "A separate final re-verification and expected-HEAD promotion gate update protected main exactly once.",
    15_000,
  );

  await page.getByRole("link", { name: /^Project Group/u }).click();
  await expect(page.getByText("Promotion completed: auth.transport=http-only-session-cookie.", { exact: true })).toBeVisible();
  await chapter(
    page,
    "durable-audit-story",
    "The Project Group retains the human requests and every trusted lifecycle result as a durable, understandable audit trail.",
    12_000,
  );

  await app.stop();
  app = undefined;
  app = await startTestApp({
    agentRuntimeConfigured: true,
    beforeStart: seedUnauthorizedDenial,
  });
  await unlock(page);
  const denialHeading = page.getByRole("heading", { name: "Unauthorized changes denied" });
  await expect(denialHeading).toBeVisible();
  const denialPanel = denialHeading.locator("xpath=ancestor::section");
  await expect(denialPanel).toContainText("Protected promotion not started");
  await chapter(
    page,
    "authority-denial",
    "A Contract that writes policy.json outside its authority is stopped before integration; the protected head is unchanged and no candidate or promotion exists.",
    16_000,
  );

  chapters.push({
    title: "closing",
    startSeconds: Number(((Date.now() - recordingStartedAt) / 1000).toFixed(3)),
    narration: "Close with: contract, isolate, verify, detect, speculate, and promote.",
    pauseSeconds: 8 * RECORDING_PAUSE_SCALE,
  });
  await page.waitForTimeout(Math.max(100, Math.round(8_000 * RECORDING_PAUSE_SCALE)));
  const persisted = await app.persistedState();
  expect(persisted).not.toContain(AUTH_TOKEN);
  expect(persisted).not.toContain(RECORDING_CANARY);
  await writeFile(CHAPTER_PATH, JSON.stringify({
    format: "Shepherd deterministic demo chapters v1",
    resolution: "1920x1080",
    aspectRatio: "16:9",
    prompts: { frontend: FRONTEND_PROMPT, backend: BACKEND_PROMPT },
    chapters,
  }, null, 2) + "\n", "utf8");

  await page.close();
  await video.saveAs(VIDEO_PATH);
  await expect(access(VIDEO_PATH)).resolves.toBeUndefined();
});
