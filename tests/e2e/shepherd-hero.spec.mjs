import { test, expect } from "./support/coverage-test.mjs";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AUTH_TOKEN, isPortOpen, repositoryRoot, startTestApp } from "./support/test-app.mjs";

const execFileAsync = promisify(execFile);
const MISSION_INTENT = "Implement frontend and backend authentication, detect their semantic transport collision, and promote the independently verified resolution.";
const PRIVATE_CANARY = "E2E02-PRIVATE-CANARY-MUST-NOT-LEAK";
const STAGES = [
  "01-contracts-active",
  "02-contract-verification",
  "03-semantic-collision",
  "04-candidates-active",
  "05-candidate-outcomes",
  "06-promotion-reverifying",
  "07-completed-overview",
  "08-promotion-event-evidence",
  "09-selected-candidate-evidence",
  "10-selected-final-evidence",
  "11-rejected-plane-evidence",
  "12-project-group-lifecycle",
  "13-protected-main-proof",
];

let app;

function headers() {
  return { Authorization: `Bearer ${AUTH_TOKEN}` };
}

async function apiJson(request, route) {
  const response = await request.get(`${app.baseURL}${route}`, { headers: headers() });
  expect(response.status(), `GET ${route}`).toBe(200);
  return await response.json();
}

async function state(request) {
  return (await apiJson(request, "/api/shepherd/state")).state;
}

async function waitForState(request, predicate, label, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  let latest;
  while (Date.now() < deadline) {
    latest = await state(request);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} was not reached; latest=${JSON.stringify(latest?.missions?.at(-1)?.state ?? null)}`);
}

async function unlock(page) {
  await page.goto(`${app.baseURL}/shepherd`);
  await expect(page.getByLabel("Access token")).toBeFocused();
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
  await expect(page.getByText("Kernel online", { exact: true })).toBeVisible();
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
  expect(body).not.toMatch(/worktreePath|workspacePath|repositoryPath|executionIdentity|runtimeSessionFingerprint|shepherdPromptVersion/iu);
  expect(body).not.toMatch(/Internal Server Error|TypeError:|ENOENT|EACCES/iu);
}

async function capture(page, testInfo, stage) {
  expect(STAGES).toContain(stage);
  await assertSafeRenderedSurface(page);
  const viewport = page.viewportSize();
  expect(viewport).toEqual(testInfo.project.use.viewport);
  const root = process.env.E2E_UPDATE_EVIDENCE === "true"
    ? path.join(repositoryRoot, "docs/ui-review/e2e-02")
    : path.join(repositoryRoot, ".tmp/playwright-evidence/e2e-02");
  const directory = path.join(root, `${viewport.width}x${viewport.height}`);
  await mkdir(directory, { recursive: true });
  const screenshotPath = path.join(directory, `${stage}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return screenshotPath;
}

async function scrollIntoVisibleDrawerEvidence(marker) {
  await marker.scrollIntoViewIfNeeded();
  const intersection = await marker.evaluate((element) => {
    const drawer = element.closest(".detail-drawer");
    if (!drawer) return null;
    const markerRect = element.getBoundingClientRect();
    const drawerRect = drawer.getBoundingClientRect();
    return {
      width: Math.max(0, Math.min(markerRect.right, drawerRect.right, window.innerWidth) - Math.max(markerRect.left, drawerRect.left, 0)),
      height: Math.max(0, Math.min(markerRect.bottom, drawerRect.bottom, window.innerHeight) - Math.max(markerRect.top, drawerRect.top, 0)),
    };
  });
  expect(intersection?.width).toBeGreaterThan(0);
  expect(intersection?.height).toBeGreaterThan(0);
  await expect(marker).toBeVisible();
}

