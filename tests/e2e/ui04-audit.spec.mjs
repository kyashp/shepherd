import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AUTH_TOKEN, repositoryRoot, startTestApp } from "./support/test-app.mjs";

let app;
test.beforeAll(async () => { app = await startTestApp(); });
test.afterAll(async () => { await app?.stop(); });

test("promotion surfaces distinguish candidate and final evidence", async ({ page, request }, testInfo) => {
  const headers = { Authorization: `Bearer ${AUTH_TOKEN}` };
  expect((await request.post(`${app.baseURL}/api/shepherd/demo/missions`, { headers })).status()).toBe(202);
  let state;
  await expect.poll(async () => {
    state = (await (await request.get(`${app.baseURL}/api/shepherd/state`, { headers })).json()).state;
    return state.missions.at(-1)?.state;
  }, { timeout: 20_000 }).toBe("completed");

  const selected = state.candidates.find((candidate) => candidate.selectionState === "selected");
  expect(selected?.verificationEvidence?.id).toBeTruthy();
  expect(selected?.promotionEvidence?.id).toBeTruthy();
  expect(selected.verificationEvidence.id).not.toBe(selected.promotionEvidence.id);
  const promotion = state.events.findLast((event) => event.type === "promotion_completed" && event.candidateId === selected.id);
  expect(promotion).toBeTruthy();

  const candidateMarker = "UI04 CANDIDATE VERIFICATION MARKER";
  const promotionMarker = "UI04 FINAL PROMOTION MARKER";
  const privateMarker = "UI04-PRIVATE-CHECK-DIAGNOSTIC";
  await page.route("**/api/shepherd/state", async (route) => {
    const upstream = await route.fetch();
    const body = await upstream.json();
    const candidate = body.state.candidates.find((item) => item.id === selected.id);
    candidate.verificationEvidence.summary = candidateMarker;
    candidate.promotionEvidence.summary = promotionMarker;
    for (const evidence of [candidate.verificationEvidence, candidate.promotionEvidence]) {
      evidence.id = `private-evidence-id-${privateMarker}`;
      evidence.checks[0].stdout = privateMarker;
      evidence.checks[0].stderr = privateMarker;
      evidence.checks[0].error = privateMarker;
    }
    await route.fulfill({ response: upstream, json: body });
  });
  await page.goto(`${app.baseURL}/shepherd`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();

  const eventCard = page.locator("article.event-card").filter({ hasText: promotion.summary });
  await eventCard.getByText("View evidence", { exact: true }).click();
  await expect(eventCard.getByLabel("Final promotion re-verification")).toBeVisible();
  await expect(eventCard.getByText(promotionMarker, { exact: true })).toBeVisible();
  await expect(eventCard.getByText(candidateMarker, { exact: true })).toHaveCount(0);

  const selectedPlaneButton = page.locator("button.tree-node").filter({ hasText: selected.targetValue });
  await selectedPlaneButton.scrollIntoViewIfNeeded();
  await selectedPlaneButton.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("button", { name: "Close Plane detail" })).toBeFocused();
  const candidateTab = drawer.getByRole("tab", { name: "Candidate verification" });
  const promotionTab = drawer.getByRole("tab", { name: "Final promotion re-verification" });
  await page.keyboard.press("Tab");
  await expect(candidateTab).toBeFocused();
  expect(await candidateTab.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await expect(candidateTab).toHaveAttribute("aria-selected", "true");
  await expect(drawer.getByText(candidateMarker, { exact: true })).toBeVisible();
  await expect(drawer.getByText(promotionMarker, { exact: true })).toHaveCount(0);
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(promotionTab).toBeFocused();
  await expect(promotionTab).toHaveAttribute("aria-selected", "true");
  await expect(drawer.getByText(promotionMarker, { exact: true })).toBeVisible();
  await expect(drawer.getByText(candidateMarker, { exact: true })).toHaveCount(0);
  await page.keyboard.press("Home");
  await expect(candidateTab).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(candidateTab).toHaveAttribute("aria-selected", "true");

  const drawerScroll = await drawer.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(drawerScroll.overflowY).toBe("auto");
  expect(drawerScroll.scrollHeight).toBeGreaterThanOrEqual(drawerScroll.clientHeight);
  expect(await page.evaluate(() => ({
    documentX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    documentY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    bodyX: document.body.scrollWidth - document.body.clientWidth,
    bodyY: document.body.scrollHeight - document.body.clientHeight,
  }))).toEqual({ documentX: 0, documentY: 0, bodyX: 0, bodyY: 0 });

  const publicText = JSON.stringify(state);
  const persistedText = await app.persistedState();
  const logs = app.readOutput();
  const bodyText = await page.locator("body").innerText();
  for (const text of [publicText, bodyText]) {
    expect(text).not.toMatch(/stdout|stderr|worktreePath|workspacePath|rawPrompt|sessionToken/iu);
    expect(text).not.toContain("/private/ui04");
  }
  expect(bodyText).not.toContain(privateMarker);
  expect(await page.content()).not.toContain(privateMarker);
  for (const text of [persistedText, logs]) {
    expect(text).not.toContain(candidateMarker);
    expect(text).not.toContain(promotionMarker);
    expect(text).not.toContain("/private/ui04");
  }

  const evidenceDir = path.join(repositoryRoot, ".tmp/playwright-evidence/ui-04", testInfo.project.name);
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, "promotion-event-and-drawer.png") });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(selectedPlaneButton).toBeFocused();
});
