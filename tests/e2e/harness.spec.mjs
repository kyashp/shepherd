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

test("Create Agent presets preserve native radio behavior without page overflow", async ({ page }, testInfo) => {
  await page.goto(`${app.baseURL}/shepherd`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await page.getByRole("link", { name: "Create Agent" }).click();
  await expect(page.getByRole("heading", { name: "Create Agent", exact: true })).toBeVisible();

  const presetGroup = page.getByRole("group", { name: "Authority preset" });
  const radios = presetGroup.getByRole("radio");
  await expect(radios).toHaveCount(4);
  await expect(page.getByRole("radio", { name: /Generalist/u })).toBeChecked();

  await page.getByLabel("Base image / runtime").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: /Generalist/u })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  const verificationRadio = page.getByRole("radio", { name: /Verification/u });
  await expect(verificationRadio).toBeFocused();
  await expect(verificationRadio).toBeChecked();
  const verificationLabel = verificationRadio.locator("..");
  await expect(verificationLabel).toHaveClass(/selected/u);
  await expect(verificationLabel).toHaveCSS("outline-style", "solid");
  await expect(verificationLabel).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Advanced authority patterns" })).toBeFocused();

  for (const name of [/Frontend/u, /Backend/u, /Verification/u, /Generalist/u]) {
    const radio = page.getByRole("radio", { name });
    await radio.locator("..").click();
    await expect(radio).toBeChecked();
    await expect(radio.locator("..")).toHaveClass(/selected/u);
    await expect(presetGroup.locator('input[type="radio"]:checked')).toHaveCount(1);
  }
  await expect(page.getByRole("radio", { name: /Generalist/u })).toBeChecked();

  const expectedViewport = testInfo.project.use.viewport;
  expect(expectedViewport).toBeTruthy();
  const geometry = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
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
    radioBoxes: [...document.querySelectorAll('.preset-grid input[type="radio"]')].map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: rect.width,
        height: rect.height,
        minHeight: style.minHeight,
        padding: style.padding,
        borderWidth: style.borderWidth,
        borderStyle: style.borderStyle,
        margin: style.margin,
      };
    }),
  }));
  expect(geometry.viewport).toEqual(expectedViewport);
  expect(geometry.document.scrollWidth).toBeLessThanOrEqual(geometry.document.clientWidth);
  expect(geometry.document.scrollHeight).toBeLessThanOrEqual(geometry.document.clientHeight);
  expect(geometry.body.scrollWidth).toBeLessThanOrEqual(geometry.body.clientWidth);
  expect(geometry.body.scrollHeight).toBeLessThanOrEqual(geometry.body.clientHeight);
  expect(geometry.radioBoxes).toHaveLength(4);
  for (const box of geometry.radioBoxes) {
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    expect(box.minHeight).toBe("0px");
    expect(box.padding).toBe("0px");
    expect(box.borderWidth).toBe("0px");
    expect(box.borderStyle).toBe("none");
    expect(box.margin).toBe("0px");
  }

  const screenshotDirectory = path.join(repositoryRoot, "docs/ui-review/ui-03-create-agent");
  await mkdir(screenshotDirectory, { recursive: true });
  await page.locator(".main-content").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({
    path: path.join(screenshotDirectory, `${geometry.viewport.width}x${geometry.viewport.height}.png`),
    fullPage: false,
  });
});
