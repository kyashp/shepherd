export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type AgentRole = "Frontend" | "Backend" | "Verification" | "Generalist";
export type AuthorityPresetId = "frontend" | "backend" | "verification" | "generalist";
export type AuthTransport = "bearer-jwt" | "http-only-session-cookie";

export interface ScopedAuthority {
  readable: string[];
  writable: string[];
  forbidden: string[];
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  lastError: string | null;
  role?: AgentRole;
  authority?: ScopedAuthority;
  currentContractId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInput {
  name: string;
  description: string;
  instructions: string;
  role: AgentRole;
  authorityPreset?: AuthorityPresetId;
  authority?: ScopedAuthority;
}

export interface AuthorityPresetDefinition {
  id: AuthorityPresetId;
  label: string;
  description: string;
  recommendedRole: AgentRole;
  authority: ScopedAuthority;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  output: string | null;
  error: string | null;
  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface SystemInfo {
  arkConfigured: boolean;
  arkBaseUrl: string;
  arkModel: string | null;
  codexAvailable: boolean;
  codexSandboxMode: string;
  runtimeProvider: "local-process" | "container";
  shepherdExecutionMode: "live" | "deterministic";
  shepherdModelReviewConfigured: boolean;
  containerEngine: string | null;
  runtime: string;
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

export type ContractState =
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

export interface FailureInfo {
  code: string;
  message: string;
  stage: string;
  at: string;
  retryable: boolean;
}

export interface ShepherdProject {
  id: string;
  displayName: string;
  protectedBranch: string;
  protectedHeadCommit: string;
  activeMissionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Mission {
  id: string;
  projectId: string;
  originalIntent: string;
  baseCommit: string;
  contractIds: string[];
  dependencyEdges: Array<{
    fromContractId: string;
    toContractId: string;
    required: boolean;
  }>;
  collisionIds: string[];
  resolutionIds: string[];
  state: MissionState;
  attentionReason: string | null;
  failure: FailureInfo | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AcceptanceCheck {
  id: string;
  name: string;
  profileId: string;
  mandatory: boolean;
  timeoutMs: number;
}

export interface VerificationCheckResult {
  id: string;
  name: string;
  profileId: string;
  mandatory: boolean;
  status: "passed" | "failed" | "timed_out" | "infrastructure_error";
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  diagnosticOutputAvailable?: boolean;
}

export interface VerificationEvidence {
  id: string;
  targetType: "contract" | "candidate" | "promotion";
  targetId: string;
  runner: "independent";
  passed: boolean;
  checks: VerificationCheckResult[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  changedFiles: string[];
  summary: string;
}

export interface ExecutionContract {
  id: string;
  missionId: string;
  agentId: string;
  title: string;
  objective: string;
  contextualInputs: Array<{
    name: string;
    value: string;
    sourceContractId: string | null;
  }>;
  dependencyIds: string[];
  semanticScopes: string[];
  declaredClaimKeys: string[];
  authority: ScopedAuthority;
  expectedArtifacts: Array<{
    path: string;
    description: string;
    required: boolean;
  }>;
  acceptance: {
    checks: AcceptanceCheck[];
    objectiveTieBreakers: string[];
  };
  planeId: string | null;
  resultManifestPath: ".shepherd/result.json";
  verificationEvidence: VerificationEvidence[];
  state: ContractState;
  failure: FailureInfo | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  agentCompletedAt: string | null;
  verifiedAt: string | null;
  completedAt: string | null;
  /** Present only when a trusted planner persisted an estimate. */
  estimatedDurationMs?: number | null;
}

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
  kind: "contract" | "integration" | "resolution";
  contractId: string | null;
  candidateId: string | null;
  branch: string;
  baseCommit: string;
  headCommit: string | null;
  purpose: string;
  authority: ScopedAuthority;
  state: PlaneState;
  changedFiles: string[];
  diffSummary: string;
  verificationEvidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  destroyedAt: string | null;
  error: FailureInfo | null;
  runtimeSessionEstablished?: boolean;
}

export interface SemanticClaim {
  id: string;
  missionId: string;
  contractId: string;
  key: string;
  value: string;
  scope: string;
  mode: "exclusive";
  valid: boolean;
  rejectionReason: string | null;
  createdAt: string;
}

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
  state: "detected" | "resolving" | "resolved" | "attention_required";
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ResolutionCandidate {
  id: string;
  missionId: string;
  collisionId: string;
  strategy: string;
  targetKey: string;
  targetValue: string;
  planeId: string;
  executionState:
    | "created"
    | "queued"
    | "running"
    | "agent_completed"
    | "verifying"
    | "passed"
    | "failed"
    | "timed_out"
    | "interrupted";
  selectionState: "pending" | "selected" | "rejected" | "tied";
  promotionState:
    | "not_started"
    | "reverifying"
    | "promoting"
    | "interrupted"
    | "promoted"
    | "failed";
  verificationEvidence: VerificationEvidence | null;
  promotionEvidence: VerificationEvidence | null;
  changedFiles: string[];
  diffSummary: string;
  result: string | null;
  retryCount: 0 | 1;
  previousAttempts?: Array<{
    planeId: string;
    executionState: "failed" | "timed_out" | "interrupted";
    verificationEvidence: VerificationEvidence | null;
    changedFiles: string[];
    diffSummary: string;
    failure: FailureInfo;
    startedAt: string;
    completedAt: string;
  }>;
  failure: FailureInfo | null;
  createdAt: string;
  updatedAt: string;
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
  | "model_review_completed"
  | "model_review_degraded"
  | "persistence_failed";

export interface ShepherdEvent {
  id: string;
  sequence: number;
  timestamp: string;
  type: ShepherdEventType;
  summary: string;
  actor: {
    type: "human" | "shepherd" | "agent" | "verifier" | "system";
    id: string | null;
    displayName: string;
  };
  missionId: string | null;
  contractId: string | null;
  agentId: string | null;
  planeId: string | null;
  collisionId: string | null;
  candidateId: string | null;
  details: Record<string, string | number | boolean | null>;
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
  createdAt: string;
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
  updatedAt: string;
}

export interface ShepherdState {
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
  nextEventSequence: number;
}

export interface ShepherdMissionDetail {
  mission: Mission;
  project: ShepherdProject;
  agents: Agent[];
  contracts: ExecutionContract[];
  planes: Plane[];
  claims: SemanticClaim[];
  collisions: SemanticCollision[];
  candidates: ResolutionCandidate[];
  events: ShepherdEvent[];
}
