import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AUTH_TOKEN, repositoryRoot, startTestApp } from "./support/test-app.mjs";

let app;
test.beforeAll(async () => { app = await startTestApp(); });
test.afterAll(async () => { await app?.stop(); });

test("promotion evidence surface selects verification evidence instead", async ({ page, request }) => {
  const headers = { Authorization: `Bearer ${AUTH_TOKEN}` };
  const accepted = await request.post(`${app.baseURL}/api/shepherd/demo/missions`, { headers });
  expect(accepted.status()).toBe(202);

  let state;
  await expect.poll(async () => {
    const response = await request.get(`${app.baseURL}/api/shepherd/state`, { headers });
    state = (await response.json()).state;
    return state.missions.at(-1)?.state;
  }, { timeout: 20_000 }).toBe("completed");

  const selected = state.candidates.find((candidate) => candidate.selectionState === "selected");
  expect(selected).toBeTruthy();
  expect(selected.verificationEvidence?.id).toBeTruthy();
  expect(selected.promotionEvidence?.id).toBeTruthy();
  expect(selected.verificationEvidence.id).not.toBe(selected.promotionEvidence.id);

  const promotion = state.events.findLast((event) =>
    event.type === "promotion_completed" && event.candidateId === selected.id
  );
  expect(promotion).toBeTruthy();

  const verificationMarker = "UI04 VERIFICATION EVIDENCE MARKER";
  const promotionMarker = "UI04 PROMOTION EVIDENCE MARKER";
  await page.route("**/api/shepherd/state", async (route) => {
    const upstream = await route.fetch();
    const body = await upstream.json();
    const candidate = body.state.candidates.find((item) => item.id === selected.id);
    candidate.verificationEvidence.summary = verificationMarker;
    candidate.promotionEvidence.summary = promotionMarker;
    await route.fulfill({ response: upstream, json: body });
  });
  await page.goto(`${app.baseURL}/shepherd`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  const card = page.locator("article.event-card").filter({ hasText: promotion.summary });
  await expect(card).toHaveCount(1);
  await card.getByText("View evidence", { exact: true }).click();
  await expect(card.getByText(verificationMarker, { exact: true })).toBeVisible();
  await expect(card.getByText(promotionMarker, { exact: true })).toHaveCount(0);

  const evidenceDir = path.join(repositoryRoot, ".tmp/playwright-evidence/ui-04");
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, "promotion-shows-verification.png") });
});
