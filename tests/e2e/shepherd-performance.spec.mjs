import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AUTH_TOKEN, startTestApp } from "./support/test-app.mjs";

const MISSION_INTENT = "Implement frontend and backend authentication, detect their semantic transport collision, and promote the independently verified resolution.";
const EVENT_TO_VISIBLE_LIMIT_MS = 1_500;
let app;

function headers() {
  return { Authorization: `Bearer ${AUTH_TOKEN}` };
}

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

async function enableCandidateGate() {
  const directory = path.join(app.runRoot, "home", ".fake-container-engine", "gates");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "candidates-enabled"), "enabled\n", "utf8");
  return directory;
}

async function readLedger() {
  const text = await readFile(path.join(app.runRoot, "home", ".fake-container-engine", "ledger.jsonl"), "utf8");
  return text.trim().split("\n").filter(Boolean).map(JSON.parse);
}

async function waitForCandidateVerifierStarts() {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const starts = (await readLedger()).filter((item) => item.operation === "start" && item.gate === "candidates");
    if (starts.length === 2) return starts;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Both candidate verifier starts were not recorded before release");
}

function timestamp(events, type) {
  const event = events.find((item) => item.type === type);
  expect(event, `missing ${type}`).toBeDefined();
  return Date.parse(event.timestamp);
}

test.beforeEach(async () => {
  app = await startTestApp();
});

test.afterEach(async () => {
  if (app) {
    const gateDirectory = path.join(app.runRoot, "home", ".fake-container-engine", "gates");
    await writeFile(path.join(gateDirectory, "candidates.release"), "released\n", "utf8").catch(() => undefined);
    await writeFile(path.join(gateDirectory, "promotion.release"), "released\n", "utf8").catch(() => undefined);
  }
  await app?.stop();
  app = undefined;
});

test("measures the real browser judge path and proves candidate verifier overlap", async ({ page, request }, testInfo) => {
  test.setTimeout(45_000);
  const gateDirectory = await enableCandidateGate();
  await unlock(page);
  const composer = page.getByLabel("Message Shepherd");
  await composer.fill(MISSION_INTENT);
  const acceptedAt = Date.now();
  const acceptedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/shepherd/messages"),
  );
  await composer.press("Enter");
  const accepted = await acceptedResponse;
  expect(accepted.status()).toBe(202);
  const { missionId } = await accepted.json();

  const candidateStarts = await waitForCandidateVerifierStarts();
  const active = await waitForState(request, (snapshot) => {
    const candidates = snapshot.candidates.filter((candidate) => candidate.missionId === missionId);
    return candidates.length === 2 && candidates.every((candidate) => candidate.executionState === "verifying");
  }, "both candidate verifier gates");
  const collision = active.events.find((event) => event.missionId === missionId && event.type === "collision_detected");
  expect(collision).toBeDefined();
  const collisionCard = page.locator("article.event-card").filter({ hasText: collision.summary });
  await expect(collisionCard).toBeVisible({ timeout: EVENT_TO_VISIBLE_LIMIT_MS });
  const eventToVisibleMs = Date.now() - Date.parse(collision.timestamp);
  expect(eventToVisibleMs).toBeLessThanOrEqual(EVENT_TO_VISIBLE_LIMIT_MS);

  await writeFile(path.join(gateDirectory, "candidates.release"), "released\n", "utf8");
  await writeFile(path.join(gateDirectory, "promotion.release"), "released\n", "utf8");
  const completed = await waitForState(request, (snapshot) =>
    snapshot.missions.find((mission) => mission.id === missionId)?.state === "completed",
  "completed Mission");
  const events = completed.events.filter((event) => event.missionId === missionId);
  const missionCreatedAt = timestamp(events, "mission_created");
  const contractStartedAt = timestamp(events, "contract_started");
  const collisionAt = timestamp(events, "collision_detected");
  const promotionStartedAt = timestamp(events, "promotion_started");
  const promotionCompletedAt = timestamp(events, "promotion_completed");
  const candidateStartSpreadMs = Math.abs(Date.parse(candidateStarts[0].timestamp) - Date.parse(candidateStarts[1].timestamp));
  expect(candidateStartSpreadMs).toBeLessThanOrEqual(1_000);
  const ledger = await readLedger();
  const verifierCreates = ledger.filter((entry) => entry.operation === "create");
  expect(verifierCreates).toHaveLength(11);
  expect(verifierCreates.every((entry) => entry.network === "none" && entry.readOnly === true)).toBe(true);
  expect(ledger.filter((entry) => entry.operation === "complete")).toHaveLength(11);
  expect(ledger.filter((entry) => entry.operation === "remove")).toHaveLength(11);

  const metrics = {
    viewport: testInfo.project.use.viewport,
    acceptedToPlaneCreationMs: contractStartedAt - acceptedAt,
    planeCreationFromMissionMs: contractStartedAt - missionCreatedAt,
    contractVerificationAndCollisionMs: collisionAt - contractStartedAt,
    persistedEventToVisibleMs: eventToVisibleMs,
    candidateVerifierStartSpreadMs: candidateStartSpreadMs,
    collisionToPromotionMs: promotionStartedAt - collisionAt,
    totalDemoMs: promotionCompletedAt - missionCreatedAt,
  };
  console.log(`[PERF-01] ${JSON.stringify(metrics)}`);
});
