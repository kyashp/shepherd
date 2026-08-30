import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  CREATE_PROMPT,
  CREATE_RESPONSE,
  FOLLOW_UP_PROMPT,
  FOLLOW_UP_RESPONSE,
  HELLO_SOURCE,
  HELLO_TEST_SOURCE,
} from "./fixtures/legacy-playground.mjs";
import {
  AUTH_TOKEN,
  LEGACY_ARK_KEY,
  isPortOpen,
  repositoryRoot,
  startTestApp,
} from "./support/test-app.mjs";

const execFileAsync = promisify(execFile);
const AGENT_NAME = "Baseline Generalist";
const DESCRIPTION = "Builds and verifies a dependency-free greeting.";
let app;

async function unlock(page) {
  await page.goto(`${app.baseURL}/shepherd`);
  const token = page.getByLabel("Access token");
  await expect(token).toBeFocused();
  await token.fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
}

async function apiJson(request, route) {
  const response = await request.get(`${app.baseURL}${route}`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  expect(response.status()).toBe(200);
  return await response.json();
}

async function runStatus(request, runId) {
  return (await apiJson(request, `/api/runs/${encodeURIComponent(runId)}`)).run.status;
}

async function assertNoDocumentOverflow(page) {
  const overflow = await page.evaluate(() => ({
    document: {
      width: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      height: [document.documentElement.scrollHeight, document.documentElement.clientHeight],
    },
    body: {
      width: [document.body.scrollWidth, document.body.clientWidth],
      height: [document.body.scrollHeight, document.body.clientHeight],
    },
  }));
  for (const surface of Object.values(overflow)) {
    expect(surface.width[0]).toBeLessThanOrEqual(surface.width[1]);
    expect(surface.height[0]).toBeLessThanOrEqual(surface.height[1]);
  }
}

async function capture(page, testInfo, stage) {
  await assertNoDocumentOverflow(page);
  const viewport = page.viewportSize();
  expect(viewport).toEqual(testInfo.project.use.viewport);
  const directory = path.join(
    repositoryRoot,
    process.env.E2E_UPDATE_EVIDENCE === "true"
      ? "docs/ui-review/e2e-01"
      : ".tmp/playwright-evidence/e2e-01",
    `${viewport.width}x${viewport.height}`,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${stage}.png`), fullPage: false });
}

async function tabTo(page, target, label) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => document.activeElement === element)) {
      await expect(target, `${label} receives visible keyboard focus`).toBeFocused();
      await expect(target).toHaveCSS("outline-style", "solid");
      return;
    }
  }
  throw new Error(`${label} was not reachable using Tab`);
}

async function expectInViewport(page, target) {
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

async function sendTurn(page, request, prompt, responseText, testInfo, prefix) {
  const composer = page.getByLabel(`Message ${AGENT_NAME}`);
  await composer.focus();
  await expect(composer).toBeFocused();
  await composer.fill(prompt);
  const queuedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith("/messages"),
  );
  await composer.press("Enter");
  const wireResponse = await queuedResponse;
  expect(wireResponse.status()).toBe(202);
  const queued = await wireResponse.json();
  expect(queued.run.status).toBe("queued");
  await expect(page.getByText("Codex is reading, editing, or running checks…")).toBeVisible();
  await expect(composer).toBeDisabled();

  await expect.poll(() => runStatus(request, queued.run.id), { timeout: 4_000 }).toBe("running");
  await capture(page, testInfo, `${prefix}-active`);
  await expect(page.getByText(responseText, { exact: true })).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => runStatus(request, queued.run.id)).toBe("completed");
  await capture(page, testInfo, `${prefix}-completed`);
  return queued.run.id;
}

test.beforeEach(async () => {
  app = await startTestApp({ legacyRuntime: true });
});

test.afterEach(async () => {
  await app?.stop();
});

test("legacy Playground persists an Agent, artifacts, session, and runs across restart", async ({ page, request }, testInfo) => {
  const unauthorized = await request.get(`${app.baseURL}/api/agents`);
  expect(unauthorized.status()).toBe(401);
  await unlock(page);
  await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Create Agent", exact: true })).toBeVisible();
  const name = page.getByLabel("Agent name");
  await expect(name).toBeFocused();
  await name.fill(AGENT_NAME);
  await page.getByLabel("Description").fill(DESCRIPTION);
  const generalistPreset = page.getByRole("radio", { name: /Generalist/u });
  await expect(generalistPreset).toBeChecked();
  const createAgent = page.getByRole("button", { name: "Create Agent", exact: true });
  await createAgent.scrollIntoViewIfNeeded();
  await expect(createAgent).toBeVisible();
  await expectInViewport(page, createAgent);
  await tabTo(page, createAgent, "Create Agent");
  await capture(page, testInfo, "01-create-agent");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: AGENT_NAME, exact: true })).toBeVisible();
  await expect(page.getByText("Generalist", { exact: true }).first()).toBeVisible();
  const agentList = await apiJson(request, "/api/agents");
  expect(agentList.agents).toHaveLength(1);
  const agentId = agentList.agents[0].id;
  expect(agentList.agents[0]).toMatchObject({
    name: AGENT_NAME,
    role: "Generalist",
    status: "ready",
  });
  expect(agentList.agents[0].authority.writable).toEqual([
    "apps/**",
    "docs/**",
    "scripts/**",
    "src/**",
    "test/**",
    "tests/**",
  ]);
  expect(JSON.stringify(agentList).includes(app.runRoot)).toBe(false);
  expect(JSON.stringify(agentList).includes("workspacePath")).toBe(false);
  const composer = page.getByLabel(`Message ${AGENT_NAME}`);
  await composer.fill("keyboard draft");
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue("keyboard draft\n");
  await composer.fill("");
  await capture(page, testInfo, "02-empty-agent");

  const firstRunId = await sendTurn(
    page,
    request,
    CREATE_PROMPT,
    CREATE_RESPONSE,
    testInfo,
    "03-first-turn",
  );
  const firstAgent = (await apiJson(request, `/api/agents/${encodeURIComponent(agentId)}`)).agent;
  expect(firstAgent.codexThreadId).toBeUndefined();
  const persistedAfterFirst = JSON.parse(await app.persistedState());
  const firstThreadId = persistedAfterFirst.agents[0].codexThreadId;
  expect(firstThreadId).toMatch(/^fixture-[a-f0-9]{16}$/u);

  const secondRunId = await sendTurn(
    page,
    request,
    FOLLOW_UP_PROMPT,
    FOLLOW_UP_RESPONSE,
    testInfo,
    "05-follow-up",
  );
  const persistedAfterSecond = JSON.parse(await app.persistedState());
  expect(persistedAfterSecond.agents[0].codexThreadId).toBe(firstThreadId);

  const runsBeforeRestart = await apiJson(request, `/api/agents/${encodeURIComponent(agentId)}/runs`);
  expect(runsBeforeRestart.runs).toHaveLength(2);
  expect(runsBeforeRestart.runs.map((run) => run.id)).toEqual([secondRunId, firstRunId]);
  expect(runsBeforeRestart.runs.every((run) => run.status === "completed")).toBe(true);
  const messagesBeforeRestart = await apiJson(request, `/api/agents/${encodeURIComponent(agentId)}/messages`);
  expect(messagesBeforeRestart.messages.map((message) => message.content)).toEqual([
    CREATE_PROMPT,
    CREATE_RESPONSE,
    FOLLOW_UP_PROMPT,
    FOLLOW_UP_RESPONSE,
  ]);

  const workspace = path.join(app.runRoot, "workspaces", agentId);
  expect(await realpath(workspace)).toBe(workspace);
  const outsideCanary = path.join(app.runRoot, "outside-workspace-canary.txt");
  await writeFile(outsideCanary, "unchanged\n", "utf8");
  expect(await readFile(path.join(workspace, "hello.js"), "utf8")).toBe(HELLO_SOURCE);
  expect(await readFile(path.join(workspace, "hello.test.js"), "utf8")).toBe(HELLO_TEST_SOURCE);
  const artifactTest = await execFileAsync(process.execPath, ["--test", "hello.test.js"], {
    cwd: workspace,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  });
  expect(artifactTest.stdout).toMatch(/pass 2/u);
  expect(await readFile(outsideCanary, "utf8")).toBe("unchanged\n");

  const stopAgent = page.getByRole("button", { name: "Stop", exact: true });
  await tabTo(page, stopAgent, "Stop");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Agent stopped", { exact: true })).toBeVisible();
  await expect(page.getByLabel(`Message ${AGENT_NAME}`)).toBeDisabled();
  await capture(page, testInfo, "07-agent-stopped");

  const originalPort = app.port;
  const runRoot = app.runRoot;
  await app.stop({ removeRunRoot: false });
  expect(await isPortOpen(originalPort)).toBe(false);
  app = await startTestApp({ legacyRuntime: true, runRoot });
  await unlock(page);
  await page.getByRole("link", { name: new RegExp(AGENT_NAME, "u") }).click();
  await expect(page.getByRole("heading", { name: AGENT_NAME, exact: true })).toBeVisible();
  await expect(page.getByText(CREATE_PROMPT, { exact: true })).toBeAttached();
  await expect(page.getByText(CREATE_RESPONSE, { exact: true })).toBeAttached();
  await expect(page.getByText(FOLLOW_UP_PROMPT, { exact: true })).toBeAttached();
  await expect(page.getByText(FOLLOW_UP_RESPONSE, { exact: true })).toBeAttached();
  await expect(page.getByText("Agent stopped", { exact: true })).toBeVisible();
  const startAgent = page.getByRole("button", { name: "Start", exact: true });
  await tabTo(page, startAgent, "Start");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Playground ready", { exact: true })).toBeVisible();
  await expect(startAgent).not.toBeVisible();
  await capture(page, testInfo, "09-server-restarted");

  const runsAfterRestart = await apiJson(request, `/api/agents/${encodeURIComponent(agentId)}/runs`);
  expect(runsAfterRestart.runs).toEqual(runsBeforeRestart.runs);
  const messagesAfterRestart = await apiJson(request, `/api/agents/${encodeURIComponent(agentId)}/messages`);
  expect(messagesAfterRestart.messages).toEqual(messagesBeforeRestart.messages);
  const finalState = await app.persistedState();
  const parsedFinalState = JSON.parse(finalState);
  expect(parsedFinalState).toMatchObject({ version: 2 });
  expect(parsedFinalState.agents).toHaveLength(1);
  expect(parsedFinalState.messages).toHaveLength(4);
  expect(parsedFinalState.runs).toHaveLength(2);
  expect(finalState.includes(AUTH_TOKEN)).toBe(false);
  expect(finalState.includes(LEGACY_ARK_KEY)).toBe(false);
  const visibleText = await page.locator("body").innerText();
  expect(visibleText.includes(AUTH_TOKEN)).toBe(false);
  expect(visibleText.includes(LEGACY_ARK_KEY)).toBe(false);
  expect(app.readOutput().includes(AUTH_TOKEN)).toBe(false);
  expect(app.readOutput().includes(LEGACY_ARK_KEY)).toBe(false);
  expect(JSON.stringify(runsAfterRestart).includes(app.runRoot)).toBe(false);
  expect(JSON.stringify(messagesAfterRestart).includes(app.runRoot)).toBe(false);
  await access(path.join(workspace, "hello.js"));
  await access(path.join(workspace, "hello.test.js"));
});
