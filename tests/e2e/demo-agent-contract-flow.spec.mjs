import { test, expect } from "@playwright/test";
import path from "node:path";
import { access, mkdir, readFile } from "node:fs/promises";
import { AUTH_TOKEN, repositoryRoot, startTestApp } from "./support/test-app.mjs";

let app;

const headers = () => ({ Authorization: `Bearer ${AUTH_TOKEN}` });

async function unlock(page) {
  await page.goto(`${app.baseURL}/shepherd`);
  await page.getByLabel("Access token").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "Open Launchpad" }).click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
}

async function createAgent(page, name, preset) {
  await page.getByRole("link", { name: "Create Agent", exact: true }).first().click();
  await page.getByLabel("Agent name").fill(name);
  await page.getByRole("radio", { name: new RegExp(preset, "u") }).locator("..").click();
  await page.getByRole("button", { name: "Create Agent", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function state(request) {
  const response = await request.get(`${app.baseURL}/api/shepherd/state`, {
    headers: headers(),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).state;
}

async function waitForCompleted(request) {
  const deadline = Date.now() + 15_000;
  let latest;
  while (Date.now() < deadline) {
    latest = await state(request);
    if (latest.missions.at(-1)?.state === "completed") return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Mission did not complete: ${latest?.missions.at(-1)?.state ?? "missing"}`);
}

async function assertNoDocumentOverflow(page) {
  const geometry = await page.evaluate(() => ({
    document: [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.documentElement.scrollHeight, document.documentElement.clientHeight],
    body: [document.body.scrollWidth, document.body.clientWidth, document.body.scrollHeight, document.body.clientHeight],
  }));
  for (const [scrollWidth, clientWidth, scrollHeight, clientHeight] of Object.values(geometry)) {
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
  }
}

async function assertShepherdShellContained(page) {
  const geometry = await page.locator(".main-content").evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
  await expect(page.getByLabel("Message Shepherd")).toBeInViewport();
}

test.beforeEach(async () => {
  app = await startTestApp({ agentRuntimeConfigured: true });
});

test.afterEach(async () => {
  await app?.stop();
});

test("user-created Agents receive visible typed contracts and produce competing resolution Planes", async ({ page, request }, testInfo) => {
  test.setTimeout(45_000);
  const viewport = testInfo.project.use.viewport;
  const screenshotDirectory = path.join(repositoryRoot, ".tmp", "demo-agent-contract-flow");
  await mkdir(screenshotDirectory, { recursive: true });
  await unlock(page);
  await createAgent(page, "My Frontend Agent", "Frontend");
  await createAgent(page, "My Backend Agent", "Backend");
  await createAgent(page, "My Generalist Agent", "Generalist");

  await page.getByRole("link", { name: /My Frontend Agent/u }).click();
  const frontendRoute = page.getByLabel("Route through Shepherd");
  await frontendRoute.focus();
  await expect(frontendRoute).toBeFocused();
  await expect(frontendRoute).toBeChecked();
  await page.getByRole("link", { name: /My Generalist Agent/u }).click();
  await expect(page.getByLabel("Route through Shepherd")).toBeChecked();
  await page.getByLabel("Route through Shepherd").uncheck();
  await expect(page.getByText("Playground ready", { exact: true })).toBeVisible();
  const directComposer = page.getByLabel("Message My Generalist Agent");
  await expect(directComposer).toBeEnabled();
  let managedRequests = 0;
  const observeManagedRequest = (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/shepherd\/agents\/[^/]+\/contracts$/u.test(request.url())
    ) {
      managedRequests += 1;
    }
  };
  page.on("request", observeManagedRequest);
  await directComposer.fill("Reply directly without creating a Shepherd Contract.");
  const directResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    /\/api\/agents\/[^/]+\/messages$/u.test(response.url()),
  );
  await directComposer.press("Enter");
  expect((await directResponse).status()).toBe(202);
  expect(managedRequests).toBe(0);
  page.off("request", observeManagedRequest);
  await page.getByRole("link", { name: /My Frontend Agent/u }).click();
  await expect(page.getByLabel("Route through Shepherd")).toBeChecked();
  const frontendPrompt =
    "Implement the frontend authentication client using an HttpOnly session cookie.";
  await page.getByLabel("Message My Frontend Agent").fill(frontendPrompt);
  const waitingResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/api\/shepherd\/agents\/[^/]+\/contracts$/u.test(response.url()),
  );
  await page.getByLabel("Message My Frontend Agent").press("Enter");
  expect((await waitingResponse).status()).toBe(201);
  await expect(page.getByText(/Prompt captured and validated as http-only-session-cookie/u)).toBeVisible();
  await assertNoDocumentOverflow(page);
  await page.screenshot({
    path: path.join(
      screenshotDirectory,
      `private-chat-${viewport.width}x${viewport.height}.png`,
    ),
    fullPage: false,
  });

  await page.getByRole("link", { name: /My Backend Agent/u }).click();
  const backendRoute = page.getByLabel("Route through Shepherd");
  await expect(backendRoute).toBeChecked();
  const backendPrompt =
    "Implement the backend authentication service using a bearer JWT.";
  await page.getByLabel("Message My Backend Agent").fill(backendPrompt);
  const acceptedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/api\/shepherd\/agents\/[^/]+\/contracts$/u.test(response.url()),
  );
  await page.getByLabel("Message My Backend Agent").press("Enter");
  expect((await acceptedResponse).status()).toBe(202);
  const finalState = await waitForCompleted(request);
  await expect(page.locator(".shepherd-contract-status").last()).toContainText("is verified");
  await page.getByRole("link", { name: /^Shepherd/u }).click();
  await expect(page.locator(".timeline-panel .state-pill")).toContainText("Completed");
  await expect(page.getByLabel("Frontend Agent", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Frontend authentication transport")).toHaveCount(0);
  const mission = finalState.missions.at(-1);
  const contracts = finalState.contracts.filter((contract) => contract.missionId === mission.id);
  const agentsResponse = await request.get(`${app.baseURL}/api/agents`, { headers: headers() });
  const agents = (await agentsResponse.json()).agents;
  const frontend = agents.find((agent) => agent.name === "My Frontend Agent");
  const backend = agents.find((agent) => agent.name === "My Backend Agent");
  expect(contracts).toEqual(expect.arrayContaining([
    expect.objectContaining({ agentId: frontend.id, objective: frontendPrompt }),
    expect.objectContaining({ agentId: backend.id, objective: backendPrompt }),
  ]));
  expect(finalState.candidates.filter((candidate) => candidate.missionId === mission.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ targetValue: "http-only-session-cookie", selectionState: "selected", promotionState: "promoted" }),
    expect.objectContaining({ targetValue: "bearer-jwt", selectionState: "rejected" }),
  ]));

  await page.getByRole("button", { name: "Contracts", exact: true }).click();
  const frontendCard = page.locator("article.event-card").filter({ hasText: "Created Implement frontend authentication transport" });
  await expect(frontendCard).toBeVisible();
  await frontendCard.getByText("View evidence", { exact: true }).click();
  const visibleContract = frontendCard.getByLabel("Agent execution contract");
  for (const text of [
    "My Frontend Agent",
    "HttpOnly session cookie",
    "auth.transport",
    "src/frontend/**",
    "src/frontend/auth.json",
    "auth-frontend",
    ".shepherd/result.json",
  ]) {
    await expect(visibleContract).toContainText(text);
  }
  await expect(visibleContract).toContainText("Agent ID");
  const collision = page.locator(".tree-collision");
  await collision.locator("summary").click();
  await expect(collision).toContainText("same integration commit");
  await expect(page.locator("button.tree-node").filter({ hasText: "bearer-jwt" })).toBeVisible();
  await expect(page.locator("button.tree-node").filter({ hasText: "http-only-session-cookie" })).toBeVisible();
  await assertNoDocumentOverflow(page);
  await assertShepherdShellContained(page);
  await page.screenshot({
    path: path.join(screenshotDirectory, `${viewport.width}x${viewport.height}.png`),
    fullPage: false,
  });
});

test("general Agent chat clarifies missing Contract details before verified execution", async ({ page, request }, testInfo) => {
  test.setTimeout(45_000);
  const screenshotDirectory = path.join(repositoryRoot, ".tmp", "demo-agent-contract-flow");
  await mkdir(screenshotDirectory, { recursive: true });
  await unlock(page);
  await createAgent(page, "General Delivery Agent", "Generalist");
  await expect(page.getByLabel("Route through Shepherd")).toBeChecked();
  await expect(page.getByText("Shepherd route ready", { exact: true })).toBeVisible();

  const composer = page.getByLabel("Message General Delivery Agent");
  await composer.fill("Build a greeting feature.");
  const clarificationResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/api\/shepherd\/agents\/[^/]+\/contracts$/u.test(response.url()),
  );
  await composer.press("Enter");
  expect((await clarificationResponse).status()).toBe(201);
  await expect(page.getByText(/Before I create the Execution Contract/u)).toBeVisible();
  await expect(composer).toBeEnabled();
  expect((await state(request)).contracts).toHaveLength(0);

  await composer.fill(
    'Create `scripts/hello.txt`. Acceptance: the file exists and contains "Hello from Shepherd".',
  );
  const acceptedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/api\/shepherd\/agents\/[^/]+\/contracts$/u.test(response.url()),
  );
  await composer.press("Enter");
  expect((await acceptedResponse).status()).toBe(202);
  const finalState = await waitForCompleted(request);
  const mission = finalState.missions.at(-1);
  const contract = finalState.contracts.find((item) => item.missionId === mission.id);
  expect(contract).toMatchObject({
    state: "verified",
    expectedArtifacts: [expect.objectContaining({ path: "scripts/hello.txt" })],
  });
  await expect(page.locator(".shepherd-contract-status").last()).toContainText("is verified");
  await expect(page.locator(".page-header .state-pill").first()).toContainText("Ready");
  await assertNoDocumentOverflow(page);
  const agentsResponse = await request.get(`${app.baseURL}/api/agents`, { headers: headers() });
  const agent = (await agentsResponse.json()).agents.find(
    (item) => item.name === "General Delivery Agent",
  );
  expect(
    await readFile(path.join(app.runRoot, "workspaces", agent.id, "scripts", "hello.txt"), "utf8"),
  ).toBe("Hello from Shepherd\n");
  await page.screenshot({
    path: path.join(
      screenshotDirectory,
      `general-${testInfo.project.use.viewport.width}x${testInfo.project.use.viewport.height}.png`,
    ),
    fullPage: false,
  });
});

test("clarification-only Shepherd drafts do not trap an Agent lifecycle", async ({ page, request }, testInfo) => {
  const viewport = testInfo.project.use.viewport;
  const screenshotDirectory = path.join(repositoryRoot, ".tmp", "agent-delete-clarification");
  await mkdir(screenshotDirectory, { recursive: true });
  await unlock(page);
  await createAgent(page, "Disposable Draft Agent", "Generalist");

  const agentsResponse = await request.get(`${app.baseURL}/api/agents`, {
    headers: headers(),
  });
  expect(agentsResponse.status()).toBe(200);
  const agent = (await agentsResponse.json()).agents.find(
    (item) => item.name === "Disposable Draft Agent",
  );
  expect(agent).toBeDefined();

  const composer = page.getByLabel("Message Disposable Draft Agent");
  for (const prompt of [
    "Create a greeting script.",
    "Create scripts/hello.txt containing a greeting.",
  ]) {
    await composer.fill(prompt);
    const clarificationResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" &&
      /\/api\/shepherd\/agents\/[^/]+\/contracts$/u.test(response.url()),
    );
    await composer.press("Enter");
    expect((await clarificationResponse).status()).toBe(201);
  }
  await expect(page.getByText(/Before I create the Execution Contract/u)).toHaveCount(2);
  const pendingState = await state(request);
  expect(pendingState.contracts).toHaveLength(0);
  expect(pendingState.missions).toHaveLength(0);
  await assertNoDocumentOverflow(page);
  await page.screenshot({
    path: path.join(
      screenshotDirectory,
      `clarification-${viewport.width}x${viewport.height}.png`,
    ),
    fullPage: false,
  });

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText("Agent stopped", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  const deletionResponse = page.waitForResponse((response) =>
    response.request().method() === "DELETE" &&
    response.url().endsWith(`/api/agents/${agent.id}`),
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  expect((await deletionResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Your Agents", exact: true })).toBeVisible();
  await expect(page.getByText("No Agents yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Disposable Draft Agent/u })).toHaveCount(0);
  expect((await state(request)).projects).toHaveLength(0);
  await assertNoDocumentOverflow(page);
  await page.screenshot({
    path: path.join(
      screenshotDirectory,
      `deleted-${viewport.width}x${viewport.height}.png`,
    ),
    fullPage: false,
  });

  for (const target of [
    path.join(app.runRoot, "workspaces", agent.id),
    path.join(app.runRoot, "shepherd", "repositories", `agent-${agent.id}`),
    path.join(app.runRoot, "shepherd", "planes", `agent-${agent.id}`),
    path.join(app.runRoot, "shepherd", "projects", `agent-${agent.id}.json`),
  ]) {
    await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

test("unresolved promotion creates a visible durable human-review reference", async ({ page, request }) => {
  test.setTimeout(30_000);
  await unlock(page);
  const settings = await request.patch(`${app.baseURL}/api/shepherd/settings`, {
    headers: headers(),
    data: { autoResolution: false },
  });
  expect(settings.status()).toBe(200);
  const composer = page.getByLabel("Message Shepherd");
  await composer.fill("Demonstrate a collision that requires human confirmation.");
  await composer.press("Enter");
  const deadline = Date.now() + 15_000;
  let latest;
  while (Date.now() < deadline) {
    latest = await state(request);
    if (latest.missions.at(-1)?.state === "attention_required") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(latest.missions.at(-1)?.state).toBe("attention_required");
  await expect(page.getByText("Internal human-review ticket", { exact: true })).toBeVisible();
  await expect(page.getByText(/Reference collision-/u)).toBeVisible();
  await expect(page.getByText(/durable attention_required/u)).toBeVisible();
  await expect(page.getByRole("button", { name: "Select verified future" })).toBeVisible();
  await assertNoDocumentOverflow(page);
});
