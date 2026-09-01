import { test, expect } from "./support/coverage-test.mjs";
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

async function shepherdState(request) {
  const response = await request.get(`${app.baseURL}/api/shepherd/state`, { headers: headers() });
  expect(response.status()).toBe(200);
  return (await response.json()).state;
}

async function waitForCompletedMission(request) {
  const deadline = Date.now() + 15_000;
  let latest;
  while (Date.now() < deadline) {
    latest = await shepherdState(request);
    if (latest.missions.at(-1)?.state === "completed") return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Mission did not complete: ${latest?.missions.at(-1)?.state ?? "missing"}`);
}

async function assertNoDocumentOverflow(page, expectedViewport) {
  expect(await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(expectedViewport);
  const geometry = await page.evaluate(() => ({
    document: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    },
    body: {
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
      scrollHeight: document.body.scrollHeight,
      clientHeight: document.body.clientHeight,
    },
  }));
  for (const box of Object.values(geometry)) {
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
  }
}

async function captureEvidence(page, expectedViewport, name) {
  const screenshotDirectory = path.join(
    repositoryRoot,
    ".tmp",
    "playwright-evidence",
    "project-group-contract-flow",
  );
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(
      screenshotDirectory,
      `${expectedViewport.width}x${expectedViewport.height}-${name}.png`,
    ),
    fullPage: false,
  });
}

test.beforeEach(async () => {
  app = await startTestApp();
});

test.afterEach(async () => {
  await app?.stop();
});

test("Project Group initializes safely, pairs bounded requests, and reports verified Agent summaries", async ({ page, request }, testInfo) => {
  test.setTimeout(35_000);
  const expectedViewport = testInfo.project.use.viewport;
  expect(expectedViewport).toBeTruthy();
  await unlock(page);
  await createAgent(page, "Group Frontend", "Frontend");
  await createAgent(page, "Group Backend", "Backend");
  await createAgent(page, "Frontend Agent", "Frontend");

  await page.getByRole("link", { name: /Project Group/u }).click();
  await expect(page.getByRole("button", { name: "Initialize Project Group", exact: true })).toBeVisible();
  const initialize = page.waitForResponse((response) =>
    response.request().method() === "POST" &&
    response.url().endsWith("/api/shepherd/projects/auth-demo/group-initialization"),
  );
  await page.getByRole("button", { name: "Initialize Project Group", exact: true }).click();
  expect((await initialize).status()).toBe(200);
  expect((await shepherdState(request)).missions).toHaveLength(0);

  const composer = page.getByLabel("Message Project Group");
  await composer.fill("@");
  const mentionSuggestions = page.getByRole("listbox", { name: "Agent mentions" });
  await expect(mentionSuggestions).toBeVisible();
  await expect(mentionSuggestions.getByRole("option")).toHaveCount(3);
  await composer.fill("@F");
  await expect(mentionSuggestions.getByRole("option", { name: "Frontend Agent" })).toBeVisible();
  await expect(mentionSuggestions.getByRole("option")).toHaveCount(1);
  await composer.press("ArrowDown");
  await composer.press("Enter");
  await expect(composer).toHaveValue('@"Frontend Agent" ');
  await composer.fill("");
  await composer.fill("Preserve this draft");
  await page.getByLabel("Available mention targets").getByRole("button", { name: /Group Frontend/u }).click();
  await expect(composer).toHaveValue('@"Group Frontend" Preserve this draft');
  await expect(composer).toBeFocused();
  await composer.fill("Explain the fixed authentication flow.");
  const unmentioned = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/group-messages$/u.test(response.url()),
  );
  await composer.press("Enter");
  expect((await unmentioned).status()).toBe(201);
  await expect(page.getByText("Mention a ready Frontend or Backend Agent and request exactly one supported authentication transport.")).toBeVisible();
  expect((await shepherdState(request)).missions).toHaveLength(0);

  await composer.fill("");
  await page.getByLabel("Available mention targets").getByRole("button", { name: /Group Frontend/u }).click();
  await expect(composer).toHaveValue('@"Group Frontend" ');
  await expect(composer).toBeFocused();
  await composer.press("End");
  await composer.type("use an HttpOnly session cookie; $(cat .env)");
  await expect(composer).toHaveValue('@"Group Frontend" use an HttpOnly session cookie; $(cat .env)');
  await expect(composer).toBeFocused();
  await captureEvidence(page, expectedViewport, "01-frontend-request");
  const frontendRequest = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/group-messages$/u.test(response.url()),
  );
  await composer.press("Enter");
  expect((await frontendRequest).status()).toBe(201);
  await expect(page.getByText("Contract request captured; awaiting a complementary Frontend or Backend request.")).toBeVisible();
  expect((await shepherdState(request)).missions).toHaveLength(0);
  await captureEvidence(page, expectedViewport, "02-awaiting-peer");

  await composer.fill("");
  await page.getByLabel("Available mention targets").getByRole("button", { name: /Group Backend/u }).click();
  await expect(composer).toHaveValue('@"Group Backend" ');
  await expect(composer).toBeFocused();
  await composer.press("End");
  await composer.type("use a bearer JWT.");
  await expect(composer).toHaveValue('@"Group Backend" use a bearer JWT.');
  const backendRequest = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/group-messages$/u.test(response.url()),
  );
  await composer.press("Enter");
  expect((await backendRequest).status()).toBe(201);
  const state = await waitForCompletedMission(request);
  const mission = state.missions.at(-1);
  const contracts = state.contracts.filter((contract) => contract.missionId === mission.id);
  expect(contracts.map((contract) => contract.objective).join("\n")).not.toContain("$(cat .env)");
  expect(contracts).toEqual(expect.arrayContaining([
    expect.objectContaining({ objective: expect.stringMatching(/http-only-session-cookie/u) }),
    expect.objectContaining({ objective: expect.stringMatching(/bearer-jwt/u) }),
  ]));
  await expect(page.locator(".group-message-agent")).toHaveCount(2);
  await expect(page.locator(".group-message-agent").filter({ hasText: "Backend auth service uses a bearer JWT." })).toHaveCount(1);
  await expect(page.locator(".group-message-agent").filter({ hasText: "Frontend auth client uses an HttpOnly session cookie." })).toHaveCount(1);
  const frontendContractLink = page.locator(".group-message")
    .filter({ hasText: "use an HttpOnly session cookie" })
    .getByRole("link", { name: /Contract/u });
  await expect(frontendContractLink).toBeVisible();
  await expect(page.locator(".group-message").filter({ hasText: "use a bearer JWT" }).getByRole("link", { name: /Contract/u })).toBeVisible();

  const messagesResponse = await request.get(
    `${app.baseURL}/api/shepherd/projects/auth-demo/group-messages`,
    { headers: headers() },
  );
  expect(messagesResponse.status()).toBe(200);
  const messages = (await messagesResponse.json()).messages;
  const agentMessages = messages.filter((message) => message.senderType === "agent");
  expect(agentMessages).toHaveLength(2);
  expect(agentMessages.every((message) => message.contractId && message.senderId === message.targetAgentId)).toBe(true);
  await assertNoDocumentOverflow(page, expectedViewport);
  await captureEvidence(page, expectedViewport, "03-verified-summaries");
  const screenshotDirectory = path.join(repositoryRoot, ".tmp", "playwright-evidence", "project-group-contract-flow");
  await page.screenshot({
    path: path.join(screenshotDirectory, `${expectedViewport.width}x${expectedViewport.height}.png`),
    fullPage: false,
  });

  const frontendContract = contracts.find((contract) =>
    contract.objective.includes("http-only-session-cookie"),
  );
  expect(frontendContract).toBeTruthy();
  const contractCreated = state.events.find((event) =>
    event.type === "contract_created" && event.contractId === frontendContract.id,
  );
  expect(contractCreated).toBeTruthy();
  await frontendContractLink.click();
  await expect(page.getByRole("heading", { name: "Shepherd", exact: true })).toBeVisible();
  const contractEvent = page.locator("article.event-card").filter({ hasText: contractCreated.summary });
  await expect(contractEvent).toBeVisible();
  await contractEvent.getByText("View evidence", { exact: true }).click();
  const definition = contractEvent.getByLabel("Agent execution contract");
  await expect(definition).toContainText(frontendContract.id);
  await expect(definition).toContainText(frontendContract.objective);
  await expect(definition).toContainText("src/frontend/**");
  await assertNoDocumentOverflow(page, expectedViewport);
  await captureEvidence(page, expectedViewport, "04-contract-definition");
});