async function releaseGate(name) {
  const directory = path.join(app.runRoot, "home", ".fake-container-engine", "gates");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${name}.release`), "released\n", "utf8");
}

async function waitForTerminalMissionDuringCleanup() {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${app.baseURL}/api/shepherd/state`, { headers: headers() }).catch(() => undefined);
    if (!response?.ok) return;
    const snapshot = (await response.json()).state;
    if (snapshot.missions.every((mission) => ["completed", "failed", "cancelled"].includes(mission.state))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForVerifierLedger(predicate, label) {
  const ledgerPath = path.join(app.runRoot, "home", ".fake-container-engine", "ledger.jsonl");
  const deadline = Date.now() + 3_000;
  let ledger = [];
  while (Date.now() < deadline) {
    ledger = (await readFile(ledgerPath, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    if (predicate(ledger)) return ledger;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label} was not recorded in the verifier ledger`);
}

async function enableGates() {
  const directory = path.join(app.runRoot, "home", ".fake-container-engine", "gates");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "enabled"), "enabled\n", "utf8");
}

async function git(repository, args) {
  return (await execFileAsync("git", args, {
    cwd: repository,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
    maxBuffer: 1_048_576,
  })).stdout.trim();
}

function missionEntities(snapshot, missionId) {
  return {
    mission: snapshot.missions.find((item) => item.id === missionId),
    contracts: snapshot.contracts.filter((item) => item.missionId === missionId),
    planes: snapshot.planes.filter((item) => item.missionId === missionId),
    collisions: snapshot.collisions.filter((item) => item.missionId === missionId),
    candidates: snapshot.candidates.filter((item) => item.missionId === missionId),
    events: snapshot.events.filter((item) => item.missionId === missionId),
  };
}

async function clickFilter(page, name) {
  const button = page.getByRole("button", { name, exact: true });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toBeFocused();
}

test.beforeEach(async () => {
  app = await startTestApp();
});

test.afterEach(async () => {
  if (!app) return;
  for (const gate of ["contracts", "candidates", "promotion"]) {
    await releaseGate(gate).catch(() => undefined);
  }
  await waitForTerminalMissionDuringCleanup();
  await app.stop();
});

test("real Shepherd hero chain verifies, resolves, and promotes protected output", async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const unauthorized = await request.get(`${app.baseURL}/api/shepherd/state`);
  expect(unauthorized.status()).toBe(401);
  const outsideCanary = path.join(app.runRoot, "outside-shepherd-canary.txt");
  await writeFile(outsideCanary, `${PRIVATE_CANARY}\n`, "utf8");
  await enableGates();
  await unlock(page);

  const composer = page.getByLabel("Message Shepherd");
  await composer.focus();
  await expect(composer).toBeFocused();
  await composer.fill("keyboard draft");
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue("keyboard draft\n");
  await composer.fill(MISSION_INTENT);
  const acceptedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/shepherd/messages"),
  );
  await composer.press("Enter");
  const accepted = await acceptedResponse;
  expect(accepted.status()).toBe(202);
  const acceptedBody = await accepted.json();
  const missionId = acceptedBody.missionId;
  expect(acceptedBody.executionMode).toBe("deterministic");

  let current = await waitForState(request, (snapshot) => {
    const entities = missionEntities(snapshot, missionId);
    return entities.contracts.length === 2 && entities.contracts.every((item) => item.state === "verifying");
  }, "both Contract verifier gates");
  let entities = missionEntities(current, missionId);
  expect(entities.mission.state).toBe("running");
  expect(entities.planes).toHaveLength(2);
  expect(entities.planes.every((item) => item.kind === "contract" && item.state === "inspecting")).toBe(true);
  expect(entities.events.filter((item) => item.type === "contract_started")).toHaveLength(2);
  expect(entities.events.filter((item) => item.type === "agent_completed")).toHaveLength(2);
  await expect(composer).toBeDisabled();
  await expect(page.getByText("Agent", { exact: true })).toHaveCount(2);
  await capture(page, testInfo, "01-contracts-active");

  await releaseGate("contracts");
  current = await waitForState(request, (snapshot) => {
    const value = missionEntities(snapshot, missionId);
    return value.candidates.length === 2 && value.candidates.every((item) => item.executionState === "verifying");
  }, "candidate verifier gates");
  entities = missionEntities(current, missionId);
  const collisionPersistedAt = Date.now();
  expect(entities.contracts.every((item) => item.state === "verified" && item.verificationEvidence.length === 1)).toBe(true);
  expect(entities.planes.filter((item) => item.kind === "contract" && item.state === "verified")).toHaveLength(2);
  expect(entities.planes.filter((item) => item.kind === "integration")).toHaveLength(1);
  await clickFilter(page, "Verification");
  await expect(page.locator("article.event-card").filter({ hasText: "Verification passed" })).toHaveCount(2, { timeout: 3_000 });
  await capture(page, testInfo, "02-contract-verification");

  const collision = entities.collisions[0];
  expect(collision).toMatchObject({ key: "auth.transport", scope: "authentication", detectionMechanism: "deterministic", state: "resolving" });
  expect([collision.leftClaim.value, collision.rightClaim.value].sort()).toEqual(["bearer-jwt", "http-only-session-cookie"].sort());
  const collisionEvent = entities.events.find((item) => item.type === "collision_detected");
  expect(collisionEvent.details.gitConflict).toBe(false);
  await clickFilter(page, "Collisions");
  const collisionCard = page.locator("article.event-card").filter({ hasText: collisionEvent.summary });
  await expect(collisionCard).toBeVisible({ timeout: 3_000 });
  const collisionVisibleMs = Date.now() - collisionPersistedAt;
  expect(collisionVisibleMs).toBeLessThanOrEqual(1_500);
  await collisionCard.getByText("View evidence", { exact: true }).click();
  await expect(collisionCard.getByText("bearer-jwt", { exact: true })).toBeVisible();
  await expect(collisionCard.getByText("http-only-session-cookie", { exact: true })).toBeVisible();
  await capture(page, testInfo, "03-semantic-collision");

  const integration = entities.planes.find((item) => item.kind === "integration");
  const resolutionPlanes = entities.planes.filter((item) => item.kind === "resolution");
  expect(resolutionPlanes).toHaveLength(2);
  expect(new Set(resolutionPlanes.map((item) => item.id)).size).toBe(2);
  expect(new Set(resolutionPlanes.map((item) => item.branch)).size).toBe(2);
  expect(resolutionPlanes.every((item) => item.baseCommit === integration.headCommit && item.state === "inspecting")).toBe(true);
  expect(entities.candidates.every((item) => item.executionState === "verifying")).toBe(true);
  await clickFilter(page, "Resolution");
  await expect(page.getByText("Resolution", { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, "04-candidates-active");

  await releaseGate("candidates");
  current = await waitForState(request, (snapshot) => {
    const value = missionEntities(snapshot, missionId);
    const selected = value.candidates.find((item) => item.selectionState === "selected");
    return selected?.promotionState === "reverifying";
  }, "final promotion verifier gate");
  entities = missionEntities(current, missionId);
  const selected = entities.candidates.find((item) => item.selectionState === "selected");
  const rejected = entities.candidates.find((item) => item.selectionState === "rejected");
  expect(selected).toMatchObject({ targetValue: "http-only-session-cookie", executionState: "passed", promotionState: "reverifying" });
  expect(rejected).toMatchObject({ targetValue: "bearer-jwt", executionState: "failed", promotionState: "not_started" });
  expect(selected.verificationEvidence.passed).toBe(true);
  expect(rejected.verificationEvidence.passed).toBe(false);
  expect(entities.events.filter((item) => item.type === "candidate_selected")).toHaveLength(1);
  expect(entities.events.filter((item) => item.type === "promotion_started")).toHaveLength(1);
  const ledgerBeforePromotion = await waitForVerifierLedger(
    (ledger) => ledger.some((item) => item.operation === "start" && item.gate === "promotion"),
    "promotion verifier start",
  );
  const candidateStarts = ledgerBeforePromotion.filter((item) => item.operation === "start" && item.gate === "candidates");
  expect(candidateStarts).toHaveLength(2);
  expect(new Set(candidateStarts.map((item) => item.target)).size).toBe(2);
  const promotionStarts = ledgerBeforePromotion.filter((item) => item.operation === "start" && item.gate === "promotion");
  expect(promotionStarts).toHaveLength(1);
  await expect(page.locator("article.event-card").filter({ hasText: "Candidate passed" })).toBeVisible({ timeout: 3_000 });
  await expect(page.locator("article.event-card").filter({ hasText: "Candidate failed" })).toBeVisible();
  const candidateOutcomeScreenshot = await capture(page, testInfo, "05-candidate-outcomes");
  const promotionStartedEvent = entities.events.find((item) => item.type === "promotion_started");
  const promotionStartedCard = page.locator("article.event-card").filter({ hasText: promotionStartedEvent.summary });
  await expect(promotionStartedCard).toBeVisible();
  await promotionStartedCard.scrollIntoViewIfNeeded();
  const promotionCardIntersection = await promotionStartedCard.evaluate((card) => {
    const pane = card.closest(".event-list");
    if (!pane) return null;
    const cardRect = card.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    return {
      width: Math.max(0, Math.min(cardRect.right, paneRect.right, window.innerWidth) - Math.max(cardRect.left, paneRect.left, 0)),
      height: Math.max(0, Math.min(cardRect.bottom, paneRect.bottom, window.innerHeight) - Math.max(cardRect.top, paneRect.top, 0)),
    };
  });
  expect(promotionCardIntersection?.width).toBeGreaterThan(0);
  expect(promotionCardIntersection?.height).toBeGreaterThan(0);
  const promotionScreenshot = await capture(page, testInfo, "06-promotion-reverifying");
  expect(Buffer.compare(await readFile(candidateOutcomeScreenshot), await readFile(promotionScreenshot))).not.toBe(0);

  await releaseGate("promotion");
  current = await waitForState(request, (snapshot) => missionEntities(snapshot, missionId).mission?.state === "completed", "completed Mission");
  entities = missionEntities(current, missionId);
  const finalSelected = entities.candidates.find((item) => item.selectionState === "selected");
  const finalRejected = entities.candidates.find((item) => item.selectionState === "rejected");
  expect(finalSelected).toMatchObject({ executionState: "passed", promotionState: "promoted" });
  expect(finalRejected).toMatchObject({ executionState: "failed", promotionState: "not_started" });
  expect(finalSelected.verificationEvidence.id).not.toBe(finalSelected.promotionEvidence.id);
  expect(finalSelected.promotionEvidence.targetType).toBe("promotion");
  expect(finalSelected.promotionEvidence.passed).toBe(true);
  expect(entities.events).toHaveLength(33);
  expect(entities.events.map((item) => item.sequence)).toEqual([...entities.events.map((item) => item.sequence)].sort((a, b) => a - b));
  await clickFilter(page, "All");
  await expect(page.locator(".timeline-panel .state-pill")).toHaveText("Completed", { timeout: 3_000 });
  await expect(page.locator(".plane-tree")).toContainText("Promoted");
  await capture(page, testInfo, "07-completed-overview");

  await clickFilter(page, "Resolution");
  const promotionEvent = entities.events.find((item) => item.type === "promotion_completed");
  const promotionCard = page.locator("article.event-card").filter({ hasText: promotionEvent.summary });
  await expect(promotionCard).toBeVisible();
  await promotionCard.getByText("View evidence", { exact: true }).click();
  await expect(promotionCard.getByLabel("Final promotion re-verification")).toBeVisible();
  await capture(page, testInfo, "08-promotion-event-evidence");

  const selectedButton = page.locator("button.tree-node").filter({ hasText: finalSelected.targetValue });
  await selectedButton.scrollIntoViewIfNeeded();
  await selectedButton.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("button", { name: "Close Plane detail" })).toBeFocused();
  const candidateTab = drawer.getByRole("tab", { name: "Candidate verification" });
  const promotionTab = drawer.getByRole("tab", { name: "Final promotion re-verification" });
  await expect(candidateTab).toHaveAttribute("aria-selected", "true");
  const selectedCandidateMarker = drawer.getByText(finalSelected.verificationEvidence.summary, { exact: true });
  await scrollIntoVisibleDrawerEvidence(selectedCandidateMarker);
  await capture(page, testInfo, "09-selected-candidate-evidence");
  await candidateTab.press("ArrowRight");
  await expect(promotionTab).toBeFocused();
  await expect(promotionTab).toHaveAttribute("aria-selected", "true");
  await capture(page, testInfo, "10-selected-final-evidence");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(selectedButton).toBeFocused();

  const rejectedButton = page.locator("button.tree-node").filter({ hasText: finalRejected.targetValue });
  await rejectedButton.scrollIntoViewIfNeeded();
  await rejectedButton.click();
  await expect(drawer).toContainText("Failed");
  await expect(drawer).toContainText("Candidate verification");
  const rejectedCandidateMarker = drawer.getByText(finalRejected.verificationEvidence.summary, { exact: true });
  await scrollIntoVisibleDrawerEvidence(rejectedCandidateMarker);
  await capture(page, testInfo, "11-rejected-plane-evidence");
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: /^Project Group/ }).click();
  await expect(page.getByRole("heading", { name: "Project Group", exact: true })).toBeVisible();
  const group = await apiJson(request, `/api/shepherd/projects/${encodeURIComponent(entities.mission.projectId)}/group-messages`);
  expect(group.messages.some((item) => item.senderType === "shepherd" && item.content.startsWith("Mission accepted:"))).toBe(true);
  expect(group.messages.filter((item) => item.senderType === "shepherd" && item.content.startsWith("Contract verified:"))).toHaveLength(2);
  expect(group.messages.some((item) => item.senderType === "shepherd" && item.content.startsWith("Collision detected:"))).toBe(true);
  expect(group.messages.some((item) => item.senderType === "shepherd" && item.content.startsWith("Promotion completed:"))).toBe(true);
  expect(group.messages.some((item) => item.senderType === "shepherd" && item.content.startsWith("Mission completed"))).toBe(true);
  const verifiedContracts = entities.contracts.filter(
    (contract) => contract.state === "verified" && contract.verificationEvidence.length === 1,
  );
  const agentMessages = group.messages.filter((item) => item.senderType === "agent");
  expect(agentMessages).toHaveLength(verifiedContracts.length);
  expect(agentMessages).toEqual(expect.arrayContaining(verifiedContracts.map((contract) =>
    expect.objectContaining({
      senderId: contract.agentId,
      targetAgentId: contract.agentId,
      contractId: contract.id,
      content: contract.title.includes("backend")
        ? "Backend auth service uses an HttpOnly session cookie."
        : "Frontend auth client uses a bearer JWT.",
    }),
  )));
  await expect(page.getByText("Promotion completed: auth.transport=http-only-session-cookie.", { exact: true })).toBeVisible();
  await capture(page, testInfo, "12-project-group-lifecycle");

  await page.getByRole("link", { name: /^Shepherd/ }).click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
  const repository = path.join(app.runRoot, "shepherd", "repositories", "auth-demo");
  expect(await realpath(repository)).toBe(repository);
  const protectedHead = await git(repository, ["rev-parse", "HEAD"]);
  expect(protectedHead).toBe(current.projects.find((item) => item.id === entities.mission.projectId).protectedHeadCommit);
  expect(protectedHead).toBe(entities.planes.find((item) => item.id === finalSelected.planeId).headCommit);
  const tracked = (await git(repository, ["ls-files"])).split("\n").filter(Boolean);
  expect(tracked.some((item) => item === ".shepherd" || item.startsWith(".shepherd/"))).toBe(false);
  const frontend = JSON.parse(await readFile(path.join(repository, "src/frontend/auth.json"), "utf8"));
  const backend = JSON.parse(await readFile(path.join(repository, "src/backend/auth.json"), "utf8"));
  expect(frontend).toEqual({ transport: "http-only-session-cookie", clientReadableCredential: false });
  expect(backend).toEqual(frontend);
  const worktrees = await git(repository, ["worktree", "list", "--porcelain"]);
  for (const plane of entities.planes) expect(worktrees).toContain(`branch refs/heads/${plane.branch}`);
  await expect(page.locator(".tree-root")).toContainText(`${protectedHead.slice(0, 8)}…`);
  await capture(page, testInfo, "13-protected-main-proof");

  const publicText = JSON.stringify(current);
  for (const forbidden of [app.runRoot, PRIVATE_CANARY, "repositoryPath", "worktreePath", "executionIdentity", "runtimeSessionFingerprint", "shepherdPromptVersion"] ) {
    expect(publicText).not.toContain(forbidden);
  }
  const persistedText = await app.persistedState();
  expect(persistedText).not.toContain(AUTH_TOKEN);
  expect(persistedText).not.toContain(PRIVATE_CANARY);
  expect(app.readOutput()).not.toContain(AUTH_TOKEN);
  expect(app.readOutput()).not.toContain(PRIVATE_CANARY);
  expect(await readFile(outsideCanary, "utf8")).toBe(`${PRIVATE_CANARY}\n`);
  const ledger = (await readFile(path.join(app.runRoot, "home", ".fake-container-engine", "ledger.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  expect(ledger.filter((item) => item.operation === "create")).toHaveLength(11);
  expect(ledger.filter((item) => item.operation === "complete")).toHaveLength(11);
  expect(ledger.filter((item) => item.operation === "remove")).toHaveLength(11);
  expect(ledger.filter((item) => item.operation === "create").every((item) => item.network === "none" && item.readOnly === true)).toBe(true);
  expect(await readdir(path.join(app.runRoot, "home", ".fake-container-engine", "containers"))).toEqual([]);

  const reset = await request.post(`${app.baseURL}/api/shepherd/demo/reset`, { headers: headers(), data: {} });
  expect(reset.status()).toBe(200);
  expect((await reset.json()).removedPlaneCount).toBe(5);
  const resetState = await state(request);
  expect(resetState.missions).toEqual([]);
  expect(resetState.contracts).toEqual([]);
  expect(resetState.planes).toEqual([]);
  expect(resetState.collisions).toEqual([]);
  expect(resetState.candidates).toEqual([]);
  expect(await git(repository, ["rev-parse", "HEAD"])).toBe(entities.mission.baseCommit);
  expect(await readFile(outsideCanary, "utf8")).toBe(`${PRIVATE_CANARY}\n`);

  const { port, runRoot } = app;
  await app.stop();
  app = null;
  expect(await isPortOpen(port)).toBe(false);
  await expect(access(runRoot)).rejects.toThrow();
});
