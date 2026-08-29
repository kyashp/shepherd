import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendShepherdEvent,
  emptyDatabase,
  loadDatabase,
  shepherdEventsAfter,
} from "./database.js";
import type { ShepherdEventInput } from "./database.js";
import { JsonStore } from "./store.js";
import type { VerificationEvidence } from "./shepherd/domain.js";
import {
  AUTH_BACKEND_CHECK_ID,
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_CHECK_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_CHECK_ID,
  AUTH_PROJECT_PROFILE_ID,
} from "./shepherd/auth-fixture.js";
import type { Database } from "./types.js";

const timestamp = "2026-08-29T12:00:00.000Z";
const completedTimestamp = "2026-08-29T12:00:02.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const eventInput = (summary: string): ShepherdEventInput => ({
  timestamp,
  type: "mission_created",
  summary,
  actor: { type: "shepherd", id: null, displayName: "Shepherd" },
  missionId: "mission-1",
  contractId: null,
  agentId: null,
  planeId: null,
  collisionId: null,
  candidateId: null,
  details: {},
});

const evidence = (
  id: string,
  targetType: VerificationEvidence["targetType"],
  targetId: string,
): VerificationEvidence => ({
  id,
  targetType,
  targetId,
  runner: "independent",
  passed: true,
  checks: (targetType === "contract"
    ? [
        targetId === "contract-left"
          ? [AUTH_FRONTEND_CHECK_ID, AUTH_FRONTEND_PROFILE_ID]
          : [AUTH_BACKEND_CHECK_ID, AUTH_BACKEND_PROFILE_ID],
      ]
    : [
        [AUTH_FRONTEND_CHECK_ID, AUTH_FRONTEND_PROFILE_ID],
        [AUTH_BACKEND_CHECK_ID, AUTH_BACKEND_PROFILE_ID],
        [AUTH_PROJECT_CHECK_ID, AUTH_PROJECT_PROFILE_ID],
      ]
  ).map(([checkId, profileId]) => ({
      id: checkId!,
      name: checkId!,
      profileId: profileId!,
      mandatory: true,
      status: "passed",
      passed: true,
      exitCode: 0,
      durationMs: 10,
      stdout: "ok",
      stderr: "",
      error: null,
    })),
  startedAt: timestamp,
  completedAt: completedTimestamp,
  durationMs: 10,
  changedFiles: ["src/auth.json"],
  summary: "1/1 mandatory checks passed",
});

