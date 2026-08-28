import type {
  ResolutionCandidate,
  VerificationCheckResult,
  VerificationEvidence,
} from "./domain.js";

export const OBJECTIVE_TIE_BREAKERS = [
  "more-optional-checks-passed",
  "fewer-changed-files",
  "shorter-verification-duration",
] as const;

export type ObjectiveTieBreaker = (typeof OBJECTIVE_TIE_BREAKERS)[number] | `optional-check:${string}`;

export interface CandidateEvidenceAssessment {
  candidateId: string;
  passes: boolean;
  reasons: string[];
  mandatoryChecks: number;
  optionalChecksPassed: number;
}

export type WinnerDecision =
  | {
      kind: "selected";
      selectedCandidateId: string;
      rejectedCandidateIds: string[];
      source: "mandatory_verification" | "objective_tie_breaker" | "human";
      tieBreaker: string | null;
      reason: string;
      assessments: CandidateEvidenceAssessment[];
    }
  | {
      kind: "none";
      attentionRequired: true;
      reason: "all_candidates_failed" | "invalid_candidate_set";
      assessments: CandidateEvidenceAssessment[];
    }
  | {
      kind: "tie";
      attentionRequired: true;
      reason: "objective_tie";
      candidateIds: [string, string];
      unsupportedTieBreakers: string[];
      assessments: CandidateEvidenceAssessment[];
    };

function passedCheck(check: VerificationCheckResult): boolean {
  return (
    check.passed &&
    check.status === "passed" &&
    check.exitCode === 0 &&
    check.error === null
  );
}

function assessEvidence(
  candidate: ResolutionCandidate,
): CandidateEvidenceAssessment {
  const evidence = candidate.verificationEvidence;
  const reasons: string[] = [];
  if (!evidence) {
    reasons.push("missing_independent_verification");
    return {
      candidateId: candidate.id,
      passes: false,
      reasons,
      mandatoryChecks: 0,
      optionalChecksPassed: 0,
    };
  }
  if (
    evidence.runner !== "independent" ||
    evidence.targetType !== "candidate" ||
    evidence.targetId !== candidate.id
  ) {
    reasons.push("verification_target_mismatch");
  }
  const mandatory = evidence.checks.filter((check) => check.mandatory);
  if (mandatory.length === 0) reasons.push("no_mandatory_checks");
  if (mandatory.some((check) => !passedCheck(check))) {
    reasons.push("mandatory_check_failed");
  }
  if (!evidence.passed) reasons.push("verification_summary_failed");
  if (candidate.executionState !== "passed") {
    reasons.push("candidate_not_in_passed_state");
  }
  return {
    candidateId: candidate.id,
    passes: reasons.length === 0,
    reasons,
    mandatoryChecks: mandatory.length,
    optionalChecksPassed: evidence.checks.filter(
      (check) => !check.mandatory && passedCheck(check),
    ).length,
  };
}

/** A candidate is acceptable only when trusted independent evidence is coherent. */
export function assessCandidateVerification(
  candidate: ResolutionCandidate,
): CandidateEvidenceAssessment {
  return assessEvidence(candidate);
}

export function candidatePassesMandatoryVerification(
  candidate: ResolutionCandidate,
): boolean {
  return assessEvidence(candidate).passes;
}

function optionalCheckPassed(
  evidence: VerificationEvidence | null,
  profileId: string,
): boolean {
  return (
    evidence?.checks.some(
      (check) =>
        !check.mandatory && check.profileId === profileId && passedCheck(check),
    ) ?? false
  );
}

/** -1 favors left, +1 favors right, 0 is objectively tied/unsupported. */
function compareWithTieBreaker(
  left: ResolutionCandidate,
  right: ResolutionCandidate,
  leftAssessment: CandidateEvidenceAssessment,
  rightAssessment: CandidateEvidenceAssessment,
  tieBreaker: string,
): number | null {
  if (tieBreaker === "more-optional-checks-passed") {
    return Math.sign(
      rightAssessment.optionalChecksPassed - leftAssessment.optionalChecksPassed,
    );
  }
  if (tieBreaker === "fewer-changed-files") {
    const leftCount = new Set(left.changedFiles).size;
    const rightCount = new Set(right.changedFiles).size;
    return Math.sign(leftCount - rightCount);
  }
  if (tieBreaker === "shorter-verification-duration") {
    const leftDuration = left.verificationEvidence?.durationMs;
    const rightDuration = right.verificationEvidence?.durationMs;
    if (leftDuration === undefined || rightDuration === undefined) return 0;
    return Math.sign(leftDuration - rightDuration);
  }
  if (tieBreaker.startsWith("optional-check:")) {
    const profileId = tieBreaker.slice("optional-check:".length);
    if (!profileId) return null;
    const leftPassed = optionalCheckPassed(left.verificationEvidence, profileId);
    const rightPassed = optionalCheckPassed(right.verificationEvidence, profileId);
    if (leftPassed === rightPassed) return 0;
    return leftPassed ? -1 : 1;
  }
  return null;
}

