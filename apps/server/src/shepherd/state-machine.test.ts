import { describe, expect, it } from "vitest";
import { emptyDatabase } from "../database.js";
import type {
  ExecutionContract,
  FailureInfo,
  Mission,
  VerificationEvidence,
} from "./domain.js";
import {
  applyContractTransition,
  applyMissionTransition,
  IllegalStateTransitionError,
  transitionContractAndRecord,
  transitionMissionAndRecord,
} from "./state-machine.js";

const timestamp = "2026-08-29T12:00:00.000Z";
const later = "2026-08-29T12:00:01.000Z";

const makeFailure = (code: FailureInfo["code"] = "agent_runtime_error"): FailureInfo => ({
  code,
  message: "evidenced failure",
  stage: "test",
  at: later,
  retryable: false,
});

const makeMission = (): Mission => ({
  id: "mission-1",
  projectId: "project-1",
  originalIntent: "Build the requested feature",
  baseCommit: "abc123",
  contractIds: ["contract-1"],
  dependencyEdges: [],
  collisionIds: [],
  resolutionIds: [],
  state: "planning",
  attentionReason: null,
  failure: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  startedAt: null,
  completedAt: null,
});

const makeContract = (): ExecutionContract => ({
  id: "contract-1",
  missionId: "mission-1",
  agentId: "agent-1",
  title: "Implement transport",
  objective: "Implement a safe transport",
  contextualInputs: [],
  dependencyIds: [],
  semanticScopes: ["authentication"],
  declaredClaimKeys: ["auth.transport"],
  authority: {
    readable: ["src/**"],
    writable: ["src/**"],
    forbidden: ["src/secrets/**"],
  },
  expectedArtifacts: [
    { path: "src/client.ts", description: "Transport client", required: true },
  ],
  acceptance: {
    checks: [
      {
        id: "test",
        name: "Targeted test",
        profileId: "fixture-test",
        mandatory: true,
        timeoutMs: 30_000,
      },
    ],
    objectiveTieBreakers: [],
  },
  planeId: "plane-1",
  resultManifestPath: ".shepherd/result.json",
  manifest: null,
  verificationEvidence: [],
  state: "created",
  failure: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  startedAt: null,
  agentCompletedAt: null,
  verifiedAt: null,
  completedAt: null,
});

const makePassingEvidence = (): VerificationEvidence => ({
  id: "verification-1",
  targetType: "contract",
  targetId: "contract-1",
  runner: "independent",
  passed: true,
  checks: [
    {
      id: "test",
      name: "Targeted test",
      profileId: "fixture-test",
      mandatory: true,
      status: "passed",
      passed: true,
      exitCode: 0,
      durationMs: 20,
      stdout: "pass",
      stderr: "",
      error: null,
    },
  ],
  startedAt: timestamp,
  completedAt: later,
  durationMs: 20,
  changedFiles: ["src/client.ts"],
  summary: "All mandatory checks passed",
});

describe("Mission state machine", () => {
  it("accepts the legal lifecycle and records terminal timestamps", () => {
    const mission = makeMission();
    applyMissionTransition(mission, "queued", {
      actor: "control_plane",
      timestamp,
    });
    applyMissionTransition(mission, "running", {
      actor: "control_plane",
      timestamp: later,
    });
    applyMissionTransition(mission, "verifying", {
      actor: "control_plane",
      timestamp: later,
    });
    applyMissionTransition(mission, "completed", {
      actor: "control_plane",
      timestamp: later,
    });

    expect(mission).toMatchObject({
      state: "completed",
      startedAt: later,
      completedAt: later,
    });
  });

  it("rejects illegal, unexplained attention, and unevidenced failure states", () => {
    const mission = makeMission();
    expect(() =>
      applyMissionTransition(mission, "completed", { actor: "control_plane" }),
    ).toThrow(IllegalStateTransitionError);
    expect(() =>
      applyMissionTransition(mission, "attention_required", {
        actor: "control_plane",
      }),
    ).toThrow("needs a reason");
    expect(() =>
      applyMissionTransition(mission, "failed", { actor: "control_plane" }),
    ).toThrow("needs failure evidence");
    expect(mission.state).toBe("planning");
  });

  it("does not let a human actor impersonate the control-plane lifecycle", () => {
    const mission = makeMission();
    expect(() =>
      applyMissionTransition(mission, "queued", { actor: "human" }),
    ).toThrow(IllegalStateTransitionError);
    applyMissionTransition(mission, "cancelled", { actor: "human" });
    expect(mission.state).toBe("cancelled");
  });

  it("persists the state and event cursor together inside one database mutation", () => {
    const database = emptyDatabase(timestamp);
    database.shepherd.missions.push(makeMission());

    const event = transitionMissionAndRecord(database, "mission-1", "queued", {
      actor: "control_plane",
      eventActor: { type: "shepherd", id: null, displayName: "Shepherd" },
      timestamp: later,
    });

    expect(database.shepherd.missions[0]?.state).toBe("queued");
    expect(event).toMatchObject({ sequence: 1, missionId: "mission-1" });
    expect(database.shepherd.nextEventSequence).toBe(2);
  });
});