const fullMissionDatabase = (): Database => {
  const database = emptyDatabase(timestamp);
  database.agents.push({
    id: "agent-1",
    name: "Builder",
    description: "Builds the authentication flow",
    instructions: "Implement only the assigned contract.",
    status: "ready",
    workspacePath: "/managed/agents/agent-1",
    codexThreadId: "thread-1",
    lastError: null,
    role: "Generalist",
    authority: {
      readable: ["src/**"],
      writable: ["src/**"],
      forbidden: [".git/**", ".shepherd/**"],
    },
    currentContractId: null,
    createdAt: timestamp,
    updatedAt: completedTimestamp,
  });
  database.runs.push({
    id: "run-1",
    agentId: "agent-1",
    status: "completed",
    prompt: "Implement authentication",
    output: "Implemented",
    error: null,
    usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 4 },
    startedAt: timestamp,
    completedAt: completedTimestamp,
    createdAt: timestamp,
  });
  database.messages.push(
    {
      id: "message-1",
      agentId: "agent-1",
      runId: "run-1",
      role: "user",
      content: "Implement authentication",
      createdAt: timestamp,
    },
    {
      id: "message-2",
      agentId: "agent-1",
      runId: "run-1",
      role: "assistant",
      content: "Implemented",
      createdAt: completedTimestamp,
    },
  );

  database.shepherd.projects.push({
    id: "project-1",
    displayName: "Authentication demo",
    repositoryPath: "/managed/repositories/auth-demo",
    protectedBranch: "main",
    protectedHeadCommit: "5".repeat(40),
    activeMissionId: null,
    createdAt: timestamp,
    updatedAt: completedTimestamp,
  });
  database.shepherd.missions.push({
    id: "mission-1",
    projectId: "project-1",
    originalIntent: "Resolve the authentication transport collision",
    baseCommit: "1".repeat(40),
    contractIds: ["contract-left", "contract-right"],
    dependencyEdges: [],
    collisionIds: ["collision-1"],
    resolutionIds: ["collision-1"],
    state: "completed",
    attentionReason: null,
    failure: null,
    createdAt: timestamp,
    updatedAt: completedTimestamp,
    startedAt: timestamp,
    completedAt: completedTimestamp,
  });

  const makeContract = (
    id: string,
    planeId: string,
    claimValue: string,
    evidenceId: string,
  ): Database["shepherd"]["contracts"][number] => ({
    id,
    missionId: "mission-1",
    agentId: "agent-1",
    title: `Contract ${id}`,
    objective: "Implement authentication transport",
    contextualInputs: [],
    dependencyIds: [],
    semanticScopes: ["authentication"],
    declaredClaimKeys: ["auth.transport"],
    authority: {
      readable: ["src/**"],
      writable: ["src/**"],
      forbidden: [".git/**", ".shepherd/**"],
    },
    expectedArtifacts: [
      { path: "src/auth.json", description: "Authentication config", required: true },
    ],
    acceptance: {
      checks: [
        {
          id: id === "contract-left" ? AUTH_FRONTEND_CHECK_ID : AUTH_BACKEND_CHECK_ID,
          name: "Security acceptance",
          profileId:
            id === "contract-left"
              ? AUTH_FRONTEND_PROFILE_ID
              : AUTH_BACKEND_PROFILE_ID,
          mandatory: true,
          timeoutMs: 5_000,
        },
      ],
      objectiveTieBreakers: ["security-first"],
    },
    planeId,
    resultManifestPath: ".shepherd/result.json",
    manifest: {
      schemaVersion: 1,
      contractId: id,
      summary: "Implemented authentication",
      artifacts: [
        { path: "src/auth.json", kind: "changed", description: "Auth config" },
      ],
      semanticClaims: [
        {
          key: "auth.transport",
          value: claimValue,
          scope: "authentication",
          mode: "exclusive",
          evidence: [{ path: "src/auth.json", description: "Transport value", line: 1 }],
        },
      ],
      agentDeclaredTests: [
        { name: "agent smoke", passed: true, summary: "Informational only" },
      ],
      notes: "",
    },
    verificationEvidence: [evidence(evidenceId, "contract", id)],
    state: "verified",
    failure: null,
    createdAt: timestamp,
    updatedAt: completedTimestamp,
    startedAt: timestamp,
    agentCompletedAt: completedTimestamp,
    verifiedAt: completedTimestamp,
    completedAt: completedTimestamp,
  });
  database.shepherd.contracts.push(
    makeContract("contract-left", "plane-left", "bearer-jwt", "evidence-left"),
    makeContract(
      "contract-right",
      "plane-right",
      "http-only-session-cookie",
      "evidence-right",
    ),
  );

  const leftClaim: Database["shepherd"]["claims"][number] = {
    id: "claim-left",
    missionId: "mission-1",
    contractId: "contract-left",
    key: "auth.transport",
    value: "bearer-jwt",
    scope: "authentication",
    mode: "exclusive",
    evidence: [{ path: "src/auth.json", description: "Transport value", line: 1 }],
    valid: true,
    rejectionReason: null,
    createdAt: timestamp,
  };
  const rightClaim: Database["shepherd"]["claims"][number] = {
    ...leftClaim,
    id: "claim-right",
    contractId: "contract-right",
    value: "http-only-session-cookie",
  };
  database.shepherd.claims.push(leftClaim, rightClaim);

  const authority = {
    readable: ["src/**"],
    writable: ["src/**"],
    forbidden: [".git/**", ".shepherd/**"],
  };
  database.shepherd.planes.push(
    {
      id: "plane-left",
      projectId: "project-1",
      missionId: "mission-1",
      kind: "contract",
      contractId: "contract-left",
      candidateId: null,
      branch: "shepherd/left",
      worktreePath: "/managed/planes/left",
      baseCommit: "1".repeat(40),
      headCommit: "2".repeat(40),
      purpose: "Contract execution",
      executionIdentity: "execution-left",
      authority,
      state: "verified",
      changedFiles: ["src/auth.json"],
      diffSummary: "1 file changed",
      verificationEvidenceIds: ["evidence-left"],
      createdAt: timestamp,
      updatedAt: completedTimestamp,
      destroyedAt: null,
      error: null,
    },
    {
      id: "plane-right",
      projectId: "project-1",
      missionId: "mission-1",
      kind: "contract",
      contractId: "contract-right",
      candidateId: null,
      branch: "shepherd/right",
      worktreePath: "/managed/planes/right",
      baseCommit: "1".repeat(40),
      headCommit: "3".repeat(40),
      purpose: "Contract execution",
      executionIdentity: "execution-right",
      authority,
      state: "verified",
      changedFiles: ["src/auth.json"],
      diffSummary: "1 file changed",
      verificationEvidenceIds: ["evidence-right"],
      createdAt: timestamp,
      updatedAt: completedTimestamp,
      destroyedAt: null,
      error: null,
    },
    {
      id: "plane-integration",
      projectId: "project-1",
      missionId: "mission-1",
      kind: "integration",
      contractId: null,
      candidateId: null,
      branch: "shepherd/integration",
      worktreePath: "/managed/planes/integration",
      baseCommit: "1".repeat(40),
      headCommit: "4".repeat(40),
      purpose: "Integrate verified contracts",
      executionIdentity: "execution-integration",
      authority,
      state: "verified",
      changedFiles: ["src/auth.json"],
      diffSummary: "2 files changed",
      verificationEvidenceIds: [],
      createdAt: timestamp,
      updatedAt: completedTimestamp,
      destroyedAt: null,
      error: null,
    },
    ...(["candidate-a", "candidate-b"] as const).map((candidateId) => ({
      id: `plane-${candidateId}`,
      projectId: "project-1",
      missionId: "mission-1",
      kind: "resolution" as const,
      contractId: null,
      candidateId,
      branch: `shepherd/${candidateId}`,
      worktreePath: `/managed/planes/${candidateId}`,
      baseCommit: "4".repeat(40),
      headCommit: (candidateId === "candidate-a" ? "5" : "6").repeat(40),
      purpose: "Resolve semantic collision",
      executionIdentity: `execution-${candidateId}`,
      authority,
      state: "verified" as const,
      changedFiles: ["src/auth.json"],
      diffSummary: "1 file changed",
      verificationEvidenceIds:
        candidateId === "candidate-a"
          ? ["evidence-candidate-a", "evidence-promotion-a"]
          : ["evidence-candidate-b"],
      createdAt: timestamp,
      updatedAt: completedTimestamp,
      destroyedAt: null,
      error: null,
    })),
  );

  database.shepherd.collisions.push({
    id: "collision-1",
    missionId: "mission-1",
    key: "auth.transport",
    scope: "authentication",
    leftContractId: "contract-left",
    rightContractId: "contract-right",
    leftClaimId: "claim-left",
    rightClaimId: "claim-right",
    leftClaim: structuredClone(leftClaim),
    rightClaim: structuredClone(rightClaim),
    reason: "Exclusive semantic values disagree",
    detectionMechanism: "deterministic",
    candidateIds: ["candidate-a", "candidate-b"],
    state: "resolved",
    createdAt: timestamp,
    updatedAt: completedTimestamp,
    resolvedAt: completedTimestamp,
  });

  database.shepherd.candidates.push(
    {
      id: "candidate-a",
      missionId: "mission-1",
      collisionId: "collision-1",
      strategy: "Use secure session cookie",
      targetKey: "auth.transport",
      targetValue: "http-only-session-cookie",
      planeId: "plane-candidate-a",
      executionState: "passed",
      selectionState: "selected",
      promotionState: "promoted",
      verificationEvidence: evidence("evidence-candidate-a", "candidate", "candidate-a"),
      promotionEvidence: evidence("evidence-promotion-a", "promotion", "candidate-a"),
      changedFiles: ["src/auth.json"],
      diffSummary: "1 file changed",
      result: "Promoted http-only-session-cookie",
      retryCount: 0,
      failure: null,
      createdAt: timestamp,
      updatedAt: completedTimestamp,
    },
    {
      id: "candidate-b",
      missionId: "mission-1",
      collisionId: "collision-1",
      strategy: "Use bearer token",
      targetKey: "auth.transport",
      targetValue: "bearer-jwt",
      planeId: "plane-candidate-b",
      executionState: "passed",
      selectionState: "rejected",
      promotionState: "not_started",
      verificationEvidence: evidence("evidence-candidate-b", "candidate", "candidate-b"),
      promotionEvidence: null,
      changedFiles: ["src/auth.json"],
      diffSummary: "1 file changed",
      result: null,
      retryCount: 0,
      failure: null,
      createdAt: timestamp,
      updatedAt: completedTimestamp,
    },
  );

  appendShepherdEvent(database, {
    ...eventInput("Mission created"),
    agentId: "agent-1",
    details: { projectId: "project-1" },
  });
  appendShepherdEvent(database, {
    ...eventInput("Mission completed"),
    timestamp: completedTimestamp,
    type: "mission_completed",
    planeId: "plane-candidate-a",
    collisionId: "collision-1",
    candidateId: "candidate-a",
  });
  database.shepherd.groupMessages.push({
    id: "group-message-1",
    projectId: "project-1",
    missionId: "mission-1",
    senderType: "agent",
    senderId: "agent-1",
    content: "Authentication resolution completed",
    targetAgentId: null,
    contractId: "contract-left",
    createdAt: completedTimestamp,
  });
  return database;
};

