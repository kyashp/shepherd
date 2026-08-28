import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  type ShepherdHttpService,
  type ShepherdMissionDetail,
} from "./app.js";
import { loadConfig } from "./config.js";
import type { AgentService } from "./agent-service.js";
import { emptyShepherdDatabase } from "./database.js";
import type { ShepherdEvent } from "./shepherd/domain.js";
import type { Agent, AgentRun, Message } from "./types.js";

const service = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

const agentId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const privateWorkspace = "/private/agent-workspaces/agent-1";
const agent: Agent = {
  id: agentId,
  name: "Builder",
  description: "Builds features",
  instructions: "Stay in scope",
  status: "ready",
  workspacePath: privateWorkspace,
  codexThreadId: null,
  lastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const run: AgentRun = {
  id: runId,
  agentId,
  status: "queued",
  prompt: "Implement the contract",
  output: null,
  error: null,
  usage: null,
  startedAt: null,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};
const message: Message = {
  id: "33333333-3333-4333-8333-333333333333",
  agentId,
  runId,
  role: "user",
  content: "Implement the contract",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const createAgentService = (
  overrides: Partial<AgentService> = {},
): AgentService =>
  ({
    listAgents: () => [agent],
    systemInfo: async () => ({}),
    createAgent: async () => agent,
    getAgent: () => agent,
    updateAgent: async () => agent,
    deleteAgent: async () => ({ deleted: true }),
    startAgent: async () => agent,
    stopAgent: async () => ({ ...agent, status: "stopped" }),
    getMessages: () => [message],
    getRuns: () => [run],
    sendMessage: async () => ({ run, message }),
    getRun: () => run,
    ...overrides,
  }) as unknown as AgentService;

const missionId = "mission-abc123";
const managedRoot = "/private/shepherd-managed";
const timestamp = "2026-01-01T00:00:00.000Z";
const event: ShepherdEvent = {
  id: "event-1",
  sequence: 7,
  timestamp: "2026-01-01T00:00:00.000Z",
  type: "mission_created",
  summary: "Mission created",
  actor: { type: "shepherd", id: null, displayName: "Shepherd" },
  missionId,
  contractId: null,
  agentId: null,
  planeId: null,
  collisionId: null,
  candidateId: null,
  details: {},
};
const missionDetail: ShepherdMissionDetail = {
  mission: {
    id: missionId,
    projectId: "project-1",
    originalIntent: "Build the authentication flow",
    baseCommit: "a".repeat(40),
    contractIds: [],
    dependencyEdges: [],
    collisionIds: [],
    resolutionIds: [],
    state: "running",
    attentionReason: null,
    failure: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    completedAt: null,
  },
  project: {
    id: "project-1",
    displayName: "Authentication fixture",
    repositoryPath: `${managedRoot}/repository`,
    protectedBranch: "main",
    protectedHeadCommit: "a".repeat(40),
    activeMissionId: missionId,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  agents: [
    {
      id: "agent-1",
      name: "Frontend Agent",
      description: "",
      instructions: "",
      status: "busy",
      workspacePath: `${managedRoot}/agent-workspace`,
      codexThreadId: null,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ],
  contracts: [],
  planes: [
    {
      id: "plane-1",
      projectId: "project-1",
      missionId,
      kind: "contract",
      contractId: null,
      candidateId: null,
      branch: "shepherd/contract/plane-1",
      worktreePath: `${managedRoot}/planes/contract-plane-1`,
      baseCommit: "a".repeat(40),
      headCommit: "b".repeat(40),
      purpose: "Frontend contract",
      executionIdentity: "execution-1",
      authority: { readable: ["**"], writable: ["src/frontend/**"], forbidden: [] },
      state: "running",
      changedFiles: ["src/frontend/auth.json"],
      diffSummary: "1 file changed",
      verificationEvidenceIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      destroyedAt: null,
      error: null,
    },
  ],
  claims: [],
  collisions: [],
  candidates: [],
  events: [event],
};

const createShepherdState = () => {
  const state = emptyShepherdDatabase(timestamp);
  state.projects = [missionDetail.project];
  state.planes = missionDetail.planes;
  return state;
};

const createShepherdService = (
  overrides: Partial<ShepherdHttpService> = {},
): ShepherdHttpService => ({
  state: createShepherdState,
  missionDetail: (id) => (id === missionId ? missionDetail : null),
  eventsAfter: () => [event],
  startDeterministicDemo: async () => ({ missionId }),
  ...overrides,
});

describe("HTTP boundary", () => {
  it("never exposes Agent workspace paths from lifecycle or conversation routes", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test" }),
      createAgentService(),
    );
    const requests = [
      { method: "GET", url: "/api/agents" },
      { method: "POST", url: "/api/agents", payload: { name: "Builder" } },
      { method: "GET", url: `/api/agents/${agentId}` },
      {
        method: "PATCH",
        url: `/api/agents/${agentId}`,
        payload: { description: "Updated" },
      },
      { method: "POST", url: `/api/agents/${agentId}/start` },
      { method: "POST", url: `/api/agents/${agentId}/stop` },
      { method: "GET", url: `/api/agents/${agentId}/messages` },
      { method: "GET", url: `/api/agents/${agentId}/runs` },
      {
        method: "POST",
        url: `/api/agents/${agentId}/messages`,
        payload: { content: "Implement the contract" },
      },
      { method: "GET", url: `/api/runs/${runId}` },
    ] as const;

    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}`).toBeLessThan(300);
      expect(response.body, `${request.method} ${request.url}`).not.toContain(
        privateWorkspace,
      );
      expect(response.body, `${request.method} ${request.url}`).not.toContain(
        "workspacePath",
      );
    }

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/agents/${agentId}`,
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(deleted.body).not.toContain(privateWorkspace);
    await app.close();
  });

  it("returns a generic bounded response for unexpected server errors", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
      createAgentService({
        listAgents: () => {
          throw new Error(
            `database failed at ${privateWorkspace} with password=super-secret-value`,
          );
        },
      }),
    );

    const response = await app.inject({ method: "GET", url: "/api/agents" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal server error" });
    expect(response.body.length).toBeLessThan(100);
    expect(response.body).not.toContain(privateWorkspace);
    expect(response.body).not.toContain("super-secret-value");
    await app.close();
  });

  it("protects API routes with the configured shared token", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", APP_AUTH_TOKEN: "a-strong-test-token" }),
      service,
      createShepherdService(),
    );
    const denied = await app.inject({ method: "GET", url: "/api/agents" });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/agents",
      headers: { authorization: "Bearer a-strong-test-token" },
    });
    expect(allowed.statusCode).toBe(200);

    const shepherdDenied = await app.inject({
      method: "GET",
      url: "/api/shepherd/state",
    });
    expect(shepherdDenied.statusCode).toBe(401);
    const shepherdAllowed = await app.inject({
      method: "GET",
      url: "/api/shepherd/state",
      headers: { authorization: "Bearer a-strong-test-token" },
    });
    expect(shepherdAllowed.statusCode).toBe(200);
    await app.close();
  });

  it("preserves Fastify client error status codes", async () => {
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service);
    const malformed = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: "{not-json",
    });
    expect(malformed.statusCode).toBe(400);

    const oversized = await app.inject({
      method: "POST",
      url: "/api/agents",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(1_100_000) }),
    });
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });

  it("exposes Shepherd state, safe Mission detail, and cursor-based events", async () => {
    const eventsAfter = vi.fn(() => [event]);
    const shepherd = createShepherdService({ eventsAfter });
    const app = await createApp(loadConfig({ NODE_ENV: "test" }), service, shepherd);

    const state = await app.inject({ method: "GET", url: "/api/shepherd/state" });
    expect(state.statusCode).toBe(200);
    expect(state.json().state.nextEventSequence).toBe(1);
    expect(state.json().state.projects[0].repositoryPath).toBeUndefined();
    expect(state.json().state.planes[0].worktreePath).toBeUndefined();
    expect(state.body).not.toContain(managedRoot);

    const mission = await app.inject({
      method: "GET",
      url: `/api/shepherd/missions/${missionId}`,
    });
    expect(mission.statusCode).toBe(200);
    expect(mission.json().mission.id).toBe(missionId);
    expect(mission.json().project.repositoryPath).toBeUndefined();
    expect(mission.json().planes[0].worktreePath).toBeUndefined();
    expect(mission.json().agents[0].workspacePath).toBeUndefined();
    expect(mission.body).not.toContain(managedRoot);

    const events = await app.inject({
      method: "GET",
      url: "/api/shepherd/events?cursor=3&limit=25",
    });
    expect(events.statusCode).toBe(200);
    expect(eventsAfter).toHaveBeenCalledWith(3, 25);
    expect(events.json()).toEqual({ events: [event], nextCursor: 7 });
    await app.close();
  });

  it("rejects unsafe Mission IDs and invalid or unbounded polling input", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test" }),
      service,
      createShepherdService(),
    );

    for (const url of [
      "/api/shepherd/missions/unsafe%24id",
      `/api/shepherd/missions/${"a".repeat(97)}`,
      "/api/shepherd/events?cursor=-1",
      "/api/shepherd/events?cursor=1.5",
      "/api/shepherd/events?limit=0",
      "/api/shepherd/events?limit=201",
      "/api/shepherd/events?path=%2Fetc%2Fpasswd",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(400);
    }

    const missing = await app.inject({
      method: "GET",
      url: "/api/shepherd/missions/mission-000000000099",
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it("guards deterministic demo execution behind explicit demo mode", async () => {
    const startDeterministicDemo = vi.fn(async () => ({ missionId }));
    const shepherd = createShepherdService({ startDeterministicDemo });
    const disabledApp = await createApp(
      loadConfig({ NODE_ENV: "test", SHEPHERD_DEMO_MODE: "false" }),
      service,
      shepherd,
    );
    const disabled = await disabledApp.inject({
      method: "POST",
      url: "/api/shepherd/demo/missions",
    });
    expect(disabled.statusCode).toBe(403);
    expect(startDeterministicDemo).not.toHaveBeenCalled();
    await disabledApp.close();

    const enabledApp = await createApp(
      loadConfig({ NODE_ENV: "test", SHEPHERD_DEMO_MODE: "true" }),
      service,
      shepherd,
    );
    const accepted = await enabledApp.inject({
      method: "POST",
      url: "/api/shepherd/demo/missions",
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({ status: "accepted", missionId });
    expect(startDeterministicDemo).toHaveBeenCalledWith({});
    await enabledApp.close();
  });

  it("does not accept browser-supplied paths or commands for a demo run", async () => {
    const startDeterministicDemo = vi.fn(async () => ({ missionId }));
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", SHEPHERD_DEMO_MODE: "true" }),
      service,
      createShepherdService({ startDeterministicDemo }),
    );
    const rejected = await app.inject({
      method: "POST",
      url: "/api/shepherd/demo/missions",
      payload: {
        path: "/etc/passwd",
        command: "arbitrary-command",
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).not.toContain("/etc/passwd");
    expect(rejected.body).not.toContain("arbitrary-command");
    expect(startDeterministicDemo).not.toHaveBeenCalled();
    await app.close();
  });
});
