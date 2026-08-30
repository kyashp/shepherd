import { test, expect } from "@playwright/test";
import { access } from "node:fs/promises";
import path from "node:path";
import {
  AUTH_TOKEN,
  isPortOpen,
  prepareHarnessRoot,
  startTestApp,
} from "./support/test-app.mjs";
import {
  assertMinimumContrast,
  assertNoDocumentOverflow,
  assertVisibleFocus,
  captureUiGate,
} from "./support/ui-gate.mjs";

const LONG_AGENT_NAME = "WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWWW";
const EDITED_DESCRIPTION = "Edited through the clean-shell UI gate.";
const UNKNOWN_ROUTE = "/ui-gate-route-that-does-not-exist";

let app;
let harnessRoot;

async function assertVisiblyDisabled(locator) {
  await expect(locator).toBeDisabled();
  const opacity = await locator.evaluate((element) => {
    const styled = element.closest(".toggle.disabled") ?? element;
    return Number.parseFloat(getComputedStyle(styled).opacity);
  });
  expect(opacity).toBeLessThan(1);
}

async function preserveSoftFailure(label, assertion) {
  try {
    await assertion();
  } catch (error) {
    expect.soft(error instanceof Error ? error.message : String(error), label).toBe("");
  }
}

async function settingsTabState(tablist) {
  return await tablist.getByRole("tab").evaluateAll((tabs) => tabs.map((tab) => ({
    ariaControls: tab.getAttribute("aria-controls"),
    ariaSelected: tab.getAttribute("aria-selected"),
    focused: document.activeElement === tab,
    id: tab.id || null,
    label: tab.textContent?.trim() ?? "",
    tabIndexAttribute: tab.getAttribute("tabindex"),
    tabIndexProperty: tab.tabIndex,
  })));
}

test.beforeAll(async () => {
  harnessRoot = await prepareHarnessRoot();
  app = await startTestApp();
  expect(path.dirname(app.runRoot)).toBe(harnessRoot);
});

test.afterAll(async () => {
  if (!app) return;
  const { port, runRoot } = app;
  await app.stop();
  expect(await isPortOpen(port)).toBe(false);
  await expect(access(runRoot)).rejects.toMatchObject({ code: "ENOENT" });
  app = undefined;
});

test("requires WCAG AA contrast for muted authentication instructions", async ({ page }) => {
  await page.goto(`${app.baseURL}/`);
  await expect(page.getByRole("heading", { name: "Enter the access token" })).toBeVisible();
  await assertMinimumContrast(
    page.getByText("This shared demo token is configured by the platform operator."),
    4.5,
  );
});

