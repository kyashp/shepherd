import { test, expect } from "./support/coverage-test.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { AUTH_TOKEN, repositoryRoot, startTestApp } from "./support/test-app.mjs";

let app;

function evidenceDirectory(defaultRelative, ephemeralRelative) {
  return path.join(
    repositoryRoot,
    process.env.E2E_UPDATE_EVIDENCE === "true" ? defaultRelative : ephemeralRelative,
  );
}

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
  expect((await page.locator("body").innerText()).includes(AUTH_TOKEN)).toBe(false);

  const screenshotDirectory = evidenceDirectory(
    "docs/ui-review/e2e-harness",
    ".tmp/playwright-evidence/e2e-harness",
  );
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

  const screenshotDirectory = evidenceDirectory(
    "docs/ui-review/ui-03-create-agent",
    ".tmp/playwright-evidence/ui-03-create-agent",
  );
  await mkdir(screenshotDirectory, { recursive: true });
  await page.locator(".main-content").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({
    path: path.join(screenshotDirectory, `${geometry.viewport.width}x${geometry.viewport.height}.png`),
    fullPage: false,
  });
});

test("settings keyboard navigation, discard, save, and demo reset remain functional", async ({ page }) => {
  await page.goto(`${app.baseURL}/settings`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

  const general = page.getByRole("tab", { name: "General" });
  await general.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Notifications" })).toBeFocused();
  await expect(page.getByText("Notification preferences", { exact: true })).toBeVisible();
  await page.keyboard.press("Home");
  await expect(general).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Execution" })).toBeFocused();

  const contractTimeout = page.getByLabel("Contract timeout in seconds");
  const candidateTimeout = page.getByLabel("Candidate timeout in seconds");
  const maxPlanes = page.getByLabel("Maximum parallel Planes");
  const automaticResolution = page.getByRole("checkbox", { name: "Automatic resolution" });
  await contractTimeout.fill("121");
  await candidateTimeout.fill("61");
  await maxPlanes.fill("3");
  await automaticResolution.click();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(contractTimeout).not.toHaveValue("121");

  await contractTimeout.fill("122");
  await candidateTimeout.fill("62");
  await maxPlanes.fill("4");
  const saved = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith("/api/shepherd/settings"),
  );
  await page.getByRole("button", { name: "Save settings" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator(".success-banner")).toContainText("Settings saved");
  await page.reload();
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await page.getByRole("tab", { name: "Execution" }).click();
  await expect(contractTimeout).toHaveValue("122");
  await expect(candidateTimeout).toHaveValue("62");
  await expect(maxPlanes).toHaveValue("4");

  await general.click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Reset demo state" }).click();
  await expect(page.locator(".success-banner")).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  const reset = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/shepherd/demo/reset"),
  );
  await page.getByRole("button", { name: "Reset demo state" }).click();
  expect((await reset).status()).toBe(200);
  await expect(page.locator(".success-banner")).toContainText("demo state was reset safely");

  await page.getByRole("tab", { name: "Execution" }).click();
  await maxPlanes.fill("5");
  const rejectSettings = async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ error: "Rejected settings fixture" }),
    });
  };
  await page.route("**/api/shepherd/settings", rejectSettings);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("alert")).toContainText("Rejected settings fixture");
  await page.getByRole("alert").getByRole("button").click();
  await page.unroute("**/api/shepherd/settings", rejectSettings);

  await general.click();
  const rejectReset = async (route) => {
    await route.fulfill({ status: 503, contentType: "text/plain", body: "not-json" });
  };
  await page.route("**/api/shepherd/demo/reset", rejectReset);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset demo state" }).click();
  await expect(page.getByRole("alert")).toContainText("Request failed");
  await page.getByRole("alert").getByRole("button").click();
  await page.unroute("**/api/shepherd/demo/reset", rejectReset);
});

