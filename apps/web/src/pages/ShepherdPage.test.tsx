import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  ResolutionCandidate,
  ShepherdEvent,
  VerificationEvidence,
} from "../types";
import {
  CandidateEvidencePanel,
  candidateEvidenceStages,
  eventEvidencePresentation,
} from "./ShepherdPage";

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