const completedNoCollisionDatabase = (): Database => {
  const database = fullMissionDatabase();
  const mission = database.shepherd.missions[0]!;
  const project = database.shepherd.projects[0]!;
  const integration = database.shepherd.planes.find(
    (plane) => plane.kind === "integration",
  )!;
  mission.collisionIds = [];
  mission.resolutionIds = [];
  database.shepherd.collisions = [];
  database.shepherd.candidates = [];
  database.shepherd.planes = database.shepherd.planes.filter(
    (plane) => plane.kind !== "resolution",
  );
  project.protectedHeadCommit = integration.headCommit!;
  const completionEvent = database.shepherd.events.find(
    (event) => event.type === "mission_completed",
  )!;
  completionEvent.planeId = integration.id;
  completionEvent.collisionId = null;
  completionEvent.candidateId = null;
  return database;
};

describe("Database V2", () => {
  it("migrates a captured V1 fixture without changing any legacy value", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL("./test-fixtures/database-v1.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const originalLegacyValues = {
      agents: structuredClone(raw.agents),
      messages: structuredClone(raw.messages),
      runs: structuredClone(raw.runs),
    };

    const loaded = loadDatabase(raw, timestamp);

    expect(loaded.migrated).toBe(true);
    expect(loaded.database.version).toBe(2);
    expect({
      agents: loaded.database.agents,
      messages: loaded.database.messages,
      runs: loaded.database.runs,
    }).toEqual(originalLegacyValues);
    expect(loaded.database.shepherd).toMatchObject({
      projects: [],
      missions: [],
      contracts: [],
      planes: [],
      claims: [],
      collisions: [],
      candidates: [],
      events: [],
      groupMessages: [],
      nextEventSequence: 1,
      settings: { updatedAt: timestamp },
    });
    expect(raw.version).toBe(1);
  });

  it.each([
    ["malformed Agent", { version: 1, agents: [null], messages: [], runs: [] }],
    [
      "orphan Run",
      {
        version: 1,
        agents: [],
        messages: [],
        runs: [
          {
            id: "run-1",
            agentId: "missing-agent",
            status: "completed",
            prompt: "prompt",
            output: "output",
            error: null,
            usage: null,
            startedAt: timestamp,
            completedAt: completedTimestamp,
            createdAt: timestamp,
          },
        ],
      },
    ],
  ])("rejects hostile V1 state: %s", (_name, database) => {
    expect(() => loadDatabase(database)).toThrow(
      "Unsupported database format: invalid version 1 state",
    );
  });

  it("round-trips V2 state without treating it as a migration", () => {
    const database = emptyDatabase(timestamp);
    const event = appendShepherdEvent(database, {
      ...eventInput("created"),
      missionId: null,
    });

    const loaded = loadDatabase(database, "unused");

    expect(loaded).toEqual({ database, migrated: false });
    expect(loaded.database).not.toBe(database);
    expect(event.sequence).toBe(1);
  });

  it("rejects truncated and unsupported databases instead of silently resetting", () => {
    expect(() => loadDatabase({ version: 1, agents: [] })).toThrow(
      "legacy collections must be arrays",
    );
    expect(() =>
      loadDatabase({ version: 2, agents: [], messages: [], runs: [] }),
    ).toThrow("invalid version 2 state");
    expect(() =>
      loadDatabase({ version: 99, agents: [], messages: [], runs: [] }),
    ).toThrow("expected version 1 or 2");
  });

  it("allocates monotonic polling cursors and returns bounded ordered pages", () => {
    const database = emptyDatabase(timestamp);
    appendShepherdEvent(database, eventInput("one"));
    appendShepherdEvent(database, eventInput("two"));
    appendShepherdEvent(database, eventInput("three"));

    expect(database.shepherd.nextEventSequence).toBe(4);
    expect(shepherdEventsAfter(database, 1, 1).map((event) => event.summary)).toEqual([
      "two",
    ]);
    expect(shepherdEventsAfter(database, 1).map((event) => event.sequence)).toEqual([
      2, 3,
    ]);
    expect(() => shepherdEventsAfter(database, -1)).toThrow("non-negative");
  });

  it("accepts reset-created event gaps without reusing a polling cursor", () => {
    const database = emptyDatabase(timestamp);
    appendShepherdEvent(database, { ...eventInput("one"), missionId: null });
    appendShepherdEvent(database, { ...eventInput("removed two"), missionId: null });
    appendShepherdEvent(database, { ...eventInput("removed three"), missionId: null });
    database.shepherd.events.splice(1);

    const loaded = loadDatabase(database);
    expect(loaded.database.shepherd.nextEventSequence).toBe(4);
    const appended = appendShepherdEvent(loaded.database, {
      ...eventInput("after reset"),
      missionId: null,
    });

    expect(appended.sequence).toBe(4);
    expect(loaded.database.shepherd.nextEventSequence).toBe(5);
    expect(shepherdEventsAfter(loaded.database, 1)).toMatchObject([
      { sequence: 4, summary: "after reset" },
    ]);
  });

  it("bounds event summaries and safe detail fields before persistence", () => {
    const database = emptyDatabase(timestamp);
    const event = appendShepherdEvent(database, {
      ...eventInput("x".repeat(700)),
      details: Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [
          `field-${index}`,
          "y".repeat(2_500),
        ]),
      ),
    });

    expect(event.summary.length).toBe(500);
    expect(Object.keys(event.details)).toHaveLength(32);
    expect(String(event.details["field-0"]).length).toBe(2_000);
  });

  it("loads and republishes a complete, referentially consistent Mission", async () => {
    const database = fullMissionDatabase();
    expect(loadDatabase(database)).toEqual({ database, migrated: false });

    const root = path.resolve(process.cwd(), ".tmp", "database-schema-tests");
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(path.join(root, "case-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "state.json");
    await writeFile(databasePath, JSON.stringify(database), "utf8");

    const store = new JsonStore(databasePath);
    await store.initialize();

    expect(store.snapshot()).toEqual(database);
    expect(JSON.parse(await readFile(databasePath, "utf8"))).toEqual(database);
  });

  it.each([
    ["unsafe identifier", (database: Database) => (database.shepherd.projects[0]!.id = "../secret")],
    ["invalid timestamp", (database: Database) => (database.shepherd.missions[0]!.updatedAt = "yesterday")],
    ["invalid Mission state", (database: Database) => ((database.shepherd.missions[0] as { state: string }).state = "done")],
    ["invalid contract state", (database: Database) => ((database.shepherd.contracts[0] as { state: string }).state = "approved")],
    ["invalid Plane state", (database: Database) => ((database.shepherd.planes[0] as { state: string }).state = "mounted")],
    ["malformed runtime session fingerprint", (database: Database) => (database.shepherd.planes[0]!.runtimeSessionFingerprint = "raw-thread-id")],
    ["malformed authority", (database: Database) => ((database.shepherd.contracts[0]!.authority as unknown as { writable: unknown }).writable = "src/**")],
    ["absolute authority pattern", (database: Database) => (database.shepherd.contracts[0]!.authority.readable = ["/etc/passwd"])],
    ["traversing expected artifact", (database: Database) => (database.shepherd.contracts[0]!.expectedArtifacts[0]!.path = "../escape")],
    ["non-canonical evidence path", (database: Database) => (database.shepherd.contracts[0]!.manifest!.semanticClaims[0]!.evidence[0]!.path = "src\\auth.json")],
    ["absolute changed file", (database: Database) => (database.shepherd.planes[0]!.changedFiles = ["/etc/passwd"])],
    ["relative host workspace", (database: Database) => (database.agents[0]!.workspacePath = "relative/agent")],
    ["unsafe Git branch", (database: Database) => (database.shepherd.planes[0]!.branch = "bad..branch")],
    ["abbreviated Git object ID", (database: Database) => (database.shepherd.projects[0]!.protectedHeadCommit = "abc123")],
    ["malformed evidence", (database: Database) => ((database.shepherd.contracts[0]!.verificationEvidence[0]!.checks[0] as { status: string }).status = "successful")],
    ["candidate proof missing project acceptance", (database: Database) => {
      const candidate = database.shepherd.candidates[0]!;
      candidate.verificationEvidence!.checks = candidate.verificationEvidence!.checks.filter(
        (check) => check.id !== AUTH_PROJECT_CHECK_ID,
      );
    }],
    ["promotion proof substitutes a required profile", (database: Database) => {
      database.shepherd.candidates[0]!.promotionEvidence!.checks[0]!.profileId = "substituted-profile";
    }],
    ["candidate proof adds an unknown mandatory check", (database: Database) => {
      const candidate = database.shepherd.candidates[0]!;
      candidate.verificationEvidence!.checks.push({
        ...candidate.verificationEvidence!.checks[0]!,
        id: "unknown-extra",
        profileId: "unknown-profile",
      });
    }],
    ["too-low Plane concurrency", (database: Database) => ((database.shepherd.settings as { maxConcurrentPlanes: number }).maxConcurrentPlanes = 1)],
    ["too-high Plane concurrency", (database: Database) => ((database.shepherd.settings as { maxConcurrentPlanes: number }).maxConcurrentPlanes = 17)],
    ["malformed event details", (database: Database) => ((database.shepherd.events[0]!.details as Record<string, unknown>).nested = { secret: true })],
    ["unexpected nested field", (database: Database) => ((database.shepherd.settings as unknown as Record<string, unknown>).credential = "DATABASE_CANARY_7f3a")],
    ["orphan legacy Run", (database: Database) => (database.runs[0]!.agentId = "missing-agent")],
    ["message linked to another Agent's Run", (database: Database) => {
      database.agents.push({
        ...database.agents[0]!,
        id: "agent-2",
        workspacePath: "/managed/agents/agent-2",
      });
      database.messages[0]!.agentId = "agent-2";
    }],
  ])("rejects hostile V2 shape: %s", (_name, mutate) => {
    const database = fullMissionDatabase();
    mutate(database);

    expect(() => loadDatabase(database)).toThrow(
      "Unsupported database format: invalid version 2 state",
    );
    try {
      loadDatabase(database);
    } catch (error) {
      expect(String(error)).not.toContain("DATABASE_CANARY_7f3a");
      expect(String(error).length).toBeLessThan(100);
    }
  });

  it.each([
    ["duplicate entity ID", (database: Database) => {
      database.shepherd.events[1]!.id = database.shepherd.events[0]!.id;
    }],
    ["duplicate Plane execution identity", (database: Database) => {
      database.shepherd.planes[1]!.executionIdentity =
        database.shepherd.planes[0]!.executionIdentity;
    }],
    ["duplicate runtime session fingerprint", (database: Database) => {
      const fingerprint = "a".repeat(64);
      database.shepherd.planes[0]!.runtimeSessionFingerprint = fingerprint;
      database.shepherd.planes[1]!.runtimeSessionFingerprint = fingerprint;
    }],
    ["duplicate event sequence", (database: Database) => {
      database.shepherd.events[1]!.sequence = database.shepherd.events[0]!.sequence;
    }],
    ["out-of-order event sequence", (database: Database) => {
      database.shepherd.events[0]!.sequence = 2;
      database.shepherd.events[1]!.sequence = 1;
    }],
    ["inconsistent next event sequence", (database: Database) => {
      database.shepherd.nextEventSequence =
        database.shepherd.events.at(-1)?.sequence ?? 1;
    }],
    ["missing Project reference", (database: Database) => {
      database.shepherd.missions[0]!.projectId = "project-missing";
    }],
    ["missing Contract reference", (database: Database) => {
      database.shepherd.missions[0]!.contractIds[0] = "contract-missing";
    }],
    ["missing Plane reference", (database: Database) => {
      database.shepherd.contracts[0]!.planeId = "plane-missing";
    }],
    ["missing Claim reference", (database: Database) => {
      database.shepherd.collisions[0]!.leftClaimId = "claim-missing";
    }],
    ["missing Collision reference", (database: Database) => {
      database.shepherd.candidates[0]!.collisionId = "collision-missing";
    }],
    ["missing Candidate reference", (database: Database) => {
      database.shepherd.collisions[0]!.candidateIds[0] = "candidate-missing";
    }],
    ["missing Event reference", (database: Database) => {
      database.shepherd.events[1]!.planeId = "plane-missing";
    }],
    ["completed Mission marked active", (database: Database) => {
      database.shepherd.projects[0]!.activeMissionId = "mission-1";
    }],
    ["active Mission pointer missing", (database: Database) => {
      database.shepherd.missions[0]!.state = "running";
    }],
  ])("rejects corrupt V2 invariant: %s", (_name, mutate) => {
    const database = fullMissionDatabase();
    mutate(database);
    expect(() => loadDatabase(database)).toThrow("invalid version 2 state");
  });

  it("rejects an evidence-free zero-contract Mission labeled completed", () => {
    const database = emptyDatabase(timestamp);
    database.shepherd.projects.push({
      id: "empty-project",
      displayName: "Empty project",
      repositoryPath: "/managed/empty-project",
      protectedBranch: "main",
      protectedHeadCommit: "a".repeat(40),
      activeMissionId: null,
      createdAt: timestamp,
      updatedAt: completedTimestamp,
    });
    database.shepherd.missions.push({
      id: "empty-mission",
      projectId: "empty-project",
      originalIntent: "Claim completion without work",
      baseCommit: "a".repeat(40),
      contractIds: [],
      dependencyEdges: [],
      collisionIds: [],
      resolutionIds: [],
      state: "completed",
      attentionReason: null,
      failure: null,
      createdAt: timestamp,
      updatedAt: completedTimestamp,
      startedAt: timestamp,
      completedAt: completedTimestamp,
    });
    appendShepherdEvent(database, {
      ...eventInput("Unsupported completion"),
      missionId: "empty-mission",
      timestamp: completedTimestamp,
      type: "mission_completed",
    });

    expect(() => loadDatabase(database)).toThrow("invalid version 2 state");
  });

  it("accepts no-collision completion only when the verified integration head was promoted", () => {
    const database = completedNoCollisionDatabase();
    expect(loadDatabase(database).database).toEqual(database);

    database.shepherd.projects[0]!.protectedHeadCommit = "f".repeat(40);
    expect(() => loadDatabase(database)).toThrow("invalid version 2 state");
  });

  it.each([
    ["verified Contract with no mandatory acceptance", (database: Database) => {
      database.shepherd.contracts[0]!.acceptance.checks = [];
    }],
    ["verified Contract evidence for unrelated changed files", (database: Database) => {
      database.shepherd.contracts[0]!.verificationEvidence[0]!.changedFiles = [
        "src/unrelated.ts",
      ];
    }],
    ["verified Plane with an invented evidence ID", (database: Database) => {
      database.shepherd.planes[0]!.verificationEvidenceIds = ["invented-evidence"];
    }],
    ["promoted Candidate without final promotion evidence", (database: Database) => {
      database.shepherd.candidates[0]!.promotionEvidence = null;
    }],
    ["Candidate evidence disconnected from its Plane diff", (database: Database) => {
      const candidate = database.shepherd.candidates[0]!;
      candidate.changedFiles = ["src/alternate.ts"];
      candidate.verificationEvidence!.changedFiles = ["src/alternate.ts"];
      candidate.promotionEvidence!.changedFiles = ["src/alternate.ts"];
    }],
    ["passed Candidate whose Plane omits its evidence", (database: Database) => {
      const candidate = database.shepherd.candidates[1]!;
      database.shepherd.planes.find((plane) => plane.id === candidate.planeId)!
        .verificationEvidenceIds = [];
    }],
    ["completed collision based on an invalid semantic claim", (database: Database) => {
      const claim = database.shepherd.claims[0]!;
      claim.valid = false;
      claim.rejectionReason = "rejected evidence";
      database.shepherd.collisions[0]!.leftClaim = structuredClone(claim);
    }],
    ["collision embeds a substituted semantic value", (database: Database) => {
      database.shepherd.collisions[0]!.leftClaim.value = "substituted-value";
    }],
    ["Candidate targets an unrelated semantic key", (database: Database) => {
      database.shepherd.candidates[0]!.targetKey = "unrelated.key";
    }],
    ["Candidate targets a value outside the collision", (database: Database) => {
      database.shepherd.candidates[0]!.targetValue = "unrelated-value";
    }],
    ["verified semantic claim disconnected from its manifest", (database: Database) => {
      const claim = database.shepherd.claims[0]!;
      claim.value = "substituted-value";
      database.shepherd.collisions[0]!.leftClaim = structuredClone(claim);
    }],
    ["in-flight promotion without candidate proof", (database: Database) => {
      const candidate = database.shepherd.candidates[0]!;
      candidate.promotionState = "promoting";
      candidate.promotionEvidence = null;
      candidate.verificationEvidence = null;
      database.shepherd.planes.find((plane) => plane.id === candidate.planeId)!
        .verificationEvidenceIds = [];
    }],
    ["in-flight promotion whose parents are already terminal", (database: Database) => {
      const candidate = database.shepherd.candidates[0]!;
      candidate.promotionState = "reverifying";
      candidate.promotionEvidence = null;
      candidate.result = null;
      database.shepherd.planes.find((plane) => plane.id === candidate.planeId)!
        .verificationEvidenceIds = [candidate.verificationEvidence!.id];
    }],
    ["promoted Candidate whose Mission and Collision are still resolving", (database: Database) => {
      database.shepherd.missions[0]!.state = "resolving";
      database.shepherd.missions[0]!.completedAt = null;
      database.shepherd.projects[0]!.activeMissionId = "mission-1";
      database.shepherd.collisions[0]!.state = "resolving";
      database.shepherd.collisions[0]!.resolvedAt = null;
    }],
    ["collision sourced from a non-verified Contract", (database: Database) => {
      const mission = database.shepherd.missions[0]!;
      const collision = database.shepherd.collisions[0]!;
      const candidate = database.shepherd.candidates[0]!;
      const contract = database.shepherd.contracts.find(
        (item) => item.id === collision.leftContractId,
      )!;
      const contractPlane = database.shepherd.planes.find(
        (plane) => plane.id === contract.planeId,
      )!;
      const integrationPlane = database.shepherd.planes.find(
        (plane) => plane.kind === "integration",
      )!;
      const candidatePlane = database.shepherd.planes.find(
        (plane) => plane.id === candidate.planeId,
      )!;

      mission.state = "resolving";
      mission.completedAt = null;
      database.shepherd.projects[0]!.activeMissionId = mission.id;
      collision.state = "resolving";
      collision.resolvedAt = null;
      candidate.promotionState = "reverifying";
      candidate.promotionEvidence = null;
      candidate.result = null;
      candidatePlane.verificationEvidenceIds = [candidate.verificationEvidence!.id];
      contract.state = "cancelled";
      contract.verifiedAt = null;
      contractPlane.state = "destroyed";
      contractPlane.destroyedAt = completedTimestamp;
      integrationPlane.state = "inspecting";
    }],
    ["two selected Candidates for one collision", (database: Database) => {
      database.shepherd.candidates[1]!.selectionState = "selected";
    }],
    ["completed Mission without a completion event", (database: Database) => {
      database.shepherd.events = database.shepherd.events.filter(
        (event) => event.type !== "mission_completed",
      );
      database.shepherd.nextEventSequence = 2;
    }],
  ])("rejects false-green lifecycle state: %s", (_name, mutate) => {
    const database = fullMissionDatabase();
    mutate(database);
    expect(() => loadDatabase(database)).toThrow("invalid version 2 state");
  });
});
