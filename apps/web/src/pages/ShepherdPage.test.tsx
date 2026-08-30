import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  Agent,
  ExecutionContract,
  Mission,
  ResolutionCandidate,
  ShepherdEvent,
  ShepherdState,
  VerificationEvidence,
} from "../types";
import { useShepherdPolling } from "../shepherd-hooks";
import {
  CandidateEvidencePanel,
  ExecutionContractPanel,
  ShepherdPage,
  candidateEvidenceStages,
  eventEvidencePresentation,
} from "./ShepherdPage";

vi.mock("../shepherd-hooks", () => ({
  useShepherdPolling: vi.fn(),
}));

function evidence(targetType: VerificationEvidence["targetType"], summary: string): VerificationEvidence {
  return {
    id: `evidence-${targetType}`,
    targetType,
    targetId: `target-${targetType}`,
    runner: "independent",
    passed: true,
    checks: [],
    startedAt: "2026-08-30T00:00:00.000Z",
    completedAt: "2026-08-30T00:00:01.000Z",
    durationMs: 1_000,
    changedFiles: [],
    summary,
  };
}

function candidate(overrides: Partial<ResolutionCandidate> = {}): ResolutionCandidate {
  return {
    id: "candidate-1",
    missionId: "mission-1",
    collisionId: "collision-1",
    strategy: "Resolve safely",
    targetKey: "auth.transport",
    targetValue: "cookie",
    planeId: "plane-1",
    executionState: "passed",
    selectionState: "selected",
    promotionState: "promoted",
    verificationEvidence: evidence("candidate", "candidate marker"),
    promotionEvidence: evidence("promotion", "promotion marker"),
    changedFiles: [],
    diffSummary: "Safe change",
    result: "done",
    retryCount: 0,
    failure: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:01.000Z",
    ...overrides,
  };
}

const event = (type: ShepherdEvent["type"]): Pick<ShepherdEvent, "type"> => ({ type });

