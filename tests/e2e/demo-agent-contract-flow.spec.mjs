import { test, expect } from "@playwright/test";
import path from "node:path";
import { mkdir } from "node:fs/promises";
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

test.beforeEach(async () => {
  app = await startTestApp();
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

  await page.getByRole("link", { name: /My Frontend Agent/u }).click();
  const frontendRoute = page.getByLabel("Route through Shepherd");
  await frontendRoute.focus();
  await expect(frontendRoute).toBeFocused();
  await frontendRoute.check();
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
  await page.getByLabel("Route through Shepherd").check();
  const backendPrompt =
    "Implement the backend authentication service using a bearer JWT.";
  await page.getByLabel("Message My Backend Agent").fill(backendPrompt);
  const acceptedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/api\/shepherd\/agents\/[^/]+\/contracts$/u.test(response.url()),
  );
  await page.getByLabel("Message My Backend Agent").press("Enter");
  expect((await acceptedResponse).status()).toBe(202);
  const finalState = await waitForCompleted(request);
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
  await page.screenshot({
    path: path.join(screenshotDirectory, `${viewport.width}x${viewport.height}.png`),
    fullPage: false,
  });
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
