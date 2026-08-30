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
  assertNoSensitiveCanaries,
  assertSafeUiGateSurface,
  assertScrollOwner,
  assertVisibleFocus,
  captureUiGate,
} from "./support/ui-gate.mjs";

const LONG_AGENT_NAME = "WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWW WWWWWWWWWW";
const EDITED_DESCRIPTION = "Edited through the clean-shell UI gate.";
const GROUP_AGENT_NAME = "UI Gate Group Agent";
const LONG_GROUP_MESSAGES = ["W".repeat(1_900), "M".repeat(1_900)];
const MISSION_INTENT = "Implement frontend and backend authentication, detect their semantic transport collision, and promote the independently verified resolution.";
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

function authHeaders() {
  return { Authorization: `Bearer ${AUTH_TOKEN}` };
}

async function shepherdState(request) {
  const response = await request.get(`${app.baseURL}/api/shepherd/state`, { headers: authHeaders() });
  expect(response.status()).toBe(200);
  return (await response.json()).state;
}

async function waitForMissionState(request, missionId, expectedState, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let latest;
  while (Date.now() < deadline) {
    latest = await shepherdState(request);
    const mission = latest.missions.find((item) => item.id === missionId);
    if (mission?.state === expectedState) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const observed = latest?.missions.find((item) => item.id === missionId)?.state ?? "missing";
  throw new Error(`Mission did not reach ${expectedState}; observed ${observed}`);
}

async function unlockShepherd(page) {
  await page.goto(`${app.baseURL}/shepherd`);
  const tokenInput = page.getByLabel("Access token");
  if (await tokenInput.isVisible()) {
    await tokenInput.fill(AUTH_TOKEN);
    await page.getByRole("button", { name: "Open Launchpad" }).click();
  }
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
  await expect(page.getByText("Kernel online", { exact: true })).toBeVisible();
}

async function createProjectGroupAgent(page) {
  await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
  await page.getByLabel("Agent name").fill(GROUP_AGENT_NAME);
  await page.getByRole("radio", { name: /Frontend/u }).locator("..").click();
  await page.getByRole("button", { name: "Create Agent", exact: true }).click();
  await expect(page.getByRole("heading", { name: GROUP_AGENT_NAME, exact: true })).toBeVisible();
}

async function mentionButtonPresentation(locator) {
  return await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      cursor: style.cursor,
      opacity: Number.parseFloat(style.opacity),
    };
  });
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

  const agentsLink = page.getByRole("link", { name: "Your Agents", exact: true });
  await assertVisibleFocus(page, agentsLink);
  await agentsLink.press("Enter");
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

  await recoveryLink.press("Enter");
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
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
  const selectedTab = afterArrowLeft.find((tab) => tab.ariaSelected === "true");
  expect.soft(selectedTab?.ariaControls, "the active tab controls the rendered tabpanel").toBe(panels[0]?.id);
  expect.soft(panels[0]?.ariaLabelledby, "the rendered tabpanel is labelled by the active tab").toBe(selectedTab?.id);
});