describe("Shepherd evidence presentation", () => {
  it("surfaces an ordinary unauthorized-diff Mission failure and the no-promotion outcome", () => {
    const timestamp = "2026-08-30T00:00:00.000Z";
    const mission: Mission = {
      id: "mission-denied-1",
      projectId: "project-1",
      originalIntent: "Attempt an unauthorized change",
      baseCommit: "1111111111111111111111111111111111111111",
      contractIds: ["contract-denied-1"],
      dependencyEdges: [],
      collisionIds: [],
      resolutionIds: [],
      state: "failed",
      attentionReason: null,
      failure: {
        code: "unknown",
        message: "Scoped authority denied contract changes",
        stage: "background_demo",
        at: timestamp,
        retryable: false,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      completedAt: timestamp,
    };
    const deniedContract: ExecutionContract = {
      id: "contract-denied-1",
      missionId: mission.id,
      agentId: "11111111-1111-4111-8111-111111111111",
      title: "Implement frontend authentication transport",
      objective: "Change only the delegated frontend artifact.",
      contextualInputs: [],
      dependencyIds: [],
      semanticScopes: ["authentication"],
      declaredClaimKeys: ["auth.transport"],
      authority: {
        readable: ["**"],
        writable: ["src/frontend/**"],
        forbidden: [".git/**", ".shepherd/**"],
      },
      expectedArtifacts: [],
      acceptance: { checks: [], objectiveTieBreakers: [] },
      planeId: "plane-denied-1",
      resultManifestPath: ".shepherd/result.json",
      verificationEvidence: [],
      state: "authority_denied",
      failure: {
        code: "unauthorized_file_change",
        message: "Actual changes exceeded the Contract's scoped authority",
        stage: "contract_authority",
        at: timestamp,
        retryable: false,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: timestamp,
      agentCompletedAt: timestamp,
      verifiedAt: null,
      completedAt: timestamp,
    };
    const state: ShepherdState = {
      projects: [{
        id: mission.projectId,
        displayName: "Authentication demo",
        protectedBranch: "main",
        protectedHeadCommit: mission.baseCommit,
        activeMissionId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      missions: [mission],
      contracts: [deniedContract],
      planes: [],
      claims: [],
      collisions: [],
      candidates: [],
      events: [],
      groupMessages: [],
      settings: {
        mode: "deterministic_test",
        contractTimeoutMs: 30_000,
        candidateTimeoutMs: 30_000,
        autoResolution: true,
        maxConcurrentPlanes: 2,
        retainCompletedPlanes: true,
        modelReviewEnabled: false,
        notifications: {
          missionCompleted: false,
          attentionRequired: false,
          collisionDetected: false,
        },
        updatedAt: timestamp,
      },
      nextEventSequence: 1,
    };
    vi.mocked(useShepherdPolling).mockReturnValue({
      state,
      events: [],
      error: null,
      loading: false,
      lastUpdated: new Date(timestamp),
      refresh: vi.fn(async () => undefined),
      connected: true,
    });

    const markup = renderToStaticMarkup(
      createElement(ShepherdPage, { agents: [], search: "" }),
    );

    expect(markup).toContain("Unauthorized changes denied");
    expect(markup).toContain("Actual changes exceeded the Contract&#x27;s scoped authority");
    expect(markup).toContain("Unauthorized File Change");
    expect(markup).toContain("Contract Authority");
    expect(markup).toContain('title="contract-denied-1"');
    expect(markup).toContain("Protected promotion not started");
  });

  it("renders the complete public Agent execution contract with existing evidence context", () => {
    const contract: ExecutionContract = {
      id: "contract-front-1",
      missionId: "mission-1",
      agentId: "11111111-1111-4111-8111-111111111111",
      title: "Implement frontend authentication transport",
      objective: "Use an HttpOnly session cookie.",
      contextualInputs: [{ name: "policy", value: "secure", sourceContractId: null }],
      dependencyIds: [],
      semanticScopes: ["authentication"],
      declaredClaimKeys: ["auth.transport"],
      authority: {
        readable: ["**"],
        writable: ["src/frontend/**"],
        forbidden: [".git/**", ".shepherd/**"],
      },
      expectedArtifacts: [{
        path: "src/frontend/auth.json",
        description: "Authentication transport configuration",
        required: true,
      }],
      acceptance: {
        checks: [{
          id: "frontend-contract",
          name: "Frontend authentication contract",
          profileId: "auth-frontend",
          mandatory: true,
          timeoutMs: 30_000,
        }],
        objectiveTieBreakers: [],
      },
      planeId: "plane-1",
      resultManifestPath: ".shepherd/result.json",
      verificationEvidence: [],
      state: "verified",
      failure: null,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:01.000Z",
      startedAt: "2026-08-30T00:00:00.100Z",
      agentCompletedAt: "2026-08-30T00:00:00.500Z",
      verifiedAt: "2026-08-30T00:00:01.000Z",
      completedAt: "2026-08-30T00:00:01.000Z",
    };
    const agent: Agent = {
      id: contract.agentId,
      name: "My Frontend Agent",
      description: "",
      instructions: "",
      status: "ready",
      lastError: null,
      role: "Frontend",
      authority: contract.authority,
      currentContractId: null,
      createdAt: contract.createdAt,
      updatedAt: contract.updatedAt,
    };
    const markup = renderToStaticMarkup(
      createElement(ExecutionContractPanel, { contract, agent }),
    );
    for (const visibleText of [
      "Agent execution contract",
      "My Frontend Agent",
      "Use an HttpOnly session cookie.",
      "auth.transport",
      "src/frontend/**",
      "src/frontend/auth.json",
      "auth-frontend",
      ".shepherd/result.json",
    ]) {
      expect(markup).toContain(visibleText);
    }
  });

  it("selects final evidence only for completed promotion events", () => {
    const item = candidate();
    expect(eventEvidencePresentation(event("promotion_completed"), null, item)).toMatchObject({
      label: "Final promotion re-verification",
      evidence: { summary: "promotion marker" },
    });
    expect(eventEvidencePresentation(event("promotion_started"), null, item)).toBeNull();
  });

  it("keeps candidate events bound to candidate verification", () => {
    expect(eventEvidencePresentation(event("candidate_passed"), null, candidate())).toMatchObject({
      label: "Candidate verification",
      evidence: { summary: "candidate marker" },
    });
  });

  it("orders both drawer stages with candidate verification as the safe default", () => {
    expect(candidateEvidenceStages(candidate()).map((stage) => [stage.id, stage.evidence.summary])).toEqual([
      ["candidate", "candidate marker"],
      ["promotion", "promotion marker"],
    ]);
    const markup = renderToStaticMarkup(
      createElement(CandidateEvidencePanel, { candidate: candidate(), planeId: "plane-1" }),
    );
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("Candidate verification");
    expect(markup).toContain("Final promotion re-verification");
    expect(markup).toContain("candidate marker");
    expect(markup).not.toContain("promotion marker");
  });

  it("gracefully renders either single stage and none", () => {
    const promotionOnly = candidate({ verificationEvidence: null });
    const markup = renderToStaticMarkup(
      createElement(CandidateEvidencePanel, { candidate: promotionOnly, planeId: "plane-2" }),
    );
    expect(markup).not.toContain('role="tablist"');
    expect(markup).toContain("Final promotion re-verification");
    expect(markup).toContain("promotion marker");
    expect(
      renderToStaticMarkup(
        createElement(CandidateEvidencePanel, {
          candidate: candidate({ verificationEvidence: null, promotionEvidence: null }),
          planeId: "plane-3",
        }),
      ),
    ).toBe("");
  });
});
