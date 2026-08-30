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
  await unlock(page);
  await createAgent(page, "My Frontend Agent", "Frontend");
  await createAgent(page, "My Backend Agent", "Backend");
  await page.getByRole("link", { name: /^Shepherd/u }).click();

  const assignments = page.getByRole("group", { name: "Execution contract assignments" });
  await expect(assignments).toContainText("My Frontend Agent");
  await expect(assignments).toContainText("My Backend Agent");
  const frontendAgentSelect = page.getByLabel("Frontend Agent", { exact: true });
  await frontendAgentSelect.focus();
  await expect(frontendAgentSelect).toBeFocused();
  await frontendAgentSelect.selectOption({ label: "My Frontend Agent" });
  await expect(frontendAgentSelect.locator("option:checked")).toHaveText("My Frontend Agent");
  await expect(page.getByLabel("Frontend authentication transport")).toHaveValue("http-only-session-cookie");
  await expect(page.getByLabel("Backend authentication transport")).toHaveValue("bearer-jwt");

  const composer = page.getByLabel("Message Shepherd");
  await composer.fill("Integrate the Frontend and Backend authentication contracts and resolve any semantic collision.");
  const acceptedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/shepherd/messages"),
  );
  await composer.press("Enter");
  expect((await acceptedResponse).status()).toBe(202);
  const finalState = await waitForCompleted(request);
  await expect(page.locator(".timeline-panel .state-pill")).toContainText("Completed");
  const mission = finalState.missions.at(-1);
  const contracts = finalState.contracts.filter((contract) => contract.missionId === mission.id);
  const agentsResponse = await request.get(`${app.baseURL}/api/agents`, { headers: headers() });
  const agents = (await agentsResponse.json()).agents;
  const frontend = agents.find((agent) => agent.name === "My Frontend Agent");
  const backend = agents.find((agent) => agent.name === "My Backend Agent");
  expect(contracts).toEqual(expect.arrayContaining([
    expect.objectContaining({ agentId: frontend.id, objective: expect.stringContaining("http-only-session-cookie") }),
    expect.objectContaining({ agentId: backend.id, objective: expect.stringContaining("bearer-jwt") }),
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
    "http-only-session-cookie",
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
  const viewport = testInfo.project.use.viewport;
  const screenshotDirectory = path.join(repositoryRoot, ".tmp", "demo-agent-contract-flow");
  await mkdir(screenshotDirectory, { recursive: true });
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
