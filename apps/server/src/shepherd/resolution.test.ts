import { describe, expect, it } from "vitest";
import type {
  ResolutionCandidate,
  VerificationCheckResult,
  VerificationEvidence,
} from "./domain.js";
import {
  applyWinnerDecision,
  assessCandidateVerification,
  candidatePassesMandatoryVerification,
  decideHumanTieWinner,
  decideResolutionWinner,
} from "./resolution.js";

const timestamp = "2026-08-29T12:00:00.000Z";

function check(
  id: string,
  passed: boolean,
  overrides: Partial<VerificationCheckResult> = {},
): VerificationCheckResult {
  return {
    id,
    name: id,
    profileId: id,
    mandatory: true,
    status: passed ? "passed" : "failed",
    passed,
    exitCode: passed ? 0 : 1,
    durationMs: 10,
    stdout: "",
    stderr: "",
    error: null,
    ...overrides,
  };
}

function evidence(
  candidateId: string,
  passed: boolean,
  overrides: Partial<VerificationEvidence> = {},
): VerificationEvidence {
  return {
    id: `${candidateId}-evidence`,
    targetType: "candidate",
    targetId: candidateId,
    runner: "independent",
    passed,
    checks: [check("mandatory-security", passed)],
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 100,
    changedFiles: [`src/${candidateId}.ts`],
    summary: passed ? "passed" : "failed",
    ...overrides,
  };
}