test("covers Project Group initialization, recovery, pending sends, and persisted messages", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  const viewport = testInfo.project.use.viewport;
  expect(viewport).toBeDefined();
  const viewportName = `${viewport.width}x${viewport.height}`;
  const groupMessagesUrl = "**/api/shepherd/projects/*/group-messages*";

  await unlockShepherd(page);
  await createProjectGroupAgent(page);
  const missionCountBefore = (await shepherdState(request)).missions.length;
  await page.getByRole("link", { name: /Project Group/u }).click();
  await expect(page.getByText("No Shepherd project yet", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message Project Group");
  const sendButton = page.getByRole("button", { name: "Send group message" });
  const mentionButton = page.getByLabel("Available mention targets")
    .getByRole("button", { name: `@${GROUP_AGENT_NAME}`, exact: true });
  await expect(composer).toBeDisabled();
  await expect(sendButton).toBeDisabled();
  const uninitializedMentionPresentation = await mentionButtonPresentation(mentionButton);
  await preserveSoftFailure(
    "member mentions are semantically disabled before Project Group initialization",
    async () => expect(mentionButton).toBeDisabled(),
  );
  await captureUiGate(page, viewportName, "14-group-uninitialized");

  let releaseInitialMessages;
  let observeInitialMessages;
  const initialMessagesHeld = new Promise((resolve) => { observeInitialMessages = resolve; });
  const initialMessagesRelease = new Promise((resolve) => { releaseInitialMessages = resolve; });
  let heldInitialMessages = false;
  const holdInitialMessages = async (route) => {
    if (heldInitialMessages || route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    heldInitialMessages = true;
    observeInitialMessages();
    await initialMessagesRelease;
    await route.continue();
  };
  await page.route(groupMessagesUrl, holdInitialMessages);
  const initialized = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && response.url().endsWith("/api/shepherd/projects/auth-demo/group-initialization"),
  );
  await page.getByRole("button", { name: "Initialize Project Group", exact: true }).click();
  expect((await initialized).status()).toBe(200);
  await initialMessagesHeld;
  try {
    await expect(page.getByText("Loading real group messages…", { exact: true })).toBeVisible();
    await captureUiGate(page, viewportName, "15-group-loading");
  } finally {
    releaseInitialMessages();
  }
  await expect(page.getByText("The Project Group is quiet", { exact: true })).toBeVisible();
  await page.unroute(groupMessagesUrl, holdInitialMessages);
  await expect(mentionButton).toBeEnabled();
  const enabledMentionPresentation = await mentionButtonPresentation(mentionButton);
  expect.soft(
    uninitializedMentionPresentation.opacity < enabledMentionPresentation.opacity
      || uninitializedMentionPresentation.cursor === "not-allowed",
    "uninitialized member mentions have a non-color disabled treatment",
  ).toBe(true);
  await captureUiGate(page, viewportName, "16-group-empty");

  let failedMessageRead = false;
  const failOneMessageRead = async (route) => {
    if (!failedMessageRead && route.request().method() === "GET") {
      failedMessageRead = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "UI gate transient group read" }),
      });
      return;
    }
    await route.continue();
  };
  await page.route(groupMessagesUrl, failOneMessageRead);
  const reconnectBanner = page.getByRole("status").filter({ hasText: "UI gate transient group read" });
  await expect(reconnectBanner).toContainText("retrying automatically", { timeout: 5_000 });
  await expect(page.getByText("The Project Group is quiet", { exact: true })).toBeVisible();
  await captureUiGate(page, viewportName, "17-group-reconnecting");
  await page.unroute(groupMessagesUrl, failOneMessageRead);
  await expect(reconnectBanner).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  await composer.fill("");
  await mentionButton.click();
  await composer.press("End");
  const targetedRequest = "use an HttpOnly session cookie.";
  await composer.type(targetedRequest);
  const targetedContent = `@"${GROUP_AGENT_NAME}" ${targetedRequest}`;
  await expect(composer).toHaveValue(targetedContent);

  let releasePendingPost;
  let observePendingPost;
  const pendingPostHeld = new Promise((resolve) => { observePendingPost = resolve; });
  const pendingPostRelease = new Promise((resolve) => { releasePendingPost = resolve; });
  let heldPostCount = 0;
  const holdOnePost = async (route) => {
    if (heldPostCount > 0 || route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    heldPostCount += 1;
    observePendingPost();
    await pendingPostRelease;
    await route.continue();
  };
  await page.route(groupMessagesUrl, holdOnePost);
  const targetedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/group-messages$/u.test(response.url()),
  );
  await composer.press("Enter");
  await pendingPostHeld;
  try {
    await expect(composer).toBeDisabled();
    await expect(sendButton).toBeDisabled();
    await expect(mentionButton).toBeDisabled();
    const pendingMentionPresentation = await mentionButtonPresentation(mentionButton);
    expect.soft(
      pendingMentionPresentation.opacity < enabledMentionPresentation.opacity
        || pendingMentionPresentation.cursor === "not-allowed",
      "pending member mentions have a non-color disabled treatment",
    ).toBe(true);
    expect(heldPostCount).toBe(1);
  } finally {
    releasePendingPost();
  }
  expect((await targetedResponse).status()).toBe(201);
  await page.unroute(groupMessagesUrl, holdOnePost);
  await expect(page.locator(".group-message-human").filter({ hasText: targetedRequest })).toHaveCount(1);

  const storedMessagesResponse = await request.get(
    `${app.baseURL}/api/shepherd/projects/auth-demo/group-messages`,
    { headers: authHeaders() },
  );
  expect(storedMessagesResponse.status()).toBe(200);
  const storedMessages = (await storedMessagesResponse.json()).messages;
  const targetedMessage = storedMessages.find((message) =>
    message.senderType === "human"
      && message.targetAgentId
      && message.content === targetedRequest,
  );
  expect(targetedMessage).toMatchObject({ contractId: null, missionId: null });

  for (const [index, content] of LONG_GROUP_MESSAGES.entries()) {
    const post = page.waitForResponse((response) =>
      response.request().method() === "POST" && /\/group-messages$/u.test(response.url()),
    );
    await composer.fill(content);
    await composer.press("Enter");
    expect((await post).status()).toBe(201);
    const paragraph = page.locator(".group-message-human p")
      .filter({ hasText: index === 0 ? /^W{1900}$/u : /^M{1900}$/u });
    await expect(paragraph).toHaveCount(1);
  }

  const longParagraph = page.locator(".group-message-human p").filter({ hasText: /^W{1900}$/u });
  const longGeometry = await longParagraph.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      lineHeight: Number.parseFloat(style.lineHeight),
      overflowWrap: style.overflowWrap,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(longGeometry.overflowWrap).toBe("anywhere");
  expect(longGeometry.scrollWidth).toBeLessThanOrEqual(longGeometry.clientWidth + 1);
  expect(longGeometry.scrollHeight).toBeGreaterThan(longGeometry.lineHeight * 2);
  const messagesPane = page.locator(".group-messages");
  const messagesGeometry = await messagesPane.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(messagesGeometry.scrollHeight).toBeGreaterThan(messagesGeometry.clientHeight + 1);
  await assertScrollOwner(messagesPane);
  await assertNoDocumentOverflow(page);
  await assertSafeUiGateSurface(page.locator(".group-chat-panel"));
  await assertNoSensitiveCanaries({ page });

  const subsequentPoll = page.waitForResponse((response) =>
    response.request().method() === "GET"
      && /\/group-messages\?/u.test(response.url())
      && response.status() === 200,
  );
  await subsequentPoll;
  for (const [index, content] of LONG_GROUP_MESSAGES.entries()) {
    const messagesAfterPoll = await request.get(
      `${app.baseURL}/api/shepherd/projects/auth-demo/group-messages`,
      { headers: authHeaders() },
    );
    expect(messagesAfterPoll.status()).toBe(200);
    const matchingMessages = (await messagesAfterPoll.json()).messages
      .filter((message) => message.senderType === "human" && message.content === content);
    expect(matchingMessages, `long Project Group message ${index + 1} remains singular after polling`).toHaveLength(1);
  }
  expect((await shepherdState(request)).missions).toHaveLength(missionCountBefore);
  await captureUiGate(page, viewportName, "18-group-message");
});