describe("Execution Contract state machine", () => {
  it("has no direct path from Agent completion to verified", () => {
    const contract = makeContract();
    applyContractTransition(contract, "queued", { actor: "control_plane" });
    applyContractTransition(contract, "running", { actor: "control_plane" });
    applyContractTransition(contract, "agent_completed", { actor: "agent_runtime" });

    expect(() =>
      applyContractTransition(contract, "verified", {
        actor: "agent_runtime",
        verificationEvidence: makePassingEvidence(),
      }),
    ).toThrow(IllegalStateTransitionError);
    expect(contract.state).toBe("agent_completed");
  });

  it("never lets an Agent self-certify and requires matching mandatory evidence", () => {
    const contract = makeContract();
    applyContractTransition(contract, "queued", { actor: "control_plane" });
    applyContractTransition(contract, "running", { actor: "control_plane" });
    applyContractTransition(contract, "agent_completed", { actor: "agent_runtime" });
    applyContractTransition(contract, "authority_validation", {
      actor: "control_plane",
    });
    applyContractTransition(contract, "verifying", { actor: "control_plane" });

    expect(() =>
      applyContractTransition(contract, "verified", {
        actor: "agent_runtime",
        verificationEvidence: makePassingEvidence(),
      }),
    ).toThrow(IllegalStateTransitionError);
    expect(() =>
      applyContractTransition(contract, "verified", {
        actor: "independent_verifier",
      }),
    ).toThrow("passing independent evidence");

    const failingEvidence = makePassingEvidence();
    const firstCheck = failingEvidence.checks[0];
    if (!firstCheck) throw new Error("test fixture has no check");
    firstCheck.passed = false;
    firstCheck.status = "failed";
    failingEvidence.passed = false;
    expect(() =>
      applyContractTransition(contract, "verified", {
        actor: "independent_verifier",
        verificationEvidence: failingEvidence,
      }),
    ).toThrow("passing independent evidence");

    applyContractTransition(contract, "verified", {
      actor: "independent_verifier",
      verificationEvidence: makePassingEvidence(),
      timestamp: later,
    });
    expect(contract.state).toBe("verified");
    expect(contract.verifiedAt).toBe(later);
    expect(contract.verificationEvidence).toHaveLength(1);
  });

  it("does not append an event or consume a cursor when transition validation fails", () => {
    const database = emptyDatabase(timestamp);
    database.shepherd.contracts.push(makeContract());
    transitionContractAndRecord(database, "contract-1", "queued", {
      actor: "control_plane",
      eventActor: { type: "shepherd", id: null, displayName: "Shepherd" },
      timestamp,
    });

    expect(() =>
      transitionContractAndRecord(database, "contract-1", "verified", {
        actor: "agent_runtime",
        eventActor: { type: "agent", id: "agent-1", displayName: "Agent" },
        verificationEvidence: makePassingEvidence(),
        timestamp: later,
      }),
    ).toThrow(IllegalStateTransitionError);
    expect(database.shepherd.contracts[0]?.state).toBe("queued");
    expect(database.shepherd.events).toHaveLength(1);
    expect(database.shepherd.nextEventSequence).toBe(2);
  });

  it("requires failure evidence before entering a failure terminal", () => {
    const contract = makeContract();
    applyContractTransition(contract, "queued", { actor: "control_plane" });
    applyContractTransition(contract, "running", { actor: "control_plane" });
    expect(() =>
      applyContractTransition(contract, "execution_failed", {
        actor: "control_plane",
      }),
    ).toThrow("needs failure evidence");

    applyContractTransition(contract, "execution_failed", {
      actor: "control_plane",
      failure: makeFailure(),
      timestamp: later,
    });
    expect(contract).toMatchObject({
      state: "execution_failed",
      completedAt: later,
      failure: { code: "agent_runtime_error" },
    });
  });
});
