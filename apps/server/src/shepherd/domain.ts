/**
 * Durable Shepherd domain types.
 *
 * All paths in this module are project-relative POSIX paths unless a field is
 * explicitly named `worktreePath`. Host paths are chosen by the trusted server
 * and are never accepted from browser or model input.
 */

export type IsoTimestamp = string;

export type AgentRole = "Frontend" | "Backend" | "Verification" | "Generalist";

export interface ScopedAuthority {
  readable: string[];
  writable: string[];
  forbidden: string[];
}

export interface EvidenceReference {
  path: string;
  description: string;
  line?: number | undefined;
}

export interface ManifestArtifact {
  path: string;
  kind: "changed" | "produced";
  description: string;
}

export interface ManifestSemanticClaim {
  key: string;
  value: string;
  scope: string;
  mode: "exclusive";
  evidence: EvidenceReference[];
}

export interface AgentDeclaredTestOutcome {
  name: string;
  passed: boolean;
  summary: string;
}

/** Agent-authored and therefore informational until trusted ingestion. */
export interface ContractResultManifest {
  schemaVersion: 1;
  contractId: string;
  summary: string;
  artifacts: ManifestArtifact[];
  semanticClaims: ManifestSemanticClaim[];
  agentDeclaredTests: AgentDeclaredTestOutcome[];
  notes: string;
}

export interface SemanticClaim {
  id: string;
  missionId: string;
  contractId: string;
  /** Canonical key after trusted normalization. */
  key: string;
  /** Canonical value after trusted normalization. */
  value: string;
  scope: string;
  mode: "exclusive";
  evidence: EvidenceReference[];
  valid: boolean;
  rejectionReason: string | null;
  createdAt: IsoTimestamp;
}