test("settings recover from an initial malformed server failure", async ({ page }) => {
  let rejectFirstLoad = true;
  const failOnce = async (route) => {
    if (rejectFirstLoad && route.request().method() === "GET") {
      rejectFirstLoad = false;
      await route.fulfill({ status: 503, contentType: "text/plain", body: "not-json" });
      return;
    }
    await route.continue();
  };
  await page.route("**/api/shepherd/settings", failOnce);
  await page.goto(`${app.baseURL}/settings`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await expect(page.getByRole("alert")).toContainText("Request failed");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.unroute("**/api/shepherd/settings", failOnce);
});

test("Agent create, lifecycle, custom authority edit, sorting, and deletion remain functional", async ({ page }) => {
  await page.goto(`${app.baseURL}/agents`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await page.getByRole("link", { name: "Create Agent" }).first().click();

  await page.getByLabel("Agent name").fill("Coverage Steward");
  await page.getByLabel("Role").selectOption("Frontend");
  await page.getByLabel("Description").fill("Owns a bounded browser workflow.");
  await page.getByRole("button", { name: "Advanced authority patterns" }).click();
  await page.getByLabel("Read access").fill("src/**\ndocs/**\nsrc/**");
  await page.getByLabel("Write access").fill("src/frontend/**");
  await page.getByLabel("Forbidden paths").fill(".env*\nsecrets/**");
  const created = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/agents"),
  );
  await page.getByRole("button", { name: "Create Agent" }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole("heading", { name: "Coverage Steward", exact: true })).toBeVisible();

  const stopped = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/stop"),
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect((await stopped).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  const started = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/start"),
  );
  await page.getByRole("button", { name: "Start", exact: true }).click();
  expect((await started).status()).toBe(200);

  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit Coverage Steward" })).toBeVisible();
  const description = page.getByLabel("Description");
  await description.fill("Updated bounded browser workflow.");
  await expect(description).toHaveValue("Updated bounded browser workflow.");
  await page.getByRole("button", { name: "Use a recommended preset" }).click();
  await expect(description).toHaveValue("Updated bounded browser workflow.");
  await page.getByRole("radio", { name: /Backend/u }).locator("..").click();
  await expect(description).toHaveValue("Updated bounded browser workflow.");
  const updated = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && /\/api\/agents\/[^/]+$/u.test(response.url()),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  const updatedResponse = await updated;
  expect(updatedResponse.status()).toBe(200);
  expect((await updatedResponse.json()).agent.description).toBe("Updated bounded browser workflow.");
  await expect(page.getByText("Updated bounded browser workflow.")).toBeVisible();

  await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  const sort = page.getByLabel("Sort Agents");
  await sort.selectOption("updated");
  await sort.selectOption("status");
  await sort.selectOption("name");
  await page.getByRole("link", { name: "Open Coverage Steward" }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("heading", { name: "Coverage Steward", exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  const deleted = page.waitForResponse((response) =>
    response.request().method() === "DELETE" && /\/api\/agents\/[^/]+$/u.test(response.url()),
  );
  await page.getByRole("button", { name: "Delete" }).click();
  expect((await deleted).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Your Agents", exact: true })).toBeVisible();
  await expect(page.getByText("Coverage Steward", { exact: true })).toHaveCount(0);

  const rejectPresets = async (route) => { await route.abort("connectionrefused"); };
  await page.route("**/api/agent-authority-presets", rejectPresets);
  await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
  await expect(page.getByRole("alert")).toContainText("control plane is unavailable");
  await page.unroute("**/api/agent-authority-presets", rejectPresets);
  await page.getByRole("link", { name: "Cancel", exact: true }).click();

  const legacyPresets = async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        presets: {
          unsupported: {
            recommendedRole: "Generalist",
            authority: { readable: ["**"], writable: [], forbidden: [] },
          },
          frontend: {
            recommendedRole: "Frontend",
            authority: {
              readable: ["apps/web/**"],
              writable: ["apps/web/**"],
              forbidden: [".env*"],
            },
          },
        },
      }),
    });
  };
  await page.route("**/api/agent-authority-presets", legacyPresets);
  await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
  await expect(page.getByRole("radio", { name: /Frontend/u })).toBeVisible();
  await expect(page.getByText("Frontend project authority", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Authority preset" }).getByRole("radio")).toHaveCount(1);
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await page.unroute("**/api/agent-authority-presets", legacyPresets);
});

test("Agents sort deterministically by name, activity, and lifecycle status", async ({ page, request }) => {
  const create = async (name) => {
    const response = await request.post(`${app.baseURL}/api/agents`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      data: {
        name,
        description: `${name} sorting fixture`,
        instructions: "Exercise deterministic list ordering.",
        role: "Generalist",
        authorityPreset: "generalist",
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).agent;
  };
  const alpha = await create("Alpha Observer");
  await create("Beta Builder");
  const zeta = await create("Zeta Verifier");
  const stopped = await request.post(`${app.baseURL}/api/agents/${zeta.id}/stop`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  expect(stopped.status()).toBe(200);

  await page.goto(`${app.baseURL}/agents`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  const names = page.locator("tbody .table-agent strong");
  await expect(names).toHaveText(["Alpha Observer", "Beta Builder", "Zeta Verifier"]);
  const sort = page.getByLabel("Sort Agents");
  await sort.selectOption("updated");
  await expect(names.first()).toHaveText("Zeta Verifier");
  await sort.selectOption("status");
  await expect(names).toHaveText(["Alpha Observer", "Beta Builder", "Zeta Verifier"]);
  await sort.selectOption("name");
  await expect(names.first()).toHaveText(alpha.name);

  await page.evaluate(() => {
    window.history.pushState(null, "", "/agents/missing-agent-id");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("alert")).toContainText("Agent not found");
  await page.evaluate(() => {
    window.history.pushState(null, "", "/agents/%E0%A4%A");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText("This route does not exist", { exact: true })).toBeVisible();
});

test("configured runtime state and consumer-cancelled links preserve truthful shell behavior", async ({ page, request }) => {
  const configuredApp = await startTestApp({ agentRuntimeConfigured: true });
  try {
    const system = await request.get(`${configuredApp.baseURL}/api/system`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(system.status()).toBe(200);
    expect((await system.json()).arkConfigured).toBe(true);

    const created = await request.post(`${configuredApp.baseURL}/api/agents`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      data: {
        name: "Short Contract Agent",
        description: "Exercises compact opaque identifiers.",
        instructions: "Render the assigned Contract reference faithfully.",
        role: "Generalist",
        authorityPreset: "generalist",
      },
    });
    expect(created.status()).toBe(201);
    await page.route("**/api/agents", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      const upstream = await route.fetch();
      const body = await upstream.json();
      body.agents = body.agents.map((agent) => ({ ...agent, currentContractId: "tiny" }));
      await route.fulfill({ response: upstream, json: body });
    });

    await page.goto(`${configuredApp.baseURL}/shepherd`);
    await page.getByLabel("Access token").fill(AUTH_TOKEN);
    await page.getByRole("button", { name: "Open Launchpad" }).click();
    await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
    await expect(page.locator(".config-banner")).toHaveCount(0);
    await page.getByRole("link", { name: "Your Agents", exact: true }).click();
    await expect(page.locator(".contract-link")).toHaveText("tiny");

    const home = page.getByRole("link", { name: "Agent Launchpad home" });
    await home.evaluate((element) => {
      element.addEventListener("click", (event) => event.preventDefault(), { once: true });
    });
    await home.click();
    await expect(page).toHaveURL(`${configuredApp.baseURL}/agents`);
  } finally {
    await configuredApp.stop();
  }
});
