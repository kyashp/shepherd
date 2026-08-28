import type {
  AcceptanceCheck,
  Plane,
  ResolutionCandidate,
  VerificationEvidence,
} from "./domain.js";
import {
  DirtyProtectedWorktreeError,
  GitClient,
  NonFastForwardPromotionError,
  ProtectedHeadMovedError,
  ProtectedRefRollbackError,
  ProtectedWorktreeSynchronizationError,
  assertFullObjectId,
} from "./git-client.js";

export interface PromotionAuthorityInput {
  plane: Plane;
  baseCommit: string;
  headCommit: string;
  changedFiles: string[];
}

export interface PromotionAuthorityResult {
  allowed: boolean;
  reason: string | null;
}

export type PromotionAuthorityRecheck = (
  input: PromotionAuthorityInput,
) => Promise<PromotionAuthorityResult>;

export interface PromotionVerifier {
  verify(input: {
    targetType: "promotion";
    targetId: string;
    planePath: string;
    checks: readonly AcceptanceCheck[];
    changedFiles: readonly string[];
  }): Promise<VerificationEvidence>;
}

export interface PromotionVerificationSnapshotProvider {
  withVerificationSnapshot<T>(
    commit: string,
    use: (snapshot: { commit: string; path: string }) => Promise<T>,
  ): Promise<T>;
}

export interface PromotionRequest {
  candidate: ResolutionCandidate;
  plane: Plane;
  protectedBranch: string;
  expectedHead: string;
  checks: readonly AcceptanceCheck[];
  /** Re-read at the gate; a stale caller snapshot is not sufficient. */
  loadPersistedSelectedCandidateId: () => Promise<string | null>;
}

export type PromotionFailureReason =
  | "selection_mismatch"
  | "candidate_head_moved"
  | "unfinalized_candidate"
  | "unauthorized_file_change"
  | "final_reverification_failure"
  | "protected_branch_moved"
  | "non_fast_forward"
  | "dirty_protected_worktree"
  | "protected_worktree_sync_failure"
  | "protected_ref_rollback_failure"
  | "verification_infrastructure_error"
  | "promotion_infrastructure_error";

export type PromotionResult =
  | {
      promoted: true;
      previousHead: string;
      promotedHead: string;
      changedFiles: string[];
      verificationEvidence: VerificationEvidence;
    }
  | {
      promoted: false;
      reason: PromotionFailureReason;
      message: string;
      actualHead: string | null;
      changedFiles: string[];
      verificationEvidence: VerificationEvidence | null;
    };

function failed(input: {
  reason: PromotionFailureReason;
  message: string;
  actualHead?: string | null;
  changedFiles?: string[];
  verificationEvidence?: VerificationEvidence | null;
}): PromotionResult {
  return {
    promoted: false,
    reason: input.reason,
    message: input.message,
    actualHead: input.actualHead ?? null,
    changedFiles: input.changedFiles ?? [],
    verificationEvidence: input.verificationEvidence ?? null,
  };
}

function isAllowedUncommittedMetadata(projectPath: string): boolean {
  return projectPath === ".shepherd/result.json";
}

/**
 * Final trusted gate: persisted selection, immutable candidate head, actual diff
 * authority, independent re-verification, expected protected HEAD, then one
 * atomic fast-forward compare-and-swap.
 */
export class PromotionGate {
  constructor(
    private readonly git: GitClient,
    private readonly verifier: PromotionVerifier,
    private readonly authorityRecheck: PromotionAuthorityRecheck,
    private readonly snapshots: PromotionVerificationSnapshotProvider,
  ) {}