test("requires WCAG AA contrast for muted Agents empty-state text", async ({ page }) => {
  await page.goto(`${app.baseURL}/agents`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  const agentsRegion = page.getByRole("region", { name: "Agents" });
  await expect(agentsRegion.getByText("No Agents yet", { exact: true })).toBeVisible();
  await assertMinimumContrast(
    agentsRegion.getByText("Create an Agent with a role and bounded project authority."),
    4.5,
  );
});

test("covers the clean shell, authentication, Agents, Settings, and not-found states", async ({ page }, testInfo) => {
  const viewport = testInfo.project.use.viewport;
  expect(viewport).toBeDefined();
  const viewportName = `${viewport.width}x${viewport.height}`;
  const evidencePaths = [];
  const capture = async (stage) => {
    evidencePaths.push(await captureUiGate(page, viewportName, stage));
  };

  let releaseAuth;
  let observeAuth;
  const authHeld = new Promise((resolve) => { observeAuth = resolve; });
  const authRelease = new Promise((resolve) => { releaseAuth = resolve; });
  let heldFirstAuth = false;
  const holdFirstAuth = async (route) => {
    if (heldFirstAuth) {
      await route.continue();
      return;
    }
    heldFirstAuth = true;
    observeAuth();
    await authRelease;
    await route.continue();
  };
  await page.route("**/api/auth", holdFirstAuth);

  const navigation = page.goto(`${app.baseURL}/`, { waitUntil: "domcontentloaded" });
  await authHeld;
  await expect(page.getByRole("heading", { name: "Connecting to the control plane" })).toBeVisible();
  await capture("01-auth-loading");
  releaseAuth();
  await navigation;
  await page.unroute("**/api/auth", holdFirstAuth);

  const tokenInput = page.getByLabel("Access token");
  const unlockButton = page.getByRole("button", { name: "Open Launchpad" });
  await expect(tokenInput).toBeFocused();
  await assertVisibleFocus(page, tokenInput);
  await expect(unlockButton).toBeDisabled();
  await tokenInput.press("Enter");
  const requiredState = await tokenInput.evaluate((element) => ({
    label: element.labels?.[0]?.textContent?.trim() ?? "",
    validationMessage: element.validationMessage,
    valueMissing: element.validity.valueMissing,
  }));
  expect(requiredState.label).toContain("Access token");
  expect(requiredState.valueMissing).toBe(true);
  expect(requiredState.validationMessage).not.toBe("");

  await tokenInput.fill("invalid-ui-gate-token");
  const deniedBootstrap = page.waitForResponse((response) =>
    response.request().method() === "GET" && response.url().endsWith("/api/agents"),
  );
  await unlockButton.click();
  const deniedResponse = await deniedBootstrap;
  expect(deniedResponse.status()).toBe(401);
  expect(await deniedResponse.json()).toEqual({ error: "Authentication required" });
  const authError = page.getByRole("alert");
  await expect(authError).toHaveText("The access token is not valid.");
  await assertMinimumContrast(authError, 4.5);
  await capture("02-auth-error");

  await tokenInput.fill(AUTH_TOKEN);
  await unlockButton.click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();

  await expect(page.getByRole("complementary")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  const shepherdNavigation = page.getByRole("navigation", { name: "Shepherd navigation" });
  const projectNavigation = page.getByRole("navigation", { name: "Project group navigation" });
  const agentNavigation = page.getByRole("navigation", { name: "Your Agents" });
  await expect(shepherdNavigation).toBeVisible();
  await expect(projectNavigation).toBeVisible();
  await expect(agentNavigation).toBeVisible();
  const shepherdLink = shepherdNavigation.getByRole("link", { name: /Shepherd/u });
  await expect(shepherdLink).toHaveClass(/\bactive\b/u);
  await assertVisibleFocus(page, shepherdLink);
  await assertMinimumContrast(shepherdLink, 4.5);
  await assertMinimumContrast(page.getByRole("heading", { name: "Shepherd", exact: true }), 4.5);
  await assertNoDocumentOverflow(page);

  await page.getByRole("link", { name: "Your Agents", exact: true }).click();
  const agentsRegion = page.getByRole("region", { name: "Agents" });
  await expect(agentsRegion.getByText("No Agents yet", { exact: true })).toBeVisible();
  await assertNoDocumentOverflow(page);
  await capture("03-agents-empty");

  await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Create Agent", exact: true })).toBeVisible();
  const nameInput = page.getByLabel("Agent name");
  const createAgent = page.getByRole("button", { name: "Create Agent", exact: true });
  await expect(nameInput).toBeFocused();
  await assertVisibleFocus(page, nameInput);
  await assertVisiblyDisabled(createAgent);
  await capture("04-agent-create-disabled");

  expect(LONG_AGENT_NAME).toHaveLength(80);
  await nameInput.fill(LONG_AGENT_NAME);
  await expect(createAgent).toBeEnabled();
  await createAgent.click();
  const longNameHeading = page.getByRole("heading", { name: LONG_AGENT_NAME, exact: true });
  await expect(longNameHeading).toBeVisible();
  const renderedLines = await longNameHeading.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  expect(renderedLines).toBeGreaterThan(1);
  const longNameGeometry = await page.evaluate(() => ({
    body: {
      clientHeight: document.body.clientHeight,
      clientWidth: document.body.clientWidth,
      scrollHeight: document.body.scrollHeight,
      scrollWidth: document.body.scrollWidth,
    },
    documentElement: {
      clientHeight: document.documentElement.clientHeight,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    },
    viewport: {
      height: window.innerHeight,
      width: window.innerWidth,
    },
  }));
  await testInfo.attach("agent-long-content-geometry", {
    body: JSON.stringify(longNameGeometry, null, 2),
    contentType: "application/json",
  });
  await preserveSoftFailure(
    "the long Agent name does not create document overflow",
    async () => assertNoDocumentOverflow(page),
  );
  await capture("05-agent-long-content");

  const editAgent = page.getByRole("link", { name: "Edit", exact: true });
  await page.keyboard.press("Tab");
  await assertVisibleFocus(page, editAgent);
  await editAgent.click();
  await expect(page.getByRole("heading", { name: `Edit ${LONG_AGENT_NAME}`, exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent name")).toHaveValue(LONG_AGENT_NAME);
  await page.getByLabel("Description").fill(EDITED_DESCRIPTION);
  const saveAgent = page.getByRole("button", { name: "Save changes" });
  await assertVisibleFocus(page, saveAgent);
  await saveAgent.click();
  await expect(longNameHeading).toBeVisible();
  await expect(page.getByText(EDITED_DESCRIPTION, { exact: true })).toBeVisible();

  const stopAgent = page.getByRole("button", { name: "Stop", exact: true });
  await assertVisibleFocus(page, stopAgent);
  await stopAgent.click();
  await expect(page.getByText("Agent stopped", { exact: true }).first()).toBeVisible();
  const startAgent = page.getByRole("button", { name: "Start", exact: true });
  await expect(startAgent).toBeVisible();
  await assertVisibleFocus(page, startAgent);
  await startAgent.click();
  await expect(page.getByText("Shepherd route ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();

  const settingsLink = page.getByRole("link", { name: "Settings", exact: true });
  await assertVisibleFocus(page, settingsLink);
  await settingsLink.click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(settingsLink).toHaveClass(/\bactive\b/u);
  const tablist = page.getByRole("tablist", { name: "Settings sections" });
  await expect(tablist).toBeVisible();
  const generalTab = tablist.getByRole("tab", { name: "General" });
  await assertVisibleFocus(page, generalTab);
  await assertVisiblyDisabled(page.getByRole("checkbox", { name: "Retain completed Planes" }));
  const saveSettings = page.getByRole("button", { name: "Save settings" });
  const discardSettings = page.getByRole("button", { name: "Discard changes" });
  await assertVisiblyDisabled(saveSettings);
  await preserveSoftFailure(
    "Discard changes is visibly and semantically disabled with no unsaved changes",
    async () => assertVisiblyDisabled(discardSettings),
  );

  const securityTab = tablist.getByRole("tab", { name: "Security" });
  await securityTab.click();
  await assertVisiblyDisabled(page.getByRole("checkbox", { name: "Bounded model review" }));
  const notificationsTab = tablist.getByRole("tab", { name: "Notifications" });
  await notificationsTab.click();
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  for (const label of [
    "Mission completed notifications",
    "Attention required notifications",
    "Collision detected notifications",
  ]) {
    await assertVisiblyDisabled(page.getByRole("checkbox", { name: label }));
  }
  await assertMinimumContrast(saveSettings, 3);
  await assertNoDocumentOverflow(page);
  await capture("06-settings-disabled");

  await page.evaluate((route) => {
    window.history.pushState(null, "", route);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, UNKNOWN_ROUTE);
  await expect(page.getByText("This route does not exist", { exact: true })).toBeVisible();
  const recoveryLink = page.getByRole("link", { name: "Open Shepherd" });
  await expect(recoveryLink).toHaveAttribute("href", "/shepherd");
  await assertVisibleFocus(page, recoveryLink);
  await assertNoDocumentOverflow(page);
  await capture("07-not-found");
  expect(evidencePaths).toHaveLength(7);

  await settingsLink.click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const keyboardTablist = page.getByRole("tablist", { name: "Settings sections" });
  const keyboardGeneralTab = keyboardTablist.getByRole("tab", { name: "General" });
  await keyboardGeneralTab.focus();
  const initial = await settingsTabState(keyboardTablist);
  await page.keyboard.press("ArrowRight");
  const afterArrowRight = await settingsTabState(keyboardTablist);
  await page.keyboard.press("End");
  const afterEnd = await settingsTabState(keyboardTablist);
  await page.keyboard.press("Home");
  const afterHome = await settingsTabState(keyboardTablist);
  await page.keyboard.press("ArrowLeft");
  const afterArrowLeft = await settingsTabState(keyboardTablist);
  const panels = await page.getByRole("tabpanel").evaluateAll((items) => items.map((panel) => ({
    ariaLabelledby: panel.getAttribute("aria-labelledby"),
    id: panel.id || null,
  })));
  const diagnostics = { initial, afterArrowRight, afterEnd, afterHome, afterArrowLeft, panels };
  await testInfo.attach("settings-tab-keyboard-diagnostics", {
    body: JSON.stringify(diagnostics, null, 2),
    contentType: "application/json",
  });

  expect.soft(initial.filter((tab) => tab.tabIndexAttribute === "0"), "exactly one Settings tab has tabindex=0").toHaveLength(1);
  expect.soft(afterArrowRight.find((tab) => tab.focused)?.label, "ArrowRight moves focus to Execution").toBe("Execution");
  expect.soft(afterArrowRight.find((tab) => tab.ariaSelected === "true")?.label, "ArrowRight selects Execution").toBe("Execution");
  expect.soft(afterEnd.find((tab) => tab.focused)?.label, "End moves focus to Notifications").toBe("Notifications");
  expect.soft(afterEnd.find((tab) => tab.ariaSelected === "true")?.label, "End selects Notifications").toBe("Notifications");
  expect.soft(afterHome.find((tab) => tab.focused)?.label, "Home moves focus to General").toBe("General");
  expect.soft(afterHome.find((tab) => tab.ariaSelected === "true")?.label, "Home selects General").toBe("General");
  expect.soft(afterArrowLeft.find((tab) => tab.focused)?.label, "ArrowLeft wraps focus to Notifications").toBe("Notifications");
  expect.soft(afterArrowLeft.find((tab) => tab.ariaSelected === "true")?.label, "ArrowLeft wraps selection to Notifications").toBe("Notifications");
  expect.soft(initial.every((tab) => Boolean(tab.id && tab.ariaControls)), "every Settings tab has an id and aria-controls").toBe(true);
  expect.soft(panels.length, "Settings exposes one related tabpanel").toBe(1);
  expect.soft(
    panels.every((panel) => Boolean(panel.id && panel.ariaLabelledby)),
    "every Settings tabpanel has an id and aria-labelledby",
  ).toBe(true);
  const selectedTab = initial.find((tab) => tab.ariaSelected === "true");
  expect.soft(selectedTab?.ariaControls, "the active tab controls the rendered tabpanel").toBe(panels[0]?.id);
  expect.soft(panels[0]?.ariaLabelledby, "the rendered tabpanel is labelled by the active tab").toBe(selectedTab?.id);
});