function candidate(
  id: string,
  passed: boolean,
  overrides: Partial<ResolutionCandidate> = {},
): ResolutionCandidate {
  return {
    id,
    missionId: "mission-1",
    collisionId: "collision-1",
    strategy: `Make auth.transport equal ${id}`,
    targetKey: "auth.transport",
    targetValue: id,
    planeId: `${id}-plane`,
    executionState: passed ? "passed" : "failed",
    selectionState: "pending",
    promotionState: "not_started",
    verificationEvidence: evidence(id, passed),
    promotionEvidence: null,
    changedFiles: [`src/${id}.ts`],
    diffSummary: "one file changed",
    result: passed ? "verified" : "rejected",
    retryCount: 0,
    failure: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("candidate verification assessment", () => {
  it("accepts coherent independent evidence with all mandatory checks passing", () => {
    expect(assessCandidateVerification(candidate("candidate-a", true))).toEqual({
      candidateId: "candidate-a",
      passes: true,
      reasons: [],
      mandatoryChecks: 1,
      optionalChecksPassed: 0,
    });
  });

  it.each([
    [
      "missing evidence",
      { verificationEvidence: null },
      "missing_independent_verification",
    ],
    [
      "wrong target",
      { verificationEvidence: evidence("different", true) },
      "verification_target_mismatch",
    ],
    [
      "no mandatory checks",
      {
        verificationEvidence: evidence("candidate-a", true, {
          checks: [check("optional", true, { mandatory: false })],
        }),
      },
      "no_mandatory_checks",
    ],
    [
      "failed summary",
      { verificationEvidence: evidence("candidate-a", false), executionState: "passed" },
      "mandatory_check_failed",
    ],
    [
      "incoherent candidate state",
      { executionState: "running" },
      "candidate_not_in_passed_state",
    ],
  ] as const)("fails closed for %s", (_name, overrides, reason) => {
    const result = assessCandidateVerification(
      candidate("candidate-a", true, overrides as Partial<ResolutionCandidate>),
    );
    expect(result.passes).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it.each([
    [{ status: "failed" as const }, "mandatory_check_failed"],
    [{ passed: false }, "mandatory_check_failed"],
    [{ exitCode: null }, "mandatory_check_failed"],
    [{ error: "runner inconsistency" }, "mandatory_check_failed"],
  ])("requires every passed-check field to agree %#", (checkOverride, reason) => {
    const item = candidate("candidate-a", true, {
      verificationEvidence: evidence("candidate-a", true, {
        checks: [check("mandatory", true, checkOverride)],
      }),
    });
    expect(assessCandidateVerification(item).reasons).toContain(reason);
  });

  it("does not let a failed optional check invalidate mandatory success", () => {
    const item = candidate("candidate-a", true, {
      verificationEvidence: evidence("candidate-a", true, {
        checks: [
          check("mandatory", true),
          check("optional", false, { mandatory: false }),
        ],
      }),
    });
    expect(candidatePassesMandatoryVerification(item)).toBe(true);
  });
});

describe("evidence-driven winner policy", () => {
  it("selects the only candidate that passed mandatory independent verification", () => {
    expect(
      decideResolutionWinner([
        candidate("candidate-a", true),
        candidate("candidate-b", false),
      ]),
    ).toMatchObject({
      kind: "selected",
      selectedCandidateId: "candidate-a",
      rejectedCandidateIds: ["candidate-b"],
      source: "mandatory_verification",
      tieBreaker: null,
    });
  });

  it("flips the winner when objective verification flips, independent of IDs/strategies", () => {
    const decideForInvariant = (bearerIsAllowed: boolean) =>
      decideResolutionWinner([
        candidate("candidate-a-bearer", bearerIsAllowed, {
          strategy: "always use candidate A",
        }),
        candidate("candidate-z-cookie", !bearerIsAllowed, {
          strategy: "always use candidate Z",
        }),
      ]);
    expect(decideForInvariant(true)).toMatchObject({
      kind: "selected",
      selectedCandidateId: "candidate-a-bearer",
    });
    expect(decideForInvariant(false)).toMatchObject({
      kind: "selected",
      selectedCandidateId: "candidate-z-cookie",
    });
  });

  it("selects none and requires attention when both candidates fail", () => {
    expect(
      decideResolutionWinner([
        candidate("candidate-a", false),
        candidate("candidate-b", false),
      ]),
    ).toMatchObject({
      kind: "none",
      attentionRequired: true,
      reason: "all_candidates_failed",
    });
  });

  it("escalates an objective tie for human selection", () => {
    expect(
      decideResolutionWinner([
        candidate("candidate-b", true),
        candidate("candidate-a", true),
      ]),
    ).toEqual({
      kind: "tie",
      attentionRequired: true,
      reason: "objective_tie",
      candidateIds: ["candidate-a", "candidate-b"],
      unsupportedTieBreakers: [],
      assessments: expect.any(Array),
    });
  });

  it("uses predeclared tie-breakers in order and ignores unsupported opinions", () => {
    const left = candidate("candidate-a", true, {
      changedFiles: ["a.ts"],
      verificationEvidence: evidence("candidate-a", true, {
        durationMs: 300,
        checks: [
          check("mandatory", true),
          check("lint", true, { mandatory: false, profileId: "lint" }),
        ],
      }),
    });
    const right = candidate("candidate-b", true, {
      changedFiles: ["a.ts", "b.ts"],
      verificationEvidence: evidence("candidate-b", true, { durationMs: 100 }),
    });
    expect(
      decideResolutionWinner(
        [left, right],
        ["llm-prefers-right", "more-optional-checks-passed", "fewer-changed-files"],
      ),
    ).toMatchObject({
      kind: "selected",
      selectedCandidateId: "candidate-a",
      source: "objective_tie_breaker",
      tieBreaker: "more-optional-checks-passed",
    });
  });

  it.each([
    ["fewer-changed-files", "candidate-a"],
    ["shorter-verification-duration", "candidate-b"],
    ["optional-check:security-extra", "candidate-a"],
  ])("applies objective tie-breaker %s", (tieBreaker, selectedId) => {
    const left = candidate("candidate-a", true, {
      changedFiles: ["a.ts"],
      verificationEvidence: evidence("candidate-a", true, {
        durationMs: 200,
        checks: [
          check("mandatory", true),
          check("extra", true, {
            mandatory: false,
            profileId: "security-extra",
          }),
        ],
      }),
    });
    const right = candidate("candidate-b", true, {
      changedFiles: ["a.ts", "b.ts"],
      verificationEvidence: evidence("candidate-b", true, { durationMs: 100 }),
    });
    expect(decideResolutionWinner([left, right], [tieBreaker])).toMatchObject({
      kind: "selected",
      selectedCandidateId: selectedId,
      tieBreaker,
    });
  });

  it("records unsupported tie-breakers and still escalates when no objective fact differs", () => {
    expect(
      decideResolutionWinner(
        [candidate("candidate-a", true), candidate("candidate-b", true)],
        ["model-opinion", "optional-check:missing"],
      ),
    ).toMatchObject({
      kind: "tie",
      unsupportedTieBreakers: ["model-opinion"],
    });
  });

  it.each([
    [[]],
    [[candidate("candidate-a", true)]],
    [
      [
        candidate("candidate-a", true),
        candidate("candidate-a", true),
      ],
    ],
    [
      [
        candidate("candidate-a", true),
        candidate("candidate-b", true, { collisionId: "collision-2" }),
      ],
    ],
    [
      [
        candidate("candidate-a", true),
        candidate("candidate-b", true, { missionId: "mission-2" }),
      ],
    ],
  ])("fails closed for an invalid candidate set %#", (candidates) => {
    expect(decideResolutionWinner(candidates)).toMatchObject({
      kind: "none",
      attentionRequired: true,
      reason: "invalid_candidate_set",
    });
  });
});

describe("human tie resolution and immutable state projection", () => {
  it("allows a human to select either objectively verified tied candidate", () => {
    const candidates = [
      candidate("candidate-a", true),
      candidate("candidate-b", true),
    ];
    const tie = decideResolutionWinner(candidates);
    expect(tie.kind).toBe("tie");
    if (tie.kind !== "tie") return;
    expect(decideHumanTieWinner(tie, candidates, "candidate-b")).toMatchObject({
      kind: "selected",
      selectedCandidateId: "candidate-b",
      rejectedCandidateIds: ["candidate-a"],
      source: "human",
    });
  });

  it("rejects an unknown or no-longer-verified human selection", () => {
    const original = [
      candidate("candidate-a", true),
      candidate("candidate-b", true),
    ];
    const tie = decideResolutionWinner(original);
    if (tie.kind !== "tie") throw new Error("Expected test fixture to tie");
    expect(decideHumanTieWinner(tie, original, "candidate-x")).toMatchObject({
      kind: "none",
      reason: "invalid_candidate_set",
    });
    expect(
      decideHumanTieWinner(
        tie,
        [original[0]!, { ...original[1]!, executionState: "failed" }],
        "candidate-a",
      ),
    ).toMatchObject({ kind: "none", reason: "invalid_candidate_set" });
  });

  it("projects selected, tied, and no-winner decisions without mutating candidates", () => {
    const candidates = [
      candidate("candidate-a", true),
      candidate("candidate-b", false),
    ];
    const selected = decideResolutionWinner(candidates);
    expect(applyWinnerDecision(candidates, selected, "later")).toMatchObject([
      { id: "candidate-a", selectionState: "selected", updatedAt: "later" },
      { id: "candidate-b", selectionState: "rejected", updatedAt: "later" },
    ]);
    expect(candidates.map((item) => item.selectionState)).toEqual([
      "pending",
      "pending",
    ]);

    const tiedCandidates = [
      candidate("candidate-a", true),
      candidate("candidate-b", true),
    ];
    expect(
      applyWinnerDecision(
        tiedCandidates,
        decideResolutionWinner(tiedCandidates),
        "later",
      ).map((item) => item.selectionState),
    ).toEqual(["tied", "tied"]);

    const failedCandidates = [
      candidate("candidate-a", false),
      candidate("candidate-b", false),
    ];
    expect(
      applyWinnerDecision(
        failedCandidates,
        decideResolutionWinner(failedCandidates),
        "later",
      ).map((item) => item.selectionState),
    ).toEqual(["rejected", "rejected"]);
  });
});