  async promote(request: PromotionRequest): Promise<PromotionResult> {
    const expectedHead = assertFullObjectId(request.expectedHead);
    if (
      request.candidate.selectionState !== "selected" ||
      request.candidate.planeId !== request.plane.id ||
      request.plane.candidateId !== request.candidate.id ||
      request.plane.kind !== "resolution"
    ) {
      return failed({
        reason: "selection_mismatch",
        message: "Candidate and Plane do not match the selected resolution decision",
      });
    }

    let persistedSelection: string | null;
    try {
      persistedSelection = await request.loadPersistedSelectedCandidateId();
    } catch {
      return failed({
        reason: "promotion_infrastructure_error",
        message: "Persisted candidate selection could not be re-read",
      });
    }
    if (persistedSelection !== request.candidate.id) {
      return failed({
        reason: "selection_mismatch",
        message: "Persisted winner does not match the requested candidate",
      });
    }

    const persistedCandidateHead = request.plane.headCommit;
    if (!persistedCandidateHead) {
      return failed({
        reason: "candidate_head_moved",
        message: "Candidate Plane has no persisted immutable head",
      });
    }
    let candidateHead: string;
    try {
      candidateHead = await this.git.currentHead(request.plane.worktreePath);
    } catch {
      return failed({
        reason: "promotion_infrastructure_error",
        message: "Candidate Plane head could not be inspected",
      });
    }
    if (candidateHead !== assertFullObjectId(persistedCandidateHead)) {
      return failed({
        reason: "candidate_head_moved",
        message: "Candidate Plane head changed after verification",
        actualHead: candidateHead,
      });
    }

    let uncommitted: string[];
    let changedFiles: string[];
    try {
      uncommitted = await this.git.uncommittedFiles(request.plane.worktreePath);
      changedFiles = await this.git.changedFilesBetween(
        request.plane.baseCommit,
        candidateHead,
        request.plane.worktreePath,
      );
    } catch {
      return failed({
        reason: "promotion_infrastructure_error",
        message: "Candidate diff could not be inspected",
      });
    }
    const unfinalized = uncommitted.filter((changedPath) => !isAllowedUncommittedMetadata(changedPath));
    if (unfinalized.length > 0) {
      return failed({
        reason: "unfinalized_candidate",
        message: "Candidate contains changes that are not represented by its immutable commit",
        changedFiles: unfinalized,
      });
    }

    let authority: PromotionAuthorityResult;
    try {
      authority = await this.authorityRecheck({
        plane: request.plane,
        baseCommit: request.plane.baseCommit,
        headCommit: candidateHead,
        changedFiles: [...changedFiles],
      });
    } catch {
      return failed({
        reason: "promotion_infrastructure_error",
        message: "Final authority re-check could not be completed",
        changedFiles,
      });
    }
    if (!authority.allowed) {
      return failed({
        reason: "unauthorized_file_change",
        message: authority.reason ?? "Candidate diff exceeds its promotion authority",
        changedFiles,
      });
    }

    let evidence: VerificationEvidence;
    try {
      evidence = await this.snapshots.withVerificationSnapshot(
        candidateHead,
        async (snapshot) => {
          if (snapshot.commit !== candidateHead || snapshot.path === request.plane.worktreePath) {
            throw new Error("Promotion verification snapshot identity is invalid");
          }
          return await this.verifier.verify({
            targetType: "promotion",
            targetId: request.candidate.id,
            planePath: snapshot.path,
            checks: request.checks,
            changedFiles,
          });
        },
      );
    } catch {
      return failed({
        reason: "verification_infrastructure_error",
        message: "Final independent verification could not run",
        changedFiles,
      });
    }
    if (!evidence.passed) {
      return failed({
        reason: "final_reverification_failure",
        message: "Candidate failed final mandatory acceptance checks",
        changedFiles,
        verificationEvidence: evidence,
      });
    }

    // Verification is read-only, but re-check the immutable ref and persisted
    // selection immediately before updating protected state.
    const headAfterVerification = await this.git.currentHead(request.plane.worktreePath);
    if (headAfterVerification !== candidateHead) {
      return failed({
        reason: "candidate_head_moved",
        message: "Candidate Plane head changed during final verification",
        actualHead: headAfterVerification,
        changedFiles,
        verificationEvidence: evidence,
      });
    }
    try {
      persistedSelection = await request.loadPersistedSelectedCandidateId();
    } catch {
      return failed({
        reason: "promotion_infrastructure_error",
        message: "Persisted candidate selection could not be re-read at promotion",
        changedFiles,
        verificationEvidence: evidence,
      });
    }
    if (persistedSelection !== request.candidate.id) {
      return failed({
        reason: "selection_mismatch",
        message: "Persisted winner changed during final verification",
        changedFiles,
        verificationEvidence: evidence,
      });
    }

    let actualProtectedHead: string;
    try {
      actualProtectedHead = await this.git.branchHead(request.protectedBranch);
    } catch {
      return failed({
        reason: "promotion_infrastructure_error",
        message: "Protected branch head could not be inspected",
        changedFiles,
        verificationEvidence: evidence,
      });
    }
    if (actualProtectedHead !== expectedHead) {
      return failed({
        reason: "protected_branch_moved",
        message: "Protected branch moved while the Mission was running",
        actualHead: actualProtectedHead,
        changedFiles,
        verificationEvidence: evidence,
      });
    }

    try {
      await this.git.compareAndSwapFastForward(
        request.protectedBranch,
        expectedHead,
        candidateHead,
      );
    } catch (error) {
      if (error instanceof ProtectedHeadMovedError) {
        return failed({
          reason: "protected_branch_moved",
          message: error.message,
          actualHead: error.actualHead,
          changedFiles,
          verificationEvidence: evidence,
        });
      }
      if (error instanceof NonFastForwardPromotionError) {
        return failed({
          reason: "non_fast_forward",
          message: error.message,
          actualHead: actualProtectedHead,
          changedFiles,
          verificationEvidence: evidence,
        });
      }
      if (error instanceof DirtyProtectedWorktreeError) {
        return failed({
          reason: "dirty_protected_worktree",
          message: error.message,
          actualHead: actualProtectedHead,
          changedFiles: error.changedFiles,
          verificationEvidence: evidence,
        });
      }
      if (error instanceof ProtectedWorktreeSynchronizationError) {
        return failed({
          reason: "protected_worktree_sync_failure",
          message: error.message,
          actualHead: error.expectedHead,
          changedFiles,
          verificationEvidence: evidence,
        });
      }
      if (error instanceof ProtectedRefRollbackError) {
        return failed({
          reason: "protected_ref_rollback_failure",
          message: error.message,
          actualHead: error.actualHead,
          changedFiles,
          verificationEvidence: evidence,
        });
      }
      return failed({
        reason: "promotion_infrastructure_error",
        message: "Protected branch promotion failed",
        actualHead: actualProtectedHead,
        changedFiles,
        verificationEvidence: evidence,
      });
    }

    return {
      promoted: true,
      previousHead: expectedHead,
      promotedHead: candidateHead,
      changedFiles,
      verificationEvidence: evidence,
    };
  }
}
