import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AUTH_TOKEN, repositoryRoot, startTestApp } from "./support/test-app.mjs";

let app;

test.beforeAll(async () => {
  app = await startTestApp();
});

test.afterAll(async () => {
  await app?.stop();
});

test("authenticated Shepherd shell has no document overflow", async ({ page }, testInfo) => {
  await page.goto(`${app.baseURL}/shepherd`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
  await expect(page.getByText("Kernel online", { exact: true })).toBeVisible();

  const expectedViewport = testInfo.project.use.viewport;
  expect(expectedViewport).toBeTruthy();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(viewport).toEqual(expectedViewport);
  const overflow = await page.evaluate(() => ({
    document: {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    },
    body: {
      clientWidth: document.body.clientWidth,
      scrollWidth: document.body.scrollWidth,
      clientHeight: document.body.clientHeight,
      scrollHeight: document.body.scrollHeight,
    },
  }));
  expect(overflow.document.scrollWidth).toBeLessThanOrEqual(overflow.document.clientWidth);
  expect(overflow.document.scrollHeight).toBeLessThanOrEqual(overflow.document.clientHeight);
  expect(overflow.body.scrollWidth).toBeLessThanOrEqual(overflow.body.clientWidth);
  expect(overflow.body.scrollHeight).toBeLessThanOrEqual(overflow.body.clientHeight);
  expect(await page.locator("body").innerText()).not.toContain(AUTH_TOKEN);

  const screenshotDirectory = path.join(repositoryRoot, "docs/ui-review/e2e-harness");
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(screenshotDirectory, `${viewport.width}x${viewport.height}.png`),
    fullPage: false,
  });
});