test("covers Shepherd loading, empty, and reconnect states", async ({ page }, testInfo) => {
  const viewport = testInfo.project.use.viewport;
  expect(viewport).toBeDefined();
  const viewportName = `${viewport.width}x${viewport.height}`;

  let releaseInitialState;
  let observeInitialState;
  const initialStateHeld = new Promise((resolve) => { observeInitialState = resolve; });
  const initialStateRelease = new Promise((resolve) => { releaseInitialState = resolve; });
  let heldInitialState = false;
  const holdInitialState = async (route) => {
    if (heldInitialState || route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    heldInitialState = true;
    observeInitialState();
    await initialStateRelease;
    await route.continue();
  };
  await page.route("**/api/shepherd/state", holdInitialState);

  await page.goto(`${app.baseURL}/shepherd`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await initialStateHeld;
  await expect(page.getByText("Connecting to the Shepherd kernel…", { exact: true })).toBeVisible();
  await captureUiGate(page, viewportName, "08-shepherd-loading");

  releaseInitialState();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
  await expect(page.getByText("No Mission yet", { exact: true })).toBeVisible();
  await expect(page.getByText("Timeline waiting", { exact: true })).toBeVisible();
  await expect(page.getByText("No Planes yet", { exact: true })).toBeVisible();
  await assertNoDocumentOverflow(page);
  await captureUiGate(page, viewportName, "09-shepherd-empty");
  await page.unroute("**/api/shepherd/state", holdInitialState);

  let failedStateRead = false;
  const failOneStateRead = async (route) => {
    if (!failedStateRead && route.request().method() === "GET") {
      failedStateRead = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "UI gate transient state read" }),
      });
      return;
    }
    await route.continue();
  };
  await page.route("**/api/shepherd/state", failOneStateRead);
  const reconnectBanner = page.getByRole("status").filter({ hasText: "Showing the last confirmed state" });
  await expect(reconnectBanner).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("No Mission yet", { exact: true })).toBeVisible();
  await expect(page.getByText("Reconnecting", { exact: true })).toBeVisible();
  await captureUiGate(page, viewportName, "10-shepherd-reconnecting");
  await page.unroute("**/api/shepherd/state", failOneStateRead);
  await expect(page.getByText("Kernel online", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(reconnectBanner).toHaveCount(0);
});