function selectedDecision(
  selected: ResolutionCandidate,
  rejected: ResolutionCandidate,
  source: Extract<WinnerDecision, { kind: "selected" }>["source"],
  tieBreaker: string | null,
  reason: string,
  assessments: CandidateEvidenceAssessment[],
): WinnerDecision {
  return {
    kind: "selected",
    selectedCandidateId: selected.id,
    rejectedCandidateIds: [rejected.id],
    source,
    tieBreaker,
    reason,
    assessments,
  };
}

/**
 * Select from exactly two candidates using verification evidence and only the
 * ordered, predeclared objective tie-breakers supplied by trusted Mission data.
 */
export function decideResolutionWinner(
  candidateInputs: readonly ResolutionCandidate[],
  predeclaredTieBreakers: readonly string[] = [],
): WinnerDecision {
  const candidates = [...candidateInputs].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const assessments = candidates.map(assessEvidence);
  if (
    candidates.length !== 2 ||
    candidates[0]?.id === candidates[1]?.id ||
    candidates[0]?.collisionId !== candidates[1]?.collisionId ||
    candidates[0]?.missionId !== candidates[1]?.missionId
  ) {
    return {
      kind: "none",
      attentionRequired: true,
      reason: "invalid_candidate_set",
      assessments,
    };
  }
  const left = candidates[0];
  const right = candidates[1];
  const leftAssessment = assessments[0];
  const rightAssessment = assessments[1];
  if (!left || !right || !leftAssessment || !rightAssessment) {
    return {
      kind: "none",
      attentionRequired: true,
      reason: "invalid_candidate_set",
      assessments,
    };
  }

  if (leftAssessment.passes !== rightAssessment.passes) {
    return leftAssessment.passes
      ? selectedDecision(
          left,
          right,
          "mandatory_verification",
          null,
          "Only the selected candidate passed every mandatory independent check",
          assessments,
        )
      : selectedDecision(
          right,
          left,
          "mandatory_verification",
          null,
          "Only the selected candidate passed every mandatory independent check",
          assessments,
        );
  }
  if (!leftAssessment.passes) {
    return {
      kind: "none",
      attentionRequired: true,
      reason: "all_candidates_failed",
      assessments,
    };
  }

  const unsupportedTieBreakers: string[] = [];
  for (const tieBreaker of predeclaredTieBreakers) {
    const comparison = compareWithTieBreaker(
      left,
      right,
      leftAssessment,
      rightAssessment,
      tieBreaker,
    );
    if (comparison === null) {
      unsupportedTieBreakers.push(tieBreaker);
      continue;
    }
    if (comparison < 0) {
      return selectedDecision(
        left,
        right,
        "objective_tie_breaker",
        tieBreaker,
        `Predeclared objective tie-breaker '${tieBreaker}' favored the selected candidate`,
        assessments,
      );
    }
    if (comparison > 0) {
      return selectedDecision(
        right,
        left,
        "objective_tie_breaker",
        tieBreaker,
        `Predeclared objective tie-breaker '${tieBreaker}' favored the selected candidate`,
        assessments,
      );
    }
  }
  return {
    kind: "tie",
    attentionRequired: true,
    reason: "objective_tie",
    candidateIds: [left.id, right.id],
    unsupportedTieBreakers,
    assessments,
  };
}

/** Apply an explicit human choice only to a still-valid objective tie. */
export function decideHumanTieWinner(
  tie: Extract<WinnerDecision, { kind: "tie" }>,
  candidates: readonly ResolutionCandidate[],
  selectedCandidateId: string,
): WinnerDecision {
  const selected = candidates.find((candidate) => candidate.id === selectedCandidateId);
  const rejected = candidates.find(
    (candidate) =>
      candidate.id !== selectedCandidateId && tie.candidateIds.includes(candidate.id),
  );
  if (
    !tie.candidateIds.includes(selectedCandidateId) ||
    !selected ||
    !rejected ||
    !candidatePassesMandatoryVerification(selected) ||
    !candidatePassesMandatoryVerification(rejected)
  ) {
    return {
      kind: "none",
      attentionRequired: true,
      reason: "invalid_candidate_set",
      assessments: candidates.map(assessEvidence),
    };
  }
  return selectedDecision(
    selected,
    rejected,
    "human",
    null,
    "A human selected between objectively tied verified candidates",
    candidates.map(assessEvidence),
  );
}

/** Return immutable candidate records with selection state derived from policy. */
export function applyWinnerDecision(
  candidates: readonly ResolutionCandidate[],
  decision: WinnerDecision,
  updatedAt: string,
): ResolutionCandidate[] {
  return candidates.map((candidate) => {
    let selectionState: ResolutionCandidate["selectionState"] = "pending";
    if (decision.kind === "selected") {
      selectionState =
        candidate.id === decision.selectedCandidateId ? "selected" : "rejected";
    } else if (decision.kind === "tie" && decision.candidateIds.includes(candidate.id)) {
      selectionState = "tied";
    } else if (decision.kind === "none" && decision.reason === "all_candidates_failed") {
      selectionState = "rejected";
    }
    return { ...candidate, selectionState, updatedAt };
  });
}