export interface ShepherdProject {
  id: string;
  displayName: string;
  /** Trusted server-selected repository location. */
  repositoryPath: string;
  protectedBranch: string;
  protectedHeadCommit: string;
  activeMissionId: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type MissionState =
  | "planning"
  | "queued"
  | "running"
  | "verifying"
  | "collision"
  | "resolving"
  | "completed"
  | "failed"
  | "cancelled"
  | "attention_required";

export interface ContractDependencyEdge {
  fromContractId: string;
  toContractId: string;
  required: boolean;
}

export type ShepherdFailureCode =
  | "agent_timeout"
  | "agent_runtime_error"
  | "missing_result_manifest"
  | "malformed_manifest"
  | "invalid_semantic_evidence"
  | "omitted_declared_claim_key"
  | "unauthorized_file_change"
  | "failed_independent_acceptance"
  | "worktree_creation_failure"
  | "git_conflict"
  | "semantic_collision"
  | "candidate_timeout"
  | "single_candidate_failure"
  | "all_candidates_failed"
  | "objective_tie"
  | "final_reverification_failure"
  | "protected_branch_moved"
  | "verification_infrastructure_error"
  | "execution_interrupted"
  | "persistence_error"
  | "polling_interrupted"
  | "model_review_degraded"
  | "cancelled"
  | "unknown";

export interface FailureInfo {
  code: ShepherdFailureCode;
  message: string;
  stage: string;
  at: IsoTimestamp;
  retryable: boolean;
}

export interface Mission {
  id: string;
  projectId: string;
  originalIntent: string;
  baseCommit: string;
  contractIds: string[];
  dependencyEdges: ContractDependencyEdge[];
  collisionIds: string[];
  resolutionIds: string[];
  state: MissionState;
  attentionReason: string | null;
  failure: FailureInfo | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  startedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
}

export interface ContractContextInput {
  name: string;
  value: string;
  sourceContractId: string | null;
}

export interface ExpectedArtifact {
  path: string;
  description: string;
  required: boolean;
}

/** A check references a trusted server-side profile, never a browser command. */
export interface AcceptanceCheck {
  id: string;
  name: string;
  profileId: string;
  mandatory: boolean;
  timeoutMs: number;
}

export interface AcceptanceSpecification {
  checks: AcceptanceCheck[];
  objectiveTieBreakers: string[];
}

export type ExecutionContractState =
  | "created"
  | "queued"
  | "blocked"
  | "running"
  | "agent_completed"
  | "authority_validation"
  | "verifying"
  | "verified"
  | "execution_failed"
  | "execution_timed_out"
  | "manifest_missing"
  | "manifest_malformed"
  | "authority_denied"
  | "verification_failed"
  | "claim_rejected"
  | "attention_required"
  | "cancelled"
  | "interrupted";

export interface ExecutionContract {
  id: string;
  missionId: string;
  agentId: string;
  title: string;
  objective: string;
  contextualInputs: ContractContextInput[];
  dependencyIds: string[];
  semanticScopes: string[];
  declaredClaimKeys: string[];
  authority: ScopedAuthority;
  expectedArtifacts: ExpectedArtifact[];
  acceptance: AcceptanceSpecification;
  planeId: string | null;
  resultManifestPath: ".shepherd/result.json";
  manifest: ContractResultManifest | null;
  /** Evidence produced only by the independent verification boundary. */
  verificationEvidence: VerificationEvidence[];
  state: ExecutionContractState;
  failure: FailureInfo | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  startedAt: IsoTimestamp | null;
  agentCompletedAt: IsoTimestamp | null;
  verifiedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
}

export type PlaneKind = "contract" | "integration" | "resolution";

export type PlaneState =
  | "creating"
  | "ready"
  | "running"
  | "inspecting"
  | "verified"
  | "failed"
  | "interrupted"
  | "destroyed";

export interface Plane {
  id: string;
  projectId: string;
  missionId: string;
  kind: PlaneKind;
  contractId: string | null;
  candidateId: string | null;
  branch: string;
  /** Trusted server-selected absolute path. */
  worktreePath: string;
  baseCommit: string;
  headCommit: string | null;
  purpose: string;
  executionIdentity: string;
  authority: ScopedAuthority;
  state: PlaneState;
  changedFiles: string[];
  diffSummary: string;
  verificationEvidenceIds: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  destroyedAt: IsoTimestamp | null;
  error: FailureInfo | null;
}

export type VerificationCheckStatus =
  | "passed"
  | "failed"
  | "timed_out"
  | "infrastructure_error";

export interface VerificationCheckResult {
  id: string;
  name: string;
  profileId: string;
  mandatory: boolean;
  status: VerificationCheckStatus;
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  /** Bounded and redacted before persistence. */
  stdout: string;
  /** Bounded and redacted before persistence. */
  stderr: string;
  error: string | null;
}

export interface VerificationEvidence {
  id: string;
  targetType: "contract" | "candidate" | "promotion";
  targetId: string;
  runner: "independent";
  passed: boolean;
  checks: VerificationCheckResult[];
  startedAt: IsoTimestamp;
  completedAt: IsoTimestamp;
  durationMs: number;
  changedFiles: string[];
  summary: string;
}

export type SemanticCollisionState =
  | "detected"
  | "resolving"
  | "resolved"
  | "attention_required";

export interface SemanticCollision {
  id: string;
  missionId: string;
  key: string;
  scope: string;
  leftContractId: string;
  rightContractId: string;
  leftClaimId: string;
  rightClaimId: string;
  leftClaim: SemanticClaim;
  rightClaim: SemanticClaim;
  reason: string;
  detectionMechanism: "deterministic" | "model_assisted";
  candidateIds: string[];
  state: SemanticCollisionState;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
}

export type CandidateExecutionState =
  | "created"
  | "queued"
  | "running"
  | "agent_completed"
  | "verifying"
  | "passed"
  | "failed"
  | "timed_out"
  | "interrupted";

export type CandidateSelectionState = "pending" | "selected" | "rejected" | "tied";

export type CandidatePromotionState =
  | "not_started"
  | "reverifying"
  | "promoting"
  | "promoted"
  | "failed";

export interface ResolutionCandidate {
  id: string;
  missionId: string;
  collisionId: string;
  strategy: string;
  targetKey: string;
  targetValue: string;
  planeId: string;
  executionState: CandidateExecutionState;
  selectionState: CandidateSelectionState;
  promotionState: CandidatePromotionState;
  verificationEvidence: VerificationEvidence | null;
  changedFiles: string[];
  diffSummary: string;
  result: string | null;
  retryCount: 0 | 1;
  failure: FailureInfo | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type ShepherdEventType =
  | "mission_created"
  | "mission_state_changed"
  | "contract_created"
  | "contract_blocked"
  | "contract_started"
  | "agent_completed"
  | "authority_accepted"
  | "authority_denied"
  | "verification_started"
  | "verification_passed"
  | "verification_failed"
  | "claims_loaded"
  | "claim_rejected"
  | "collision_detected"
  | "resolution_started"
  | "candidate_created"
  | "candidate_passed"
  | "candidate_failed"
  | "candidate_retried"
  | "candidate_selected"
  | "tie_escalated"
  | "promotion_started"
  | "promotion_completed"
  | "mission_completed"
  | "mission_failed"
  | "mission_cancelled"
  | "execution_interrupted"
  | "model_review_degraded"
  | "persistence_failed";

export interface ShepherdEventActor {
  type: "human" | "shepherd" | "agent" | "verifier" | "system";
  id: string | null;
  displayName: string;
}

export type SafeEventDetail = string | number | boolean | null;

export interface ShepherdEvent {
  id: string;
  /** Monotonic, durable polling cursor. */
  sequence: number;
  timestamp: IsoTimestamp;
  type: ShepherdEventType;
  summary: string;
  actor: ShepherdEventActor;
  missionId: string | null;
  contractId: string | null;
  agentId: string | null;
  planeId: string | null;
  collisionId: string | null;
  candidateId: string | null;
  /** Bounded and redacted by the trusted event writer. */
  details: Record<string, SafeEventDetail>;
}

export interface ProjectGroupMessage {
  id: string;
  projectId: string;
  missionId: string | null;
  senderType: "human" | "shepherd" | "agent";
  senderId: string | null;
  content: string;
  targetAgentId: string | null;
  contractId: string | null;
  createdAt: IsoTimestamp;
}

export interface ShepherdSettings {
  mode: "production" | "deterministic_test";
  contractTimeoutMs: number;
  candidateTimeoutMs: number;
  autoResolution: boolean;
  maxConcurrentPlanes: number;
  retainCompletedPlanes: boolean;
  modelReviewEnabled: boolean;
  notifications: {
    missionCompleted: boolean;
    attentionRequired: boolean;
    collisionDetected: boolean;
  };
  updatedAt: IsoTimestamp;
}

export interface ShepherdDatabase {
  projects: ShepherdProject[];
  missions: Mission[];
  contracts: ExecutionContract[];
  planes: Plane[];
  claims: SemanticClaim[];
  collisions: SemanticCollision[];
  candidates: ResolutionCandidate[];
  events: ShepherdEvent[];
  groupMessages: ProjectGroupMessage[];
  settings: ShepherdSettings;
  /** The cursor assigned to the next appended event. */
  nextEventSequence: number;
}