test("covers every populated Shepherd surface and exposes full Plane identifiers", async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  const viewport = testInfo.project.use.viewport;
  expect(viewport).toBeDefined();
  const viewportName = `${viewport.width}x${viewport.height}`;
  await unlockShepherd(page);

  const composer = page.getByLabel("Message Shepherd");
  await composer.fill(MISSION_INTENT);
  const acceptedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/shepherd/messages"),
  );
  await composer.press("Enter");
  const accepted = await acceptedResponse;
  expect(accepted.status()).toBe(202);
  const missionId = (await accepted.json()).missionId;
  const snapshot = await waitForMissionState(request, missionId, "completed");
  const mission = snapshot.missions.find((item) => item.id === missionId);
  const contracts = snapshot.contracts.filter((item) => item.missionId === missionId);
  const planes = snapshot.planes.filter((item) => item.missionId === missionId);
  const candidates = snapshot.candidates.filter((item) => item.missionId === missionId);
  expect(mission).toBeDefined();
  expect(contracts).toHaveLength(2);
  expect(planes).toHaveLength(5);
  expect(candidates).toHaveLength(2);

  await expect(page.locator(".timeline-panel .state-pill")).toHaveText("Completed", { timeout: 5_000 });
  await expect(page.locator(".plane-tree")).toContainText("Promoted");
  await assertScrollOwner(page.locator(".event-list"));
  await assertScrollOwner(page.locator(".timeline-scroll"));
  await assertScrollOwner(page.locator(".plane-tree"));
  await assertNoDocumentOverflow(page);
  await assertNoSensitiveCanaries({ page });
  await captureUiGate(page, viewportName, "11-shepherd-active");

  for (const name of ["Contracts", "Verification", "Collisions", "Resolution"]) {
    const filter = page.getByRole("button", { name, exact: true });
    await assertVisibleFocus(page, filter);
    await filter.press("Enter");
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("article.event-card").first()).toBeVisible();
  }
  await captureUiGate(page, viewportName, "12-shepherd-filtered");
  await page.getByRole("button", { name: "All", exact: true }).click();

  const selectedCandidate = candidates.find((item) => item.selectionState === "selected");
  expect(selectedCandidate).toBeDefined();
  const selectedPlane = planes.find((item) => item.id === selectedCandidate.planeId);
  expect(selectedPlane).toBeDefined();
  const selectedNode = page.locator("button.tree-node").filter({ hasText: selectedCandidate.targetValue });
  await selectedNode.scrollIntoViewIfNeeded();
  const shortenedPlaneId = selectedNode.locator("small");
  await expect(shortenedPlaneId).toHaveText(`${selectedPlane.id.slice(0, 14)}…`);
  await expect.soft(shortenedPlaneId, "the shortened Plane ID exposes its full value").toHaveAttribute("title", selectedPlane.id);

  await assertVisibleFocus(page, selectedNode);
  await selectedNode.press("Enter");
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await assertSafeUiGateSurface(drawer);
  const closeDrawer = drawer.getByRole("button", { name: "Close Plane detail" });
  await expect(closeDrawer).toBeFocused();
  const candidateTab = drawer.getByRole("tab", { name: "Candidate verification" });
  const promotionTab = drawer.getByRole("tab", { name: "Final promotion re-verification" });
  await candidateTab.focus();
  await candidateTab.press("ArrowRight");
  await expect(promotionTab).toBeFocused();
  await expect(promotionTab).toHaveAttribute("aria-selected", "true");
  await captureUiGate(page, viewportName, "13-plane-drawer");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(selectedNode).toBeFocused();
});
