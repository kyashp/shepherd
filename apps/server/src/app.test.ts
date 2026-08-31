import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  toPublicShepherdState,
  type ShepherdHttpService,
  type ShepherdMissionDetail,
} from "./app.js";
import { loadConfig } from "./config.js";
import type { AgentAuthorityPreset, AgentService } from "./agent-service.js";
import { emptyShepherdDatabase } from "./database.js";
import { JsonStore } from "./store.js";
import type {
  ExecutionContract,
  ProjectGroupMessage,
  ResolutionCandidate,
  SemanticClaim,
  SemanticCollision,
  ShepherdEvent,
  VerificationEvidence,
} from "./shepherd/domain.js";
import type {
  ShepherdCandidateDetail,
  ShepherdCollisionDetail,
  ShepherdPlaneDetail,
} from "./shepherd/service.js";
import { ShepherdControlError, ShepherdService } from "./shepherd/service.js";
import type { Agent, AgentRun, Message } from "./types.js";

const appTestRoot = fileURLToPath(
  new URL("../../../.tmp/shepherd-app-tests/", import.meta.url),
);

async function makeAppCaseRoot(): Promise<string> {
  await mkdir(appTestRoot, { recursive: true });
  return await mkdtemp(path.join(appTestRoot, "reset-"));
}

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
const plantedSecret = "test-ark-secret-canary-827364";
const evidence: VerificationEvidence = {
  id: "evidence-1",
  targetType: "contract",
  targetId: "contract-1",
  runner: "independent",
  passed: true,
  checks: [
    {
      id: "check-1",
      name: "Safe verification",
      profileId: "auth-frontend",
      mandatory: true,
      status: "passed",
      passed: true,
      exitCode: 0,
      durationMs: 5,
      stdout: `verified ${plantedSecret} at ${managedRoot}/private-output`,
      stderr: `Bearer ${plantedSecret}`,
      error: `password=${plantedSecret}`,
    },
  ],
  startedAt: timestamp,
  completedAt: timestamp,
  durationMs: 5,
  changedFiles: ["src/frontend/auth.json"],
  summary: `Verification passed; diagnostic secret=${plantedSecret}`,
};
const claim: SemanticClaim = {
  id: "claim-1",
  missionId,
  contractId: "contract-1",
  key: "auth.transport",
  value: "bearer-jwt",
  scope: "authentication",
  mode: "exclusive",
  evidence: [
    {
      path: "src/frontend/auth.json",
      description: "Frontend transport",
      line: 1,
    },
  ],
  valid: true,
  rejectionReason: null,
  createdAt: timestamp,
};
const contract: ExecutionContract = {
  id: "contract-1",
  missionId,
  agentId: "agent-1",
  title: "Frontend authentication",
  objective: `Implement auth without ${plantedSecret}`,
  contextualInputs: [],
  dependencyIds: [],
  semanticScopes: ["authentication"],
  declaredClaimKeys: ["auth.transport"],
  authority: {
    readable: ["**"],
    writable: ["src/frontend/**"],
    forbidden: [".shepherd/**"],
  },
  expectedArtifacts: [
    {
      path: "src/frontend/auth.json",
      description: "Frontend auth transport",
      required: true,
    },
  ],
  acceptance: {
    checks: [
      {
        id: "check-1",
        name: "Frontend acceptance",
        profileId: "auth-frontend",
        mandatory: true,
        timeoutMs: 30_000,
      },
    ],
    objectiveTieBreakers: [],
  },
  planeId: "plane-1",
  resultManifestPath: ".shepherd/result.json",
  manifest: {
    schemaVersion: 1,
    contractId: "contract-1",
    summary: `raw manifest ${plantedSecret}`,
    artifacts: [],
    semanticClaims: [],
    agentDeclaredTests: [],
    notes: `raw prompt ${plantedSecret}`,
  },
  verificationEvidence: [evidence],
  state: "verified",
  failure: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  startedAt: timestamp,
  agentCompletedAt: timestamp,
  verifiedAt: timestamp,
  completedAt: timestamp,
};
const candidate: ResolutionCandidate = {
  id: "candidate-1",
  missionId,
  collisionId: "collision-1",
  strategy: "Use the independently verified transport",
  targetKey: "auth.transport",
  targetValue: "http-only-session-cookie",
  planeId: "plane-1",
  executionState: "passed",
  selectionState: "tied",
  promotionState: "not_started",
  verificationEvidence: { ...evidence, targetType: "candidate", targetId: "candidate-1" },
  previousAttempts: [
    {
      planeId: "plane-previous",
      executionState: "failed",
      verificationEvidence: null,
      changedFiles: ["src/frontend/auth.json"],
      diffSummary: `failed at ${managedRoot}/previous`,
      failure: {
        code: "candidate_timeout",
        message: `timeout secret=${plantedSecret}`,
        stage: "candidate_execution",
        at: timestamp,
        retryable: true,
      },
      startedAt: timestamp,
      completedAt: timestamp,
    },
  ],
  promotionEvidence: null,
  changedFiles: ["src/frontend/auth.json"],
  diffSummary: "1 file changed",
  result: `candidate output ${plantedSecret}`,
  retryCount: 1,
  failure: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const collision: SemanticCollision = {
  id: "collision-1",
  missionId,
  key: "auth.transport",
  scope: "authentication",
  leftContractId: "contract-1",
  rightContractId: "contract-2",
  leftClaimId: claim.id,
  rightClaimId: "claim-2",
  leftClaim: claim,
  rightClaim: {
    ...claim,
    id: "claim-2",
    contractId: "contract-2",
    value: "http-only-session-cookie",
  },
  reason: "Exclusive values differ",
  detectionMechanism: "deterministic",
  candidateIds: [candidate.id],
  state: "attention_required",
  createdAt: timestamp,
  updatedAt: timestamp,
  resolvedAt: null,
};
const groupMessage: ProjectGroupMessage = {
  id: "group-1",
  projectId: "project-1",
  missionId,
  senderType: "human",
  senderId: null,
  content: "Please run the fixed authentication Mission",
  targetAgentId: null,
  contractId: null,
  createdAt: timestamp,
};
const missionDetail: ShepherdMissionDetail = {
  mission: {
    id: missionId,
    projectId: "project-1",
    originalIntent: "Build the authentication flow",
    baseCommit: "a".repeat(40),
    contractIds: [contract.id],
    dependencyEdges: [],
    collisionIds: [collision.id],
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
  contracts: [contract],
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
      runtimeSessionFingerprint: "a".repeat(64),
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
  claims: [claim],
  collisions: [collision],
  candidates: [candidate],
  events: [event],
};

const createShepherdState = () => {
  const state = emptyShepherdDatabase(timestamp);
  state.projects = [missionDetail.project];
  state.missions = [missionDetail.mission];
  state.contracts = missionDetail.contracts;
  state.planes = missionDetail.planes;
  state.claims = missionDetail.claims;
  state.collisions = missionDetail.collisions;
  state.candidates = missionDetail.candidates;
  state.events = missionDetail.events;
  state.groupMessages = [groupMessage];
  return state;
};

const planeDetail: ShepherdPlaneDetail = {
  plane: missionDetail.planes[0]!,
  mission: missionDetail.mission,
  project: missionDetail.project,
  contract,
  candidate,
  verificationEvidence: [evidence],
};
const collisionDetail: ShepherdCollisionDetail = {
  collision,
  mission: missionDetail.mission,
  project: missionDetail.project,
  sourceContracts: [contract, { ...contract, id: "contract-2" }],
  candidates: [candidate],
  planes: missionDetail.planes,
};
const candidateDetail: ShepherdCandidateDetail = {
  candidate,
  collision,
  mission: missionDetail.mission,
  project: missionDetail.project,
  plane: missionDetail.planes[0]!,
  previousPlanes: [{ ...missionDetail.planes[0]!, id: "plane-previous" }],
};

const createShepherdService = (
  overrides: Partial<ShepherdHttpService> = {},
): ShepherdHttpService => ({
  state: createShepherdState,
  initializeProjectGroup: async () => ({
    ...createShepherdState().projects[0]!,
    id: "auth-demo",
    activeMissionId: null,
  }),
  missionDetail: (id) => (id === missionId ? missionDetail : null),
  eventsAfter: () => [event],
  startDeterministicDemo: async () => ({ missionId }),
  startMissionFromMessage: async () => ({ missionId, message: groupMessage }),
  submitPrivateContractPrompt: async () => ({
    status: "accepted",
    missionId,
    contractId: contract.id,
    clarification: null,
    message: groupMessage,
  }),
  projectGroupMessages: () => [groupMessage],
  sendProjectGroupMessage: async () => groupMessage,
  cancelMission: async () => ({ ...missionDetail.mission, state: "cancelled" }),
  selectTiedCandidate: async () => missionDetail,
  resetDeterministicDemo: async () => ({
    projectId: "auth-demo",
    restoredHead: "a".repeat(40),
    removedPlanePaths: [`${managedRoot}/planes/old`],
    removed: {
      missions: 1,
      contracts: 2,
      planes: 5,
      claims: 2,
      collisions: 1,
      candidates: 2,
      events: 20,
      messages: 4,
    },
  }),
  settings: () => createShepherdState().settings,
  updateSettings: async (input) => ({
    ...createShepherdState().settings,
    ...input,
    notifications: {
      ...createShepherdState().settings.notifications,
      ...(input.notifications ?? {}),
    },
    updatedAt: timestamp,
  }),
  planeDetail: (id) => (id === "plane-1" ? planeDetail : null),
  collisionDetail: (id) => (id === collision.id ? collisionDetail : null),
  candidateDetail: (id) => (id === candidate.id ? candidateDetail : null),
  ...overrides,
});

describe("HTTP boundary", () => {
  it("redacts derived general Contract fields and Plane promotion evidence independently", () => {
    const state = createShepherdState();
    state.groupMessages = [
      {
        ...groupMessage,
        targetAgentId: "agent-1",
        content: `Create output without ${plantedSecret}`,
        contractAssignment: {
          preset: "general-contract",
          role: "Generalist",
          draftId: "draft-public-redaction",
          status: "clarification_required",
          missingFields: ["acceptance_evidence"],
          expectedArtifacts: [],
          acceptanceSummary: `contains ${plantedSecret}`,
          requiredContent: plantedSecret,
        },
        requestFingerprint: "f".repeat(64),
      },
    ];
    state.planes[0] = {
      ...state.planes[0]!,
      generalPromotionState: "promoting",
      generalPromotionEvidence: {
        ...evidence,
        id: "promotion-evidence-public",
        targetType: "promotion",
        targetId: state.planes[0]!.id,
      },
    };
    const publicState = toPublicShepherdState(state, [plantedSecret]);
    const serialized = JSON.stringify(publicState);
    expect(serialized).not.toContain(plantedSecret);
    expect(publicState.groupMessages[0]?.requestFingerprint).toBeUndefined();
    expect(
      publicState.planes[0]?.generalPromotionEvidence?.checks[0],
    ).not.toHaveProperty("stdout");
  });

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

  it("offers bounded authority presets and persists the resolved role and preset", async () => {
    const createAgent = vi.fn(async (input) => ({
      ...agent,
      name: input.name,
      description: input.description ?? "",
      instructions: input.instructions ?? "",
      role: input.role,
      authority: input.authority,
      codexThreadId: "private-thread-id",
    }));
    const app = await createApp(
      loadConfig({ NODE_ENV: "test" }),
      createAgentService({ createAgent }),
    );

    const presets = await app.inject({
      method: "GET",
      url: "/api/agent-authority-presets",
    });
    expect(presets.statusCode).toBe(200);
    const presetBody = presets.json() as { presets: AgentAuthorityPreset[] };
    expect(presetBody.presets.map((preset) => preset.id)).toEqual([
      "frontend",
      "backend",
      "verification",
      "generalist",
    ]);
    expect(presetBody.presets[0]?.authority.writable).toContain("apps/web/**");
    expect(presetBody.presets[0]?.authority.forbidden).toContain(".git/**");

    const created = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "Frontend owner",
        authorityPreset: "frontend",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().agent).toMatchObject({
      name: "Frontend owner",
      role: "Frontend",
    });
    expect(created.json().agent.authority.writable).toContain("src/frontend/**");
    expect(created.json().agent.codexThreadId).toBeUndefined();
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Frontend owner",
        role: "Frontend",
        authority: expect.objectContaining({ writable: expect.any(Array) }),
      }),
    );
    await app.close();
  });

  it("normalizes advanced authority and rejects ambiguous or host-level authority", async () => {
    const createAgent = vi.fn(async (input) => ({
      ...agent,
      name: input.name,
      role: input.role,
      authority: input.authority,
    }));
    const app = await createApp(
      loadConfig({ NODE_ENV: "test" }),
      createAgentService({ createAgent }),
    );
    const accepted = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: {
        name: "Scoped",
        role: "Verification",
        authority: {
          readable: ["./src//**", "src/**"],
          writable: ["tests/**", "./tests/**"],
          forbidden: [".git/**"],
        },
      },
    });
    expect(accepted.statusCode).toBe(201);
    expect(createAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: "Verification",
        authority: {
          readable: ["src/**"],
          writable: ["tests/**"],
          forbidden: [".git/**"],
        },
      }),
    );

    const rejectedPayloads = [
      {
        name: "Ambiguous",
        authorityPreset: "frontend",
        authority: { readable: ["**"], writable: ["src/**"], forbidden: [] },
      },
      { name: "Mismatch", role: "Backend", authorityPreset: "frontend" },
      {
        name: "Absolute",
        authority: { readable: ["**"], writable: ["/etc/**"], forbidden: [] },
      },
      {
        name: "Traversal",
        authority: { readable: ["**"], writable: ["../outside/**"], forbidden: [] },
      },
      {
        name: "Unknown",
        authorityPreset: "generalist",
        repositoryPath: "/tmp/repository",
      },
    ];
    for (const payload of rejectedPayloads) {
      const response = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload,
      });
      expect(response.statusCode, payload.name).toBe(400);
      expect(response.body).not.toContain("/etc");
      expect(response.body).not.toContain("/tmp/repository");
    }
    expect(createAgent).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("passes role-only edits through so AgentService resets the matching preset", async () => {
    const updateAgent = vi.fn(async (_id, input) => ({
      ...agent,
      ...input,
      role: input.role,
    }));
    const app = await createApp(
      loadConfig({ NODE_ENV: "test" }),
      createAgentService({ updateAgent }),
    );
    const response = await app.inject({
      method: "PATCH",
      url: `/api/agents/${agentId}`,
      payload: { role: "Backend" },
    });
    expect(response.statusCode).toBe(200);
    expect(updateAgent).toHaveBeenCalledWith(agentId, { role: "Backend" });
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

  it("omits raw run prompts and redacts configured secrets from legacy aggregates", async () => {
    const secretRun = {
      ...run,
      prompt: `raw prompt ${plantedSecret}`,
      output: `Bearer ${plantedSecret}`,
      error: `failed at ${privateWorkspace} password=${plantedSecret}`,
    };
    const secretAgent = {
      ...agent,
      codexThreadId: "private-thread-fingerprint",
      lastError: `failed at ${privateWorkspace} secret=${plantedSecret}`,
    };
    const app = await createApp(
      loadConfig({
        NODE_ENV: "test",
        ARK_API_KEY: plantedSecret,
        ARK_MODEL: "test-model",
      }),
      createAgentService({
        listAgents: () => [secretAgent],
        getRuns: () => [secretRun],
        getRun: () => secretRun,
      }),
    );
    for (const url of [
      "/api/agents",
      `/api/agents/${agentId}/runs`,
      `/api/runs/${runId}`,
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).not.toContain(plantedSecret);
      expect(response.body, url).not.toContain(privateWorkspace);
      expect(response.body, url).not.toContain("codexThreadId");
      expect(response.body, url).not.toContain('"prompt"');
    }
    await app.close();
  });

  it("protects API routes with the configured shared token", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", APP_AUTH_TOKEN: "a-strong-bounded-test-token" }),
      service,
      createShepherdService(),
    );
    const denied = await app.inject({ method: "GET", url: "/api/agents" });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/api/agents",
      headers: { authorization: "Bearer a-strong-bounded-test-token" },
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
      headers: { authorization: "Bearer a-strong-bounded-test-token" },
    });
    expect(shepherdAllowed.statusCode).toBe(200);
    await app.close();
  });

  it("rejects hostile Host and Origin values before tokenless mutation handlers", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test" }),
      createAgentService(),
      createShepherdService(),
    );
    const route = `/api/agents/${agentId}/start`;
    for (const headers of [
      { host: "attacker.example" },
      { host: "localhost", origin: "https://attacker.example" },
      { host: "localhost", origin: "null" },
      { host: "localhost", origin: "http://127.0.0.1" },
    ]) {
      const denied = await app.inject({ method: "POST", url: route, headers });
      expect(denied.statusCode, JSON.stringify(headers)).toBe(403);
      expect(denied.json()).toEqual({ error: "Local API origin required" });
    }

    const sameOrigin = await app.inject({
      method: "POST",
      url: route,
      headers: { host: "localhost", origin: "http://localhost" },
    });
    expect(sameOrigin.statusCode).toBe(200);
    const commandLine = await app.inject({
      method: "POST",
      url: route,
      headers: { host: "127.0.0.1:3000" },
    });
    expect(commandLine.statusCode).toBe(200);
    await app.close();
  });

  it("protects API routes spelled with a percent-encoded prefix", async () => {
    // The hook decides whether to authenticate from the RAW request target while
    // the router percent-decodes before matching, so any encoded spelling of the
    // prefix skipped the hook and still reached the handler. Destructive routes
    // included: the demo reset removes Plane worktrees and restores protected HEAD.
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", APP_AUTH_TOKEN: "a-strong-bounded-test-token" }),
      service,
      createShepherdService(),
    );
    for (const url of [
      "/%61pi/system",
      "/%61pi/agents",
      "/%61pi/shepherd/state",
      "/ap%69/shepherd/state",
    ]) {
      const denied = await app.inject({ method: "GET", url });
      expect(denied.statusCode, url).toBe(401);
    }
    // The exemptions stay exact-match: a query string on a public route still
    // fails closed, which is the behaviour before this correction.
    const healthWithQuery = await app.inject({ method: "GET", url: "/api/health?x=1" });
    expect(healthWithQuery.statusCode).toBe(401);
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);

    // The canonical spelling must keep working with a valid token.
    const allowed = await app.inject({
      method: "GET",
      url: "/api/shepherd/state",
      headers: { authorization: "Bearer a-strong-bounded-test-token" },
    });
    expect(allowed.statusCode).toBe(200);
    await app.close();
  });

  it("protects API routes requested in absolute form", async () => {
    // HTTP/1.1 permits an absolute-form request target, and `request.url` is then the
    // whole URI, which does not start with "/api/". A prefix test on it skips the hook
    // while the router still matches the path component.
    //
    // This must go over a real socket: `app.inject` normalizes the target, so it
    // cannot express this request at all and reports a false pass.
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", APP_AUTH_TOKEN: "a-strong-bounded-test-token" }),
      service,
      createShepherdService(),
    );
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const statusFor = async (target: string): Promise<number> =>
      await new Promise((resolve, reject) => {
        const socket = connect(port, "127.0.0.1", () => {
          socket.write(
            `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
          );
        });
        let received = "";
        socket.on("data", (chunk) => (received += chunk.toString("utf8")));
        socket.on("error", reject);
        socket.on("close", () =>
          resolve(Number(received.split("\r\n")[0]?.split(" ")[1] ?? 0)),
        );
      });

    try {
      expect(await statusFor("/api/system")).toBe(401);
      for (const target of [
        `http://127.0.0.1:${port}/api/system`,
        `http://127.0.0.1:${port}/api/shepherd/state`,
        `http://127.0.0.1:${port}/api/agents`,
      ]) {
        expect(await statusFor(target), target).toBe(401);
      }
    } finally {
      await app.close();
    }
  }, 30_000);

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
    expect(state.json().state.planes[0].runtimeSessionFingerprint).toBeUndefined();
    expect(state.json().state.planes[0].executionIdentity).toBeUndefined();
    expect(state.json().state.planes[0].runtimeSessionEstablished).toBe(true);
    expect(state.json().state.contracts[0].manifest).toBeUndefined();
    expect(
      state.json().state.contracts[0].verificationEvidence[0].checks[0].stdout,
    ).toBeUndefined();
    expect(
      state.json().state.contracts[0].verificationEvidence[0].checks[0].stderr,
    ).toBeUndefined();
    expect(
      state.json().state.contracts[0].verificationEvidence[0].checks[0].error,
    ).toBeUndefined();
    expect(state.body).not.toContain(managedRoot);

    const mission = await app.inject({
      method: "GET",
      url: `/api/shepherd/missions/${missionId}`,
    });
    expect(mission.statusCode).toBe(200);
    expect(mission.json().mission.id).toBe(missionId);
    expect(mission.json().project.repositoryPath).toBeUndefined();
    expect(mission.json().planes[0].worktreePath).toBeUndefined();
    expect(mission.json().planes[0].runtimeSessionFingerprint).toBeUndefined();
    expect(mission.json().planes[0].runtimeSessionEstablished).toBe(true);
    expect(mission.json().agents[0].workspacePath).toBeUndefined();
    expect(mission.json().agents[0].codexThreadId).toBeUndefined();
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

  it("authenticates every Shepherd read and control route", async () => {
    const app = await createApp(
      loadConfig({
        NODE_ENV: "test",
        APP_AUTH_TOKEN: "a-strong-shepherd-test-token",
        SHEPHERD_DEMO_MODE: "true",
      }),
      service,
      createShepherdService(),
    );
    const requests = [
      { method: "GET", url: "/api/shepherd/state" },
      { method: "GET", url: `/api/shepherd/missions/${missionId}` },
      { method: "GET", url: "/api/shepherd/events" },
      { method: "GET", url: "/api/shepherd/planes/plane-1" },
      { method: "GET", url: "/api/shepherd/collisions/collision-1" },
      { method: "GET", url: "/api/shepherd/candidates/candidate-1" },
      {
        method: "GET",
        url: "/api/shepherd/projects/project-1/group-messages",
      },
      { method: "GET", url: "/api/shepherd/settings" },
      {
        method: "POST",
        url: "/api/shepherd/messages",
        payload: { content: "Implement authentication", preset: "auth-demo" },
      },
      {
        method: "POST",
        url: "/api/shepherd/projects/auth-demo/group-initialization",
        payload: {},
      },
      {
        method: "POST",
        url: "/api/shepherd/projects/project-1/group-messages",
        payload: { clientMessageId: "client-1", content: "Status?" },
      },
      {
        method: "POST",
        url: `/api/shepherd/agents/${agentId}/contracts`,
        payload: {
          clientMessageId: "private-contract-1",
          content: "Use an HttpOnly session cookie.",
          preset: "auth-demo-contract",
        },
      },
      {
        method: "POST",
        url: `/api/shepherd/missions/${missionId}/cancel`,
        payload: {},
      },
      {
        method: "POST",
        url: "/api/shepherd/collisions/collision-1/select",
        payload: { candidateId: "candidate-1" },
      },
      {
        method: "PATCH",
        url: "/api/shepherd/settings",
        payload: { autoResolution: false },
      },
      { method: "POST", url: "/api/shepherd/demo/reset", payload: {} },
    ] as const;
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(401);
    }
    await app.close();
  });

  it("serves the complete structured Shepherd control API", async () => {
    const startMissionFromMessage = vi.fn(async () => ({
      missionId,
      message: groupMessage,
    }));
    const projectGroupMessages = vi.fn(() => [groupMessage]);
    const sendProjectGroupMessage = vi.fn(async () => groupMessage);
    const submitPrivateContractPrompt = vi.fn(async () => ({
      status: "awaiting_peer" as const,
      missionId: null,
      contractId: null,
      clarification: null,
      message: {
        ...groupMessage,
        missionId: null,
        contractId: null,
        targetAgentId: agentId,
        contractAssignment: {
          preset: "auth-demo-contract" as const,
          role: "Frontend" as const,
          transport: "http-only-session-cookie" as const,
        },
        requestFingerprint: "f".repeat(64),
      },
    }));
    const cancelMission = vi.fn(async () => ({
      ...missionDetail.mission,
      state: "cancelled" as const,
    }));
    const selectTiedCandidate = vi.fn(async () => missionDetail);
    const updateSettings = vi.fn(async (input) => ({
      ...createShepherdState().settings,
      ...input,
      notifications: {
        ...createShepherdState().settings.notifications,
        ...(input.notifications ?? {}),
      },
      updatedAt: timestamp,
    }));
    const app = await createApp(
      loadConfig({ NODE_ENV: "test" }),
      service,
      createShepherdService({
        startMissionFromMessage,
        submitPrivateContractPrompt,
        projectGroupMessages,
        sendProjectGroupMessage,
        cancelMission,
        selectTiedCandidate,
        updateSettings,
      }),
    );

    const started = await app.inject({
      method: "POST",
      url: "/api/shepherd/messages",
      payload: {
        content: "Implement the authentication demo",
        preset: "auth-demo",
        clientMessageId: "mission-client-1",
      },
    });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({
      status: "accepted",
      missionId,
      executionMode: "deterministic",
      message: { id: groupMessage.id },
    });
    expect(startMissionFromMessage).toHaveBeenCalledWith({
      content: "Implement the authentication demo",
      preset: "auth-demo",
      clientMessageId: "mission-client-1",
    });

    const initializedGroup = await app.inject({
      method: "POST",
      url: "/api/shepherd/projects/auth-demo/group-initialization",
      payload: {},
    });
    expect(initializedGroup.statusCode).toBe(200);
    expect(initializedGroup.json()).toMatchObject({
      project: { id: "auth-demo", activeMissionId: null },
    });

    const privatePrompt = await app.inject({
      method: "POST",
      url: `/api/shepherd/agents/${agentId}/contracts`,
      payload: {
        clientMessageId: "private-contract-client-1",
        content: "Implement frontend auth with an HttpOnly session cookie.",
        preset: "managed-contract",
      },
    });
    expect(privatePrompt.statusCode).toBe(201);
    expect(privatePrompt.json()).toMatchObject({
      status: "awaiting_peer",
      missionId: null,
      contractId: null,
      executionMode: "deterministic",
      message: {
        targetAgentId: agentId,
        contractAssignment: {
          role: "Frontend",
          transport: "http-only-session-cookie",
        },
      },
    });
    expect(privatePrompt.body).not.toContain("requestFingerprint");
    expect(submitPrivateContractPrompt).toHaveBeenCalledWith({
      agentId,
      clientMessageId: "private-contract-client-1",
      content: "Implement frontend auth with an HttpOnly session cookie.",
    });

    const messages = await app.inject({
      method: "GET",
      url: "/api/shepherd/projects/project-1/group-messages?limit=25",
    });
    expect(messages.statusCode).toBe(200);
    expect(messages.json()).toEqual({ messages: [groupMessage] });
    expect(projectGroupMessages).toHaveBeenCalledWith("project-1", 25);

    const sent = await app.inject({
      method: "POST",
      url: "/api/shepherd/projects/project-1/group-messages",
      payload: {
        clientMessageId: "group-client-1",
        content: "@Frontend Agent verify the contract",
        assignmentPreset: "auth-demo-contract",
      },
    });
    expect(sent.statusCode).toBe(201);
    expect(sendProjectGroupMessage).toHaveBeenCalledWith("project-1", {
      clientMessageId: "group-client-1",
      content: "@Frontend Agent verify the contract",
      assignmentPreset: "auth-demo-contract",
    });

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/shepherd/missions/${missionId}/cancel`,
      payload: {},
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().mission.state).toBe("cancelled");
    expect(cancelMission).toHaveBeenCalledWith(missionId);

    const selected = await app.inject({
      method: "POST",
      url: "/api/shepherd/collisions/collision-1/select",
      payload: { candidateId: "candidate-1" },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json().mission.id).toBe(missionId);
    expect(selectTiedCandidate).toHaveBeenCalledWith("collision-1", "candidate-1");

    const settings = await app.inject({
      method: "PATCH",
      url: "/api/shepherd/settings",
      payload: {
        contractTimeoutMs: 45_000,
        autoResolution: false,
        modelReviewEnabled: true,
        notifications: { collisionDetected: false },
      },
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().settings).toMatchObject({
      contractTimeoutMs: 45_000,
      autoResolution: false,
      modelReviewEnabled: true,
      notifications: { collisionDetected: false },
    });
    expect(updateSettings).toHaveBeenCalledWith({
      contractTimeoutMs: 45_000,
      autoResolution: false,
      modelReviewEnabled: true,
      notifications: { collisionDetected: false },
    });
    await app.close();
  });

  it("returns safe Plane, collision, and candidate detail aggregates", async () => {
    const stateWithPrivateEventDetails = createShepherdState();
    stateWithPrivateEventDetails.events = [
      {
        ...event,
        details: {
          prompt: `internal prompt ${plantedSecret}`,
          runtimeSessionFingerprint: "f".repeat(64),
          worktreePath: `${managedRoot}/private-event-plane`,
          safeSummary: `Bearer ${plantedSecret}`,
        },
      },
    ];
    const app = await createApp(
      loadConfig({
        NODE_ENV: "test",
        ARK_API_KEY: plantedSecret,
        ARK_MODEL: "test-model",
      }),
      service,
      createShepherdService({ state: () => stateWithPrivateEventDetails }),
    );
    for (const url of [
      "/api/shepherd/state",
      `/api/shepherd/missions/${missionId}`,
      "/api/shepherd/planes/plane-1",
      "/api/shepherd/collisions/collision-1",
      "/api/shepherd/candidates/candidate-1",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).not.toContain(plantedSecret);
      expect(response.body, url).not.toContain(managedRoot);
      expect(response.body, url).not.toContain("worktreePath");
      expect(response.body, url).not.toContain("repositoryPath");
      expect(response.body, url).not.toContain("runtimeSessionFingerprint");
      expect(response.body, url).not.toContain("executionIdentity");
      expect(response.body, url).not.toContain('"stdout"');
      expect(response.body, url).not.toContain('"stderr"');
      expect(response.body, url).not.toContain('"manifest"');
      expect(response.body, url).not.toContain('"prompt"');
    }

    for (const url of [
      "/api/shepherd/planes/missing",
      "/api/shepherd/collisions/missing",
      "/api/shepherd/candidates/missing",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
    }
    await app.close();
  });

  it("rejects unsupported plans, host controls, locked settings, and malformed controls", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test", SHEPHERD_DEMO_MODE: "true" }),
      service,
      createShepherdService(),
    );
    const requests = [
      {
        method: "POST",
        url: "/api/shepherd/messages",
        payload: { content: "Arbitrary plan", preset: "generic" },
        status: 422,
      },
      {
        method: "POST",
        url: "/api/shepherd/messages",
        payload: {
          content: "Demo",
          preset: "auth-demo",
          repositoryPath: "/etc",
        },
        status: 400,
      },
      {
        method: "POST",
        url: "/api/shepherd/projects/project-1/group-messages",
        payload: { content: "Missing identity" },
        status: 400,
      },
      {
        method: "POST",
        url: `/api/shepherd/missions/${missionId}/cancel`,
        payload: { force: true },
        status: 400,
      },
      {
        method: "POST",
        url: "/api/shepherd/collisions/collision-1/select",
        payload: { candidateId: "../../candidate", path: "/tmp" },
        status: 400,
      },
      {
        method: "PATCH",
        url: "/api/shepherd/settings",
        payload: { mode: "production" },
        status: 400,
      },
      {
        method: "PATCH",
        url: "/api/shepherd/settings",
        payload: { retainCompletedPlanes: false },
        status: 400,
      },
      {
        method: "PATCH",
        url: "/api/shepherd/settings",
        payload: { maxConcurrentPlanes: 17 },
        status: 400,
      },
      {
        method: "GET",
        url: "/api/shepherd/projects/project-1/group-messages?limit=201",
        status: 400,
      },
    ] as const;
    for (const request of requests) {
      const response = await app.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(
        request.status,
      );
      expect(response.body).not.toContain("/etc");
      expect(response.body).not.toContain("/tmp");
    }
    await app.close();
  });

  it("maps Shepherd control conflicts and unsupported assignments to stable statuses", async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: "test" }),
      service,
      createShepherdService({
        sendProjectGroupMessage: async () => {
          throw new ShepherdControlError(
            "unsupported_assignment",
            "Only fixed assignments are supported",
          );
        },
        updateSettings: async () => {
          throw new ShepherdControlError(
            "conflict",
            "Settings cannot change while a Mission is active",
          );
        },
        cancelMission: async () => {
          throw new ShepherdControlError("not_found", "Mission was not found");
        },
      }),
    );
    const unsupported = await app.inject({
      method: "POST",
      url: "/api/shepherd/projects/project-1/group-messages",
      payload: {
        clientMessageId: "client-unsupported",
        content: "@Frontend Agent do arbitrary work",
        assignmentPreset: "auth-demo-contract",
      },
    });
    expect(unsupported.statusCode).toBe(422);
    const conflict = await app.inject({
      method: "PATCH",
      url: "/api/shepherd/settings",
      payload: { autoResolution: false },
    });
    expect(conflict.statusCode).toBe(409);
    const missing = await app.inject({
      method: "POST",
      url: `/api/shepherd/missions/${missionId}/cancel`,
      payload: {},
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
    expect(accepted.json()).toEqual({
      status: "accepted",
      missionId,
      executionMode: "deterministic",
    });
    expect(startDeterministicDemo).toHaveBeenCalledWith({});
    await enabledApp.close();
  });

  it("returns an authenticated empty demo reset without creating the fixture", async () => {
    const caseRoot = await makeAppCaseRoot();
    const managedRoot = path.join(caseRoot, "managed");
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const shepherd = new ShepherdService({
      store,
      managedRoot,
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: {
        verify: async () => {
          throw new Error("Verifier must not run during demo reset");
        },
      },
    });
    await shepherd.initialize();
    const app = await createApp(
      loadConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        APP_AUTH_TOKEN: "a-strong-reset-test-token",
        SHEPHERD_DEMO_MODE: "true",
      }),
      service,
      shepherd,
    );
    try {
      const reset = await app.inject({
        method: "POST",
        url: "/api/shepherd/demo/reset",
        headers: { authorization: "Bearer a-strong-reset-test-token" },
        payload: {},
      });

      expect(reset.statusCode).toBe(200);
      expect(reset.json()).toEqual({
        reset: true,
        projectId: "auth-demo",
        restoredHead: null,
        removedPlaneCount: 0,
        removed: {
          missions: 0,
          contracts: 0,
          planes: 0,
          claims: 0,
          collisions: 0,
          candidates: 0,
          events: 0,
          messages: 0,
        },
      });
      await expect(
        access(path.join(managedRoot, "repositories", "auth-demo")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await app.close();
      await rm(caseRoot, { recursive: true, force: true });
    }
  });

  it("authenticates and guards initialized demo reset without exposing paths", async () => {
    const resetDeterministicDemo = vi.fn(
      createShepherdService().resetDeterministicDemo,
    );
    const disabledApp = await createApp(
      loadConfig({
        NODE_ENV: "test",
        APP_AUTH_TOKEN: "a-strong-reset-test-token",
        SHEPHERD_DEMO_MODE: "false",
      }),
      service,
      createShepherdService({ resetDeterministicDemo }),
    );
    const disabled = await disabledApp.inject({
      method: "POST",
      url: "/api/shepherd/demo/reset",
      headers: { authorization: "Bearer a-strong-reset-test-token" },
      payload: {},
    });
    expect(disabled.statusCode).toBe(403);
    expect(resetDeterministicDemo).not.toHaveBeenCalled();
    await disabledApp.close();

    const enabledApp = await createApp(
      loadConfig({
        NODE_ENV: "test",
        APP_AUTH_TOKEN: "a-strong-reset-test-token",
        SHEPHERD_DEMO_MODE: "true",
      }),
      service,
      createShepherdService({ resetDeterministicDemo }),
    );
    const reset = await enabledApp.inject({
      method: "POST",
      url: "/api/shepherd/demo/reset",
      headers: { authorization: "Bearer a-strong-reset-test-token" },
      payload: {},
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({
      reset: true,
      projectId: "auth-demo",
      removedPlaneCount: 1,
    });
    expect(reset.body).not.toContain(managedRoot);
    expect(reset.body).not.toContain("removedPlanePaths");
    expect(resetDeterministicDemo).toHaveBeenCalledOnce();
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
