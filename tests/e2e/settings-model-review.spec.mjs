import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AUTH_TOKEN, repositoryRoot, startTestApp } from "./support/test-app.mjs";

async function openSettings(page, app) {
  await page.goto(`${app.baseURL}/settings`);
  const accessToken = page.getByLabel("Access token");
  if (await accessToken.isVisible()) {
    await accessToken.fill(AUTH_TOKEN);
    await page.getByRole("button", { name: "Open Launchpad" }).click();
  }
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Security" }).click();
}

async function assertNoDocumentOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
      document.documentElement.scrollHeight,
      document.documentElement.clientHeight,
    ],
    body: [
      document.body.scrollWidth,
      document.body.clientWidth,
      document.body.scrollHeight,
      document.body.clientHeight,
    ],
  }));
  for (const [scrollWidth, clientWidth, scrollHeight, clientHeight] of Object.values(overflow)) {
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  }
}

async function capture(page, testInfo, state) {
  const viewport = page.viewportSize();
  expect(viewport).toEqual(testInfo.project.use.viewport);
  const directory = path.join(
    repositoryRoot,
    ".tmp/playwright-evidence/mr-02",
    `${viewport.width}x${viewport.height}`,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${state}.png`), fullPage: false });
}

test("model review setting reflects runtime capability without losing its stored preference", async ({ page, request }, testInfo) => {
  let app = await startTestApp();
  try {
    let patchCount = 0;
    page.on("request", (outgoing) => {
      if (outgoing.method() === "PATCH" && outgoing.url().endsWith("/api/shepherd/settings")) {
        patchCount += 1;
      }
    });

    await openSettings(page, app);
    const unavailableToggle = page.getByRole("checkbox", { name: "Bounded model review" });
    await expect(unavailableToggle).toBeChecked();
    await expect(unavailableToggle).toBeDisabled();
    const unavailableStatus = page.locator('[role="status"]').filter({ hasText: /^Unavailable$/u });
    await expect(unavailableStatus).toHaveText("Unavailable");
    await expect(page.getByText(/not configured for this running process/u)).toBeVisible();
    const box = await unavailableToggle.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await unavailableToggle.evaluate((element) => element.focus());
    await page.keyboard.press("Space");
    await expect(unavailableToggle).not.toBeFocused();
    await expect(unavailableToggle).toBeChecked();
    await expect(page.getByRole("button", { name: "Save settings" })).toBeDisabled();
    expect(patchCount).toBe(0);
    await assertNoDocumentOverflow(page);
    await capture(page, testInfo, "unavailable-stored-on");

    const unavailableSystem = await request.get(`${app.baseURL}/api/system`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(unavailableSystem.status()).toBe(200);
    expect((await unavailableSystem.json()).shepherdModelReviewConfigured).toBe(false);

    await app.stop();
    app = await startTestApp({ modelReviewConfigured: true });
    await openSettings(page, app);
    const availableToggle = page.getByRole("checkbox", { name: "Bounded model review" });
    await expect(availableToggle).toBeEnabled();
    await expect(availableToggle).toBeChecked();
    await expect(page.locator('[role="status"]').filter({ hasText: /^Unavailable$/u })).toHaveCount(0);

    const configuredSystem = await request.get(`${app.baseURL}/api/system`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(configuredSystem.status()).toBe(200);
    expect((await configuredSystem.json()).shepherdModelReviewConfigured).toBe(true);

    await availableToggle.click();
    await expect(availableToggle).not.toBeChecked();
    let saved = page.waitForResponse((response) =>
      response.request().method() === "PATCH" && response.url().endsWith("/api/shepherd/settings"),
    );
    await page.getByRole("button", { name: "Save settings" }).click();
    expect((await saved).status()).toBe(200);
    await availableToggle.focus();
    await expect(availableToggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(availableToggle).toBeChecked();
    saved = page.waitForResponse((response) =>
      response.request().method() === "PATCH" && response.url().endsWith("/api/shepherd/settings"),
    );
    await page.getByRole("button", { name: "Save settings" }).click();
    expect((await saved).status()).toBe(200);
    expect(patchCount).toBe(2);
    await assertNoDocumentOverflow(page);
    await capture(page, testInfo, "configured-stored-on");

    const state = await app.persistedState();
    expect(JSON.parse(state).shepherd.settings.modelReviewEnabled).toBe(true);
    expect(state.includes("fixture-review-key-never-send")).toBe(false);
    expect((await page.locator("body").innerText()).includes("fixture-review-key-never-send")).toBe(false);
    expect(app.readOutput().includes("fixture-review-key-never-send")).toBe(false);
  } finally {
    await app.stop();
  }
});
