import { test, expect } from "./support/coverage-test.mjs";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AUTH_TOKEN, isPortOpen, startTestApp } from "./support/test-app.mjs";

const execFileAsync = promisify(execFile);
const enabled = process.env.E2E_LIVE_LEGACY === "true";
const liveConfig = enabled
  ? {
      arkApiKey: process.env.ARK_API_KEY ?? "",
      arkModel: process.env.ARK_MODEL ?? "",
      arkBaseUrl: process.env.ARK_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/v3",
      codexBin: process.env.E2E_CODEX_BIN ?? process.env.CODEX_BIN ?? "codex",
    }
  : null;

test.skip(!enabled, "explicit E2E_LIVE_LEGACY=true opt-in required");

async function unlock(page, app) {
  await page.goto(`${app.baseURL}/shepherd`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
}

async function apiJson(request, app, route) {
  const response = await request.get(`${app.baseURL}${route}`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  expect(response.status()).toBe(200);
  return await response.json();
}

async function sendAndComplete(page, request, app, prompt) {
  const composer = page.getByLabel("Message Live Baseline Agent");
  await composer.fill(prompt);
  const accepted = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/messages"),
  );
  await composer.press("Enter");
  const response = await accepted;
  expect(response.status()).toBe(202);
  const { run } = await response.json();
  expect(run.status).toBe("queued");
  await expect(page.getByText("Codex is reading, editing, or running checks…")).toBeVisible();
  await expect.poll(async () =>
    (await apiJson(request, app, `/api/runs/${encodeURIComponent(run.id)}`)).run.status,
  { timeout: 240_000, intervals: [500, 1_000, 2_000] }).toBe("completed");
  const messages = (await apiJson(
    request,
    app,
    `/api/agents/${encodeURIComponent(run.agentId)}/messages`,
  )).messages;
  expect(messages.at(-1)).toMatchObject({ role: "assistant" });
  expect(messages.at(-1).content.length).toBeGreaterThan(0);
  return run.id;
}

test("live legacy Playground preserves a two-turn Codex session across restart", async ({ page, request }) => {
  expect(liveConfig?.arkApiKey.length).toBeGreaterThan(0);
  expect(liveConfig?.arkModel.length).toBeGreaterThan(0);
  let app = await startTestApp({ liveLegacyConfig: liveConfig });
  try {
    await unlock(page, app);
    await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
    await page.getByLabel("Agent name").fill("Live Baseline Agent");
    await page.getByLabel("Description").fill("Runs one bounded live continuity acceptance.");
    await expect(page.getByRole("radio", { name: /Generalist/u })).toBeChecked();
    await page.getByRole("button", { name: "Create Agent", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Live Baseline Agent" })).toBeVisible();
    const shepherdRoute = page.getByRole("checkbox", { name: "Route through Shepherd" });
    await expect(shepherdRoute).toBeChecked();
    await shepherdRoute.uncheck();

    const agents = (await apiJson(request, app, "/api/agents")).agents;
    expect(agents).toHaveLength(1);
    const agentId = agents[0].id;
    const firstRunId = await sendAndComplete(
      page,
      request,
      app,
      "Create src/hello.js exporting hello(name = 'world') and tests/hello.test.js with two dependency-free node:test cases. Run the test and briefly report the result.",
    );
    const firstState = JSON.parse(await app.persistedState());
    const threadId = firstState.agents[0].codexThreadId;
    expect(threadId).toEqual(expect.any(String));

    const secondRunId = await sendAndComplete(
      page,
      request,
      app,
      "Continue this same session. Re-run the existing hello test unchanged and briefly report whether it still passes.",
    );
    const secondState = JSON.parse(await app.persistedState());
    expect(secondState.agents[0].codexThreadId).toBe(threadId);
    const workspace = path.join(app.runRoot, "workspaces", agentId);
    const source = await readFile(path.join(workspace, "src/hello.js"), "utf8");
    const testSource = await readFile(path.join(workspace, "tests/hello.test.js"), "utf8");
    expect(source).toContain("hello");
    expect(testSource).toContain("node:test");
    const artifact = await execFileAsync(process.execPath, ["--test", "tests/hello.test.js"], {
      cwd: workspace,
      encoding: "utf8",
    });
    expect(artifact.stdout).toMatch(/pass 2/u);
    const beforeRuns = (await apiJson(request, app, `/api/agents/${agentId}/runs`)).runs;
    expect(beforeRuns.map((run) => run.id)).toEqual([secondRunId, firstRunId]);

    const oldPort = app.port;
    const runRoot = app.runRoot;
    await app.stop({ removeRunRoot: false });
    expect(await isPortOpen(oldPort)).toBe(false);
    app = await startTestApp({ liveLegacyConfig: liveConfig, runRoot });
    await unlock(page, app);
    await page.getByRole("link", { name: /Live Baseline Agent/u }).click();
    await expect(page.getByRole("heading", { name: "Live Baseline Agent" })).toBeVisible();
    const afterRuns = (await apiJson(request, app, `/api/agents/${agentId}/runs`)).runs;
    expect(afterRuns).toEqual(beforeRuns);
    expect(JSON.parse(await app.persistedState()).agents[0].codexThreadId).toBe(threadId);
    await access(path.join(workspace, "src/hello.js"));
    await access(path.join(workspace, "tests/hello.test.js"));
    const persisted = await app.persistedState();
    expect(persisted.includes(liveConfig.arkApiKey)).toBe(false);
    expect((await page.locator("body").innerText()).includes(liveConfig.arkApiKey)).toBe(false);
    expect(app.readOutput().includes(liveConfig.arkApiKey)).toBe(false);
  } finally {
    await app?.stop();
  }
});
