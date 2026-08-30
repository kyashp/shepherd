import { test, expect } from "@playwright/test";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { AUTH_TOKEN, repositoryRoot, startTestApp } from "./support/test-app.mjs";

const MISSION_INTENT = "Implement frontend and backend authentication, detect their semantic transport collision, and promote the independently verified resolution.";
const EVENT_TO_VISIBLE_LIMIT_MS = 1_500;
let app;

function headers() { return { Authorization: `Bearer ${AUTH_TOKEN}` }; }

async function state(request) {
  const response = await request.get(`${app.baseURL}/api/shepherd/state`, { headers: headers() });
  expect(response.status()).toBe(200);
  return (await response.json()).state;
}

async function waitForState(request, predicate, label) {
  const deadline = Date.now() + 12_000;
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
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
}

async function sendMission(page) {
  const composer = page.getByLabel("Message Shepherd");
  await composer.fill(MISSION_INTENT);
  const acceptedResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/shepherd/messages"));
  const acceptedAt = Date.now();
  await composer.press("Enter");
  const accepted = await acceptedResponse;
  expect(accepted.status()).toBe(202);
  return { acceptedAt, missionId: (await accepted.json()).missionId };
}

async function readLedger(directory) {
  const text = await readFile(path.join(directory, "ledger.jsonl"), "utf8");
  return text.trim().split("\n").filter(Boolean).map(JSON.parse);
}

async function assertNoDocumentOverflow(page) {
  const geometry = await page.evaluate(() => ({ document: [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.documentElement.scrollHeight, document.documentElement.clientHeight], body: [document.body.scrollWidth, document.body.clientWidth, document.body.scrollHeight, document.body.clientHeight] }));
  for (const [scrollWidth, clientWidth, scrollHeight, clientHeight] of Object.values(geometry)) {
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  }
}

async function capture(page, testInfo, stage) {
  await assertNoDocumentOverflow(page);
  const viewport = page.viewportSize();
  expect(viewport).toEqual(testInfo.project.use.viewport);
  const directory = path.join(repositoryRoot, process.env.E2E_UPDATE_EVIDENCE === "true" ? "docs/ui-review/perf-01" : ".tmp/playwright-evidence/perf-01", `${viewport.width}x${viewport.height}`);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${stage}.png`), fullPage: false });
}

function timestamp(events, type) {
  const event = events.find((item) => item.type === type);
  expect(event, `missing ${type}`).toBeDefined();
  return Date.parse(event.timestamp);
}

function assertVerifierLifecycle(ledger) {
  const creates = ledger.filter((entry) => entry.operation === "create");
  expect(creates).toHaveLength(11);
  const names = creates.map((entry) => entry.name);
  expect(new Set(names).size).toBe(11);
  for (const name of names) expect(ledger.filter((entry) => entry.name === name).map((entry) => entry.operation)).toEqual(["create", "start", "complete", "remove"]);
}

test.beforeEach(async () => { app = await startTestApp(); });
test.afterEach(async () => {
  await app?.stop();
  app = undefined;
});

test("measures the ungated real browser judge path", async ({ page, request }, testInfo) => {
  test.setTimeout(45_000);
  await unlock(page);
  const { acceptedAt, missionId } = await sendMission(page);
  const collisionState = await waitForState(request, (snapshot) => snapshot.events.some((event) => event.missionId === missionId && event.type === "collision_detected"), "persisted collision");
  const collision = collisionState.events.find((event) => event.missionId === missionId && event.type === "collision_detected");
  const collisionCard = page.locator("article.event-card").filter({ hasText: collision.summary });
  await expect(collisionCard).toBeVisible({ timeout: EVENT_TO_VISIBLE_LIMIT_MS });
  const eventToVisibleMs = Date.now() - Date.parse(collision.timestamp);
  expect(eventToVisibleMs).toBeLessThanOrEqual(EVENT_TO_VISIBLE_LIMIT_MS);
  await capture(page, testInfo, "01-collision-visible");

  const completed = await waitForState(request, (snapshot) => snapshot.missions.find((mission) => mission.id === missionId)?.state === "completed", "completed Mission");
  const events = completed.events.filter((event) => event.missionId === missionId);
  const contractPlanes = completed.planes.filter((plane) => plane.missionId === missionId && plane.kind === "contract");
  expect(contractPlanes).toHaveLength(2);
  const contractStarts = events.filter((event) => event.type === "contract_started");
  expect(contractStarts).toHaveLength(2);
  const verificationStarts = events.filter((event) => event.type === "verification_started");
  const verificationPasses = events.filter((event) => event.type === "verification_passed");
  expect(verificationStarts).toHaveLength(2);
  expect(verificationPasses).toHaveLength(2);
  expect(events.filter((event) => event.type === "verification_failed")).toHaveLength(0);
  const missionCreatedAt = timestamp(events, "mission_created");
  const collisionAt = timestamp(events, "collision_detected");
  const promotionCompletedAt = timestamp(events, "promotion_completed");
  const earliestContractStartedAt = Math.min(...contractStarts.map((event) => Date.parse(event.timestamp)));
  const earliestVerificationStartedAt = Math.min(...verificationStarts.map((event) => Date.parse(event.timestamp)));
  const latestVerificationPassedAt = Math.max(...verificationPasses.map((event) => Date.parse(event.timestamp)));
  const containerDirectory = path.join(app.runRoot, "home", ".fake-container-engine");
  assertVerifierLifecycle(await readLedger(containerDirectory));
  expect(await readdir(path.join(containerDirectory, "containers"))).toEqual([]);
  await expect(page.locator(".timeline-panel .state-pill")).toHaveText("Completed");
  await capture(page, testInfo, "02-promotion-completed");

  console.log(`[PERF-01] ${JSON.stringify({ viewport: testInfo.project.use.viewport, acceptedToTwoPlaneReadyMs: earliestContractStartedAt - acceptedAt, twoPlaneReadyFromMissionMs: earliestContractStartedAt - missionCreatedAt, verificationMs: latestVerificationPassedAt - earliestVerificationStartedAt, persistedEventToVisibleMs: eventToVisibleMs, collisionToPromotionCompletedMs: promotionCompletedAt - collisionAt, totalDemoMs: promotionCompletedAt - missionCreatedAt })}`);
});
