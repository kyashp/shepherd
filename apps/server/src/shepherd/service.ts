import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import {
  appendProjectGroupMessage,
  appendShepherdEvent,
} from "../database.js";
import { RuntimeExecutionError } from "../errors.js";
import { JsonStore } from "../store.js";
import type { Agent, Database } from "../types.js";
import { WorkspaceManager } from "../workspace.js";
import { agentAuthorityPreset } from "../agent-service.js";
import {
  AUTH_CLAIM_KEY,
  AUTH_FRONTEND_CHECK_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_BACKEND_CHECK_ID,
  AUTH_BACKEND_PROFILE_ID,
  AUTH_PROJECT_CHECK_ID,
  AUTH_PROJECT_PROFILE_ID,
  BEARER_TRANSPORT,
  COOKIE_TRANSPORT,
  verifiedAuthTransportFact,
  type AuthTransport,
} from "./auth-fixture.js";
import {
  isAlwaysProtectedPath,
  intersectScopedAuthority,
  validateChangedPaths,
} from "./authority.js";
import { detectDeterministicCollisions } from "./collision.js";
import {
  assertNoManagedProjectState,
  beginGeneralProjectCreation,
  beginGeneralProjectPolicyUpdate,
  completeGeneralProjectCreation,
  completeGeneralProjectPolicyUpdate,
  initializeAuthDemoProject,
  initializeGeneralAgentProject,
  initializeShepherdManagedRoot,
  openAuthDemoProject,
  reconcileGeneralProjectCreations,
  reconcileGeneralProjectPolicyUpdates,
  recordGeneralProjectPolicyUpdate,
  resetAuthDemoProject,
  resolveManagedProjectIdentity,
  validateShepherdManagedRoot,
  type ManagedAuthDemoProject,
  type ManagedGeneralAgentProject,
} from "./demo-project.js";
import type {
  AcceptanceCheck,
  ExecutionContract,
  FailureInfo,
  Mission,
  Plane,
  ProjectGroupMessage,
  ResolutionCandidate,
  ScopedAuthority,
  SemanticClaim,
  SemanticCollision,
  ShepherdDatabase,
  ShepherdEvent,
  ShepherdEventActor,
  ShepherdProject,
  ShepherdSettings,
  VerificationEvidence,
} from "./domain.js";
import {
  DeterministicFixtureExecutor,
  type DeterministicOperation,
  type ShepherdExecutor,
} from "./executor.js";
import { ingestContractResultManifest } from "./manifest.js";
import {
  MODEL_REVIEW_MAX_EVIDENCE_REFS,
  MODEL_REVIEW_MAX_FINDINGS,
  type ModelReviewContractInput,
  type ModelReviewInput,
  type ModelReviewResult,
  type ModelReviewer,
} from "./model-reviewer.js";
import { parseProjectGroupMessage } from "./group-routing.js";
import {
  GeneralContractPlanError,
  planGeneralContract,
  type GeneralContractPlan,
} from "./general-contract.js";
import { GitClient, type GitClientOptions } from "./git-client.js";
import {
  GitConflictCleanupError,
  GitMergeConflictError,
  PlaneAuthorityViolationError,
  PlaneCreationError,
  PlaneManager,
  synchronizeVerifiedArtifacts,
  type ExecutionWorkspace,
} from "./plane-manager.js";
import {
  buildContractExecutionPrompt,
  buildResolutionCandidatePrompt,
  type DependencyOutput,
} from "./prompt.js";
import { PromotionGate, type PromotionResult } from "./promotion-gate.js";
import { redactText, redactValue } from "./redaction.js";
import {
  reconcilePersistenceRecoveryIntent,
  reconcileShepherdStartup,
} from "./recovery.js";
import {
  applyWinnerDecision,
  candidatePassesMandatoryVerification,
  decideHumanTieWinner,
  decideResolutionWinner,
} from "./resolution.js";
import {
  canTransitionContract,
  canTransitionMission,
  transitionContractAndRecord,
  transitionMissionAndRecord,
} from "./state-machine.js";
import { selectRunnableContracts } from "./scheduler.js";
import type { VerificationRequest } from "./verifier.js";

const SHEPHERD_ACTOR = {
  type: "shepherd",
  id: null,
  displayName: "Shepherd",
} as const;
const VERIFIER_ACTOR = {
  type: "verifier",
  id: null,
  displayName: "Independent verifier",
} as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u;
const MAX_MANIFEST_BYTES = 64 * 1024;
/** How often an in-flight advisory review re-checks durable cancellation. */
const MODEL_REVIEW_CANCELLATION_POLL_MS = 250;
/**
 * Service-side ceiling on any injected reviewer. ArkModelReviewer bounds itself,
 * but the service must stay bounded even when a caller injects one that does not.
 */
const MODEL_REVIEW_SERVICE_DEADLINE_MS = 45_000;
export const GENERAL_CONTRACT_PROFILE_ID = "general-contract";
const GENERAL_CONTRACT_CHECK_ID = "general-contract-output";

const MODEL_REVIEW_DEGRADED_REASONS: ReadonlySet<string> = new Set([
  "invalid_input",
  "timeout",
  "transport_error",
  "rate_limited",
  "authentication_error",
  "configuration_error",
  "provider_error",
  "incomplete_response",
  "invalid_response",
  "storage_contract_violation",
]);
const MODEL_REVIEW_FINDING_KINDS: ReadonlySet<string> = new Set([
  "equivalent_key",
  "likely_incompatibility",
]);
const MODEL_REVIEW_CONFIDENCES: ReadonlySet<string> = new Set([
  "low",
  "medium",
  "high",
]);
const MODEL_REVIEW_EVIDENCE_SOURCES: ReadonlySet<string> = new Set([
  "objective",
  "manifest",
  "claim",
  "changed_file",
  "diff_summary",
]);
const MODEL_REVIEW_COMPLETED_KEYS: ReadonlySet<string> = new Set([
  "status",
  "findings",
  // MR-03 may report bounded overflow metadata; this service does not persist it.
  "droppedFindingCount",
]);
const MODEL_REVIEW_DEGRADED_KEYS: ReadonlySet<string> = new Set([
  "status",
  "reason",
  "retryable",
]);
const MODEL_REVIEW_STATUS_KEYS: ReadonlySet<string> = new Set(["status"]);
const MODEL_REVIEW_FINDING_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "leftContractId",
  "rightContractId",
  "leftKey",
  "rightKey",
  "confidence",
  "reason",
  "evidenceRefs",
]);
const MODEL_REVIEW_EVIDENCE_KEYS: ReadonlySet<string> = new Set([
  "contractId",
  "source",
  "ref",
]);
const MODEL_REVIEW_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u;
const PRIVATE_PROMPT_MAX_LENGTH = 2_000;

function normalizedPrivatePrompt(content: string): string {
  const normalized = content.normalize("NFKC").trim();
  if (
    normalized.length < 1 ||
    normalized.length > PRIVATE_PROMPT_MAX_LENGTH ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)
  ) {
    throw new ShepherdControlError(
      "invalid_input",
      "A Shepherd Contract prompt must contain 1 to 2000 safe characters",
    );
  }
  return normalized;
}

function transportFromPrivatePrompt(content: string): AuthTransport {
  const normalized = normalizedPrivatePrompt(content).toLocaleLowerCase("en-US");
  const requestsCookie =
    /\bhttp[\s-]*only\b/u.test(normalized) && /\bcookie\b/u.test(normalized);
  const requestsBearer =
    (/\bbearer\b/u.test(normalized) && /\bjwt\b/u.test(normalized)) ||
    /\bjwt[\s-]*bearer\b/u.test(normalized);
  if (requestsCookie === requestsBearer) {
    throw new ShepherdControlError(
      "invalid_input",
      requestsCookie
        ? "Name only one authentication transport in this Contract prompt"
        : "Name either an HttpOnly cookie or a bearer JWT in this Contract prompt",
    );
  }
  return requestsCookie ? COOKIE_TRANSPORT : BEARER_TRANSPORT;
}

function authTransportFromPrivatePrompt(content: string): AuthTransport | null {
  try {
    return transportFromPrivatePrompt(content);
  } catch (error) {
    if (error instanceof ShepherdControlError && error.code === "invalid_input") {
      return null;
    }
    throw error;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedText(value: unknown, minimum: number, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isModelReviewIdentifier(value: unknown): value is string {
  return isBoundedText(value, 1, 128) && MODEL_REVIEW_IDENTIFIER.test(value);
}

function isModelReviewEvidenceReference(
  value: unknown,
  pair: ReadonlySet<string>,
): value is Record<string, unknown> {
  return (
    isPlainRecord(value) &&
    hasOnlyKeys(value, MODEL_REVIEW_EVIDENCE_KEYS) &&
    isModelReviewIdentifier(value.contractId) &&
    pair.has(value.contractId) &&
    typeof value.source === "string" &&
    MODEL_REVIEW_EVIDENCE_SOURCES.has(value.source) &&
    isBoundedText(value.ref, 1, 512)
  );
}

function isModelReviewFinding(
  value: unknown,
  inputContractIds: ReadonlySet<string>,
): value is Record<string, unknown> {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, MODEL_REVIEW_FINDING_KEYS) ||
    typeof value.kind !== "string" ||
    !MODEL_REVIEW_FINDING_KINDS.has(value.kind) ||
    !isModelReviewIdentifier(value.leftContractId) ||
    !isModelReviewIdentifier(value.rightContractId) ||
    value.leftContractId === value.rightContractId ||
    !inputContractIds.has(value.leftContractId) ||
    !inputContractIds.has(value.rightContractId) ||
    !isBoundedText(value.leftKey, 0, 128) ||
    !isBoundedText(value.rightKey, 0, 128) ||
    (value.kind === "equivalent_key" &&
      (value.leftKey.length === 0 || value.rightKey.length === 0)) ||
    typeof value.confidence !== "string" ||
    !MODEL_REVIEW_CONFIDENCES.has(value.confidence) ||
    !isBoundedText(value.reason, 1, 512) ||
    !Array.isArray(value.evidenceRefs) ||
    value.evidenceRefs.length < 1 ||
    value.evidenceRefs.length > MODEL_REVIEW_MAX_EVIDENCE_REFS
  ) {
    return false;
  }

  const pair = new Set([value.leftContractId, value.rightContractId]);
  if (
    !value.evidenceRefs.every((reference) =>
      isModelReviewEvidenceReference(reference, pair),
    )
  ) {
    return false;
  }
  const referencedContracts = new Set(
    value.evidenceRefs.map((reference) => reference.contractId),
  );
  return (
    referencedContracts.has(value.leftContractId) &&
    referencedContracts.has(value.rightContractId)
  );
}

function isModelReviewResult(
  value: unknown,
  input: ModelReviewInput,
): value is ModelReviewResult {
  try {
    if (!isPlainRecord(value) || typeof value.status !== "string") return false;
    if (value.status === "disabled" || value.status === "cancelled") {
      return hasOnlyKeys(value, MODEL_REVIEW_STATUS_KEYS);
    }
    if (value.status === "degraded") {
      return (
        hasOnlyKeys(value, MODEL_REVIEW_DEGRADED_KEYS) &&
        typeof value.reason === "string" &&
        MODEL_REVIEW_DEGRADED_REASONS.has(value.reason) &&
        typeof value.retryable === "boolean"
      );
    }
    if (
      value.status !== "completed" ||
      !hasOnlyKeys(value, MODEL_REVIEW_COMPLETED_KEYS) ||
      !Array.isArray(value.findings) ||
      value.findings.length > MODEL_REVIEW_MAX_FINDINGS
    ) {
      return false;
    }
    if (
      value.droppedFindingCount !== undefined &&
      (typeof value.droppedFindingCount !== "number" ||
        !Number.isSafeInteger(value.droppedFindingCount) ||
        value.droppedFindingCount < 1 ||
        value.droppedFindingCount > MODEL_REVIEW_MAX_FINDINGS)
    ) {
      return false;
    }
    const inputContractIds = new Set(
      input.contracts.map((contract) => contract.contractId),
    );
    return value.findings.every((finding) =>
      isModelReviewFinding(finding, inputContractIds),
    );
  } catch {
    return false;
  }
}

export {
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_BACKEND_PROFILE_ID,
  AUTH_PROJECT_PROFILE_ID,
} from "./auth-fixture.js";

const frontendCheck = (): AcceptanceCheck => ({
  id: AUTH_FRONTEND_CHECK_ID,
  name: "Frontend authentication contract",
  profileId: AUTH_FRONTEND_PROFILE_ID,
  mandatory: true,
  timeoutMs: 30_000,
});

const backendCheck = (): AcceptanceCheck => ({
  id: AUTH_BACKEND_CHECK_ID,
  name: "Backend authentication contract",
  profileId: AUTH_BACKEND_PROFILE_ID,
  mandatory: true,
  timeoutMs: 30_000,
});

const projectCheck = (): AcceptanceCheck => ({
  id: AUTH_PROJECT_CHECK_ID,
  name: "Project authentication security invariant",
  profileId: AUTH_PROJECT_PROFILE_ID,
  mandatory: true,
  timeoutMs: 30_000,
});

const generalContractCheck = (): AcceptanceCheck => ({
  id: GENERAL_CONTRACT_CHECK_ID,
  name: "Confirmed general Contract artifacts",
  profileId: GENERAL_CONTRACT_PROFILE_ID,
  mandatory: true,
  timeoutMs: 30_000,
});

const protectedPatterns = [
  ".git/**",
  ".shepherd/**",
  "checks/**",
  "policy.json",
] as const;

function authorityFor(area: "frontend" | "backend" | "resolution"): ScopedAuthority {
  const writable =
    area === "resolution"
      ? ["src/frontend/**", "src/backend/**"]
      : [`src/${area}/**`];
  return {
    readable: ["**"],
    writable,
    forbidden: [...protectedPatterns],
  };
}

function boundedContractAuthority(
  agentAuthority: ScopedAuthority,
  requestedAuthority: ScopedAuthority,
): ScopedAuthority {
  const intersection = intersectScopedAuthority(agentAuthority, requestedAuthority);
  if (!intersection.ok) {
    throw new Error("Execution Contract authority exceeds its assigned Agent authority");
  }
  return intersection.authority;
}

function boundedConflictPreview(conflictFiles: readonly string[]): string {
  return JSON.stringify(
    conflictFiles.slice(0, 8).map((file) =>
      file.length <= 48 ? file : `${file.slice(0, 45)}...`,
    ),
  );
}

export interface ShepherdIndependentVerifier {
  verify(request: VerificationRequest): Promise<VerificationEvidence>;
  cancel?(targetId: string): Promise<boolean>;
  reconcileInterrupted?(): Promise<void>;
}

export type ShepherdFaultCheckpoint =
  | "contract_plane_creation_start"
  | "contract_execution_workspace_ready"
  | "contract_verification_snapshot_ready"
  | "integration_merge_start"
  | "promotion_ready_for_cas"
  | "promotion_cas_completed"
  | "general_completion_persistence";

export interface ShepherdFaultCheckpointContext {
  missionId?: string;
  contractId?: string;
  candidateId?: string;
  planeId?: string;
}

export interface ShepherdServiceOptions {
  store: JsonStore;
  managedRoot: string;
  /** Must match the WorkspaceManager root used by AgentService. */
  agentWorkspaceRoot?: string;
  verifier: ShepherdIndependentVerifier;
  executor?: ShepherdExecutor;
  sensitiveValues?: readonly string[];
  /** Deterministic process-kill test seam. Undefined in production composition. */
  faultCheckpoint?: (
    checkpoint: ShepherdFaultCheckpoint,
    context: ShepherdFaultCheckpointContext,
  ) => void | Promise<void>;
  /** Internal test-only seam around the protected-ref/worktree CAS boundary. */
  gitPromotionFaults?: GitClientOptions["promotionFaults"];
  /** Internal test-only seam around merge-conflict cleanup and inspection. */
  gitMergeFaults?: GitClientOptions["mergeFaults"];
  now?: () => Date;
  idFactory?: (prefix: string) => string;
  contractTimeoutMs?: number;
  candidateTimeoutMs?: number;
  /**
   * Advisory-only semantic reviewer. Absent means no review is attempted and
   * no advisory event is emitted. Its output can never influence deterministic
   * collision detection, winner selection, or promotion.
   */
  reviewer?: ModelReviewer;
  /**
   * Internal test-only seam. Bounds an injected reviewer that does not bound
   * itself, and sets how often an in-flight review re-checks durable
   * cancellation. Production composition leaves both at their defaults.
   */
  modelReviewBounds?: { deadlineMs?: number; cancellationPollMs?: number };
}

export interface DeterministicDemoOptions {
  projectId?: string;
  allowClientReadableCredential?: boolean;
  /** Bounded human intent retained while the runnable plan stays the fixed demo. */
  originalIntent?: string;
  /** Optional user-created Agents selected by the trusted auth-demo planner. */
  frontendAgentId?: string;
  backendAgentId?: string;
  frontendTransport?: AuthTransport;
  backendTransport?: AuthTransport;
  /** Exact bounded user prompts collected from the two private Agent chats. */
  contractPrompts?: {
    frontend: string;
    backend: string;
  };
  /** Durable private-chat records atomically bound when the Mission is created. */
  privatePromptRecords?: {
    frontend: PrivateContractPromptRecord;
    backend: PrivateContractPromptRecord;
  };
  /** Internal durable request binding used by the HTTP Mission command. */
  requestRecord?: {
    messageId: string;
    fingerprint: string;
  };
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

export interface ShepherdPlaneDetail {
  plane: Plane;
  mission: Mission;
  project: ShepherdProject;
  contract: ExecutionContract | null;
  candidate: ResolutionCandidate | null;
  verificationEvidence: VerificationEvidence[];
}

export interface ShepherdCollisionDetail {
  collision: SemanticCollision;
  mission: Mission;
  project: ShepherdProject;
  sourceContracts: [ExecutionContract, ExecutionContract];
  candidates: ResolutionCandidate[];
  planes: Plane[];
}

export interface ShepherdCandidateDetail {
  candidate: ResolutionCandidate;
  collision: SemanticCollision;
  mission: Mission;
  project: ShepherdProject;
  plane: Plane;
  previousPlanes: Plane[];
}

export interface ShepherdSettingsUpdate {
  contractTimeoutMs?: number;
  candidateTimeoutMs?: number;
  autoResolution?: boolean;
  maxConcurrentPlanes?: number;
  modelReviewEnabled?: boolean;
  notifications?: Partial<ShepherdSettings["notifications"]>;
}

export interface SendProjectGroupMessageInput {
  clientMessageId: string;
  content: string;
  assignmentPreset?: "auth-demo-contract";
}

export interface StartMissionFromMessageInput {
  content: string;
  preset: "auth-demo";
  clientMessageId?: string;
  frontendAgentId?: string;
  backendAgentId?: string;
  frontendTransport?: AuthTransport;
  backendTransport?: AuthTransport;
}

export interface SubmitPrivateContractPromptInput {
  agentId: string;
  clientMessageId: string;
  content: string;
}

export interface PrivateContractPromptResult {
  status: "clarification_required" | "awaiting_peer" | "accepted";
  missionId: string | null;
  contractId: string | null;
  clarification: string | null;
  message: ProjectGroupMessage;
}

interface PrivateContractPromptRecord {
  messageId: string;
  fingerprint: string;
  content: string;
  agentId: string;
  role: "Frontend" | "Backend";
  transport: AuthTransport;
  createdAt: string;
}

export type ShepherdControlErrorCode =
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "unsupported_assignment"
  | "idempotency_conflict";

export class ShepherdControlError extends Error {
  constructor(
    readonly code: ShepherdControlErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ShepherdControlError";
  }
}

export interface DeterministicDemoResetResult {
  projectId: "auth-demo";
  restoredHead: string | null;
  removedPlanePaths: string[];
  removed: {
    missions: number;
    contracts: number;
    planes: number;
    claims: number;
    collisions: number;
    candidates: number;
    events: number;
    messages: number;
  };
}

export interface DeterministicDemoResult {
  mission: Mission;
  collision: SemanticCollision;
  candidates: ResolutionCandidate[];
  selectedCandidate: ResolutionCandidate;
  integrationCommit: string;
  promotedHead: string;
}

interface PreparedProjectMission {
  project: ManagedAuthDemoProject | ManagedGeneralAgentProject;
  planeManager: PlaneManager;
  missionId: string;
}

interface PreparedMission extends PreparedProjectMission {
  project: ManagedAuthDemoProject;
  frontendContractId: string;
  backendContractId: string;
  frontendTransport: AuthTransport;
  backendTransport: AuthTransport;
}

interface PreparedGeneralMission extends PreparedProjectMission {
  project: ManagedGeneralAgentProject;
  contractId: string;
  agentId: string;
  artifactPaths: string[];
  requiredContent: string | null;
}

interface ContractPlaneInput {
  contractId: string;
  operation: DeterministicOperation;
}

interface CandidateWork {
  candidateId: string;
  plane: Plane;
  operation: Extract<DeterministicOperation, { kind: "resolution_candidate" }>;
}

function replaceById<T extends { id: string }>(collection: T[], value: T): void {
  const index = collection.findIndex((item) => item.id === value.id);
  if (index === -1) collection.push(structuredClone(value));
  else collection[index] = structuredClone(value);
}

interface EventInput {
  type: ShepherdEvent["type"];
  summary: string;
  missionId: string;
  contractId?: string | null;
  agentId?: string | null;
  planeId?: string | null;
  collisionId?: string | null;
  candidateId?: string | null;
  actor?: ShepherdEventActor;
  details?: ShepherdEvent["details"];
  timestamp: string;
}

function appendRawEvent(
  database: Database,
  input: EventInput,
): ShepherdEvent {
  return appendShepherdEvent(database, {
    type: input.type,
    summary: input.summary,
    actor: input.actor ?? SHEPHERD_ACTOR,
    missionId: input.missionId,
    contractId: input.contractId ?? null,
    agentId: input.agentId ?? null,
    planeId: input.planeId ?? null,
    collisionId: input.collisionId ?? null,
    candidateId: input.candidateId ?? null,
    details: input.details ?? {},
    timestamp: input.timestamp,
  });
}

async function readBoundedRegularFile(filePath: string): Promise<string> {
  const entry = await lstat(filePath);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error("Result manifest must be a regular file");
  }
  if (entry.size > MAX_MANIFEST_BYTES) {
    throw new Error("Result manifest exceeds the trusted ingestion limit");
  }
  return await readFile(filePath, "utf8");
}

async function existingRegularPaths(
  root: string,
  changedPaths: readonly string[],
): Promise<string[]> {
  const existing: string[] = [];
  for (const changedPath of changedPaths) {
    const destination = path.join(root, ...changedPath.split("/"));
    try {
      const entry = await lstat(destination);
      if (!entry.isSymbolicLink() && entry.isFile()) existing.push(changedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return existing;
}

function terminalMission(state: Mission["state"]): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function pathsOverlap(left: string, right: string): boolean {
  const relative = path.relative(left, right);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative)) ||
    (() => {
      const inverse = path.relative(right, left);
      return (
        !inverse.startsWith(".." + path.sep) &&
        inverse !== ".." &&
        !path.isAbsolute(inverse)
      );
    })()
  );
}

async function allSettledBounded<T>(
  inputs: readonly T[],
  limit: number,
  operation: (input: T, index: number) => Promise<void>,
): Promise<PromiseSettledResult<void>[]> {
  const results = new Array<PromiseSettledResult<void>>(inputs.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= inputs.length) return;
      const input = inputs[index];
      if (input === undefined) return;
      try {
        await operation(input, index);
        results[index] = { status: "fulfilled", value: undefined };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  const workers = Array.from(
    { length: Math.min(inputs.length, Math.max(1, limit)) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/** Stable UUID-shaped identity accepted by all existing Agent API routes. */
export function deterministicDemoAgentId(
  projectId: string,
  role: "frontend" | "backend",
): string {
  const bytes = createHash("sha256")
    .update(`shepherd-demo-agent\0${projectId}\0${role}`, "utf8")
    .digest()
    .subarray(0, 16);
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Could not derive deterministic Agent identity");
  }
  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class AuthorityViolationError extends Error {
  constructor(readonly stage: "contract" | "candidate") {
    super(`Scoped authority denied ${stage} changes`);
    this.name = "AuthorityViolationError";
  }
}

class ContractVerificationInfrastructureError extends Error {
  constructor() {
    super("Contract independent verification infrastructure failed");
    this.name = "ContractVerificationInfrastructureError";
  }
}

class MissionCancelledError extends Error {
  constructor() {
    super("Mission was cancelled");
    this.name = "MissionCancelledError";
  }
}

/**
 * Orchestrates the deterministic, real-Git Shepherd walking skeleton. The
 * shared JsonStore must be initialized once by application composition before
 * this service is used; initialize() establishes only the managed project root.
 */
export class ShepherdService {
  private readonly store: JsonStore;
  private readonly managedRoot: string;
  private readonly agentWorkspaceRoot: string;
  private readonly workspaceManager: WorkspaceManager;
  private readonly verifier: ShepherdIndependentVerifier;
  private readonly executor: ShepherdExecutor;
  private readonly sensitiveValues: string[];
  private readonly faultCheckpoint:
    | ShepherdServiceOptions["faultCheckpoint"]
    | undefined;
  private readonly gitPromotionFaults: GitClientOptions["promotionFaults"];
  private readonly gitMergeFaults: GitClientOptions["mergeFaults"];
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private readonly contractTimeoutMs: number;
  private readonly candidateTimeoutMs: number;
  private readonly reviewer: ModelReviewer | null;
  private readonly modelReviewDeadlineMs: number;
  private readonly modelReviewPollMs: number;
  private initialization: Promise<void> | null = null;
  private readonly activeProjects = new Set<string>();
  private readonly backgroundRuns = new Map<
    string,
    Promise<unknown | null>
  >();
  private readonly pendingMissionStarts = new Map<
    string,
    {
      fingerprint: string;
      operation: Promise<{ missionId: string; message: ProjectGroupMessage }>;
    }
  >();
  private privatePromptTail: Promise<void> = Promise.resolve();

  constructor(options: ShepherdServiceOptions) {
    this.store = options.store;
    this.managedRoot = path.resolve(options.managedRoot);
    this.agentWorkspaceRoot = path.resolve(
      options.agentWorkspaceRoot ?? path.join(this.managedRoot, "agent-workspaces"),
    );
    this.workspaceManager = new WorkspaceManager(this.agentWorkspaceRoot);
    this.verifier = options.verifier;
    this.executor = options.executor ?? new DeterministicFixtureExecutor();
    this.sensitiveValues = [...new Set(options.sensitiveValues ?? [])].filter(
      (value) => value.length > 0,
    );
    this.faultCheckpoint = options.faultCheckpoint;
    this.gitPromotionFaults = options.gitPromotionFaults;
    this.gitMergeFaults = options.gitMergeFaults;
    this.now = options.now ?? (() => new Date());
    this.idFactory =
      options.idFactory ??
      ((prefix) => `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`);
    this.contractTimeoutMs = this.executionTimeout(
      options.contractTimeoutMs ?? 600_000,
      "Contract",
    );
    this.candidateTimeoutMs = this.executionTimeout(
      options.candidateTimeoutMs ?? 600_000,
      "Candidate",
    );
    this.reviewer = options.reviewer ?? null;
    this.modelReviewDeadlineMs = Math.max(
      1,
      options.modelReviewBounds?.deadlineMs ?? MODEL_REVIEW_SERVICE_DEADLINE_MS,
    );
    this.modelReviewPollMs = Math.max(
      1,
      options.modelReviewBounds?.cancellationPollMs ??
        MODEL_REVIEW_CANCELLATION_POLL_MS,
    );
  }

  async initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    await this.initialization;
    const snapshot = this.store.snapshot();
    for (const project of snapshot.shepherd.projects) {
      const missionIds = new Set(
        snapshot.shepherd.missions
          .filter((mission) => mission.projectId === project.id)
          .map((mission) => mission.id),
      );
      const agentIds = new Set(
        snapshot.shepherd.contracts
          .filter((contract) => missionIds.has(contract.missionId))
          .map((contract) => contract.agentId),
      );
      for (const agent of snapshot.agents.filter((item) => agentIds.has(item.id))) {
        await this.ensureAgentWorkspace(agent, project.repositoryPath, null, true);
      }
    }
  }

  private async initializeOnce(): Promise<void> {
    await reconcilePersistenceRecoveryIntent({ store: this.store, now: this.now });
    const durableProjectHeads = new Map(
      this.store.snapshot().shepherd.projects.map((project) => [
        project.id,
        project.protectedHeadCommit,
      ]),
    );
    const durableProjectIds = new Set(durableProjectHeads.keys());
    await reconcileGeneralProjectCreations(this.managedRoot, durableProjectIds);
    await reconcileGeneralProjectPolicyUpdates(this.managedRoot, durableProjectHeads);
    if (durableProjectIds.size > 0) {
      await validateShepherdManagedRoot(this.managedRoot);
    } else {
      await assertNoManagedProjectState(this.managedRoot);
      await initializeShepherdManagedRoot(this.managedRoot);
    }
    const initialState = this.store.snapshot();
    if (
      initialState.shepherd.projects.length === 0 &&
      initialState.shepherd.missions.length === 0 &&
      initialState.shepherd.events.length === 0 &&
      (initialState.shepherd.settings.contractTimeoutMs !== this.contractTimeoutMs ||
        initialState.shepherd.settings.candidateTimeoutMs !== this.candidateTimeoutMs ||
        initialState.shepherd.settings.mode !==
          (this.executor.kind === "codex_ephemeral"
            ? "production"
            : "deterministic_test") ||
        !initialState.shepherd.settings.retainCompletedPlanes)
    ) {
      await this.store.mutate((database) => {
        database.shepherd.settings.contractTimeoutMs = this.contractTimeoutMs;
        database.shepherd.settings.candidateTimeoutMs = this.candidateTimeoutMs;
        database.shepherd.settings.mode =
          this.executor.kind === "codex_ephemeral"
            ? "production"
            : "deterministic_test";
        database.shepherd.settings.retainCompletedPlanes = true;
        database.shepherd.settings.updatedAt = this.timestamp();
      });
    }
    await this.initializeWorkspaceRoot();
    let runtimeRecoveryError: unknown = null;
    try {
      await this.executor.reconcileInterrupted?.();
    } catch (error) {
      runtimeRecoveryError = error;
    }
    let verifierRecoveryError: unknown = null;
    try {
      await this.verifier.reconcileInterrupted?.();
    } catch (error) {
      verifierRecoveryError = error;
    }
    const recovery = await reconcileShepherdStartup({
      store: this.store,
      managedRoot: this.managedRoot,
      now: this.now,
    });
    const inspectionFailure = recovery.observations.find(
      (observation) =>
        observation.inspectionError !== null ||
        observation.classification === "protected_branch_moved" ||
        observation.classification === "protected_worktree_mismatch",
    );
    if (inspectionFailure) {
      throw new Error("Shepherd startup artifact reconciliation failed");
    }
    if (runtimeRecoveryError) {
      throw new Error("Agent Runtime startup reconciliation failed", {
        cause: runtimeRecoveryError,
      });
    }
    if (verifierRecoveryError) {
      throw new Error("Independent verifier startup reconciliation failed", {
        cause: verifierRecoveryError,
      });
    }
    await this.executor.preflight?.();
  }

  private async checkpoint(
    checkpoint: ShepherdFaultCheckpoint,
    context: ShepherdFaultCheckpointContext,
  ): Promise<void> {
    await this.faultCheckpoint?.(checkpoint, context);
  }

  state(): ShepherdDatabase {
    return this.store.snapshot().shepherd;
  }

  missionDetail(missionId: string): ShepherdMissionDetail | null {
    const database = this.store.snapshot();
    const mission = database.shepherd.missions.find((item) => item.id === missionId);
    if (!mission) return null;
    const project = database.shepherd.projects.find(
      (item) => item.id === mission.projectId,
    );
    if (!project) throw new Error("Mission references a missing Shepherd project");
    const contracts = database.shepherd.contracts.filter(
      (item) => item.missionId === missionId,
    );
    const agentIds = new Set(contracts.map((contract) => contract.agentId));
    return {
      mission,
      project,
      agents: database.agents.filter((agent) => agentIds.has(agent.id)),
      contracts,
      planes: database.shepherd.planes.filter(
        (item) => item.missionId === missionId,
      ),
      claims: database.shepherd.claims.filter(
        (item) => item.missionId === missionId,
      ),
      collisions: database.shepherd.collisions.filter(
        (item) => item.missionId === missionId,
      ),
      candidates: database.shepherd.candidates.filter(
        (item) => item.missionId === missionId,
      ),
      events: database.shepherd.events
        .filter((item) => item.missionId === missionId)
        .sort((left, right) => left.sequence - right.sequence),
    };
  }

  planeDetail(planeId: string): ShepherdPlaneDetail | null {
    const database = this.store.snapshot();
    const plane = database.shepherd.planes.find((item) => item.id === planeId);
    if (!plane) return null;
    const mission = database.shepherd.missions.find(
      (item) => item.id === plane.missionId,
    );
    const project = database.shepherd.projects.find(
      (item) => item.id === plane.projectId,
    );
    if (!mission || !project) throw new Error("Plane references missing durable state");
    const contract = plane.contractId
      ? database.shepherd.contracts.find((item) => item.id === plane.contractId) ?? null
      : null;
    const candidate = plane.candidateId
      ? database.shepherd.candidates.find((item) => item.id === plane.candidateId) ?? null
      : null;
    const evidence = [
      ...(contract?.verificationEvidence ?? []),
      ...(candidate?.previousAttempts ?? []).flatMap((attempt) =>
        attempt.verificationEvidence ? [attempt.verificationEvidence] : [],
      ),
      ...(candidate?.verificationEvidence ? [candidate.verificationEvidence] : []),
      ...(candidate?.promotionEvidence ? [candidate.promotionEvidence] : []),
      ...(plane.generalPromotionEvidence ? [plane.generalPromotionEvidence] : []),
    ];
    const evidenceById = new Map(evidence.map((item) => [item.id, item]));
    return {
      plane,
      mission,
      project,
      contract,
      candidate,
      verificationEvidence: plane.verificationEvidenceIds.map((id) => {
        const item = evidenceById.get(id);
        if (!item) throw new Error("Plane references missing verification evidence");
        return item;
      }),
    };
  }

  collisionDetail(collisionId: string): ShepherdCollisionDetail | null {
    const database = this.store.snapshot();
    const collision = database.shepherd.collisions.find(
      (item) => item.id === collisionId,
    );
    if (!collision) return null;
    const mission = database.shepherd.missions.find(
      (item) => item.id === collision.missionId,
    );
    const project = database.shepherd.projects.find(
      (item) => item.id === mission?.projectId,
    );
    const left = database.shepherd.contracts.find(
      (item) => item.id === collision.leftContractId,
    );
    const right = database.shepherd.contracts.find(
      (item) => item.id === collision.rightContractId,
    );
    if (!mission || !project || !left || !right) {
      throw new Error("Collision references missing durable state");
    }
    const candidates = database.shepherd.candidates.filter(
      (item) => item.collisionId === collision.id,
    );
    const planeIds = new Set(
      candidates.flatMap((candidate) => [
        candidate.planeId,
        ...(candidate.previousAttempts ?? []).map((attempt) => attempt.planeId),
      ]),
    );
    return {
      collision,
      mission,
      project,
      sourceContracts: [left, right],
      candidates,
      planes: database.shepherd.planes.filter((plane) => planeIds.has(plane.id)),
    };
  }

  candidateDetail(candidateId: string): ShepherdCandidateDetail | null {
    const database = this.store.snapshot();
    const candidate = database.shepherd.candidates.find(
      (item) => item.id === candidateId,
    );
    if (!candidate) return null;
    const collision = database.shepherd.collisions.find(
      (item) => item.id === candidate.collisionId,
    );
    const mission = database.shepherd.missions.find(
      (item) => item.id === candidate.missionId,
    );
    const project = database.shepherd.projects.find(
      (item) => item.id === mission?.projectId,
    );
    const plane = database.shepherd.planes.find(
      (item) => item.id === candidate.planeId,
    );
    if (!collision || !mission || !project || !plane) {
      throw new Error("Candidate references missing durable state");
    }
    const previousPlanes = (candidate.previousAttempts ?? []).map((attempt) => {
      const previous = database.shepherd.planes.find(
        (item) => item.id === attempt.planeId,
      );
      if (!previous) throw new Error("Candidate retry references a missing Plane");
      return previous;
    });
    return { candidate, collision, mission, project, plane, previousPlanes };
  }

  settings(): ShepherdSettings {
    return {
      ...this.store.snapshot().shepherd.settings,
      mode:
        this.executor.kind === "codex_ephemeral"
          ? "production"
          : "deterministic_test",
      retainCompletedPlanes: true,
      maxConcurrentPlanes: Math.max(
        2,
        this.store.snapshot().shepherd.settings.maxConcurrentPlanes,
      ),
    };
  }

  async updateSettings(input: ShepherdSettingsUpdate): Promise<ShepherdSettings> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new ShepherdControlError("invalid_input", "Settings update must be an object");
    }
    const allowed = new Set([
      "contractTimeoutMs",
      "candidateTimeoutMs",
      "autoResolution",
      "maxConcurrentPlanes",
      "modelReviewEnabled",
      "notifications",
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
      throw new ShepherdControlError("invalid_input", "Settings update has unknown fields");
    }
    for (const [label, value] of [
      ["Contract", input.contractTimeoutMs],
      ["Candidate", input.candidateTimeoutMs],
    ] as const) {
      if (value !== undefined) {
        try {
          this.executionTimeout(value, label);
        } catch {
          throw new ShepherdControlError(
            "invalid_input",
            `${label} timeout must be between 1000 and 3600000 ms`,
          );
        }
      }
    }
    if (
      input.maxConcurrentPlanes !== undefined &&
      (!Number.isSafeInteger(input.maxConcurrentPlanes) ||
        input.maxConcurrentPlanes < 2 ||
        input.maxConcurrentPlanes > 16)
    ) {
      throw new ShepherdControlError(
        "invalid_input",
        "Maximum concurrent Planes must be between 2 and 16 for speculative resolution",
      );
    }
    for (const value of [
      input.autoResolution,
      input.modelReviewEnabled,
    ]) {
      if (value !== undefined && typeof value !== "boolean") {
        throw new ShepherdControlError("invalid_input", "Settings booleans are invalid");
      }
    }
    if (input.notifications !== undefined) {
      if (
        !input.notifications ||
        typeof input.notifications !== "object" ||
        Array.isArray(input.notifications) ||
        Object.keys(input.notifications).some(
          (key) =>
            ![
              "missionCompleted",
              "attentionRequired",
              "collisionDetected",
            ].includes(key),
        ) ||
        Object.values(input.notifications).some(
          (value) => value !== undefined && typeof value !== "boolean",
        )
      ) {
        throw new ShepherdControlError(
          "invalid_input",
          "Notification settings are invalid",
        );
      }
    }
    return await this.store.mutate((database) => {
      if (database.shepherd.missions.some((mission) => !terminalMission(mission.state))) {
        throw new ShepherdControlError(
          "conflict",
          "Settings cannot change while a Mission is active",
        );
      }
      const current = database.shepherd.settings;
      const updated: ShepherdSettings = {
        ...current,
        mode:
          this.executor.kind === "codex_ephemeral"
            ? "production"
            : "deterministic_test",
        ...(input.contractTimeoutMs === undefined
          ? {}
          : { contractTimeoutMs: input.contractTimeoutMs }),
        ...(input.candidateTimeoutMs === undefined
          ? {}
          : { candidateTimeoutMs: input.candidateTimeoutMs }),
        ...(input.autoResolution === undefined
          ? {}
          : { autoResolution: input.autoResolution }),
        ...(input.maxConcurrentPlanes === undefined
          ? {}
          : { maxConcurrentPlanes: input.maxConcurrentPlanes }),
        retainCompletedPlanes: true,
        ...(input.modelReviewEnabled === undefined
          ? {}
          : { modelReviewEnabled: input.modelReviewEnabled }),
        notifications: {
          ...current.notifications,
          ...(input.notifications ?? {}),
        },
        updatedAt: this.timestamp(),
      };
      database.shepherd.settings = updated;
      return structuredClone(updated);
    });
  }

  projectGroupMessages(projectId: string, limit = 200): ProjectGroupMessage[] {
    if (!SAFE_ID.test(projectId)) {
      throw new ShepherdControlError("invalid_input", "Project ID is invalid");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new ShepherdControlError("invalid_input", "Message limit must be 1 to 500");
    }
    return this.store
      .snapshot()
      .shepherd.groupMessages.filter((message) => message.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-limit);
  }

  async sendProjectGroupMessage(
    projectId: string,
    input: SendProjectGroupMessageInput,
  ): Promise<ProjectGroupMessage> {
    if (!SAFE_ID.test(projectId) || !SAFE_ID.test(input.clientMessageId)) {
      throw new ShepherdControlError("invalid_input", "Message identity is invalid");
    }
    if (
      input.assignmentPreset !== undefined &&
      input.assignmentPreset !== "auth-demo-contract"
    ) {
      throw new ShepherdControlError(
        "unsupported_assignment",
        "Only the fixed auth-demo Contract assignment preset is supported",
      );
    }
    const snapshot = this.store.snapshot();
    const project = snapshot.shepherd.projects.find((item) => item.id === projectId);
    if (!project) throw new ShepherdControlError("not_found", "Project was not found");
    const projectMissions = snapshot.shepherd.missions.filter(
      (mission) => mission.projectId === projectId,
    );
    const projectMissionIds = new Set(projectMissions.map((mission) => mission.id));
    const projectContracts = snapshot.shepherd.contracts.filter((contract) =>
      projectMissionIds.has(contract.missionId),
    );
    const agentIds = new Set(projectContracts.map((contract) => contract.agentId));
    const agents = snapshot.agents.filter((agent) => agentIds.has(agent.id));
    const uniqueAgents = [...new Map(agents.map((agent) => [agent.id, agent])).values()];
    let route;
    try {
      route = parseProjectGroupMessage(input.content, uniqueAgents);
    } catch (error) {
      throw new ShepherdControlError(
        "invalid_input",
        error instanceof Error ? error.message : "Project Group message is invalid",
      );
    }
    const activeMission = project.activeMissionId
      ? projectMissions.find((mission) => mission.id === project.activeMissionId) ?? null
      : null;
    let targetAgentId: string | null = null;
    let contractId: string | null = null;
    let content = route.content;
    if (route.kind === "agent") {
      if (input.assignmentPreset !== "auth-demo-contract") {
        throw new ShepherdControlError(
          "unsupported_assignment",
          "Free-form @Agent assignments are not runnable in the fixed demo",
        );
      }
      if (!activeMission) {
        throw new ShepherdControlError(
          "conflict",
          "The auth-demo Contract preset needs an active Mission",
        );
      }
      const contract = projectContracts.find(
        (item) =>
          item.missionId === activeMission.id && item.agentId === route.agentId,
      );
      if (!contract) {
        throw new ShepherdControlError(
          "unsupported_assignment",
          "The mentioned Agent has no Contract in the active auth demo",
        );
      }
      targetAgentId = route.agentId;
      contractId = contract.id;
    } else if (input.assignmentPreset !== undefined) {
      throw new ShepherdControlError(
        "unsupported_assignment",
        "The auth-demo Contract preset requires a leading @Agent mention",
      );
    }
    const messageId =
      "group-" +
      createHash("sha256")
        .update(`${projectId}\0${input.clientMessageId}`, "utf8")
        .digest("hex")
        .slice(0, 40);
    const message: ProjectGroupMessage = {
      id: messageId,
      projectId,
      missionId: activeMission?.id ?? null,
      senderType: "human",
      senderId: null,
      content,
      targetAgentId,
      contractId,
      createdAt: this.timestamp(),
    };
    return await this.store.mutate((database) => {
      const existing = database.shepherd.groupMessages.find(
        (item) => item.id === messageId,
      );
      if (existing) {
        if (
          existing.projectId !== message.projectId ||
          existing.content !== message.content ||
          existing.targetAgentId !== message.targetAgentId ||
          existing.contractId !== message.contractId
        ) {
          throw new ShepherdControlError(
            "idempotency_conflict",
            "Client message ID was already used for different content",
          );
        }
        return structuredClone(existing);
      }
      return appendProjectGroupMessage(database, message);
    });
  }

  private async serializePrivatePrompt<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.privatePromptTail;
    let release!: () => void;
    this.privatePromptTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async ensurePrivatePromptProject(
    database: Database,
    timestamp: string,
  ): Promise<void> {
    if (this.activeProjects.has("auth-demo")) {
      throw new ShepherdControlError(
        "conflict",
        "The authentication project already has an active Shepherd operation",
      );
    }
    if (
      database.shepherd.missions.some(
        (mission) => mission.projectId === "auth-demo" && !terminalMission(mission.state),
      )
    ) {
      throw new ShepherdControlError(
        "conflict",
        "Finish or reset the active Mission before collecting another Contract prompt",
      );
    }
    const project = await initializeAuthDemoProject({
      managedRoot: this.managedRoot,
      projectId: "auth-demo",
      allowClientReadableCredential: false,
    });
    const planeManager = new PlaneManager({
      repositoryPath: project.repositoryPath,
      planesRoot: project.planesRoot,
      protectedBranch: project.protectedBranch,
    });
    await planeManager.initialize();
    const existing = database.shepherd.projects.find(
      (item) => item.id === project.projectId,
    );
    if (existing) {
      if (
        existing.repositoryPath !== project.repositoryPath ||
        existing.protectedBranch !== project.protectedBranch ||
        existing.protectedHeadCommit !== project.headCommit ||
        existing.activeMissionId !== null
      ) {
        throw new ShepherdControlError(
          "conflict",
          "The managed authentication project is not ready for Contract intake",
        );
      }
      return;
    }
    database.shepherd.projects.push({
      id: project.projectId,
      displayName: "Authentication collision demo",
      repositoryPath: project.repositoryPath,
      protectedBranch: project.protectedBranch,
      protectedHeadCommit: project.headCommit,
      activeMissionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async submitPrivateContractPrompt(
    input: SubmitPrivateContractPromptInput,
  ): Promise<PrivateContractPromptResult> {
    await this.initialize();
    const content = normalizedPrivatePrompt(input.content);
    const snapshot = this.store.snapshot();
    const agent = snapshot.agents.find((item) => item.id === input.agentId);
    if (!agent) throw new ShepherdControlError("not_found", "Agent was not found");
    const authTransport = authTransportFromPrivatePrompt(content);
    const mentionsAuthDemoTransport =
      /\b(?:http[\s-]*only|cookie|bearer|jwt)\b/iu.test(content);
    const isConciseAuthDemoPrompt =
      (agent.role === "Frontend" || agent.role === "Backend") &&
      (authTransport !== null || mentionsAuthDemoTransport) &&
      !/\bacceptance\s*:/iu.test(content) &&
      !content.includes("`");
    if (isConciseAuthDemoPrompt) {
      return await this.submitAuthPrivateContractPrompt(input);
    }
    return await this.submitGeneralPrivateContractPrompt({ ...input, content });
  }

  private async submitAuthPrivateContractPrompt(
    input: SubmitPrivateContractPromptInput,
  ): Promise<PrivateContractPromptResult> {
    return await this.serializePrivatePrompt(async () => {
      await this.initialize();
      if (!SAFE_ID.test(input.agentId) || !SAFE_ID.test(input.clientMessageId)) {
        throw new ShepherdControlError("invalid_input", "Contract prompt identity is invalid");
      }
      const content = normalizedPrivatePrompt(input.content);
      const transport = transportFromPrivatePrompt(content);
      const initial = this.store.snapshot();
      const agent = initial.agents.find((item) => item.id === input.agentId);
      if (!agent) {
        throw new ShepherdControlError("not_found", "Agent was not found");
      }
      if (agent.role !== "Frontend" && agent.role !== "Backend") {
        throw new ShepherdControlError(
          "unsupported_assignment",
          "Only Frontend and Backend Agents can receive the authentication Contract preset",
        );
      }
      const role = agent.role;
      const messageId =
        "group-private-" +
        createHash("sha256")
          .update(`auth-demo\0${input.agentId}\0${input.clientMessageId}`, "utf8")
          .digest("hex")
          .slice(0, 40);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({
          preset: "auth-demo-contract",
          agentId: input.agentId,
          role,
          content,
          transport,
        }), "utf8")
        .digest("hex");
      const existing = initial.shepherd.groupMessages.find(
        (message) => message.id === messageId,
      );
      if (existing) {
        if (
          existing.requestFingerprint !== fingerprint ||
          existing.content !== content ||
          existing.targetAgentId !== input.agentId ||
          existing.contractAssignment?.preset !== "auth-demo-contract" ||
          existing.contractAssignment.role !== role ||
          existing.contractAssignment.transport !== transport
        ) {
          throw new ShepherdControlError(
            "idempotency_conflict",
            "Client message ID was already used for a different Contract prompt",
          );
        }
        if (existing.missionId) {
          return {
            status: "accepted",
            missionId: existing.missionId,
            contractId: existing.contractId,
            clarification: null,
            message: structuredClone(existing),
          };
        }
      }
      if (agent.status !== "ready" || agent.currentContractId) {
        throw new ShepherdControlError(
          "conflict",
          `${agent.name} must be ready before Shepherd collects its Contract prompt`,
        );
      }
      const pending = initial.shepherd.groupMessages.filter(
        (message) =>
          message.projectId === "auth-demo" &&
          message.missionId === null &&
          message.contractId === null &&
          message.contractAssignment?.preset === "auth-demo-contract",
      );
      if (
        pending.some(
          (message) =>
            message.id !== messageId && message.contractAssignment?.role === role,
        )
      ) {
        throw new ShepherdControlError(
          "conflict",
          `A ${role} Contract prompt is already waiting; reset the demo to replace it`,
        );
      }
      const oppositeRole = role === "Frontend" ? "Backend" : "Frontend";
      const peer = pending.find(
        (message) => message.contractAssignment?.role === oppositeRole,
      );
      const createdAt = existing?.createdAt ?? this.timestamp();
      const currentRecord: PrivateContractPromptRecord = {
        messageId,
        fingerprint,
        content,
        agentId: input.agentId,
        role,
        transport,
        createdAt,
      };
      if (!peer) {
        if (existing) {
          return {
            status: "awaiting_peer",
            missionId: null,
            contractId: null,
            clarification: null,
            message: structuredClone(existing),
          };
        }
        const message = await this.store.mutate(async (database) => {
          const currentAgent = database.agents.find((item) => item.id === input.agentId);
          if (
            !currentAgent ||
            currentAgent.role !== role ||
            currentAgent.status !== "ready" ||
            currentAgent.currentContractId
          ) {
            throw new ShepherdControlError(
              "conflict",
              `${agent.name} availability changed before Contract intake`,
            );
          }
          if (
            database.shepherd.groupMessages.some(
              (item) =>
                item.projectId === "auth-demo" &&
                item.missionId === null &&
                item.contractAssignment?.role === role,
            )
          ) {
            throw new ShepherdControlError(
              "conflict",
              `A ${role} Contract prompt is already waiting`,
            );
          }
          await this.ensurePrivatePromptProject(database, createdAt);
          return appendProjectGroupMessage(database, {
            id: messageId,
            projectId: "auth-demo",
            missionId: null,
            senderType: "human",
            senderId: null,
            content,
            targetAgentId: input.agentId,
            contractId: null,
            contractAssignment: {
              preset: "auth-demo-contract",
              role,
              transport,
            },
            requestFingerprint: fingerprint,
            createdAt,
          });
        });
        return {
          status: "awaiting_peer",
          missionId: null,
          contractId: null,
          clarification: null,
          message,
        };
      }
      if (
        peer.contractAssignment?.preset !== "auth-demo-contract" ||
        !peer.targetAgentId ||
        !peer.requestFingerprint
      ) {
        throw new Error("Pending private Contract prompt is missing trusted metadata");
      }
      if (peer.contractAssignment.transport === transport) {
        throw new ShepherdControlError(
          "invalid_input",
          "The Frontend and Backend prompts must request incompatible transports for this collision demo",
        );
      }
      const peerAgent = initial.agents.find((item) => item.id === peer.targetAgentId);
      if (
        !peerAgent ||
        peerAgent.role !== oppositeRole ||
        peerAgent.status !== "ready" ||
        peerAgent.currentContractId
      ) {
        throw new ShepherdControlError(
          "conflict",
          `The waiting ${oppositeRole} Agent is no longer ready`,
        );
      }
      const peerRecord: PrivateContractPromptRecord = {
        messageId: peer.id,
        fingerprint: peer.requestFingerprint,
        content: peer.content,
        agentId: peerAgent.id,
        role: oppositeRole,
        transport: peer.contractAssignment.transport,
        createdAt: peer.createdAt,
      };
      const frontend = role === "Frontend" ? currentRecord : peerRecord;
      const backend = role === "Backend" ? currentRecord : peerRecord;
      if (!existing) {
        await this.store.mutate((database) => {
          const currentAgent = database.agents.find((item) => item.id === input.agentId);
          if (
            !currentAgent ||
            currentAgent.role !== role ||
            currentAgent.status !== "ready" ||
            currentAgent.currentContractId
          ) {
            throw new ShepherdControlError(
              "conflict",
              `${agent.name} availability changed before Contract intake`,
            );
          }
          if (
            database.shepherd.groupMessages.some(
              (item) =>
                item.projectId === "auth-demo" &&
                item.missionId === null &&
                item.contractAssignment?.role === role,
            )
          ) {
            throw new ShepherdControlError(
              "conflict",
              `A ${role} Contract prompt is already waiting`,
            );
          }
          return appendProjectGroupMessage(database, {
            id: messageId,
            projectId: "auth-demo",
            missionId: null,
            senderType: "human",
            senderId: null,
            content,
            targetAgentId: input.agentId,
            contractId: null,
            contractAssignment: {
              preset: "auth-demo-contract",
              role,
              transport,
            },
            requestFingerprint: fingerprint,
            createdAt,
          });
        });
      }
      let started: { missionId: string };
      try {
        started = await this.startDeterministicDemo({
          projectId: "auth-demo",
          originalIntent:
            "Integrate the independently prompted Frontend and Backend authentication Contracts and resolve any verified semantic collision.",
          frontendAgentId: frontend.agentId,
          backendAgentId: backend.agentId,
          frontendTransport: frontend.transport,
          backendTransport: backend.transport,
          contractPrompts: {
            frontend: frontend.content,
            backend: backend.content,
          },
          privatePromptRecords: { frontend, backend },
        });
      } catch (error) {
        if (!existing) {
          await this.store.mutate((database) => {
            database.shepherd.groupMessages = database.shepherd.groupMessages.filter(
              (message) =>
                message.id !== messageId ||
                message.missionId !== null ||
                message.contractId !== null ||
                message.requestFingerprint !== fingerprint,
            );
          });
        }
        throw error;
      }
      const accepted = this.store
        .snapshot()
        .shepherd.groupMessages.find((message) => message.id === messageId);
      if (!accepted || accepted.missionId !== started.missionId || !accepted.contractId) {
        throw new Error("Private Contract prompt was not bound to its created Mission");
      }
      return {
        status: "accepted",
        missionId: started.missionId,
        contractId: accepted.contractId,
        clarification: null,
        message: structuredClone(accepted),
      };
    });
  }

  private async submitGeneralPrivateContractPrompt(
    input: SubmitPrivateContractPromptInput,
  ): Promise<PrivateContractPromptResult> {
    return await this.serializePrivatePrompt(async () => {
      if (!SAFE_ID.test(input.agentId) || !SAFE_ID.test(input.clientMessageId)) {
        throw new ShepherdControlError("invalid_input", "Contract prompt identity is invalid");
      }
      const content = normalizedPrivatePrompt(input.content);
      const initial = this.store.snapshot();
      const agent = initial.agents.find((item) => item.id === input.agentId);
      if (!agent) throw new ShepherdControlError("not_found", "Agent was not found");
      const role = agent.role ?? "Generalist";
      const authority = agent.authority ?? agentAuthorityPreset("generalist").authority;
      const projectId = `agent-${agent.id}`;
      const messageId =
        "group-private-" +
        createHash("sha256")
          .update(`general-contract\0${input.agentId}\0${input.clientMessageId}`, "utf8")
          .digest("hex")
          .slice(0, 40);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ preset: "general-contract", agentId: agent.id, content }), "utf8")
        .digest("hex");
      const existing = initial.shepherd.groupMessages.find((item) => item.id === messageId);
      if (existing) {
        if (
          existing.requestFingerprint !== fingerprint ||
          existing.content !== content ||
          existing.targetAgentId !== agent.id ||
          existing.contractAssignment?.preset !== "general-contract"
        ) {
          throw new ShepherdControlError(
            "idempotency_conflict",
            "Client message ID was already used for a different Contract prompt",
          );
        }
        await completeGeneralProjectCreation(this.managedRoot, projectId);
        const existingDraftId = existing.contractAssignment.draftId;
        const existingPlan = planGeneralContract(
          initial.shepherd.groupMessages
            .filter(
              (item) =>
                item.contractAssignment?.preset === "general-contract" &&
                item.contractAssignment.draftId === existingDraftId,
            )
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .map((item) => item.content),
          authority,
        );
        if (existing.missionId !== null) {
          return {
            status: "accepted",
            missionId: existing.missionId,
            contractId: existing.contractId,
            clarification: null,
            message: structuredClone(existing),
          };
        }
        if (
          existing.contractAssignment.status !== "accepted" ||
          existingPlan.status !== "ready"
        ) {
          return {
            status: "clarification_required",
            missionId: null,
            contractId: null,
            clarification: existingPlan.clarification,
            message: structuredClone(existing),
          };
        }
        const persistedProject = initial.shepherd.projects.find(
          (item) => item.id === projectId,
        );
        if (!persistedProject) {
          throw new ShepherdControlError(
            "conflict",
            "Accepted Contract draft is missing its managed project",
          );
        }
        const resumedProject = await initializeGeneralAgentProject({
          managedRoot: this.managedRoot,
          projectId,
          agentWorkspacePath: agent.workspacePath,
          expectedArtifacts: existingPlan.expectedArtifacts.map((artifact) => artifact.path),
          acceptanceSummary: existingPlan.acceptanceSummary!,
          requiredContent: existingPlan.requiredContent,
          expectedHead: persistedProject.protectedHeadCommit,
        });
        const resumed = await this.startGeneralAgentMission({
          agent,
          project: resumedProject,
          plan: existingPlan,
          draftId: existingDraftId,
        });
        const bound = this.store
          .snapshot()
          .shepherd.groupMessages.find((item) => item.id === messageId);
        if (!bound?.missionId || !bound.contractId) {
          throw new Error("Resumed Contract draft was not bound to its Mission");
        }
        return {
          status: "accepted",
          missionId: resumed.missionId,
          contractId: bound.contractId,
          clarification: null,
          message: structuredClone(bound),
        };
      }
      if (agent.status !== "ready" || agent.currentContractId) {
        throw new ShepherdControlError(
          "conflict",
          `${agent.name} must be ready before Shepherd collects its Contract prompt`,
        );
      }
      const pending = initial.shepherd.groupMessages
        .filter(
          (item) =>
            item.projectId === projectId &&
            item.targetAgentId === agent.id &&
            item.missionId === null &&
            item.contractAssignment?.preset === "general-contract",
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const lastPending = pending.at(-1);
      const draftId =
        lastPending?.contractAssignment?.preset === "general-contract"
          ? lastPending.contractAssignment.draftId
          : this.identifier("draft");
      let plan: GeneralContractPlan;
      try {
        plan = planGeneralContract([...pending.map((item) => item.content), content], authority);
      } catch (error) {
        if (error instanceof GeneralContractPlanError) {
          throw new ShepherdControlError("invalid_input", error.message);
        }
        throw error;
      }
      const createdAt = this.timestamp();
      let project: ManagedGeneralAgentProject | null = null;
      const durableProjectBefore = initial.shepherd.projects.find(
        (item) => item.id === projectId,
      );
      const creationJournaled = !durableProjectBefore;
      if (creationJournaled) {
        await beginGeneralProjectCreation(this.managedRoot, projectId);
      } else {
        await beginGeneralProjectPolicyUpdate(
          this.managedRoot,
          projectId,
          durableProjectBefore.protectedHeadCommit,
        );
      }
      const message = await this.store.mutate(async (database) => {
        const currentAgent = database.agents.find((item) => item.id === agent.id);
        if (
          !currentAgent ||
          (currentAgent.role ?? "Generalist") !== role ||
          currentAgent.status !== "ready" ||
          currentAgent.currentContractId
        ) {
          throw new ShepherdControlError(
            "conflict",
            `${agent.name} availability changed before Contract intake`,
          );
        }
        const currentPending = database.shepherd.groupMessages.filter(
          (item) =>
            item.projectId === projectId &&
            item.targetAgentId === agent.id &&
            item.missionId === null &&
            item.contractAssignment?.preset === "general-contract",
        );
        if (currentPending.length !== pending.length) {
          throw new ShepherdControlError("conflict", "Contract clarification changed concurrently");
        }
        const existingProject = database.shepherd.projects.find((item) => item.id === projectId);
        project = await initializeGeneralAgentProject({
          managedRoot: this.managedRoot,
          projectId,
          agentWorkspacePath: currentAgent.workspacePath,
          expectedArtifacts:
            plan.status === "ready"
              ? plan.expectedArtifacts.map((artifact) => artifact.path)
              : ["README.md"],
          acceptanceSummary:
            plan.status === "ready"
              ? plan.acceptanceSummary!
              : "Contract draft intake is pending human clarification",
          requiredContent: plan.status === "ready" ? plan.requiredContent : null,
          ...(existingProject?.protectedHeadCommit
            ? { expectedHead: existingProject.protectedHeadCommit }
            : {}),
        });
        if (durableProjectBefore) {
          await recordGeneralProjectPolicyUpdate(
            this.managedRoot,
            projectId,
            durableProjectBefore.protectedHeadCommit,
            project.headCommit,
          );
        }
        replaceById(database.shepherd.projects, {
          id: projectId,
          displayName: `${agent.name} managed project`,
          repositoryPath: project.repositoryPath,
          protectedBranch: project.protectedBranch,
          protectedHeadCommit: project.headCommit,
          activeMissionId: null,
          createdAt: existingProject?.createdAt ?? createdAt,
          updatedAt: createdAt,
        });
        return appendProjectGroupMessage(database, {
          id: messageId,
          projectId,
          missionId: null,
          senderType: "human",
          senderId: null,
          content,
          targetAgentId: agent.id,
          contractId: null,
          contractAssignment: {
            preset: "general-contract",
            role,
            draftId,
            status:
              plan.status === "ready" ? "accepted" : "clarification_required",
            missingFields: [...plan.missingFields],
            expectedArtifacts: structuredClone(plan.expectedArtifacts),
            acceptanceSummary: plan.acceptanceSummary,
            requiredContent: plan.requiredContent,
          },
          requestFingerprint: fingerprint,
          createdAt,
        });
      });
      if (creationJournaled) {
        await completeGeneralProjectCreation(this.managedRoot, projectId);
      } else {
        await completeGeneralProjectPolicyUpdate(this.managedRoot, projectId);
      }
      if (plan.status === "clarification_required") {
        return {
          status: "clarification_required",
          missionId: null,
          contractId: null,
          clarification: plan.clarification,
          message,
        };
      }
      if (!project) throw new Error("General managed project was not initialized");
      let started: { missionId: string };
      try {
        started = await this.startGeneralAgentMission({
          agent,
          project,
          plan,
          draftId,
        });
      } catch (error) {
        await this.store.mutate((database) => {
          database.shepherd.groupMessages = database.shepherd.groupMessages.filter(
            (item) =>
              item.id !== messageId ||
              item.missionId !== null ||
              item.contractId !== null ||
              item.requestFingerprint !== fingerprint,
          );
        });
        throw error;
      }
      const accepted = this.store
        .snapshot()
        .shepherd.groupMessages.find((item) => item.id === messageId);
      if (!accepted?.missionId || !accepted.contractId) {
        throw new Error("General Contract prompt was not bound to its created Mission");
      }
      return {
        status: "accepted",
        missionId: started.missionId,
        contractId: accepted.contractId,
        clarification: null,
        message: structuredClone(accepted),
      };
    });
  }

  async startMissionFromMessage(
    input: StartMissionFromMessageInput,
  ): Promise<{ missionId: string; message: ProjectGroupMessage }> {
    if (input.preset !== "auth-demo") {
      throw new ShepherdControlError(
        "unsupported_assignment",
        "Only the fixed auth-demo Mission preset is supported",
      );
    }
    let route;
    try {
      route = parseProjectGroupMessage(input.content, []);
    } catch (error) {
      throw new ShepherdControlError(
        "invalid_input",
        error instanceof Error ? error.message : "Mission intent is invalid",
      );
    }
    if (route.kind !== "shepherd" || route.content.length > 20_000) {
      throw new ShepherdControlError(
        "invalid_input",
        "Mission intent must be a bounded Shepherd message",
      );
    }
    const clientMessageId =
      input.clientMessageId ??
      ("start-" +
        createHash("sha256").update(route.content, "utf8").digest("hex").slice(0, 32));
    const messageId =
      "group-" +
      createHash("sha256")
        .update(`auth-demo\0${clientMessageId}`, "utf8")
        .digest("hex")
        .slice(0, 40);
    const expectedFrontendAgentId = input.frontendAgentId ??
      deterministicDemoAgentId("auth-demo", "frontend");
    const expectedBackendAgentId = input.backendAgentId ??
      deterministicDemoAgentId("auth-demo", "backend");
    const expectedFrontendTransport = input.frontendTransport ?? BEARER_TRANSPORT;
    const expectedBackendTransport = input.backendTransport ?? COOKIE_TRANSPORT;
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({
        preset: input.preset,
        content: route.content,
        frontendAgentId: expectedFrontendAgentId,
        backendAgentId: expectedBackendAgentId,
        frontendTransport: expectedFrontendTransport,
        backendTransport: expectedBackendTransport,
      }), "utf8")
      .digest("hex");
    const snapshot = this.store.snapshot();
    const existing = snapshot.shepherd.groupMessages.find(
      (message) => message.id === messageId,
    );
    if (existing) {
      const contracts = existing.missionId
        ? snapshot.shepherd.contracts.filter(
            (contract) => contract.missionId === existing.missionId,
          )
        : [];
      const frontend = contracts.find((contract) =>
        contract.title.startsWith("Implement frontend"),
      );
      const backend = contracts.find((contract) =>
        contract.title.startsWith("Implement backend"),
      );
      if (
        (existing.requestFingerprint !== undefined
          ? existing.requestFingerprint !== requestFingerprint
          : existing.content !== route.content ||
            frontend?.agentId !== expectedFrontendAgentId ||
            backend?.agentId !== expectedBackendAgentId ||
            !frontend?.objective.includes(`transport "${expectedFrontendTransport}"`) ||
            !backend?.objective.includes(`transport "${expectedBackendTransport}"`)) ||
        !existing.missionId ||
        existing.content !== route.content
      ) {
        throw new ShepherdControlError(
          "idempotency_conflict",
          "Client message ID was already used for a different Mission assignment",
        );
      }
      return { missionId: existing.missionId, message: existing };
    }
    const pending = this.pendingMissionStarts.get(messageId);
    if (pending) {
      if (pending.fingerprint !== requestFingerprint) {
        throw new ShepherdControlError(
          "idempotency_conflict",
          "Client message ID is already starting a different Mission assignment",
        );
      }
      return await pending.operation;
    }
    const operation = (async () => {
      const started = await this.startDeterministicDemo({
        projectId: "auth-demo",
        originalIntent: route.content,
        ...(input.frontendAgentId === undefined
          ? {}
          : { frontendAgentId: input.frontendAgentId }),
        ...(input.backendAgentId === undefined
          ? {}
          : { backendAgentId: input.backendAgentId }),
        ...(input.frontendTransport === undefined
          ? {}
          : { frontendTransport: input.frontendTransport }),
        ...(input.backendTransport === undefined
          ? {}
          : { backendTransport: input.backendTransport }),
        requestRecord: {
          messageId,
          fingerprint: requestFingerprint,
        },
      });
      const message = this.store
        .snapshot()
        .shepherd.groupMessages.find((item) => item.id === messageId);
      if (!message) {
        throw new Error("Atomic Mission request record was not persisted");
      }
      if (message.missionId !== started.missionId) {
        throw new Error("Project Group message did not link to its created Mission");
      }
      return { missionId: started.missionId, message };
    })();
    this.pendingMissionStarts.set(messageId, {
      fingerprint: requestFingerprint,
      operation,
    });
    try {
      return await operation;
    } finally {
      if (this.pendingMissionStarts.get(messageId)?.operation === operation) {
        this.pendingMissionStarts.delete(messageId);
      }
    }
  }

  async cancelMission(missionId: string): Promise<Mission> {
    if (!SAFE_ID.test(missionId)) {
      throw new ShepherdControlError("invalid_input", "Mission ID is invalid");
    }
    const cancellation = await this.store.mutate((database) => {
      const mission = database.shepherd.missions.find(
        (item) => item.id === missionId,
      );
      if (!mission) throw new ShepherdControlError("not_found", "Mission was not found");
      if (terminalMission(mission.state)) {
        if (mission.state === "cancelled") {
          return {
            mission: structuredClone(mission),
            executorIds: [] as string[],
            verifierIds: [] as string[],
          };
        }
        throw new ShepherdControlError(
          "conflict",
          "A terminal Mission cannot be cancelled",
        );
      }
      const cancelledAt = this.timestamp();
      const failure: FailureInfo = {
        code: "cancelled",
        message: "Mission cancelled by a human",
        stage: "mission_cancellation",
        at: cancelledAt,
        retryable: false,
      };
      const missionPlanes = database.shepherd.planes.filter(
        (plane) => plane.missionId === mission.id,
      );
      const missionContracts = database.shepherd.contracts.filter(
        (contract) => contract.missionId === mission.id,
      );
      const missionCandidates = database.shepherd.candidates.filter(
        (candidate) => candidate.missionId === mission.id,
      );
      if (
        missionCandidates.some(
          (candidate) => candidate.promotionState === "promoting",
        ) ||
        missionPlanes.some(
          (plane) => plane.generalPromotionState === "promoting",
        )
      ) {
        throw new ShepherdControlError(
          "conflict",
          "Mission cannot be cancelled after promotion reached its durable CAS marker",
        );
      }
      const executorIds = missionPlanes
        .filter((plane) => plane.state === "running")
        .map((plane) => plane.executionIdentity);
      const verifierIds = [
        ...missionContracts
          .filter((contract) => contract.state === "verifying")
          .map((contract) => contract.id),
        ...missionCandidates
          .filter(
            (candidate) =>
              candidate.executionState === "verifying" ||
              candidate.promotionState === "reverifying",
          )
          .map((candidate) => candidate.id),
        ...missionPlanes
          .filter((plane) => plane.generalPromotionState === "reverifying")
          .map((plane) => plane.id),
      ];
      for (const contract of missionContracts) {
        if (canTransitionContract(contract.state, "cancelled", "human")) {
          transitionContractAndRecord(database, contract.id, "cancelled", {
            actor: "human",
            eventActor: {
              type: "human",
              id: null,
              displayName: "Human operator",
            },
            timestamp: cancelledAt,
          });
        }
      }
      for (const candidate of missionCandidates) {
        if (
          candidate.executionState === "created" ||
          candidate.executionState === "queued" ||
          candidate.executionState === "running" ||
          candidate.executionState === "agent_completed" ||
          candidate.executionState === "verifying"
        ) {
          candidate.executionState = "interrupted";
          candidate.failure = failure;
          candidate.updatedAt = cancelledAt;
        }
        if (candidate.promotionState === "reverifying") {
          candidate.promotionState = "interrupted";
          candidate.failure = failure;
          candidate.updatedAt = cancelledAt;
        }
      }
      for (const plane of missionPlanes) {
        if (plane.generalPromotionState === "reverifying") {
          plane.generalPromotionState = "failed";
        }
        if (
          plane.state === "creating" ||
          plane.state === "ready" ||
          plane.state === "running" ||
          plane.state === "inspecting"
        ) {
          plane.state = "interrupted";
          plane.error = failure;
          plane.updatedAt = cancelledAt;
        }
      }
      for (const agent of database.agents) {
        if (
          agent.currentContractId &&
          mission.contractIds.includes(agent.currentContractId)
        ) {
          agent.currentContractId = null;
          agent.status = "ready";
          agent.lastError = null;
          agent.updatedAt = cancelledAt;
        }
      }
      const cancellationEvent = transitionMissionAndRecord(database, mission.id, "cancelled", {
        actor: "human",
        eventActor: {
          type: "human",
          id: null,
          displayName: "Human operator",
        },
        timestamp: cancelledAt,
        failure,
        summary: "Mission cancelled by a human",
      });
      this.appendServerGroupMessage(database, {
        sourceId: cancellationEvent.id,
        missionId: mission.id,
        content: "Mission cancelled by a human. Active executions were interrupted.",
        timestamp: cancelledAt,
      });
      const project = database.shepherd.projects.find(
        (item) => item.id === mission.projectId,
      );
      if (!project) throw new Error("Mission project disappeared during cancellation");
      project.activeMissionId = null;
      project.updatedAt = cancelledAt;
      return {
        mission: structuredClone(mission),
        executorIds: [...new Set(executorIds)],
        verifierIds: [...new Set(verifierIds)],
      };
    });
    await Promise.allSettled([
      ...cancellation.executorIds.map((id) => this.executor.cancel(id)),
      ...cancellation.verifierIds.map((id) => this.verifier.cancel?.(id)),
    ]);
    await this.backgroundRuns.get(missionId)?.catch(() => null);
    return this.missionDetail(missionId)?.mission ?? cancellation.mission;
  }

  async selectTiedCandidate(
    collisionId: string,
    candidateId: string,
  ): Promise<ShepherdMissionDetail> {
    if (!SAFE_ID.test(collisionId) || !SAFE_ID.test(candidateId)) {
      throw new ShepherdControlError("invalid_input", "Selection identity is invalid");
    }
    const snapshot = this.store.snapshot();
    const collision = snapshot.shepherd.collisions.find(
      (item) => item.id === collisionId,
    );
    const candidate = snapshot.shepherd.candidates.find(
      (item) => item.id === candidateId && item.collisionId === collisionId,
    );
    const mission = snapshot.shepherd.missions.find(
      (item) => item.id === collision?.missionId,
    );
    const project = snapshot.shepherd.projects.find(
      (item) => item.id === mission?.projectId,
    );
    if (!collision || !candidate || !mission || !project) {
      throw new ShepherdControlError("not_found", "Resolution selection was not found");
    }
    if (
      mission.state !== "attention_required" ||
      collision.state !== "attention_required" ||
      (mission.attentionReason !== "objective_tie" &&
        mission.attentionReason !== "auto_resolution_disabled")
    ) {
      throw new ShepherdControlError(
        "conflict",
        "Resolution is not awaiting a human candidate selection",
      );
    }
    if (!candidatePassesMandatoryVerification(candidate)) {
      throw new ShepherdControlError(
        "conflict",
        "A failed or unverified candidate cannot be selected",
      );
    }
    if (this.activeProjects.has(project.id)) {
      throw new ShepherdControlError(
        "conflict",
        "The project still has an active control-plane operation",
      );
    }
    this.activeProjects.add(project.id);
    try {
      const candidates = snapshot.shepherd.candidates.filter(
        (item) => item.collisionId === collision.id,
      );
      const objective = decideResolutionWinner(candidates, []);
      let decision: Extract<ReturnType<typeof decideResolutionWinner>, { kind: "selected" }>;
      if (mission.attentionReason === "objective_tie") {
        if (objective.kind !== "tie") {
          throw new ShepherdControlError(
            "conflict",
            "Objective tie evidence changed before human selection",
          );
        }
        const human = decideHumanTieWinner(objective, candidates, candidate.id);
        if (human.kind !== "selected") {
          throw new ShepherdControlError("conflict", "Human selection is no longer valid");
        }
        decision = human;
      } else {
        if (
          objective.kind === "none" ||
          (objective.kind === "selected" &&
            objective.selectedCandidateId !== candidate.id)
        ) {
          throw new ShepherdControlError(
            "conflict",
            "Only an objectively passing candidate may be confirmed",
          );
        }
        if (objective.kind === "tie") {
          const human = decideHumanTieWinner(objective, candidates, candidate.id);
          if (human.kind !== "selected") {
            throw new ShepherdControlError("conflict", "Human selection is no longer valid");
          }
          decision = human;
        } else {
          decision = {
            ...objective,
            source: "human",
            tieBreaker: null,
            reason: "A human confirmed the sole objectively passing candidate",
          };
        }
      }

      const managedProject = await openAuthDemoProject({
        managedRoot: this.managedRoot,
        projectId: project.id,
      });
      if (
        managedProject.repositoryPath !== project.repositoryPath ||
        managedProject.protectedBranch !== project.protectedBranch ||
        managedProject.headCommit !== project.protectedHeadCommit
      ) {
        throw new ShepherdControlError(
          "conflict",
          "Managed project head changed before human selection",
        );
      }
      const planeManager = new PlaneManager({
        repositoryPath: managedProject.repositoryPath,
        planesRoot: managedProject.planesRoot,
        protectedBranch: managedProject.protectedBranch,
        git: new GitClient(managedProject.repositoryPath, {
          worktreeRoot: managedProject.planesRoot,
          protectedBranch: managedProject.protectedBranch,
          ...(this.gitPromotionFaults === undefined
            ? {}
            : { promotionFaults: this.gitPromotionFaults }),
        }),
        now: this.now,
      });
      await planeManager.initialize();
      const sourceContracts = snapshot.shepherd.contracts.filter(
        (contract) => contract.missionId === mission.id,
      );
      if (sourceContracts.length !== 2 || !sourceContracts[0] || !sourceContracts[1]) {
        throw new Error("Auth demo selection requires two source Contracts");
      }
      const prepared: PreparedMission = {
        project: managedProject,
        planeManager,
        missionId: mission.id,
        frontendContractId: sourceContracts[0].id,
        backendContractId: sourceContracts[1].id,
        frontendTransport:
          collision.leftContractId === sourceContracts[0].id
            ? collision.leftClaim.value as AuthTransport
            : collision.rightClaim.value as AuthTransport,
        backendTransport:
          collision.leftContractId === sourceContracts[1].id
            ? collision.leftClaim.value as AuthTransport
            : collision.rightClaim.value as AuthTransport,
      };
      const selectedAt = this.timestamp();
      await this.store.mutate((database) => {
        const persistedMission = database.shepherd.missions.find(
          (item) => item.id === mission.id,
        );
        const persistedCollision = database.shepherd.collisions.find(
          (item) => item.id === collision.id,
        );
        if (
          persistedMission?.state !== "attention_required" ||
          persistedMission.attentionReason !== mission.attentionReason ||
          persistedCollision?.state !== "attention_required"
        ) {
          throw new ShepherdControlError(
            "conflict",
            "Resolution state changed before selection was persisted",
          );
        }
        const current = database.shepherd.candidates.filter(
          (item) => item.collisionId === collision.id,
        );
        for (const updated of applyWinnerDecision(current, decision, selectedAt)) {
          replaceById(database.shepherd.candidates, updated);
        }
        persistedCollision.state = "resolving";
        persistedCollision.updatedAt = selectedAt;
        transitionMissionAndRecord(database, mission.id, "resolving", {
          actor: "human",
          eventActor: {
            type: "human",
            id: null,
            displayName: "Human operator",
          },
          timestamp: selectedAt,
          attentionReason: null,
          failure: null,
        });
        this.recordEvent(database, {
          type: "candidate_selected",
          summary: "Human selected a verified resolution candidate",
          missionId: mission.id,
          collisionId: collision.id,
          candidateId: candidate.id,
          actor: {
            type: "human",
            id: null,
            displayName: "Human operator",
          },
          timestamp: selectedAt,
          details: {
            source:
              mission.attentionReason === "objective_tie"
                ? "objective_tie"
                : "manual_confirmation",
          },
        });
      });
      const selected = this.store
        .snapshot()
        .shepherd.candidates.find((item) => item.id === candidate.id);
      const plane = this.store
        .snapshot()
        .shepherd.planes.find((item) => item.id === selected?.planeId);
      if (!selected || !plane) throw new Error("Selected candidate Plane disappeared");
      let promotion: PromotionResult;
      try {
        promotion = await this.promoteCandidate(prepared, selected, plane);
      } catch (error) {
        if (!this.missionIsCancelled(mission.id)) {
          const current = this.store
            .snapshot()
            .shepherd.candidates.find((item) => item.id === selected.id);
          if (current?.promotionState === "reverifying") {
            const failedAt = this.timestamp();
            await this.store.mutate((database) => {
              const persistedMission = database.shepherd.missions.find(
                (item) => item.id === mission.id,
              );
              const persistedCollision = database.shepherd.collisions.find(
                (item) => item.id === collision.id,
              );
              const persistedCandidate = database.shepherd.candidates.find(
                (item) => item.id === selected.id,
              );
              if (
                persistedMission?.state !== "resolving" ||
                !persistedCollision ||
                persistedCandidate?.promotionState !== "reverifying"
              ) {
                return;
              }
              const failure: FailureInfo = {
                code: "persistence_error",
                message: "Promotion could not complete after human selection",
                stage: "human_selection_promotion",
                at: failedAt,
                retryable: false,
              };
              persistedCandidate.promotionState = "failed";
              persistedCandidate.failure = failure;
              persistedCandidate.updatedAt = failedAt;
              persistedCollision.state = "attention_required";
              persistedCollision.updatedAt = failedAt;
              transitionMissionAndRecord(database, mission.id, "attention_required", {
                actor: "control_plane",
                eventActor: SHEPHERD_ACTOR,
                timestamp: failedAt,
                attentionReason: "promotion_infrastructure_error",
                failure,
              });
            });
          }
        }
        throw error;
      }
      await this.persistPromotionOutcome(prepared, collision, selected, plane, promotion);
      const detail = this.missionDetail(mission.id);
      if (!detail) throw new Error("Promoted Mission detail disappeared");
      return detail;
    } finally {
      this.activeProjects.delete(project.id);
    }
  }

  async resetDeterministicDemo(): Promise<DeterministicDemoResetResult> {
    const projectId = "auth-demo" as const;
    if (this.activeProjects.has(projectId)) {
      throw new ShepherdControlError(
        "conflict",
        "The auth demo cannot reset while its control plane is active",
      );
    }
    this.activeProjects.add(projectId);
    try {
      const snapshot = this.store.snapshot();
      const project = snapshot.shepherd.projects.find((item) => item.id === projectId);
      if (!project) {
        await assertNoManagedProjectState(this.managedRoot);
        return {
          projectId,
          restoredHead: null,
          removedPlanePaths: [],
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
        };
      }
      if (
        snapshot.shepherd.missions.some(
          (mission) => mission.projectId === projectId && !terminalMission(mission.state),
        )
      ) {
        throw new ShepherdControlError(
          "conflict",
          "The auth demo cannot reset while a Mission is active",
        );
      }
      const managedProject = await openAuthDemoProject({
        managedRoot: this.managedRoot,
        projectId,
      });
      if (
        managedProject.repositoryPath !== project.repositoryPath ||
        managedProject.protectedBranch !== project.protectedBranch ||
        (managedProject.headCommit !== project.protectedHeadCommit &&
          managedProject.headCommit !== managedProject.initialCommit)
      ) {
        throw new ShepherdControlError(
          "conflict",
          "Managed auth demo differs from durable trusted state",
        );
      }
      const planeManager = new PlaneManager({
        repositoryPath: managedProject.repositoryPath,
        planesRoot: managedProject.planesRoot,
        protectedBranch: managedProject.protectedBranch,
        git: new GitClient(managedProject.repositoryPath, {
          worktreeRoot: managedProject.planesRoot,
          protectedBranch: managedProject.protectedBranch,
        }),
        now: this.now,
      });
      await planeManager.initialize();
      const removedPlanePaths = await planeManager.resetManagedPlanes();
      const resetProject = await resetAuthDemoProject({
        managedRoot: this.managedRoot,
        projectId,
      });
      const result = await this.store.mutate((database) => {
        const missionIds = new Set(
          database.shepherd.missions
            .filter((mission) => mission.projectId === projectId)
            .map((mission) => mission.id),
        );
        const counts = {
          missions: database.shepherd.missions.filter((item) => missionIds.has(item.id)).length,
          contracts: database.shepherd.contracts.filter((item) => missionIds.has(item.missionId)).length,
          planes: database.shepherd.planes.filter((item) => missionIds.has(item.missionId)).length,
          claims: database.shepherd.claims.filter((item) => missionIds.has(item.missionId)).length,
          collisions: database.shepherd.collisions.filter((item) => missionIds.has(item.missionId)).length,
          candidates: database.shepherd.candidates.filter((item) => missionIds.has(item.missionId)).length,
          events: database.shepherd.events.filter((item) => item.missionId && missionIds.has(item.missionId)).length,
          messages: database.shepherd.groupMessages.filter((item) => item.projectId === projectId).length,
        };
        database.shepherd.missions = database.shepherd.missions.filter(
          (item) => !missionIds.has(item.id),
        );
        database.shepherd.contracts = database.shepherd.contracts.filter(
          (item) => !missionIds.has(item.missionId),
        );
        database.shepherd.planes = database.shepherd.planes.filter(
          (item) => !missionIds.has(item.missionId),
        );
        database.shepherd.claims = database.shepherd.claims.filter(
          (item) => !missionIds.has(item.missionId),
        );
        database.shepherd.collisions = database.shepherd.collisions.filter(
          (item) => !missionIds.has(item.missionId),
        );
        database.shepherd.candidates = database.shepherd.candidates.filter(
          (item) => !missionIds.has(item.missionId),
        );
        database.shepherd.events = database.shepherd.events.filter(
          (item) => !item.missionId || !missionIds.has(item.missionId),
        );
        database.shepherd.groupMessages = database.shepherd.groupMessages.filter(
          (item) => item.projectId !== projectId,
        );
        const persistedProject = database.shepherd.projects.find(
          (item) => item.id === projectId,
        );
        if (!persistedProject) throw new Error("Auth demo project disappeared during reset");
        persistedProject.protectedHeadCommit = resetProject.initialCommit;
        persistedProject.activeMissionId = null;
        persistedProject.updatedAt = this.timestamp();
        for (const agent of database.agents) {
          if (
            agent.id === deterministicDemoAgentId(projectId, "frontend") ||
            agent.id === deterministicDemoAgentId(projectId, "backend")
          ) {
            agent.status = "ready";
            agent.currentContractId = null;
            agent.lastError = null;
            agent.updatedAt = this.timestamp();
          }
        }
        return counts;
      });
      return {
        projectId,
        restoredHead: resetProject.initialCommit,
        removedPlanePaths,
        removed: result,
      };
    } finally {
      this.activeProjects.delete(projectId);
    }
  }

  eventsAfter(cursor: number, limit = 200): ShepherdEvent[] {
    return this.store.shepherdEventsAfter(cursor, limit);
  }

  private async startGeneralAgentMission(input: {
    agent: Agent;
    project: ManagedGeneralAgentProject;
    plan: GeneralContractPlan;
    draftId: string;
  }): Promise<{ missionId: string }> {
    if (input.plan.status !== "ready" || !input.plan.acceptanceSummary) {
      throw new Error("A general Mission requires a confirmed Contract plan");
    }
    const acceptanceSummary = input.plan.acceptanceSummary;
    this.claimProject(input.project.projectId);
    let prepared: PreparedGeneralMission;
    try {
      const planeManager = new PlaneManager({
        repositoryPath: input.project.repositoryPath,
        planesRoot: input.project.planesRoot,
        protectedBranch: input.project.protectedBranch,
        git: new GitClient(input.project.repositoryPath, {
          worktreeRoot: input.project.planesRoot,
          protectedBranch: input.project.protectedBranch,
          ...(this.gitPromotionFaults === undefined
            ? {}
            : { promotionFaults: this.gitPromotionFaults }),
          ...(this.gitMergeFaults === undefined ? {} : { mergeFaults: this.gitMergeFaults }),
        }),
        now: this.now,
      });
      await planeManager.initialize();
      const createdAt = this.timestamp();
      const missionId = this.identifier("mission");
      const contractId = this.identifier("contract");
      const role = input.agent.role ?? "Generalist";
      const currentAuthority =
        input.agent.authority ?? agentAuthorityPreset("generalist").authority;
      const requestedAuthority: ScopedAuthority = {
        readable: ["**"],
        writable: input.plan.expectedArtifacts.map((artifact) => artifact.path),
        forbidden: [...protectedPatterns],
      };
      const contractAuthority = boundedContractAuthority(
        currentAuthority,
        requestedAuthority,
      );
      await this.store.mutate((database) => {
        const agent = database.agents.find((item) => item.id === input.agent.id);
        const project = database.shepherd.projects.find(
          (item) => item.id === input.project.projectId,
        );
        const draftMessages = database.shepherd.groupMessages.filter(
          (message) =>
            message.contractAssignment?.preset === "general-contract" &&
            message.contractAssignment.draftId === input.draftId &&
            message.missionId === null &&
            message.contractId === null,
        );
        if (
          !agent ||
          (agent.role ?? "Generalist") !== role ||
          agent.status !== "ready" ||
          agent.currentContractId ||
          !project ||
          project.activeMissionId !== null ||
          project.protectedHeadCommit !== input.project.headCommit ||
          draftMessages.length < 1 ||
          !draftMessages.some(
            (message) =>
              message.contractAssignment?.preset === "general-contract" &&
              message.contractAssignment.status === "accepted",
          )
        ) {
          throw new ShepherdControlError(
            "conflict",
            "General Contract intake changed before Mission creation",
          );
        }
        const currentAuthorityValue =
          agent.authority ?? agentAuthorityPreset("generalist").authority;
        if (
          JSON.stringify(
            boundedContractAuthority(currentAuthorityValue, requestedAuthority),
          ) !== JSON.stringify(contractAuthority)
        ) {
          throw new ShepherdControlError(
            "conflict",
            "Agent authority changed before Contract assignment",
          );
        }
        agent.status = "busy";
        agent.currentContractId = contractId;
        agent.lastError = null;
        agent.updatedAt = createdAt;
        project.activeMissionId = missionId;
        project.updatedAt = createdAt;
        const mission: Mission = {
          id: missionId,
          projectId: project.id,
          originalIntent: input.plan.objective,
          baseCommit: project.protectedHeadCommit,
          contractIds: [contractId],
          dependencyEdges: [],
          collisionIds: [],
          resolutionIds: [],
          state: "planning",
          attentionReason: null,
          failure: null,
          createdAt,
          updatedAt: createdAt,
          startedAt: null,
          completedAt: null,
        };
        const contract: ExecutionContract = {
          id: contractId,
          missionId,
          agentId: agent.id,
          title: input.plan.title,
          objective: input.plan.objective,
          contextualInputs: [
            {
              name: "Confirmed acceptance",
              value: acceptanceSummary,
              sourceContractId: null,
            },
          ],
          dependencyIds: [],
          semanticScopes: [],
          declaredClaimKeys: [],
          authority: contractAuthority,
          expectedArtifacts: structuredClone(input.plan.expectedArtifacts),
          acceptance: { checks: [generalContractCheck()], objectiveTieBreakers: [] },
          planeId: null,
          resultManifestPath: ".shepherd/result.json",
          manifest: null,
          verificationEvidence: [],
          state: "created",
          failure: null,
          createdAt,
          updatedAt: createdAt,
          startedAt: null,
          agentCompletedAt: null,
          verifiedAt: null,
          completedAt: null,
        };
        database.shepherd.missions.push(mission);
        database.shepherd.contracts.push(contract);
        for (const message of draftMessages) {
          message.missionId = missionId;
          message.contractId = contractId;
        }
        this.recordEvent(database, {
          type: "mission_created",
          summary: "Created confirmed general Agent Mission",
          missionId,
          timestamp: createdAt,
          details: { projectId: project.id },
        });
        this.recordEvent(database, {
          type: "contract_created",
          summary: `Created ${contract.title}`,
          missionId,
          contractId,
          agentId: agent.id,
          timestamp: createdAt,
        });
        transitionContractAndRecord(database, contractId, "queued", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: createdAt,
        });
        transitionMissionAndRecord(database, missionId, "queued", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: createdAt,
        });
      });
      prepared = {
        project: input.project,
        planeManager,
        missionId,
        contractId,
        agentId: input.agent.id,
        artifactPaths: input.plan.expectedArtifacts.map((artifact) => artifact.path),
        requiredContent: input.plan.requiredContent,
      };
    } catch (error) {
      this.activeProjects.delete(input.project.projectId);
      throw error;
    }
    const operation = this.executePreparedGeneralMission(prepared)
      .catch(async (error: unknown) => {
        await this.recordMissionFailure(prepared.missionId, error, "background_general_contract");
        return null;
      })
      .finally(() => {
        this.backgroundRuns.delete(prepared.missionId);
        this.activeProjects.delete(prepared.project.projectId);
      });
    this.backgroundRuns.set(prepared.missionId, operation);
    return { missionId: prepared.missionId };
  }

  async startDeterministicDemo(
    options: DeterministicDemoOptions = {},
  ): Promise<{ missionId: string }> {
    const projectId = options.projectId ?? "auth-demo";
    this.claimProject(projectId);
    let prepared: PreparedMission;
    try {
      prepared = await this.prepareMission(options);
    } catch (error) {
      this.activeProjects.delete(projectId);
      throw error;
    }
    const operation = this.executePreparedMission(prepared)
      .catch(async (error: unknown) => {
        await this.recordMissionFailure(prepared.missionId, error, "background_demo");
        return null;
      })
      .finally(() => {
        this.backgroundRuns.delete(prepared.missionId);
        this.activeProjects.delete(projectId);
      });
    this.backgroundRuns.set(prepared.missionId, operation);
    return { missionId: prepared.missionId };
  }

  async runDeterministicDemo(
    options: DeterministicDemoOptions = {},
  ): Promise<DeterministicDemoResult> {
    const projectId = options.projectId ?? "auth-demo";
    this.claimProject(projectId);
    let missionId: string | null = null;
    try {
      const prepared = await this.prepareMission(options);
      missionId = prepared.missionId;
      return await this.executePreparedMission(prepared);
    } catch (error) {
      if (missionId) await this.recordMissionFailure(missionId, error, "deterministic_demo");
      throw error;
    } finally {
      this.activeProjects.delete(projectId);
    }
  }

  private claimProject(projectId: string): void {
    if (this.activeProjects.has(projectId)) {
      throw new Error("A deterministic Mission is already active for this project");
    }
    this.activeProjects.add(projectId);
  }

  private identifier(prefix: string): string {
    const id = this.idFactory(prefix);
    if (!SAFE_ID.test(id)) throw new Error("ID factory returned an unsafe identifier");
    return id;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private missionIsCancelled(missionId: string): boolean {
    return (
      this.store
        .snapshot()
        .shepherd.missions.find((mission) => mission.id === missionId)?.state ===
      "cancelled"
    );
  }

  private missionHasContractVerificationInfrastructureFailure(
    missionId: string,
  ): boolean {
    const mission = this.store
      .snapshot()
      .shepherd.missions.find((item) => item.id === missionId);
    return (
      mission?.state === "failed" &&
      mission.failure?.code === "verification_infrastructure_error" &&
      mission.failure.stage === "contract_verification"
    );
  }

  private ensureMissionRunnable(missionId: string): void {
    const mission = this.store
      .snapshot()
      .shepherd.missions.find((item) => item.id === missionId);
    if (!mission) throw new Error("Mission was not found");
    if (mission.state === "cancelled") throw new MissionCancelledError();
    if (
      mission.state === "failed" &&
      mission.failure?.code === "verification_infrastructure_error" &&
      mission.failure.stage === "contract_verification"
    ) {
      throw new ContractVerificationInfrastructureError();
    }
  }

  private assertMissionRunnable(database: Database, missionId: string): Mission {
    const mission = database.shepherd.missions.find(
      (item) => item.id === missionId,
    );
    if (!mission) throw new Error("Mission was not found");
    if (mission.state === "cancelled") throw new MissionCancelledError();
    if (
      mission.state === "failed" &&
      mission.failure?.code === "verification_infrastructure_error" &&
      mission.failure.stage === "contract_verification"
    ) {
      throw new ContractVerificationInfrastructureError();
    }
    return mission;
  }

  private executionTimeout(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 3_600_000) {
      throw new Error(`${label} execution timeout must be between 1000 and 3600000 ms`);
    }
    return value;
  }

  private dependencyOutputs(contract: ExecutionContract): DependencyOutput[] {
    const snapshot = this.store.snapshot();
    return contract.dependencyIds.map((contractId) => {
      const dependency = snapshot.shepherd.contracts.find(
        (item) => item.id === contractId,
      );
      if (!dependency?.manifest || dependency.state !== "verified") {
        throw new Error("Contract dependency output is not independently verified");
      }
      return {
        contractId,
        summary: dependency.manifest.summary,
        artifacts: dependency.manifest.artifacts.map((artifact) => artifact.path),
      };
    });
  }

  private async persistRuntimeSessionFingerprint(
    planeId: string,
    runtimeSessionId: string | null,
  ): Promise<string | null> {
    if (runtimeSessionId === null) return null;
    if (
      runtimeSessionId.length < 1 ||
      runtimeSessionId.length > 512 ||
      runtimeSessionId.includes("\0")
    ) {
      throw new Error("Runtime returned an invalid session identifier");
    }
    const fingerprint = createHash("sha256")
      .update(runtimeSessionId, "utf8")
      .digest("hex");
    await this.store.mutate((database) => {
      const plane = database.shepherd.planes.find((item) => item.id === planeId);
      if (!plane) throw new Error("Runtime Plane disappeared before session binding");
      if (plane.state === "interrupted") throw new MissionCancelledError();
      if (
        database.shepherd.planes.some(
          (item) =>
            item.id !== planeId && item.runtimeSessionFingerprint === fingerprint,
        )
      ) {
        throw new Error("Runtime session was reused across execution identities");
      }
      if (
        plane.runtimeSessionFingerprint !== undefined &&
        plane.runtimeSessionFingerprint !== null &&
        plane.runtimeSessionFingerprint !== fingerprint
      ) {
        throw new Error("Runtime Plane is already bound to another session");
      }
      plane.runtimeSessionFingerprint = fingerprint;
      plane.updatedAt = this.timestamp();
    });
    return fingerprint;
  }

  private safeText(input: string, maxStringLength = 1_000): string {
    return redactText(input, {
      secrets: this.sensitiveValues,
      maxStringLength,
    }).replace(
      /(?:[A-Za-z]:\\[^\s"'`,;]+|\/(?:home|workspace|tmp|var|root|Users)(?:\/[^\s"'`,;]+)+)/gu,
      "[PATH]",
    );
  }

  private makeFailure(error: unknown, stage: string, at: string): FailureInfo {
    const raw = error instanceof Error ? error.message : "Unknown failure";
    if (error instanceof RuntimeExecutionError) {
      const publicMessage = new RuntimeExecutionError(
        error.kind,
        error.timeoutMs,
      ).message;
      return {
        code: error.kind === "timeout" ? "agent_timeout" : "agent_runtime_error",
        message: publicMessage,
        stage: "contract_execution",
        at,
        retryable: false,
      };
    }
    if (error instanceof PlaneCreationError) {
      return {
        code: "worktree_creation_failure",
        message: "Contract Plane worktree could not be created",
        stage: "plane_creation",
        at,
        retryable: false,
      };
    }
    if (error instanceof GitMergeConflictError) {
      return {
        code: "git_conflict",
        message: "Verified Contract changes conflict during integration",
        stage: "integration_merge",
        at,
        retryable: false,
      };
    }
    if (error instanceof GitConflictCleanupError) {
      return {
        code: "git_conflict",
        message: "Git conflict cleanup requires operator attention",
        stage: "integration_cleanup",
        at,
        retryable: false,
      };
    }
    return {
      code: "unknown",
      message: this.safeText(raw),
      stage,
      at,
      retryable: false,
    };
  }

  private recordEvent(database: Database, input: EventInput): ShepherdEvent {
    const redacted = redactValue(input.details ?? {}, {
      secrets: this.sensitiveValues,
      maxDepth: 2,
      maxArrayItems: 16,
      maxObjectKeys: 32,
      maxStringLength: 500,
      maxNodes: 128,
    });
    const details: ShepherdEvent["details"] = {};
    if (typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)) {
      for (const [key, value] of Object.entries(redacted)) {
        details[this.safeText(key, 64)] =
          typeof value === "string"
            ? this.safeText(value, 500)
            : typeof value === "number" || typeof value === "boolean" || value === null
              ? value
              : this.safeText(JSON.stringify(value), 500);
      }
    }
    const event = appendRawEvent(database, {
      ...input,
      summary: this.safeText(input.summary, 500),
      details,
    });
    this.appendLifecycleMessageForEvent(database, event);
    return event;
  }

  private appendServerGroupMessage(
    database: Database,
    input: {
      sourceId: string;
      missionId: string;
      content: string;
      contractId?: string | null;
      targetAgentId?: string | null;
      timestamp: string;
    },
  ): void {
    const mission = database.shepherd.missions.find(
      (item) => item.id === input.missionId,
    );
    if (!mission) return;
    const project = database.shepherd.projects.find(
      (item) => item.id === mission.projectId,
    );
    if (!project) return;
    const id =
      "group-system-" +
      createHash("sha256")
        .update(`${project.id}\0${input.sourceId}`, "utf8")
        .digest("hex")
        .slice(0, 32);
    if (database.shepherd.groupMessages.some((message) => message.id === id)) return;
    appendProjectGroupMessage(database, {
      id,
      projectId: project.id,
      missionId: mission.id,
      senderType: "shepherd",
      senderId: null,
      content: this.safeText(input.content, 2_000),
      targetAgentId: input.targetAgentId ?? null,
      contractId: input.contractId ?? null,
      createdAt: input.timestamp,
    });
  }

  private appendLifecycleMessageForEvent(
    database: Database,
    event: ShepherdEvent,
  ): void {
    if (!event.missionId) return;
    if (event.type === "mission_created") {
      const mission = database.shepherd.missions.find(
        (item) => item.id === event.missionId,
      );
      if (mission) {
        this.appendServerGroupMessage(database, {
          sourceId: event.id,
          missionId: mission.id,
          content: `Mission accepted: ${mission.originalIntent}`,
          timestamp: event.timestamp,
        });
      }
      return;
    }
    if (event.type === "collision_detected" && event.collisionId) {
      const collision = database.shepherd.collisions.find(
        (item) => item.id === event.collisionId,
      );
      if (collision) {
        this.appendServerGroupMessage(database, {
          sourceId: event.id,
          missionId: event.missionId,
          content: `Collision detected: exclusive ${collision.key} claims disagree in ${collision.scope}.`,
          timestamp: event.timestamp,
        });
      }
      return;
    }
    if (
      (event.type === "candidate_passed" || event.type === "candidate_failed") &&
      event.candidateId
    ) {
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === event.candidateId,
      );
      if (candidate) {
        this.appendServerGroupMessage(database, {
          sourceId: event.id,
          missionId: event.missionId,
          content:
            event.type === "candidate_passed"
              ? `Candidate passed independent verification: ${candidate.strategy} (${candidate.targetKey}=${candidate.targetValue}).`
              : `Candidate failed: ${candidate.strategy} (${candidate.failure?.code ?? "failed_independent_acceptance"}).`,
          timestamp: event.timestamp,
        });
      }
      return;
    }
    if (event.type === "promotion_completed" && event.candidateId) {
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === event.candidateId,
      );
      if (candidate) {
        this.appendServerGroupMessage(database, {
          sourceId: event.id,
          missionId: event.missionId,
          content: `Promotion completed: ${candidate.targetKey}=${candidate.targetValue}.`,
          timestamp: event.timestamp,
        });
      }
    }
  }

  private sanitizeEvidence(evidence: VerificationEvidence): VerificationEvidence {
    return {
      ...evidence,
      summary: this.safeText(evidence.summary, 1_000),
      checks: evidence.checks.map((check) => ({
        ...check,
        name: this.safeText(check.name, 200),
        stdout: this.safeText(check.stdout, 2_000),
        stderr: this.safeText(check.stderr, 2_000),
        error: check.error === null ? null : this.safeText(check.error, 1_000),
      })),
    };
  }

  private async prepareMission(
    options: DeterministicDemoOptions,
  ): Promise<PreparedMission> {
    await this.initialize();
    const requestedProjectId = options.projectId ?? "auth-demo";
    const originalIntent =
      options.originalIntent?.normalize("NFKC").trim() ??
      "Implement frontend and backend authentication, detect their semantic transport collision, and promote the independently verified resolution.";
    if (
      originalIntent.length < 1 ||
      originalIntent.length > 20_000 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(originalIntent)
    ) {
      throw new ShepherdControlError("invalid_input", "Mission intent is invalid");
    }
    if (
      options.requestRecord &&
      (!SAFE_ID.test(options.requestRecord.messageId) ||
        !/^[a-f0-9]{64}$/u.test(options.requestRecord.fingerprint))
    ) {
      throw new ShepherdControlError(
        "invalid_input",
        "Mission request identity is invalid",
      );
    }
    if (options.requestRecord && options.privatePromptRecords) {
      throw new ShepherdControlError(
        "invalid_input",
        "A Mission cannot use both Shepherd-composer and private-chat request records",
      );
    }
    if (options.privatePromptRecords && !options.contractPrompts) {
      throw new ShepherdControlError(
        "invalid_input",
        "Private Contract records require both bounded Agent prompts",
      );
    }
    const suppliedAgentCount = Number(Boolean(options.frontendAgentId)) +
      Number(Boolean(options.backendAgentId));
    if (suppliedAgentCount === 1) {
      throw new ShepherdControlError(
        "invalid_input",
        "Select both a Frontend Agent and a Backend Agent",
      );
    }
    if (
      options.frontendAgentId &&
      options.frontendAgentId === options.backendAgentId
    ) {
      throw new ShepherdControlError(
        "invalid_input",
        "Frontend and Backend contracts require different Agents",
      );
    }
    const frontendTransport = options.frontendTransport ?? BEARER_TRANSPORT;
    const backendTransport = options.backendTransport ?? COOKIE_TRANSPORT;
    if (frontendTransport === backendTransport) {
      throw new ShepherdControlError(
        "invalid_input",
        "The collision demo requires incompatible authentication transports",
      );
    }
    const frontendObjective = options.contractPrompts
      ? normalizedPrivatePrompt(options.contractPrompts.frontend)
      : `Configure the required frontend authentication artifact with exactly transport "${frontendTransport}" and clientReadableCredential ${String(frontendTransport === BEARER_TRANSPORT)}.`;
    const backendObjective = options.contractPrompts
      ? normalizedPrivatePrompt(options.contractPrompts.backend)
      : `Configure the required backend authentication artifact with exactly transport "${backendTransport}" and clientReadableCredential ${String(backendTransport === BEARER_TRANSPORT)}.`;
    if (
      options.contractPrompts &&
      (transportFromPrivatePrompt(frontendObjective) !== frontendTransport ||
        transportFromPrivatePrompt(backendObjective) !== backendTransport)
    ) {
      throw new ShepherdControlError(
        "invalid_input",
        "Private Contract prompts do not match their trusted transport assignments",
      );
    }
    if (options.privatePromptRecords) {
      const records = [
        options.privatePromptRecords.frontend,
        options.privatePromptRecords.backend,
      ];
      if (
        options.privatePromptRecords.frontend.messageId ===
          options.privatePromptRecords.backend.messageId ||
        records.some(
          (record) =>
            !SAFE_ID.test(record.messageId) ||
            !SAFE_ID.test(record.agentId) ||
            !/^[a-f0-9]{64}$/u.test(record.fingerprint) ||
            !Number.isFinite(Date.parse(record.createdAt)),
        ) ||
        options.privatePromptRecords.frontend.role !== "Frontend" ||
        options.privatePromptRecords.backend.role !== "Backend" ||
        options.privatePromptRecords.frontend.agentId !== options.frontendAgentId ||
        options.privatePromptRecords.backend.agentId !== options.backendAgentId ||
        options.privatePromptRecords.frontend.transport !== frontendTransport ||
        options.privatePromptRecords.backend.transport !== backendTransport ||
        options.privatePromptRecords.frontend.content !== frontendObjective ||
        options.privatePromptRecords.backend.content !== backendObjective
      ) {
        throw new ShepherdControlError(
          "invalid_input",
          "Private Contract prompt metadata is inconsistent",
        );
      }
    }
    const beforePreparation = this.store.snapshot();
    const existingActive = beforePreparation.shepherd.missions.find(
      (mission) =>
        mission.projectId === requestedProjectId && !terminalMission(mission.state),
    );
    if (existingActive) {
      throw new Error("The managed project already has a non-terminal Mission");
    }
    const currentAgents = beforePreparation.agents;
    const selectedFrontendAgent = options.frontendAgentId
      ? currentAgents.find((agent) => agent.id === options.frontendAgentId)
      : undefined;
    const selectedBackendAgent = options.backendAgentId
      ? currentAgents.find((agent) => agent.id === options.backendAgentId)
      : undefined;
    if (options.frontendAgentId && !selectedFrontendAgent) {
      throw new ShepherdControlError("not_found", "Selected Frontend Agent was not found");
    }
    if (options.backendAgentId && !selectedBackendAgent) {
      throw new ShepherdControlError("not_found", "Selected Backend Agent was not found");
    }
    if (selectedFrontendAgent && selectedFrontendAgent.role !== "Frontend") {
      throw new ShepherdControlError(
        "invalid_input",
        "The Frontend contract requires an Agent with the Frontend role",
      );
    }
    if (selectedBackendAgent && selectedBackendAgent.role !== "Backend") {
      throw new ShepherdControlError(
        "invalid_input",
        "The Backend contract requires an Agent with the Backend role",
      );
    }
    for (const selected of [selectedFrontendAgent, selectedBackendAgent]) {
      if (selected && selected.status !== "ready") {
        throw new ShepherdControlError(
          "conflict",
          `${selected.name} must be ready before Shepherd assigns a Contract`,
        );
      }
    }
    const persistedProject = beforePreparation.shepherd.projects.find(
      (item) => item.id === requestedProjectId,
    );
    if (persistedProject) {
      const identity = await resolveManagedProjectIdentity({
        managedRoot: this.managedRoot,
        projectId: persistedProject.id,
        protectedBranch: persistedProject.protectedBranch,
        persistedRepositoryPath: persistedProject.repositoryPath,
      });
      const inspectionClient = new GitClient(identity.repositoryPath, {
        worktreeRoot: identity.planesRoot,
        protectedBranch: identity.protectedBranch,
      });
      await inspectionClient.initialize();
      const inspection = await inspectionClient.inspectProtectedWorktree(
        identity.protectedBranch,
      );
      if (
        inspection.branchHead !== persistedProject.protectedHeadCommit ||
        !inspection.synchronized
      ) {
        throw new Error("Protected checkout differs from the durable trusted head");
      }
    }
    const project = await initializeAuthDemoProject({
      managedRoot: this.managedRoot,
      projectId: requestedProjectId,
      allowClientReadableCredential:
        options.allowClientReadableCredential ?? false,
    });
    if (
      persistedProject &&
      (project.headCommit !== persistedProject.protectedHeadCommit ||
        project.repositoryPath !== persistedProject.repositoryPath ||
        project.protectedBranch !== persistedProject.protectedBranch)
    ) {
      throw new Error("Managed project identity changed during Mission preparation");
    }
    const planeManager = new PlaneManager({
      repositoryPath: project.repositoryPath,
      planesRoot: project.planesRoot,
      protectedBranch: project.protectedBranch,
      git: new GitClient(project.repositoryPath, {
        worktreeRoot: project.planesRoot,
        protectedBranch: project.protectedBranch,
        ...(this.gitPromotionFaults === undefined
          ? {}
          : { promotionFaults: this.gitPromotionFaults }),
        ...(this.gitMergeFaults === undefined ? {} : { mergeFaults: this.gitMergeFaults }),
      }),
      now: this.now,
    });
    await planeManager.initialize();

    const createdAt = this.timestamp();
    const missionId = this.identifier("mission");
    const frontendContractId = this.identifier("contract-front");
    const backendContractId = this.identifier("contract-back");
    const frontendAgentId = selectedFrontendAgent?.id ??
      deterministicDemoAgentId(project.projectId, "frontend");
    const backendAgentId = selectedBackendAgent?.id ??
      deterministicDemoAgentId(project.projectId, "backend");
    const frontendAuthority = selectedFrontendAgent?.authority ?? authorityFor("frontend");
    const backendAuthority = selectedBackendAgent?.authority ?? authorityFor("backend");
    const frontendContractAuthority = boundedContractAuthority(
      frontendAuthority,
      authorityFor("frontend"),
    );
    const backendContractAuthority = boundedContractAuthority(
      backendAuthority,
      authorityFor("backend"),
    );
    const frontendAgent = selectedFrontendAgent
      ? { ...selectedFrontendAgent, currentContractId: null, updatedAt: createdAt }
      : this.makeAgent(
          currentAgents.find((agent) => agent.id === frontendAgentId),
          frontendAgentId,
          "Frontend Agent",
          "Frontend",
          frontendAuthority,
          createdAt,
        );
    const backendAgent = selectedBackendAgent
      ? { ...selectedBackendAgent, currentContractId: null, updatedAt: createdAt }
      : this.makeAgent(
          currentAgents.find((agent) => agent.id === backendAgentId),
          backendAgentId,
          "Backend Agent",
          "Backend",
          backendAuthority,
          createdAt,
        );
    await this.ensureAgentWorkspace(
      frontendAgent,
      project.repositoryPath,
      project.planesRoot,
      currentAgents.some((agent) => agent.id === frontendAgentId),
    );
    await this.ensureAgentWorkspace(
      backendAgent,
      project.repositoryPath,
      project.planesRoot,
      currentAgents.some((agent) => agent.id === backendAgentId),
    );

    await this.store.mutate((database) => {
      const existingActive = database.shepherd.missions.find(
        (mission) =>
          mission.projectId === project.projectId && !terminalMission(mission.state),
      );
      if (existingActive) {
        throw new Error("The managed project already has a non-terminal Mission");
      }
      const existingProject = database.shepherd.projects.find(
        (item) => item.id === project.projectId,
      );
      const projectRecord: ShepherdProject = {
        id: project.projectId,
        displayName: "Authentication collision demo",
        repositoryPath: project.repositoryPath,
        protectedBranch: project.protectedBranch,
        protectedHeadCommit: project.headCommit,
        activeMissionId: missionId,
        createdAt: existingProject?.createdAt ?? createdAt,
        updatedAt: createdAt,
      };
      replaceById(database.shepherd.projects, projectRecord);
      if (options.requestRecord) {
        const duplicate = database.shepherd.groupMessages.find(
          (message) => message.id === options.requestRecord?.messageId,
        );
        if (duplicate) {
          throw new ShepherdControlError(
            "idempotency_conflict",
            "Mission request was durably recorded before this assignment",
          );
        }
      }
      if (options.privatePromptRecords) {
        const records = [
          options.privatePromptRecords.frontend,
          options.privatePromptRecords.backend,
        ];
        const pendingForProject = database.shepherd.groupMessages.filter(
          (message) =>
            message.projectId === project.projectId &&
            message.missionId === null &&
            message.contractId === null &&
            message.contractAssignment?.preset === "auth-demo-contract",
        );
        const existingRecords = records.flatMap((record) => {
          const message = database.shepherd.groupMessages.find(
            (item) => item.id === record.messageId,
          );
          return message ? [{ record, message }] : [];
        });
        const expectedMessageIds = new Set(records.map((record) => record.messageId));
        if (
          existingRecords.length !== 2 ||
          pendingForProject.length !== 2 ||
          pendingForProject.some((message) => !expectedMessageIds.has(message.id))
        ) {
          throw new ShepherdControlError(
            "conflict",
            "Private Contract intake changed before Mission creation",
          );
        }
        for (const { record, message } of existingRecords) {
          if (
            message.projectId !== project.projectId ||
            message.missionId !== null ||
            message.contractId !== null ||
            message.senderType !== "human" ||
            message.senderId !== null ||
            message.content !== record.content ||
            message.targetAgentId !== record.agentId ||
            message.requestFingerprint !== record.fingerprint ||
            message.contractAssignment?.preset !== "auth-demo-contract" ||
            message.contractAssignment.role !== record.role ||
            message.contractAssignment.transport !== record.transport
          ) {
            throw new ShepherdControlError(
              "idempotency_conflict",
              "The waiting private Contract prompt no longer matches its request",
            );
          }
        }
      }
      const reserveAgent = (
        selected: Agent | undefined,
        fallback: Agent,
        role: "Frontend" | "Backend",
        requestedAuthority: ScopedAuthority,
        contractId: string,
      ) => {
        if (!selected) {
          replaceById(database.agents, fallback);
          return;
        }
        const current = database.agents.find((agent) => agent.id === selected.id);
        if (
          !current ||
          current.role !== role ||
          current.status !== "ready" ||
          current.currentContractId
        ) {
          throw new ShepherdControlError(
            "conflict",
            `${role} Agent availability changed before Contract assignment`,
          );
        }
        const currentAuthority = boundedContractAuthority(
          current.authority ?? requestedAuthority,
          requestedAuthority,
        );
        if (JSON.stringify(currentAuthority) !== JSON.stringify(
          role === "Frontend" ? frontendContractAuthority : backendContractAuthority,
        )) {
          throw new ShepherdControlError(
            "conflict",
            `${role} Agent authority changed before Contract assignment`,
          );
        }
        current.status = "busy";
        current.currentContractId = contractId;
        current.lastError = null;
        current.updatedAt = createdAt;
      };
      reserveAgent(
        selectedFrontendAgent,
        frontendAgent,
        "Frontend",
        authorityFor("frontend"),
        frontendContractId,
      );
      reserveAgent(
        selectedBackendAgent,
        backendAgent,
        "Backend",
        authorityFor("backend"),
        backendContractId,
      );

      const mission: Mission = {
        id: missionId,
        projectId: project.projectId,
        originalIntent,
        baseCommit: project.headCommit,
        contractIds: [frontendContractId, backendContractId],
        dependencyEdges: [],
        collisionIds: [],
        resolutionIds: [],
        state: "planning",
        attentionReason: null,
        failure: null,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        completedAt: null,
      };
      database.shepherd.missions.push(mission);
      const contracts = [
        this.makeContract({
          id: frontendContractId,
          missionId,
          agentId: frontendAgentId,
          title: "Implement frontend authentication transport",
          objective: frontendObjective,
          artifactPath: "src/frontend/auth.json",
          authority: frontendContractAuthority,
          acceptanceChecks: [frontendCheck()],
          createdAt,
        }),
        this.makeContract({
          id: backendContractId,
          missionId,
          agentId: backendAgentId,
          title: "Implement backend authentication transport",
          objective: backendObjective,
          artifactPath: "src/backend/auth.json",
          authority: backendContractAuthority,
          acceptanceChecks: [backendCheck()],
          createdAt,
        }),
      ];
      database.shepherd.contracts.push(...contracts);
      if (options.privatePromptRecords) {
        for (const record of [
          options.privatePromptRecords.frontend,
          options.privatePromptRecords.backend,
        ]) {
          const contractId =
            record.role === "Frontend" ? frontendContractId : backendContractId;
          const existingMessage = database.shepherd.groupMessages.find(
            (message) => message.id === record.messageId,
          );
          if (existingMessage) {
            existingMessage.missionId = missionId;
            existingMessage.contractId = contractId;
          } else {
            appendProjectGroupMessage(database, {
              id: record.messageId,
              projectId: project.projectId,
              missionId,
              senderType: "human",
              senderId: null,
              content: record.content,
              targetAgentId: record.agentId,
              contractId,
              contractAssignment: {
                preset: "auth-demo-contract",
                role: record.role,
                transport: record.transport,
              },
              requestFingerprint: record.fingerprint,
              createdAt: record.createdAt,
            });
          }
        }
      }
      if (options.requestRecord) {
        appendProjectGroupMessage(database, {
          id: options.requestRecord.messageId,
          projectId: project.projectId,
          missionId,
          senderType: "human",
          senderId: null,
          content: originalIntent,
          targetAgentId: null,
          contractId: null,
          requestFingerprint: options.requestRecord.fingerprint,
          createdAt,
        });
      }
      this.recordEvent(database, {
        type: "mission_created",
        summary: "Created authentication collision Mission",
        missionId,
        timestamp: createdAt,
        details: { projectId: project.projectId },
      });
      for (const contract of contracts) {
        this.recordEvent(database, {
          type: "contract_created",
          summary: `Created ${contract.title}`,
          missionId,
          contractId: contract.id,
          agentId: contract.agentId,
          timestamp: createdAt,
        });
        transitionContractAndRecord(database, contract.id, "queued", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: createdAt,
        });
      }
      transitionMissionAndRecord(database, missionId, "queued", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: createdAt,
      });
    });

    return {
      project,
      planeManager,
      missionId,
      frontendContractId,
      backendContractId,
      frontendTransport,
      backendTransport,
    };
  }

  private async initializeWorkspaceRoot(): Promise<void> {
    try {
      const entry = await lstat(this.agentWorkspaceRoot);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error("Agent workspace root cannot be a symlink or non-directory");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(this.agentWorkspaceRoot, { recursive: true });
    }
    const canonical = await realpath(this.agentWorkspaceRoot);
    if (canonical !== this.agentWorkspaceRoot) {
      throw new Error("Agent workspace root identity changed through a symlink");
    }
    await this.workspaceManager.initialize();
  }

  private async ensureAgentWorkspace(
    agent: Agent,
    repositoryPath: string,
    planesRoot: string | null,
    hasPersistedAgent: boolean,
  ): Promise<void> {
    await this.initializeWorkspaceRoot();
    const workspacePath = path.resolve(agent.workspacePath);
    const expectedPath = path.join(this.agentWorkspaceRoot, agent.id);
    if (workspacePath !== expectedPath) {
      throw new Error("Demo Agent workspace does not match its server-owned identity");
    }
    if (
      pathsOverlap(workspacePath, path.resolve(repositoryPath)) ||
      (planesRoot !== null && pathsOverlap(workspacePath, path.resolve(planesRoot)))
    ) {
      throw new Error("Demo Agent workspace overlaps protected Shepherd state");
    }
    try {
      const entry = await lstat(workspacePath);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error("Demo Agent workspace cannot be a symlink or non-directory");
      }
      if (!hasPersistedAgent) {
        throw new Error("Refusing to adopt an untracked demo Agent workspace");
      }
      if ((await realpath(workspacePath)) !== workspacePath) {
        throw new Error("Demo Agent workspace identity changed through a symlink");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.workspaceManager.create(agent);
      if ((await realpath(workspacePath)) !== workspacePath) {
        throw new Error("Created demo Agent workspace escaped its managed root");
      }
    }
  }

  private makeAgent(
    existing: Agent | undefined,
    id: string,
    name: string,
    role: "Frontend" | "Backend",
    authority: ScopedAuthority,
    timestamp: string,
  ): Agent {
    return {
      id,
      name,
      description: "Shepherd-managed authentication implementation Agent",
      instructions: "Operate only within the assigned Execution Contract.",
      status: "ready",
      workspacePath: this.workspaceManager.workspacePath(id),
      codexThreadId: null,
      lastError: null,
      role,
      authority,
      currentContractId: null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
  }

  private makeContract(input: {
    id: string;
    missionId: string;
    agentId: string;
    title: string;
    objective: string;
    artifactPath: string;
    authority: ScopedAuthority;
    acceptanceChecks: AcceptanceCheck[];
    createdAt: string;
  }): ExecutionContract {
    return {
      id: input.id,
      missionId: input.missionId,
      agentId: input.agentId,
      title: input.title,
      objective: input.objective,
      contextualInputs: [],
      dependencyIds: [],
      semanticScopes: ["authentication"],
      declaredClaimKeys: [AUTH_CLAIM_KEY],
      authority: input.authority,
      expectedArtifacts: [
        {
          path: input.artifactPath,
          description: "Authentication transport configuration",
          required: true,
        },
      ],
      acceptance: {
        checks: input.acceptanceChecks,
        objectiveTieBreakers: [],
      },
      planeId: null,
      resultManifestPath: ".shepherd/result.json",
      manifest: null,
      verificationEvidence: [],
      state: "created",
      failure: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      startedAt: null,
      agentCompletedAt: null,
      verifiedAt: null,
      completedAt: null,
    };
  }

  private async executePreparedGeneralMission(
    prepared: PreparedGeneralMission,
  ): Promise<void> {
    this.ensureMissionRunnable(prepared.missionId);
    const startedAt = this.timestamp();
    await this.store.mutate((database) => {
      transitionMissionAndRecord(database, prepared.missionId, "running", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: startedAt,
      });
    });
    const contractPlane = await this.createContractPlane(
      prepared,
      prepared.contractId,
    );
    await this.executeContract(
      prepared,
      {
        contractId: prepared.contractId,
        operation: {
          kind: "general_contract",
          contractId: prepared.contractId,
          artifactPaths: [...prepared.artifactPaths],
          requiredContent: prepared.requiredContent,
        },
      },
      contractPlane,
      { retainAgentReservation: true },
    );
    this.ensureMissionRunnable(prepared.missionId);
    const verifyingAt = this.timestamp();
    await this.store.mutate((database) => {
      transitionMissionAndRecord(database, prepared.missionId, "verifying", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: verifyingAt,
      });
    });
    const contract = this.store
      .snapshot()
      .shepherd.contracts.find((item) => item.id === prepared.contractId);
    if (!contract) throw new Error("General Execution Contract disappeared");
    const integration = await this.integrateContracts(prepared, {
      expectedPlaneCount: 1,
      authority: contract.authority,
    });
    if (!integration.headCommit) {
      throw new Error("General integration Plane has no immutable head");
    }
    const changedFiles = await prepared.planeManager.git.changedFilesBetween(
      prepared.project.headCommit,
      integration.headCommit,
      integration.worktreePath,
    );
    const authority = validateChangedPaths(changedFiles, contract.authority);
    if (!authority.allowed || authority.manifestPaths.length > 0) {
      throw new Error("General integration diff exceeds its confirmed Contract authority");
    }
    const promotionStartedAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      const plane = database.shepherd.planes.find((item) => item.id === integration.id);
      if (!plane || plane.kind !== "integration" || plane.headCommit !== integration.headCommit) {
        throw new Error("General integration Plane changed before final verification");
      }
      plane.generalPromotionState = "reverifying";
      plane.generalPromotionEvidence = null;
      plane.updatedAt = promotionStartedAt;
      this.recordEvent(database, {
        type: "promotion_started",
        summary: "Started final general Contract verification and promotion",
        missionId: prepared.missionId,
        contractId: prepared.contractId,
        planeId: integration.id,
        timestamp: promotionStartedAt,
      });
    });
    const evidence = this.sanitizeEvidence(
      await prepared.planeManager.withVerificationSnapshot(
        integration.headCommit,
        async (snapshot) =>
          await this.verifier.verify({
            targetType: "promotion",
            targetId: integration.id,
            planePath: snapshot.path,
            checks: [generalContractCheck()],
            changedFiles,
          }),
      ),
    );
    if (!evidence.passed) {
      throw new Error("General Contract failed final independent re-verification");
    }
    const promotingAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      const project = database.shepherd.projects.find(
        (item) => item.id === prepared.project.projectId,
      );
      const plane = database.shepherd.planes.find((item) => item.id === integration.id);
      const agent = database.agents.find((item) => item.id === prepared.agentId);
      if (
        !project ||
        project.activeMissionId !== prepared.missionId ||
        project.protectedHeadCommit !== prepared.project.headCommit ||
        !plane ||
        plane.generalPromotionState !== "reverifying" ||
        plane.headCommit !== integration.headCommit ||
        evidence.targetType !== "promotion" ||
        evidence.targetId !== plane.id ||
        !evidence.passed ||
        evidence.changedFiles.length !== changedFiles.length ||
        !evidence.changedFiles.every((file) => changedFiles.includes(file)) ||
        !agent ||
        agent.currentContractId !== prepared.contractId ||
        agent.status !== "busy"
      ) {
        throw new Error("General promotion evidence no longer matches durable state");
      }
      plane.generalPromotionState = "promoting";
      plane.generalPromotionEvidence = structuredClone(evidence);
      if (!plane.verificationEvidenceIds.includes(evidence.id)) {
        plane.verificationEvidenceIds.push(evidence.id);
      }
      plane.updatedAt = promotingAt;
    });
    await this.checkpoint("promotion_ready_for_cas", {
      missionId: prepared.missionId,
      planeId: integration.id,
    });
    await prepared.planeManager.git.compareAndSwapFastForward(
      prepared.project.protectedBranch,
      prepared.project.headCommit,
      integration.headCommit,
    );
    try {
      await this.checkpoint("promotion_cas_completed", {
        missionId: prepared.missionId,
        planeId: integration.id,
      });
      const promotedAgent = this.store
        .snapshot()
        .agents.find((item) => item.id === prepared.agentId);
      if (
        !promotedAgent ||
        promotedAgent.status !== "busy" ||
        promotedAgent.currentContractId !== prepared.contractId
      ) {
        throw new Error("General Contract Agent reservation disappeared after promotion");
      }
      await this.workspaceManager.assertManagedWorkspace(promotedAgent);
      await synchronizeVerifiedArtifacts(
        integration.worktreePath,
        promotedAgent.workspacePath,
        prepared.artifactPaths,
      );
      await this.workspaceManager.assertManagedWorkspace(promotedAgent);
    } catch (error) {
      await this.persistGeneralMaterializationFailure(prepared, integration, error);
      return;
    }
    const completedAt = this.timestamp();
    await this.checkpoint("general_completion_persistence", {
      missionId: prepared.missionId,
      contractId: prepared.contractId,
      planeId: integration.id,
    });
    try {
      await this.store.mutate((database) => {
        const project = database.shepherd.projects.find(
          (item) => item.id === prepared.project.projectId,
        );
        const plane = database.shepherd.planes.find((item) => item.id === integration.id);
        const agent = database.agents.find((item) => item.id === prepared.agentId);
        if (
          !project ||
          !plane ||
          plane.generalPromotionState !== "promoting" ||
          plane.generalPromotionEvidence?.id !== evidence.id ||
          !agent ||
          agent.currentContractId !== prepared.contractId
        ) {
          throw new Error("General promotion records disappeared before completion");
        }
        project.protectedHeadCommit = integration.headCommit!;
        project.activeMissionId = null;
        project.updatedAt = completedAt;
        plane.state = "verified";
        plane.generalPromotionState = "promoted";
        plane.updatedAt = completedAt;
        agent.status = "ready";
        agent.currentContractId = null;
        agent.lastError = null;
        agent.updatedAt = completedAt;
        this.recordEvent(database, {
          type: "promotion_completed",
          summary: "Promoted the independently verified general Contract",
          missionId: prepared.missionId,
          contractId: prepared.contractId,
          planeId: integration.id,
          timestamp: completedAt,
          details: {
            previousHead: prepared.project.headCommit,
            promotedHead: integration.headCommit!,
            verificationEvidenceId: evidence.id,
            mandatoryChecksPassed: evidence.checks.filter(
              (check) => check.mandatory && check.passed,
            ).length,
          },
        });
        const completion = transitionMissionAndRecord(
          database,
          prepared.missionId,
          "completed",
          {
            actor: "control_plane",
            eventActor: SHEPHERD_ACTOR,
            timestamp: completedAt,
          },
        );
        this.appendServerGroupMessage(database, {
          sourceId: completion.id,
          missionId: prepared.missionId,
          contractId: prepared.contractId,
          targetAgentId: prepared.agentId,
          content:
            "Mission completed after independent verification and protected promotion.",
          timestamp: completedAt,
        });
      });
    } catch (error) {
      await this.persistGeneralMaterializationFailure(
        prepared,
        integration,
        error,
        true,
      );
    }
  }

  private async persistGeneralMaterializationFailure(
    prepared: PreparedGeneralMission,
    integration: Plane,
    _cause: unknown,
    workspaceMaterialized = false,
  ): Promise<void> {
    if (!integration.headCommit) {
      throw new Error("Promoted general integration Plane has no immutable head");
    }
    const failedAt = this.timestamp();
    const failure: FailureInfo = {
      code: "persistence_error",
      message: workspaceMaterialized
        ? "The verified Contract was promoted and materialized, but durable completion needs human attention"
        : "The verified Contract was promoted, but its Agent workspace could not be materialized",
      stage: workspaceMaterialized
        ? "general_completion_persistence"
        : "agent_workspace_materialization",
      at: failedAt,
      retryable: true,
    };
    await this.store.mutate((database) => {
      const mission = database.shepherd.missions.find(
        (item) => item.id === prepared.missionId,
      );
      const project = database.shepherd.projects.find(
        (item) => item.id === prepared.project.projectId,
      );
      const plane = database.shepherd.planes.find((item) => item.id === integration.id);
      const agent = database.agents.find((item) => item.id === prepared.agentId);
      if (
        !mission ||
        !project ||
        !plane ||
        plane.generalPromotionState !== "promoting" ||
        !plane.generalPromotionEvidence?.passed
      ) {
        throw new Error("General promotion state disappeared during materialization recovery");
      }
      project.protectedHeadCommit = integration.headCommit!;
      project.activeMissionId = mission.id;
      project.updatedAt = failedAt;
      plane.state = "verified";
      plane.generalPromotionState = "promoted";
      plane.error = null;
      plane.updatedAt = failedAt;
      if (agent) {
        agent.status = "error";
        agent.currentContractId = null;
        agent.lastError = failure.message;
        agent.updatedAt = failedAt;
      }
      this.recordEvent(database, {
        type: "promotion_completed",
        summary: "Promoted the independently verified general Contract",
        missionId: mission.id,
        contractId: prepared.contractId,
        planeId: plane.id,
        timestamp: failedAt,
        details: {
          previousHead: prepared.project.headCommit,
          promotedHead: integration.headCommit!,
          workspaceMaterialized,
        },
      });
      const attention = transitionMissionAndRecord(
        database,
        mission.id,
        "attention_required",
        {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: failedAt,
          attentionReason: failure.message,
          failure,
          summary: failure.message,
          details: { failureCode: failure.code },
        },
      );
      this.appendServerGroupMessage(database, {
        sourceId: attention.id,
        missionId: mission.id,
        contractId: prepared.contractId,
        targetAgentId: prepared.agentId,
        content:
          "The verified change is protected, but the Agent workspace needs human attention before further work.",
        timestamp: failedAt,
      });
    });
  }

  private async executePreparedMission(
    prepared: PreparedMission,
  ): Promise<DeterministicDemoResult> {
    this.ensureMissionRunnable(prepared.missionId);
    const startedAt = this.timestamp();
    await this.store.mutate((database) => {
      transitionMissionAndRecord(database, prepared.missionId, "running", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: startedAt,
      });
    });

    const contractInputs: ContractPlaneInput[] = [
      {
        contractId: prepared.frontendContractId,
        operation: {
          kind: "frontend_contract",
          contractId: prepared.frontendContractId,
          targetTransport: prepared.frontendTransport,
        },
      },
      {
        contractId: prepared.backendContractId,
        operation: {
          kind: "backend_contract",
          contractId: prepared.backendContractId,
          targetTransport: prepared.backendTransport,
        },
      },
    ];
    const schedulingSnapshot = this.store.snapshot();
    const schedulingMission = schedulingSnapshot.shepherd.missions.find(
      (mission) => mission.id === prepared.missionId,
    );
    const schedulingContracts = schedulingSnapshot.shepherd.contracts.filter(
      (contract) => contract.missionId === prepared.missionId,
    );
    if (!schedulingMission) throw new Error("Mission disappeared before scheduling");
    const scheduling = selectRunnableContracts(
      schedulingMission,
      schedulingContracts,
      {
        activePlaneCount: 0,
        maxPlaneConcurrency: this.settings().maxConcurrentPlanes,
      },
    );
    const selectedIds = new Set(scheduling.selected.map((contract) => contract.id));
    if (selectedIds.size !== contractInputs.length) {
      const blockedAt = this.timestamp();
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        for (const blocked of scheduling.blocked) {
          const contract = database.shepherd.contracts.find(
            (item) => item.id === blocked.contract.id,
          );
          if (
            contract &&
            canTransitionContract(contract.state, "blocked", "control_plane")
          ) {
            transitionContractAndRecord(database, contract.id, "blocked", {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: blockedAt,
              summary: "Contract blocked by the durable DAG scheduler",
              details: { reason: blocked.reason.code },
            });
          }
        }
      });
      throw new Error("Durable Contract DAG did not produce the required runnable batch");
    }
    const scheduledInputs = scheduling.selected.map((selected) => {
      const input = contractInputs.find(
        (candidate) => candidate.contractId === selected.id,
      );
      if (!input) throw new Error("Scheduler selected an unknown Contract input");
      return input;
    });
    const contractPlanes: Plane[] = [];
    try {
      for (const input of scheduledInputs) {
        contractPlanes.push(await this.createContractPlane(prepared, input.contractId));
      }
    } catch (error) {
      await this.unwindInitialContractPlanes(prepared, contractPlanes, error);
      throw error;
    }
    let rejectInfrastructureFailure!: (reason: unknown) => void;
    const infrastructureFailure = new Promise<PromiseSettledResult<void>[]>(
      (_resolve, reject) => {
        rejectInfrastructureFailure = reject;
      },
    );
    const contractResultsPromise = allSettledBounded(
      scheduledInputs,
      this.settings().maxConcurrentPlanes,
      async (input, index) => {
        const plane = contractPlanes[index];
        if (!plane) throw new Error("Contract Plane was not created");
        try {
          await this.executeContract(prepared, input, plane);
        } catch (error) {
          if (error instanceof ContractVerificationInfrastructureError) {
            rejectInfrastructureFailure(error);
          }
          throw error;
        }
      },
    );
    const contractResults = await Promise.race([
      contractResultsPromise,
      infrastructureFailure,
    ]);
    const contractFailure = contractResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (contractFailure) throw contractFailure.reason;
    this.ensureMissionRunnable(prepared.missionId);

    const verificationAt = this.timestamp();
    try {
      await this.store.mutateRecoverably({
        operation: "mission_verification_transition",
        missionId: prepared.missionId,
        contractIds: [prepared.frontendContractId, prepared.backendContractId],
        planeIds: contractPlanes.map((plane) => plane.id),
        stage: "mission_verification_persistence",
        timestamp: verificationAt,
      }, (database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        transitionMissionAndRecord(database, prepared.missionId, "verifying", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: verificationAt,
        });
      });
    } catch (error) {
      if (this.store.persistenceRecoveryIntent()) {
        const outcome = await reconcilePersistenceRecoveryIntent({
          store: this.store,
          now: this.now,
        });
        if (outcome === "committed") {
          return await this.continueAfterMissionVerificationPersistence(
            prepared,
            contractPlanes,
          );
        }
      }
      throw error;
    }
    return await this.continueAfterMissionVerificationPersistence(prepared, contractPlanes);
  }

  private async continueAfterMissionVerificationPersistence(
    prepared: PreparedMission,
    contractPlanes: Plane[],
  ): Promise<DeterministicDemoResult> {
    const integrationPlane = await this.integrateContracts(prepared);
    const integrationCommit = integrationPlane.headCommit;
    if (!integrationCommit) throw new Error("Integration Plane has no immutable head");
    await this.runAdvisoryModelReview(prepared.missionId, integrationPlane.id);
    const collision = await this.detectAndPersistCollision(
      prepared.missionId,
      integrationPlane,
    );
    const candidateWorks = await this.createCandidates(
      prepared,
      collision,
      integrationCommit,
    );
    const candidateSettled = await allSettledBounded(
      candidateWorks,
      this.settings().maxConcurrentPlanes,
      async (work) => await this.executeCandidate(prepared, work),
    );
    for (const [index, settled] of candidateSettled.entries()) {
      if (settled.status === "rejected") {
        const work = candidateWorks[index];
        if (work) await this.persistCandidateInfrastructureFailure(work, settled.reason);
      }
    }

    const retryableCandidateIds = this.store
      .snapshot()
      .shepherd.candidates.filter(
        (candidate) =>
          candidate.collisionId === collision.id &&
          candidate.retryCount === 0 &&
          candidate.failure?.retryable === true &&
          (candidate.executionState === "failed" ||
            candidate.executionState === "timed_out"),
      )
      .map((candidate) => candidate.id);
    await allSettledBounded(
      retryableCandidateIds,
      this.settings().maxConcurrentPlanes,
      async (candidateId) =>
        await this.retryTransientCandidate(prepared, candidateId),
    );
    this.ensureMissionRunnable(prepared.missionId);

    const candidates = this.store
      .snapshot()
      .shepherd.candidates.filter((item) => item.collisionId === collision.id);
    const decision = decideResolutionWinner(candidates, []);
    if (!this.settings().autoResolution) {
      const pausedAt = this.timestamp();
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        const persistedCandidates = database.shepherd.candidates.filter(
          (candidate) => candidate.collisionId === collision.id,
        );
        for (const candidate of persistedCandidates) {
          candidate.selectionState =
            candidate.executionState === "passed" ? "tied" : "rejected";
          candidate.updatedAt = pausedAt;
        }
      });
      await this.persistAttentionRequired(
        prepared.missionId,
        collision.id,
        "auto_resolution_disabled",
      );
      throw new Error("Resolution requires attention: auto_resolution_disabled");
    }
    if (decision.kind !== "selected") {
      const decisionAt = this.timestamp();
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        const current = database.shepherd.candidates.filter(
          (item) => item.collisionId === collision.id,
        );
        for (const updated of applyWinnerDecision(current, decision, decisionAt)) {
          replaceById(database.shepherd.candidates, updated);
        }
        if (decision.kind === "tie") {
          this.recordEvent(database, {
            type: "tie_escalated",
            summary: "Objective evidence left the resolution candidates tied",
            missionId: prepared.missionId,
            collisionId: collision.id,
            timestamp: decisionAt,
            details: { reason: decision.reason },
          });
        }
      });
      await this.persistAttentionRequired(
        prepared.missionId,
        collision.id,
        decision.reason,
      );
      throw new Error(`Resolution requires attention: ${decision.reason}`);
    }
    const selectedAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      const current = database.shepherd.candidates.filter(
        (item) => item.collisionId === collision.id,
      );
      for (const updated of applyWinnerDecision(current, decision, selectedAt)) {
        replaceById(database.shepherd.candidates, updated);
      }
      this.recordEvent(database, {
        type: "candidate_selected",
        summary: "Selected the independently verified resolution candidate",
        missionId: prepared.missionId,
        collisionId: collision.id,
        candidateId: decision.selectedCandidateId,
        timestamp: selectedAt,
        details: {
          source: decision.source,
          tieBreaker: decision.tieBreaker,
        },
      });
    });

    const selectedCandidate = this.store
      .snapshot()
      .shepherd.candidates.find((item) => item.id === decision.selectedCandidateId);
    if (!selectedCandidate) throw new Error("Selected candidate disappeared before promotion");
    const selectedPlane = this.store
      .snapshot()
      .shepherd.planes.find((item) => item.id === selectedCandidate.planeId);
    if (!selectedPlane) throw new Error("Selected candidate Plane is missing");
    const promotion = await this.promoteCandidate(
      prepared,
      selectedCandidate,
      selectedPlane,
    );
    this.ensureMissionRunnable(prepared.missionId);
    await this.persistPromotionOutcome(
      prepared,
      collision,
      selectedCandidate,
      selectedPlane,
      promotion,
    );
    if (!promotion.promoted) throw new Error("Unreachable failed promotion outcome");

    const detail = this.missionDetail(prepared.missionId);
    if (!detail) throw new Error("Completed Mission could not be reloaded");
    const finalCollision = detail.collisions.find((item) => item.id === collision.id);
    const finalSelected = detail.candidates.find(
      (item) => item.id === selectedCandidate.id,
    );
    if (!finalCollision || !finalSelected) {
      throw new Error("Completed resolution records could not be reloaded");
    }
    return {
      mission: detail.mission,
      collision: finalCollision,
      candidates: detail.candidates,
      selectedCandidate: finalSelected,
      integrationCommit,
      promotedHead: promotion.promotedHead,
    };
  }

  private async createContractPlane(
    prepared: PreparedProjectMission,
    contractId: string,
  ): Promise<Plane> {
    this.ensureMissionRunnable(prepared.missionId);
    const snapshot = this.store.snapshot();
    const contract = snapshot.shepherd.contracts.find((item) => item.id === contractId);
    if (!contract) throw new Error("Execution Contract is missing");
    const planeId = this.identifier("plane-contract");
    await this.checkpoint("contract_plane_creation_start", {
      missionId: prepared.missionId,
      contractId,
      planeId,
    });
    let plane: Plane;
    try {
      plane = await prepared.planeManager.createPlane({
        id: planeId,
        projectId: prepared.project.projectId,
        missionId: prepared.missionId,
        kind: "contract",
        contractId,
        candidateId: null,
        baseCommit: prepared.project.headCommit,
        purpose: contract.objective,
        executionIdentity: this.identifier("execution"),
        authority: contract.authority,
      });
    } catch (error) {
      const failedAt = this.timestamp();
      const failure = this.makeFailure(error, "plane_creation", failedAt);
      await this.store.mutate((database) => {
        transitionContractAndRecord(database, contractId, "execution_failed", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: failedAt,
          failure,
          summary: "Contract Plane worktree creation failed",
          details: { failureCode: failure.code, stage: failure.stage },
        });
        const agent = database.agents.find((item) => item.id === contract.agentId);
        if (agent) {
          agent.status = "error";
          agent.currentContractId = null;
          agent.lastError = failure.message;
          agent.updatedAt = failedAt;
        }
      });
      throw error;
    }
    try {
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        database.shepherd.planes.push(plane);
        const persisted = database.shepherd.contracts.find(
          (item) => item.id === contractId,
        );
        if (!persisted) throw new Error("Execution Contract disappeared");
        persisted.planeId = plane.id;
        persisted.updatedAt = this.timestamp();
      });
    } catch (error) {
      await prepared.planeManager.destroyPlane(plane).catch(() => undefined);
      throw error;
    }
    return plane;
  }

  private async unwindInitialContractPlanes(
    prepared: PreparedProjectMission,
    planes: readonly Plane[],
    creationError: unknown,
  ): Promise<void> {
    if (planes.length === 0) return;
    const destroyedIds = new Set<string>();
    const cleanupFailedIds = new Set<string>();
    for (const plane of [...planes].reverse()) {
      try {
        await prepared.planeManager.destroyPlane(plane);
        destroyedIds.add(plane.id);
      } catch {
        cleanupFailedIds.add(plane.id);
      }
    }
    const updatedAt = this.timestamp();
    const cleanupFailure: FailureInfo = {
      code: "worktree_creation_failure",
      message: "Initial Contract Plane cleanup requires operator attention",
      stage: "plane_unwind",
      at: updatedAt,
      retryable: false,
    };
    const creationFailure = this.makeFailure(
      creationError,
      "plane_creation",
      updatedAt,
    );
    await this.store.mutate((database) => {
      const missionContracts = database.shepherd.contracts.filter(
        (contract) => contract.missionId === prepared.missionId,
      );
      database.shepherd.planes = database.shepherd.planes.filter((plane) => {
        if (destroyedIds.has(plane.id)) return false;
        if (cleanupFailedIds.has(plane.id)) {
          plane.state = "failed";
          plane.error = cleanupFailure;
          plane.updatedAt = updatedAt;
        }
        return true;
      });
      for (const contract of missionContracts) {
        if (contract.planeId && destroyedIds.has(contract.planeId)) {
          contract.planeId = null;
          contract.updatedAt = updatedAt;
        } else if (
          contract.planeId &&
          cleanupFailedIds.has(contract.planeId) &&
          canTransitionContract(contract.state, "interrupted", "control_plane")
        ) {
          transitionContractAndRecord(database, contract.id, "interrupted", {
            actor: "control_plane",
            eventActor: SHEPHERD_ACTOR,
            timestamp: updatedAt,
            failure: cleanupFailure,
            summary: "Initial Contract Plane cleanup requires operator attention",
            details: { failureCode: cleanupFailure.code, stage: cleanupFailure.stage },
          });
        }
        const agent = database.agents.find((item) => item.id === contract.agentId);
        if (agent?.currentContractId === contract.id) {
          agent.currentContractId = null;
          agent.status = cleanupFailedIds.has(contract.planeId ?? "")
            ? "error"
            : "ready";
          agent.lastError = cleanupFailedIds.has(contract.planeId ?? "")
            ? cleanupFailure.message
            : null;
          agent.updatedAt = updatedAt;
        }
      }
      if (cleanupFailedIds.size > 0) {
        const mission = database.shepherd.missions.find(
          (item) => item.id === prepared.missionId,
        );
        if (
          mission &&
          canTransitionMission(mission.state, "attention_required", "control_plane")
        ) {
          transitionMissionAndRecord(database, mission.id, "attention_required", {
            actor: "control_plane",
            eventActor: SHEPHERD_ACTOR,
            timestamp: updatedAt,
            attentionReason: "plane_unwind_failed",
            failure: creationFailure,
          });
        }
      }
    });
  }

  private async persistContractAuthorityDenial(
    contractId: string,
    planeId: string,
    changedPaths: readonly string[],
  ): Promise<never> {
    const deniedAt = this.timestamp();
    const failure: FailureInfo = {
      code: "unauthorized_file_change",
      message: "Actual changes exceeded the Contract's scoped authority",
      stage: "contract_authority",
      at: deniedAt,
      retryable: false,
    };
    await this.store.mutate((database) => {
      transitionContractAndRecord(database, contractId, "authority_validation", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: deniedAt,
      });
      transitionContractAndRecord(database, contractId, "authority_denied", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: deniedAt,
        failure,
      });
      const plane = database.shepherd.planes.find((item) => item.id === planeId);
      if (plane) {
        plane.state = "failed";
        plane.error = failure;
        plane.changedFiles = [...changedPaths];
        plane.updatedAt = deniedAt;
      }
      const contract = database.shepherd.contracts.find(
        (item) => item.id === contractId,
      );
      const agent = database.agents.find((item) => item.id === contract?.agentId);
      if (agent) {
        agent.status = "error";
        agent.currentContractId = null;
        agent.lastError = failure.message;
        agent.updatedAt = deniedAt;
      }
    });
    throw new AuthorityViolationError("contract");
  }

  private async executeContract(
    prepared: PreparedProjectMission,
    input: ContractPlaneInput,
    initialPlane: Plane,
    options: { retainAgentReservation?: boolean } = {},
  ): Promise<void> {
    this.ensureMissionRunnable(prepared.missionId);
    const startedAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      transitionContractAndRecord(database, input.contractId, "running", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: startedAt,
      });
      const agent = database.agents.find(
        (item) =>
          item.id ===
          database.shepherd.contracts.find((contract) => contract.id === input.contractId)
            ?.agentId,
      );
      if (agent) {
        agent.status = "busy";
        agent.currentContractId = input.contractId;
        agent.updatedAt = startedAt;
      }
      const plane = database.shepherd.planes.find((item) => item.id === initialPlane.id);
      if (plane) {
        plane.state = "running";
        plane.updatedAt = startedAt;
      }
    });
    let executionWorkspace: ExecutionWorkspace | null = null;
    try {
      executionWorkspace =
        await prepared.planeManager.createExecutionWorkspace(initialPlane);
      this.ensureMissionRunnable(prepared.missionId);
      await this.checkpoint("contract_execution_workspace_ready", {
        missionId: prepared.missionId,
        contractId: input.contractId,
      });
      const executionSnapshot = this.store.snapshot();
      const contract = executionSnapshot.shepherd.contracts.find(
        (item) => item.id === input.contractId,
      );
      const agent = executionSnapshot.agents.find(
        (item) => item.id === contract?.agentId,
      );
      if (!contract || !agent) {
        throw new Error("Contract prompt identity disappeared before execution");
      }
      const prompt = buildContractExecutionPrompt({
        agent: {
          id: agent.id,
          name: agent.name,
          role: agent.role ?? "Generalist",
        },
        contract,
        dependencyOutputs: this.dependencyOutputs(contract),
        sensitiveValues: this.sensitiveValues,
      });
      const executionResult = await this.executor.run({
        executionId: initialPlane.executionIdentity,
        workspacePath: executionWorkspace.path,
        operation: input.operation,
        prompt,
        timeoutMs: this.settings().contractTimeoutMs,
      });
      this.ensureMissionRunnable(prepared.missionId);
      const runtimeSessionFingerprint = await this.persistRuntimeSessionFingerprint(
        initialPlane.id,
        executionResult.runtimeSessionId,
      );
      initialPlane.runtimeSessionFingerprint = runtimeSessionFingerprint;
    } catch (error) {
      if (
        error instanceof MissionCancelledError ||
        this.missionIsCancelled(prepared.missionId)
      ) {
        if (executionWorkspace) {
          await prepared.planeManager
            .destroyExecutionWorkspace(executionWorkspace)
            .catch(() => undefined);
        }
        throw new MissionCancelledError();
      }
      if (
        error instanceof ContractVerificationInfrastructureError ||
        this.missionHasContractVerificationInfrastructureFailure(
          prepared.missionId,
        )
      ) {
        if (executionWorkspace) {
          await prepared.planeManager
            .destroyExecutionWorkspace(executionWorkspace)
            .catch(() => undefined);
        }
        throw new ContractVerificationInfrastructureError();
      }
      const failedAt = this.timestamp();
      const failure = this.makeFailure(error, "contract_execution", failedAt);
      await this.store.mutate((database) => {
        transitionContractAndRecord(
          database,
          input.contractId,
          failure.code === "agent_timeout"
            ? "execution_timed_out"
            : "execution_failed",
          {
            actor: "control_plane",
            eventActor: SHEPHERD_ACTOR,
            timestamp: failedAt,
            failure,
            ...(failure.code === "agent_timeout"
              ? { summary: "Agent Runtime execution timed out" }
              : failure.code === "agent_runtime_error"
                ? { summary: "Agent Runtime execution failed" }
                : {}),
            details: { failureCode: failure.code },
          },
        );
        const plane = database.shepherd.planes.find(
          (item) => item.id === initialPlane.id,
        );
        if (plane) {
          plane.state = "failed";
          plane.error = failure;
          plane.updatedAt = failedAt;
        }
        const persistedContract = database.shepherd.contracts.find(
          (item) => item.id === input.contractId,
        );
        const agent = database.agents.find(
          (item) => item.id === persistedContract?.agentId,
        );
        if (agent) {
          agent.status = "error";
          agent.currentContractId = null;
          agent.lastError = failure.message;
          agent.updatedAt = failedAt;
        }
      });
      if (executionWorkspace) {
        await prepared.planeManager.destroyExecutionWorkspace(executionWorkspace);
      }
      throw error;
    }
    const agentCompletedAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      const runtimeSessionFingerprint = database.shepherd.planes.find(
        (item) => item.id === initialPlane.id,
      )?.runtimeSessionFingerprint;
      transitionContractAndRecord(database, input.contractId, "agent_completed", {
        actor: "agent_runtime",
        eventActor: {
          type: "agent",
          id: database.shepherd.contracts.find((item) => item.id === input.contractId)
            ?.agentId ?? null,
          displayName: "Contract Agent",
        },
        timestamp: agentCompletedAt,
        details: {
          runtimeSessionEstablished: Boolean(runtimeSessionFingerprint),
        },
      });
    });

    if (!executionWorkspace) {
      throw new Error("Contract execution workspace disappeared after completion");
    }
    try {
      this.ensureMissionRunnable(prepared.missionId);
      await prepared.planeManager.importExecutionWorkspace(
        initialPlane,
        executionWorkspace,
      );
      this.ensureMissionRunnable(prepared.missionId);
    } catch (error) {
      if (error instanceof PlaneAuthorityViolationError) {
        await this.persistContractAuthorityDenial(
          input.contractId,
          initialPlane.id,
          error.deniedPaths,
        );
      }
      throw error;
    } finally {
      await prepared.planeManager.destroyExecutionWorkspace(executionWorkspace);
    }

    const changedPaths = await prepared.planeManager.git.changedFilesSince(
      initialPlane.baseCommit,
      initialPlane.worktreePath,
    );
    this.ensureMissionRunnable(prepared.missionId);
    const contract = this.store
      .snapshot()
      .shepherd.contracts.find((item) => item.id === input.contractId);
    if (!contract) throw new Error("Execution Contract disappeared after Agent completion");
    const authority = validateChangedPaths(changedPaths, contract.authority);
    if (!authority.allowed) {
      await this.persistContractAuthorityDenial(
        input.contractId,
        initialPlane.id,
        changedPaths,
      );
    }
    if (authority.manifestPaths.length !== 1) {
      const failedAt = this.timestamp();
      const failure: FailureInfo = {
        code: "missing_result_manifest",
        message: "The Contract did not produce exactly one trusted result manifest",
        stage: "manifest_ingestion",
        at: failedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        transitionContractAndRecord(database, input.contractId, "manifest_missing", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: failedAt,
          failure,
        });
      });
      throw new Error("Contract result manifest is missing");
    }

    const manifestPath = path.join(
      initialPlane.worktreePath,
      ".shepherd",
      "result.json",
    );
    let manifestRaw: string;
    try {
      manifestRaw = await readBoundedRegularFile(manifestPath);
    } catch (error) {
      const failedAt = this.timestamp();
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      const failure: FailureInfo = {
        code: missing ? "missing_result_manifest" : "malformed_manifest",
        message: missing
          ? "The Contract result manifest is missing"
          : "The Contract result manifest could not be safely read",
        stage: "manifest_ingestion",
        at: failedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        transitionContractAndRecord(
          database,
          input.contractId,
          missing ? "manifest_missing" : "manifest_malformed",
          {
            actor: "control_plane",
            eventActor: SHEPHERD_ACTOR,
            timestamp: failedAt,
            failure,
          },
        );
      });
      throw error;
    }
    const existingPaths = await existingRegularPaths(
      initialPlane.worktreePath,
      changedPaths,
    );
    const ingestion = ingestContractResultManifest(manifestRaw, {
      expectedContractId: input.contractId,
      missionId: prepared.missionId,
      declaredClaimKeys: contract.declaredClaimKeys,
      declaredSemanticScopes: contract.semanticScopes,
      expectedArtifacts: contract.expectedArtifacts,
      existingPaths,
      changedPaths,
      createdAt: this.timestamp(),
      claimId: (index) => `${input.contractId}-claim-${index + 1}`,
    });
    if (!ingestion.ok) {
      const failedAt = this.timestamp();
      const malformed = ingestion.failureCode === "malformed_manifest";
      const failure: FailureInfo = {
        code: ingestion.failureCode,
        message: `Strict result manifest ingestion failed: ${ingestion.failureCode}`,
        stage: "manifest_ingestion",
        at: failedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        if (malformed) {
          transitionContractAndRecord(
            database,
            input.contractId,
            "manifest_malformed",
            {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
              failure,
            },
          );
        } else {
          transitionContractAndRecord(
            database,
            input.contractId,
            "authority_validation",
            {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
            },
          );
          transitionContractAndRecord(
            database,
            input.contractId,
            "claim_rejected",
            {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
              failure,
            },
          );
        }
      });
      throw new Error(
        `Strict result manifest ingestion failed: ${ingestion.failureCode}`,
      );
    }
    const authorityAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      transitionContractAndRecord(
        database,
        input.contractId,
        "authority_validation",
        {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: authorityAt,
        },
      );
      this.recordEvent(database, {
        type: "authority_accepted",
        summary: "Accepted the actual Git diff within Contract authority",
        missionId: prepared.missionId,
        contractId: input.contractId,
        planeId: initialPlane.id,
        timestamp: authorityAt,
        details: { changedFileCount: changedPaths.length },
      });
    });
    await rm(manifestPath);
    const finalizedChangedPaths = await prepared.planeManager.git.changedFilesSince(
      initialPlane.baseCommit,
      initialPlane.worktreePath,
    );
    const finalizedAuthority = validateChangedPaths(
      finalizedChangedPaths,
      contract.authority,
    );
    if (!finalizedAuthority.allowed || finalizedAuthority.manifestPaths.length !== 0) {
      throw new Error("Contract diff failed authority after manifest removal");
    }
    this.ensureMissionRunnable(prepared.missionId);
    let plane = await prepared.planeManager.commitPlane(
      initialPlane,
      `Finalize Contract ${input.contractId}`,
    );
    plane = { ...plane, state: "inspecting", updatedAt: this.timestamp() };
    const verificationStartedAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      replaceById(database.shepherd.planes, plane);
      const persisted = database.shepherd.contracts.find(
        (item) => item.id === input.contractId,
      );
      if (!persisted) throw new Error("Execution Contract disappeared at ingestion");
      persisted.manifest = ingestion.manifest;
      persisted.updatedAt = verificationStartedAt;
      transitionContractAndRecord(database, input.contractId, "verifying", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: verificationStartedAt,
      });
    });

    if (!plane.headCommit) throw new Error("Contract Plane has no immutable commit");
    let evidence: VerificationEvidence;
    try {
      evidence = this.sanitizeEvidence(
        await prepared.planeManager.withVerificationSnapshot(
          plane.headCommit,
          async (snapshot) => {
            await this.checkpoint("contract_verification_snapshot_ready", {
              missionId: prepared.missionId,
              contractId: input.contractId,
            });
            this.ensureMissionRunnable(prepared.missionId);
            return await this.verifier.verify({
              targetType: "contract",
              targetId: input.contractId,
              planePath: snapshot.path,
              checks: contract.acceptance.checks,
              changedFiles: plane.changedFiles,
            });
          },
        ),
      );
    } catch (error) {
      if (
        error instanceof MissionCancelledError ||
        this.missionIsCancelled(prepared.missionId)
      ) {
        throw new MissionCancelledError();
      }
      evidence = await this.persistContractVerificationInfrastructureFailure(
        prepared.missionId,
        input.contractId,
        plane.id,
      );
    }
    if (
      evidence.checks.some(
        (check) => check.mandatory && check.status === "infrastructure_error",
      )
    ) {
      evidence = await this.persistContractVerificationInfrastructureFailure(
        prepared.missionId,
        input.contractId,
        plane.id,
      );
    }
    this.ensureMissionRunnable(prepared.missionId);
    const verifiedAt = this.timestamp();
    if (!evidence.passed) {
      const failure: FailureInfo = {
        code: "failed_independent_acceptance",
        message: evidence.summary,
        stage: "contract_verification",
        at: verifiedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        transitionContractAndRecord(
          database,
          input.contractId,
          "verification_failed",
          {
            actor: "independent_verifier",
            eventActor: VERIFIER_ACTOR,
            timestamp: verifiedAt,
            failure,
          },
        );
      });
      throw new Error(`Contract ${input.contractId} failed independent verification`);
    }
    const verifiedTransport = verifiedAuthTransportFact(evidence);
    const claimsCorroborated =
      contract.declaredClaimKeys.length === 0
        ? ingestion.claims.length === 0
        : verifiedTransport !== null &&
          ingestion.claims.every(
            (claim) =>
              claim.key !== AUTH_CLAIM_KEY || claim.value === verifiedTransport,
          );
    if (!claimsCorroborated) {
      const failure: FailureInfo = {
        code: "invalid_semantic_evidence",
        message:
          "Independent verification did not corroborate the Agent-declared semantic claim",
        stage: "claim_corroboration",
        at: verifiedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        transitionContractAndRecord(database, input.contractId, "claim_rejected", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: verifiedAt,
          failure,
        });
      });
      throw new Error(`Contract ${input.contractId} semantic claim was not corroborated`);
    }
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      for (const claim of ingestion.claims) replaceById(database.shepherd.claims, claim);
      this.recordEvent(database, {
        type: "claims_loaded",
        summary: "Loaded independently corroborated semantic claims",
        missionId: prepared.missionId,
        contractId: input.contractId,
        planeId: plane.id,
        timestamp: verifiedAt,
        details: { claimCount: ingestion.claims.length },
      });
      const verifiedEvent = transitionContractAndRecord(database, input.contractId, "verified", {
        actor: "independent_verifier",
        eventActor: VERIFIER_ACTOR,
        timestamp: verifiedAt,
        verificationEvidence: evidence,
      });
      const verifiedContract = database.shepherd.contracts.find(
        (item) => item.id === input.contractId,
      );
      if (verifiedContract?.manifest) {
        this.appendServerGroupMessage(database, {
          sourceId: verifiedEvent.id,
          missionId: prepared.missionId,
          contractId: verifiedContract.id,
          targetAgentId: verifiedContract.agentId,
          content: `Contract verified: ${verifiedContract.title}. ${verifiedContract.manifest.summary}`,
          timestamp: verifiedAt,
        });
      }
      const persistedPlane = database.shepherd.planes.find(
        (item) => item.id === plane.id,
      );
      if (persistedPlane) {
        persistedPlane.state = "verified";
        persistedPlane.verificationEvidenceIds.push(evidence.id);
        persistedPlane.updatedAt = verifiedAt;
      }
      const persistedContract = database.shepherd.contracts.find(
        (item) => item.id === input.contractId,
      );
      const agent = database.agents.find(
        (item) => item.id === persistedContract?.agentId,
      );
      if (agent && !options.retainAgentReservation) {
        agent.status = "ready";
        agent.currentContractId = null;
        agent.updatedAt = verifiedAt;
      }
    });
  }

  private async persistContractVerificationInfrastructureFailure(
    missionId: string,
    contractId: string,
    planeId: string,
  ): Promise<never> {
    const failedAt = this.timestamp();
    const failure: FailureInfo = {
      code: "verification_infrastructure_error",
      message: "Contract independent verification infrastructure failed",
      stage: "contract_verification",
      at: failedAt,
      retryable: true,
    };
    let cancelled = false;
    const executorIds: string[] = [];
    const verifierIds: string[] = [];
    await this.store.mutate((database) => {
      const mission = database.shepherd.missions.find(
        (item) => item.id === missionId,
      );
      const contract = database.shepherd.contracts.find(
        (item) => item.id === contractId,
      );
      const plane = database.shepherd.planes.find((item) => item.id === planeId);
      if (!mission || !contract || !plane) {
        throw new Error(
          "Contract verification records disappeared before failure persistence",
        );
      }
      if (mission.state === "cancelled") {
        cancelled = true;
        return;
      }
      if (
        mission.state === "failed" &&
        mission.failure?.code === failure.code &&
        mission.failure.stage === failure.stage
      ) {
        return;
      }
      if (contract.state !== "verifying") {
        throw new Error(
          "Contract left verification before infrastructure failure persistence",
        );
      }
      const missionContractIds = new Set(mission.contractIds);
      for (const affectedContract of database.shepherd.contracts) {
        if (
          affectedContract.missionId !== missionId ||
          !missionContractIds.has(affectedContract.id)
        ) {
          continue;
        }
        if (affectedContract.state === "verifying") {
          verifierIds.push(affectedContract.id);
        }
        if (affectedContract.id === contractId) {
          transitionContractAndRecord(
            database,
            affectedContract.id,
            "verification_failed",
            {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
              failure: { ...failure },
              summary: failure.message,
              details: {
                failureCode: failure.code,
                stage: failure.stage,
              },
            },
          );
        } else if (
          canTransitionContract(
            affectedContract.state,
            "interrupted",
            "control_plane",
          )
        ) {
          transitionContractAndRecord(
            database,
            affectedContract.id,
            "interrupted",
            {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
              failure: { ...failure },
              summary:
                "Contract interrupted after independent verification infrastructure failed",
              details: {
                failureCode: failure.code,
                stage: failure.stage,
              },
            },
          );
        }
      }
      for (const affectedPlane of database.shepherd.planes) {
        if (
          affectedPlane.missionId !== missionId ||
          affectedPlane.kind !== "contract" ||
          !affectedPlane.contractId ||
          !missionContractIds.has(affectedPlane.contractId)
        ) {
          continue;
        }
        if (
          affectedPlane.state === "creating" ||
          affectedPlane.state === "ready" ||
          affectedPlane.state === "running" ||
          affectedPlane.state === "inspecting"
        ) {
          executorIds.push(affectedPlane.executionIdentity);
          affectedPlane.state =
            affectedPlane.id === planeId ? "failed" : "interrupted";
          affectedPlane.error = { ...failure };
          affectedPlane.updatedAt = failedAt;
        }
      }
      for (const agent of database.agents) {
        if (
          agent.currentContractId &&
          missionContractIds.has(agent.currentContractId)
        ) {
          agent.status = "error";
          agent.currentContractId = null;
          agent.lastError = failure.message;
          agent.updatedAt = failedAt;
        }
      }
      if (
        mission.state !== "failed" &&
        canTransitionMission(mission.state, "failed", "control_plane")
      ) {
        transitionMissionAndRecord(database, missionId, "failed", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: failedAt,
          failure: { ...failure },
          summary: failure.message,
          details: {
            failureCode: failure.code,
            stage: failure.stage,
          },
        });
      }
      const project = database.shepherd.projects.find(
        (item) => item.id === mission.projectId,
      );
      if (project?.activeMissionId === missionId) {
        project.activeMissionId = null;
        project.updatedAt = failedAt;
      }
    });
    if (cancelled) throw new MissionCancelledError();
    const verifierCancel = this.verifier.cancel;
    const cancellationTasks: Promise<boolean>[] = [
      ...new Set(executorIds),
    ].map((id) =>
      Promise.resolve().then(async () => await this.executor.cancel(id)),
    );
    if (verifierCancel) {
      cancellationTasks.push(
        ...[...new Set(verifierIds)].map((id) =>
          Promise.resolve().then(
            async () => await verifierCancel.call(this.verifier, id),
          ),
        ),
      );
    }
    void Promise.allSettled(cancellationTasks);
    throw new ContractVerificationInfrastructureError();
  }

  private async integrateContracts(
    prepared: PreparedProjectMission,
    options: { expectedPlaneCount?: number; authority?: ScopedAuthority } = {},
  ): Promise<Plane> {
    this.ensureMissionRunnable(prepared.missionId);
    let integration = await prepared.planeManager.createIntegrationPlane({
      id: this.identifier("plane-integration"),
      projectId: prepared.project.projectId,
      missionId: prepared.missionId,
      baseCommit: prepared.project.headCommit,
      purpose: "Integrate independently verified Contract commits",
      executionIdentity: this.identifier("integration"),
      authority: options.authority ?? authorityFor("resolution"),
    });
    try {
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        database.shepherd.planes.push(integration);
      });
    } catch (error) {
      await prepared.planeManager.destroyPlane(integration).catch(() => undefined);
      throw error;
    }
    await this.checkpoint("integration_merge_start", {
      missionId: prepared.missionId,
      planeId: integration.id,
    });
    const contractPlanes = this.store
      .snapshot()
      .shepherd.planes.filter(
        (plane) => plane.missionId === prepared.missionId && plane.kind === "contract",
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const expectedPlaneCount = options.expectedPlaneCount ?? 2;
    if (contractPlanes.length !== expectedPlaneCount) {
      throw new Error(
        `Integration requires exactly ${expectedPlaneCount} verified Contract Plane${expectedPlaneCount === 1 ? "" : "s"}`,
      );
    }
    for (const contractPlane of contractPlanes) {
      this.ensureMissionRunnable(prepared.missionId);
      let merged;
      try {
        merged = await prepared.planeManager.mergePlane(integration, contractPlane);
      } catch (error) {
        if (!(error instanceof GitConflictCleanupError)) throw error;
        const failedAt = this.timestamp();
        const failure = this.makeFailure(error, "integration_cleanup", failedAt);
        await this.store.mutate((database) => {
          const persistedIntegration = database.shepherd.planes.find(
            (plane) => plane.id === integration.id,
          );
          const mission = database.shepherd.missions.find(
            (item) => item.id === prepared.missionId,
          );
          if (!persistedIntegration || !mission) {
            throw new Error("Integration state disappeared before cleanup failure persistence");
          }
          persistedIntegration.state = "failed";
          persistedIntegration.error = failure;
          persistedIntegration.updatedAt = failedAt;
          if (mission.state !== "attention_required") {
            transitionMissionAndRecord(database, mission.id, "attention_required", {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
              attentionReason: failure.message,
              failure,
              summary: failure.message,
              details: { failureCode: failure.code, stage: failure.stage },
            });
          }
        });
        throw error;
      }
      this.ensureMissionRunnable(prepared.missionId);
      if (!merged.merged || merged.conflictFiles.length > 0) {
        const error = new GitMergeConflictError(merged.conflictFiles);
        const failedAt = this.timestamp();
        const failure = this.makeFailure(error, "integration_merge", failedAt);
        await this.store.mutate((database) => {
          const persistedIntegration = database.shepherd.planes.find(
            (plane) => plane.id === integration.id,
          );
          if (!persistedIntegration) {
            throw new Error("Integration Plane disappeared before conflict persistence");
          }
          persistedIntegration.state = "failed";
          persistedIntegration.error = failure;
          persistedIntegration.updatedAt = failedAt;
          this.recordEvent(database, {
            type: "mission_state_changed",
            summary: failure.message,
            missionId: prepared.missionId,
            contractId: contractPlane.contractId,
            planeId: integration.id,
            actor: SHEPHERD_ACTOR,
            timestamp: failedAt,
            details: {
              failureCode: failure.code,
              stage: failure.stage,
              conflictFileCount: merged.conflictFiles.length,
              conflictFiles: boundedConflictPreview(merged.conflictFiles),
            },
          });
        });
        throw error;
      }
      integration = merged.plane;
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, prepared.missionId);
        replaceById(database.shepherd.planes, integration);
      });
    }
    return integration;
  }

  private async detectAndPersistCollision(
    missionId: string,
    integrationPlane: Plane,
  ): Promise<SemanticCollision> {
    this.ensureMissionRunnable(missionId);
    const snapshot = this.store.snapshot();
    const contracts = snapshot.shepherd.contracts
      .filter((contract) => contract.missionId === missionId)
      .map((contract) => ({
        ...contract,
        claims: snapshot.shepherd.claims.filter(
          (claim) => claim.contractId === contract.id,
        ),
      }));
    const detected = detectDeterministicCollisions(contracts, {
      dependencyEdges:
        snapshot.shepherd.missions.find((mission) => mission.id === missionId)
          ?.dependencyEdges ?? [],
      createdAt: this.timestamp(),
      collisionId: () => this.identifier("collision"),
    });
    if (detected.length !== 1) {
      throw new Error(
        `Expected one deterministic semantic collision, found ${detected.length}`,
      );
    }
    const collision = detected[0];
    if (!collision) throw new Error("Collision detector returned no record");
    const collisionAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, missionId);
      database.shepherd.collisions.push(collision);
      const mission = database.shepherd.missions.find(
        (item) => item.id === missionId,
      );
      if (!mission) throw new Error("Mission disappeared during collision detection");
      mission.collisionIds.push(collision.id);
      mission.resolutionIds.push(collision.id);
      const persistedIntegration = database.shepherd.planes.find(
        (item) => item.id === integrationPlane.id,
      );
      if (persistedIntegration) {
        persistedIntegration.state = "inspecting";
        persistedIntegration.updatedAt = collisionAt;
      }
      this.recordEvent(database, {
        type: "collision_detected",
        summary: collision.reason,
        missionId,
        planeId: integrationPlane.id,
        collisionId: collision.id,
        timestamp: collisionAt,
        details: {
          key: collision.key,
          scope: collision.scope,
          gitConflict: false,
        },
      });
      transitionMissionAndRecord(database, missionId, "collision", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: collisionAt,
      });
      transitionMissionAndRecord(database, missionId, "resolving", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: collisionAt,
      });
      collision.state = "resolving";
      collision.updatedAt = collisionAt;
      replaceById(database.shepherd.collisions, collision);
    });
    return collision;
  }

  /**
   * Advisory-only. Builds a bounded review input from evidence that is already
   * trusted: verified Contract objectives, ingested manifest summaries,
   * corroborated claims, and committed Plane diffs. Never throws; returns null
   * when there is nothing cross-Contract to compare.
   */
  private buildModelReviewInput(missionId: string): ModelReviewInput | null {
    const snapshot = this.store.snapshot();
    const bounded = (value: string, max: number): string =>
      this.safeText(value, max).slice(0, max).trim();
    const contracts: ModelReviewContractInput[] = [];
    for (const contract of snapshot.shepherd.contracts) {
      if (contract.missionId !== missionId) continue;
      if (contract.state !== "verified") continue;
      const plane = snapshot.shepherd.planes.find(
        (item) =>
          item.missionId === missionId &&
          item.kind === "contract" &&
          item.contractId === contract.id,
      );
      if (!plane) continue;
      const claims = snapshot.shepherd.claims
        .filter((claim) => claim.contractId === contract.id && claim.valid)
        .map((claim) => ({
          key: claim.key.trim().slice(0, 128),
          value: claim.value.trim().slice(0, 256),
          scope: claim.scope.trim().slice(0, 128),
          mode: "exclusive" as const,
        }))
        .filter(
          (claim) =>
            claim.key.length > 0 && claim.value.length > 0 && claim.scope.length > 0,
        )
        .sort((left, right) => left.key.localeCompare(right.key))
        .slice(0, 32);
      contracts.push({
        contractId: contract.id,
        objective:
          bounded(contract.objective, 4_000) ||
          bounded(contract.title, 4_000) ||
          contract.id,
        manifestSummary:
          bounded(contract.manifest?.summary ?? "", 2_000) ||
          "No trusted manifest summary was ingested for this Contract.",
        claims,
        changedFiles: plane.changedFiles
          .filter(
            (file) =>
              file.length > 0 && file.length <= 512 && !isAlwaysProtectedPath(file),
          )
          .slice(0, 128),
        diffSummary: bounded(plane.diffSummary, 8_000),
      });
      if (contracts.length === 8) break;
    }
    return contracts.length >= 2 ? { contracts } : null;
  }

  /**
   * Runs the bounded advisory reviewer and records its outcome as a durable
   * event. Returns void so no reviewer value can reach the deterministic
   * collision, winner, or promotion path, and never rejects so no reviewer
   * outcome can fail or stall a Mission.
   */
  private async runAdvisoryModelReview(
    missionId: string,
    integrationPlaneId: string,
  ): Promise<void> {
    const reviewer = this.reviewer;
    if (!reviewer) return;
    try {
      if (!this.settings().modelReviewEnabled) return;
      if (this.missionIsCancelled(missionId)) return;
      const input = this.buildModelReviewInput(missionId);
      if (!input) return;

      const controller = new AbortController();
      let settleCancellation: (() => void) | undefined;
      const cancellation = new Promise<ModelReviewResult>((resolve) => {
        settleCancellation = () => resolve({ status: "cancelled" });
      });
      const poll = setInterval(() => {
        if (this.missionIsCancelled(missionId)) {
          controller.abort();
          settleCancellation?.();
        }
      }, this.modelReviewPollMs);
      poll.unref?.();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let result: ModelReviewResult;
      try {
        const bound = new Promise<ModelReviewResult>((resolve) => {
          deadline = setTimeout(() => {
            // Stop the losing request rather than leaving it in flight. Promise.race
            // already subscribes to both inputs, so a late rejection stays handled.
            controller.abort();
            resolve({ status: "degraded", reason: "timeout", retryable: true });
          }, this.modelReviewDeadlineMs);
          deadline.unref?.();
        });
        const candidate: unknown = await Promise.race([
          reviewer.review(input, controller.signal),
          bound,
          cancellation,
        ]);
        result = isModelReviewResult(candidate, input)
          ? candidate
          : { status: "degraded", reason: "invalid_response", retryable: false };
      } catch {
        // A reviewer that throws is itself a degradation, never a fake "safe".
        result = { status: "degraded", reason: "provider_error", retryable: false };
      } finally {
        clearInterval(poll);
        if (deadline) clearTimeout(deadline);
      }
      if (result.status === "disabled" || result.status === "cancelled") return;

      const at = this.timestamp();
      const contractCount = input.contracts.length;
      await this.store.mutate((database) => {
        this.assertMissionRunnable(database, missionId);
        if (result.status === "degraded") {
          this.recordEvent(database, {
            type: "model_review_degraded",
            summary:
              "Advisory model review degraded; deterministic detection remains authoritative",
            missionId,
            planeId: integrationPlaneId,
            timestamp: at,
            details: {
              advisory: true,
              reason: result.reason,
              retryable: result.retryable,
              contractCount,
            },
          });
          return;
        }
        const findingCount = result.findings.length;
        const top = result.findings[0];
        this.recordEvent(database, {
          type: "model_review_completed",
          summary:
            findingCount > 0
              ? `Advisory model review reported ${findingCount} non-authoritative finding(s)`
              : "Advisory model review reported no cross-Contract findings",
          missionId,
          planeId: integrationPlaneId,
          timestamp: at,
          details: {
            advisory: true,
            findingCount,
            contractCount,
            ...(top
              ? {
                  topKind: top.kind,
                  topConfidence: top.confidence,
                  topLeftKey: top.leftKey,
                  topRightKey: top.rightKey,
                }
              : {}),
          },
        });
      });
    } catch {
      // Advisory review may never fail, delay, or alter a Mission. Cancellation
      // is re-derived from durable state by detectAndPersistCollision's own
      // ensureMissionRunnable on the very next statement.
    }
  }

  private async createCandidates(
    prepared: PreparedMission,
    collision: SemanticCollision,
    integrationCommit: string,
  ): Promise<CandidateWork[]> {
    const candidates: Array<{ value: AuthTransport; strategy: string }> = [
      { value: BEARER_TRANSPORT, strategy: "Unify on bearer JWT" },
      {
        value: COOKIE_TRANSPORT,
        strategy: "Unify on HttpOnly session cookie",
      },
    ];
    const works: CandidateWork[] = [];
    for (const input of candidates) {
      this.ensureMissionRunnable(prepared.missionId);
      const candidateId = this.identifier("candidate");
      const plane = await prepared.planeManager.createResolutionPlane({
        id: this.identifier("plane-resolution"),
        projectId: prepared.project.projectId,
        missionId: prepared.missionId,
        candidateId,
        baseCommit: integrationCommit,
        purpose: input.strategy,
        executionIdentity: this.identifier("resolution-exec"),
        authority: authorityFor("resolution"),
      });
      const createdAt = this.timestamp();
      const candidate: ResolutionCandidate = {
        id: candidateId,
        missionId: prepared.missionId,
        collisionId: collision.id,
        strategy: input.strategy,
        targetKey: collision.key,
        targetValue: input.value,
        planeId: plane.id,
        executionState: "queued",
        selectionState: "pending",
        promotionState: "not_started",
        verificationEvidence: null,
        previousAttempts: [],
        promotionEvidence: null,
        changedFiles: [],
        diffSummary: "",
        result: null,
        retryCount: 0,
        failure: null,
        createdAt,
        updatedAt: createdAt,
      };
      try {
        await this.store.mutate((database) => {
          this.assertMissionRunnable(database, prepared.missionId);
          database.shepherd.planes.push(plane);
          database.shepherd.candidates.push(candidate);
          const persistedCollision = database.shepherd.collisions.find(
            (item) => item.id === collision.id,
          );
          if (!persistedCollision) throw new Error("Collision disappeared");
          persistedCollision.candidateIds.push(candidate.id);
          persistedCollision.updatedAt = createdAt;
          this.recordEvent(database, {
            type: "candidate_created",
            summary: `Created resolution candidate: ${input.strategy}`,
            missionId: prepared.missionId,
            planeId: plane.id,
            collisionId: collision.id,
            candidateId,
            timestamp: createdAt,
            details: { targetValue: input.value, baseCommit: integrationCommit },
          });
        });
      } catch (error) {
        await prepared.planeManager.destroyPlane(plane).catch(() => undefined);
        throw error;
      }
      works.push({
        candidateId,
        plane,
        operation: {
          kind: "resolution_candidate",
          candidateId,
          targetTransport: input.value,
        },
      });
    }
    return works;
  }

  private async executeCandidate(
    prepared: PreparedMission,
    work: CandidateWork,
  ): Promise<void> {
    this.ensureMissionRunnable(prepared.missionId);
    const startedAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === work.candidateId,
      );
      const plane = database.shepherd.planes.find((item) => item.id === work.plane.id);
      if (!candidate || !plane) throw new Error("Candidate records disappeared");
      candidate.executionState = "running";
      candidate.updatedAt = startedAt;
      plane.state = "running";
      plane.updatedAt = startedAt;
    });
    const executionWorkspace =
      await prepared.planeManager.createExecutionWorkspace(work.plane);
    try {
      this.ensureMissionRunnable(prepared.missionId);
      const executionSnapshot = this.store.snapshot();
      const candidate = executionSnapshot.shepherd.candidates.find(
        (item) => item.id === work.candidateId,
      );
      const collision = executionSnapshot.shepherd.collisions.find(
        (item) => item.id === candidate?.collisionId,
      );
      if (!candidate || !collision) {
        throw new Error("Candidate prompt context disappeared before execution");
      }
      const sourceContracts = [collision.leftContractId, collision.rightContractId].map(
        (contractId) =>
          executionSnapshot.shepherd.contracts.find(
            (contract) => contract.id === contractId,
          ),
      );
      if (
        sourceContracts.some(
          (contract) => !contract?.manifest || contract.state !== "verified",
        )
      ) {
        throw new Error("Candidate prompt requires two verified source Contracts");
      }
      const verifiedSourceContracts = sourceContracts.filter(
        (contract): contract is ExecutionContract => contract !== undefined,
      );
      const dependencyOutputs: DependencyOutput[] = verifiedSourceContracts.map(
        (contract) => ({
          contractId: contract.id,
          summary: contract.manifest?.summary ?? "",
          artifacts: contract.manifest?.artifacts.map((artifact) => artifact.path) ?? [],
        }),
      );
      const expectedArtifacts = [
        ...new Map(
          verifiedSourceContracts
            .flatMap((contract) => contract.expectedArtifacts)
            .map((artifact) => [artifact.path, artifact] as const),
        ).values(),
      ];
      const prompt = buildResolutionCandidatePrompt({
        agent: {
          id: work.plane.executionIdentity,
          name: "Resolution Agent",
          role: "Generalist",
        },
        missionId: prepared.missionId,
        collisionId: collision.id,
        candidate,
        context: [
          {
            name: "collision.reason",
            value: collision.reason,
            sourceContractId: null,
          },
          {
            name: "left.exclusiveClaim",
            value: `${collision.leftClaim.key}=${collision.leftClaim.value}`,
            sourceContractId: collision.leftContractId,
          },
          {
            name: "right.exclusiveClaim",
            value: `${collision.rightClaim.key}=${collision.rightClaim.value}`,
            sourceContractId: collision.rightContractId,
          },
          {
            name: "auth.transportSemantics",
            value:
              '"bearer-jwt" requires clientReadableCredential=true; "http-only-session-cookie" requires clientReadableCredential=false.',
            sourceContractId: null,
          },
          {
            name: "project.allowClientReadableCredential",
            value: String(prepared.project.allowClientReadableCredential),
            sourceContractId: null,
          },
        ],
        dependencyOutputs,
        authority: work.plane.authority,
        expectedArtifacts,
        declaredClaimKeys: [collision.key],
        sensitiveValues: this.sensitiveValues,
      });
      const executionResult = await this.executor.run({
        executionId: work.plane.executionIdentity,
        workspacePath: executionWorkspace.path,
        operation: work.operation,
        prompt,
        timeoutMs: this.settings().candidateTimeoutMs,
      });
      this.ensureMissionRunnable(prepared.missionId);
      const runtimeSessionFingerprint = await this.persistRuntimeSessionFingerprint(
        work.plane.id,
        executionResult.runtimeSessionId,
      );
      work.plane.runtimeSessionFingerprint = runtimeSessionFingerprint;
      try {
        this.ensureMissionRunnable(prepared.missionId);
        await prepared.planeManager.importExecutionWorkspace(
          work.plane,
          executionWorkspace,
        );
        this.ensureMissionRunnable(prepared.missionId);
      } catch (error) {
        if (error instanceof PlaneAuthorityViolationError) {
          throw new AuthorityViolationError("candidate");
        }
        throw error;
      }
    } finally {
      await prepared.planeManager.destroyExecutionWorkspace(executionWorkspace);
    }
    const actualChanged = await prepared.planeManager.git.changedFilesSince(
      work.plane.baseCommit,
      work.plane.worktreePath,
    );
    this.ensureMissionRunnable(prepared.missionId);
    const authority = validateChangedPaths(actualChanged, work.plane.authority);
    if (!authority.allowed || authority.manifestPaths.length > 0) {
      throw new AuthorityViolationError("candidate");
    }
    this.ensureMissionRunnable(prepared.missionId);
    let plane = await prepared.planeManager.commitPlane(
      work.plane,
      `Finalize resolution candidate ${work.candidateId}`,
    );
    plane = { ...plane, state: "inspecting", updatedAt: this.timestamp() };
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      replaceById(database.shepherd.planes, plane);
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === work.candidateId,
      );
      if (!candidate) throw new Error("Candidate disappeared before verification");
      candidate.executionState = "verifying";
      candidate.changedFiles = [...plane.changedFiles];
      candidate.diffSummary = plane.diffSummary;
      candidate.updatedAt = this.timestamp();
    });
    if (!plane.headCommit) throw new Error("Candidate Plane has no immutable commit");
    const evidence = this.sanitizeEvidence(
      await prepared.planeManager.withVerificationSnapshot(
        plane.headCommit,
        async (snapshot) =>
          await this.verifier.verify({
            targetType: "candidate",
            targetId: work.candidateId,
            planePath: snapshot.path,
            checks: [frontendCheck(), backendCheck(), projectCheck()],
            changedFiles: plane.changedFiles,
          }),
      ),
    );
    this.ensureMissionRunnable(prepared.missionId);
    const completedAt = this.timestamp();
    const verifiedTarget = verifiedAuthTransportFact(evidence);
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === work.candidateId,
      );
      const persistedPlane = database.shepherd.planes.find(
        (item) => item.id === plane.id,
      );
      if (!candidate || !persistedPlane) throw new Error("Candidate records disappeared");
      const targetCorroborated =
        candidate.targetKey === AUTH_CLAIM_KEY &&
        candidate.targetValue === work.operation.targetTransport &&
        verifiedTarget === work.operation.targetTransport;
      const candidatePassed = evidence.passed && targetCorroborated;
      const failure: FailureInfo | null = candidatePassed
        ? null
        : evidence.passed
          ? {
              code: "invalid_semantic_evidence",
              message:
                "Independent verification did not corroborate the candidate target",
              stage: "candidate_target_corroboration",
              at: completedAt,
              retryable: false,
            }
          : (() => {
              const transient = evidence.checks.some(
                (check) =>
                  check.mandatory &&
                  (check.status === "infrastructure_error" ||
                    check.status === "timed_out"),
              );
              return {
                code: evidence.checks.some(
                  (check) => check.mandatory && check.status === "timed_out",
                )
                  ? ("candidate_timeout" as const)
                  : transient
                    ? ("verification_infrastructure_error" as const)
                    : ("failed_independent_acceptance" as const),
                message: evidence.summary,
                stage: "candidate_verification",
                at: completedAt,
                retryable: transient,
              };
            })();
      candidate.executionState = candidatePassed ? "passed" : "failed";
      candidate.verificationEvidence = evidence;
      candidate.failure = failure;
      candidate.updatedAt = completedAt;
      persistedPlane.state = candidatePassed ? "verified" : "failed";
      persistedPlane.verificationEvidenceIds.push(evidence.id);
      persistedPlane.updatedAt = completedAt;
      this.recordEvent(database, {
        type: candidatePassed ? "candidate_passed" : "candidate_failed",
        summary: failure?.message ?? evidence.summary,
        missionId: prepared.missionId,
        planeId: plane.id,
        collisionId: candidate.collisionId,
        candidateId: candidate.id,
        actor: VERIFIER_ACTOR,
        timestamp: completedAt,
        details: {
          passed: candidatePassed,
          independentChecksPassed: evidence.passed,
          targetCorroborated,
          runtimeSessionEstablished: Boolean(
            persistedPlane.runtimeSessionFingerprint,
          ),
        },
      });
    });
  }

  private async persistCandidateInfrastructureFailure(
    work: CandidateWork,
    error: unknown,
  ): Promise<void> {
    if (this.missionIsCancelled(work.plane.missionId)) return;
    const failedAt = this.timestamp();
    await this.store.mutate((database) => {
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === work.candidateId,
      );
      const plane = database.shepherd.planes.find((item) => item.id === work.plane.id);
      if (!candidate || !plane || candidate.executionState === "failed") return;
      candidate.executionState = "failed";
      const rawMessage = error instanceof Error ? error.message : "";
      const runtimeFailure =
        error instanceof RuntimeExecutionError
          ? new RuntimeExecutionError(error.kind, error.timeoutMs)
          : null;
      candidate.failure = error instanceof AuthorityViolationError
        ? {
              code: "unauthorized_file_change",
              message: "Actual Git changes exceeded the candidate's scoped authority",
              stage: "candidate_authority",
              at: failedAt,
              retryable: false,
            }
        : {
            code: runtimeFailure?.kind === "timeout" || /timed out after/iu.test(rawMessage)
              ? "candidate_timeout"
              : error instanceof Error && error.name === "PlaneCreationError"
                ? "worktree_creation_failure"
                : "agent_runtime_error",
            message: runtimeFailure?.message ??
              this.safeText(rawMessage || "Candidate execution failed"),
            stage: "candidate_execution",
            at: failedAt,
            retryable: true,
          };
      candidate.executionState =
        candidate.failure.code === "candidate_timeout" ? "timed_out" : "failed";
      candidate.updatedAt = failedAt;
      plane.state = "failed";
      plane.error = candidate.failure;
      plane.updatedAt = failedAt;
      this.recordEvent(database, {
        type: "candidate_failed",
        summary: candidate.failure.message,
        missionId: candidate.missionId,
        planeId: plane.id,
        collisionId: candidate.collisionId,
        candidateId: candidate.id,
        timestamp: failedAt,
      });
    });
  }

  private async retryTransientCandidate(
    prepared: PreparedMission,
    candidateId: string,
  ): Promise<void> {
    this.ensureMissionRunnable(prepared.missionId);
    const snapshot = this.store.snapshot();
    const candidate = snapshot.shepherd.candidates.find(
      (item) => item.id === candidateId,
    );
    const previousPlane = snapshot.shepherd.planes.find(
      (item) => item.id === candidate?.planeId,
    );
    if (
      !candidate ||
      !previousPlane ||
      candidate.retryCount !== 0 ||
      (candidate.executionState !== "failed" &&
        candidate.executionState !== "timed_out") ||
      !candidate.failure?.retryable
    ) {
      return;
    }
    const retryPlane = await prepared.planeManager.createResolutionPlane({
      id: this.identifier("plane-resolution"),
      projectId: prepared.project.projectId,
      missionId: prepared.missionId,
      candidateId: candidate.id,
      baseCommit: previousPlane.baseCommit,
      purpose: candidate.strategy + " (single transient retry)",
      executionIdentity: this.identifier("resolution-exec"),
      authority: authorityFor("resolution"),
    });
    const retryAt = this.timestamp();
    try {
      await this.store.mutate((database) => {
        const mission = database.shepherd.missions.find(
          (item) => item.id === prepared.missionId,
        );
        const persisted = database.shepherd.candidates.find(
          (item) => item.id === candidate.id,
        );
        const persistedPreviousPlane = database.shepherd.planes.find(
          (item) => item.id === previousPlane.id,
        );
        if (mission?.state === "cancelled") throw new MissionCancelledError();
        if (
          !persisted ||
          !persistedPreviousPlane ||
          persisted.planeId !== previousPlane.id ||
          persisted.retryCount !== 0 ||
          (persisted.executionState !== "failed" &&
            persisted.executionState !== "timed_out") ||
          !persisted.failure?.retryable
        ) {
          throw new ShepherdControlError(
            "conflict",
            "Candidate retry eligibility changed",
          );
        }
        const previousAttempts = persisted.previousAttempts ?? [];
        if (previousAttempts.length !== 0) {
          throw new ShepherdControlError(
            "conflict",
            "Candidate already has a previous attempt",
          );
        }
        previousAttempts.push({
          planeId: previousPlane.id,
          executionState: persisted.executionState,
          verificationEvidence: persisted.verificationEvidence,
          changedFiles: [...persisted.changedFiles],
          diffSummary: persisted.diffSummary,
          failure: persisted.failure,
          startedAt: persistedPreviousPlane.createdAt,
          completedAt: persisted.failure.at,
        });
        persisted.previousAttempts = previousAttempts;
        persisted.planeId = retryPlane.id;
        persisted.executionState = "queued";
        persisted.selectionState = "pending";
        persisted.promotionState = "not_started";
        persisted.verificationEvidence = null;
        persisted.promotionEvidence = null;
        persisted.changedFiles = [];
        persisted.diffSummary = "";
        persisted.result = null;
        persisted.retryCount = 1;
        persisted.failure = null;
        persisted.updatedAt = retryAt;
        database.shepherd.planes.push(retryPlane);
        this.recordEvent(database, {
          type: "candidate_retried",
          summary: "Started the candidate's single transient retry",
          missionId: persisted.missionId,
          planeId: retryPlane.id,
          collisionId: persisted.collisionId,
          candidateId: persisted.id,
          timestamp: retryAt,
          details: {
            previousPlaneId: previousPlane.id,
            retryPlaneId: retryPlane.id,
            baseCommit: retryPlane.baseCommit,
            retryCount: 1,
          },
        });
      });
    } catch (error) {
      await prepared.planeManager.destroyPlane(retryPlane).catch(() => undefined);
      throw error;
    }
    const work: CandidateWork = {
      candidateId: candidate.id,
      plane: retryPlane,
      operation: {
        kind: "resolution_candidate",
        candidateId: candidate.id,
        targetTransport: candidate.targetValue as AuthTransport,
      },
    };
    try {
      await this.executeCandidate(prepared, work);
    } catch (error) {
      await this.persistCandidateInfrastructureFailure(work, error);
    }
  }

  private async persistAttentionRequired(
    missionId: string,
    collisionId: string,
    reason: string,
  ): Promise<void> {
    const timestamp = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, missionId);
      const collision = database.shepherd.collisions.find(
        (item) => item.id === collisionId,
      );
      if (collision) {
        collision.state = "attention_required";
        collision.updatedAt = timestamp;
      }
      const code: FailureInfo["code"] =
        reason === "objective_tie"
          ? "objective_tie"
          : reason === "auto_resolution_disabled"
            ? "manual_confirmation_required"
            : reason === "all_candidates_failed"
              ? "all_candidates_failed"
              : "single_candidate_failure";
      const failure: FailureInfo = {
        code,
        message:
          reason === "auto_resolution_disabled"
            ? "Automatic resolution is disabled; a human must confirm a passing candidate"
            : `Resolution requires attention: ${reason}`,
        stage: "resolution_selection",
        at: timestamp,
        retryable: false,
      };
      const attentionEvent = transitionMissionAndRecord(database, missionId, "attention_required", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp,
        attentionReason: reason,
        failure,
      });
      this.appendServerGroupMessage(database, {
        sourceId: attentionEvent.id,
        missionId,
        content:
          reason === "objective_tie"
            ? "Attention required: verified resolution candidates are objectively tied."
            : reason === "auto_resolution_disabled"
              ? "Manual confirmation required: automatic resolution is disabled."
              : `Attention required: ${code}.`,
        timestamp,
      });
    });
  }

  private async persistPromotionOutcome(
    prepared: PreparedMission,
    collision: SemanticCollision,
    selectedCandidate: ResolutionCandidate,
    selectedPlane: Plane,
    promotion: PromotionResult,
  ): Promise<void> {
    if (promotion.promoted) {
      await this.checkpoint("promotion_cas_completed", {
        missionId: prepared.missionId,
        candidateId: selectedCandidate.id,
      });
    }
    if (!promotion.promoted) {
      if (this.missionIsCancelled(prepared.missionId)) {
        throw new MissionCancelledError();
      }
      const failedAt = this.timestamp();
      const failureCode: FailureInfo["code"] =
        promotion.reason === "protected_branch_moved"
          ? "protected_branch_moved"
          : promotion.reason === "final_reverification_failure"
            ? "final_reverification_failure"
            : promotion.reason === "verification_infrastructure_error"
              ? "verification_infrastructure_error"
              : promotion.reason === "unauthorized_file_change"
                ? "unauthorized_file_change"
                : promotion.reason === "non_fast_forward"
                  ? "git_conflict"
                  : "persistence_error";
      await this.store.mutate((database) => {
        const persistedCandidate = database.shepherd.candidates.find(
          (item) => item.id === selectedCandidate.id,
        );
        const persistedCollision = database.shepherd.collisions.find(
          (item) => item.id === collision.id,
        );
        const persistedMission = database.shepherd.missions.find(
          (item) => item.id === prepared.missionId,
        );
        if (!persistedCandidate || !persistedCollision || !persistedMission) {
          throw new Error("Promotion records disappeared before failure persistence");
        }
        const failure: FailureInfo = {
          code: failureCode,
          message: `Promotion failed: ${promotion.reason}`,
          stage: "promotion",
          at: failedAt,
          retryable: false,
        };
        persistedCandidate.promotionState = "failed";
        persistedCandidate.failure = failure;
        persistedCandidate.updatedAt = failedAt;
        persistedCollision.state = "attention_required";
        persistedCollision.updatedAt = failedAt;
        if (persistedMission.state !== "attention_required") {
          const attentionEvent = transitionMissionAndRecord(
            database,
            persistedMission.id,
            "attention_required",
            {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
              attentionReason: promotion.reason,
              failure,
              summary: "Promotion failed after final gate evaluation",
              details: { reason: promotion.reason },
            },
          );
          this.appendServerGroupMessage(database, {
            sourceId: attentionEvent.id,
            missionId: persistedMission.id,
            content: `Attention required: promotion failed (${promotion.reason}).`,
            timestamp: failedAt,
          });
        }
      });
      throw new Error(`Promotion failed: ${promotion.reason}`);
    }

    const completedAt = this.timestamp();
    await this.store.mutate((database) => {
      const persistedCandidate = database.shepherd.candidates.find(
        (item) => item.id === selectedCandidate.id,
      );
      const persistedPlane = database.shepherd.planes.find(
        (item) => item.id === selectedPlane.id,
      );
      const persistedCollision = database.shepherd.collisions.find(
        (item) => item.id === collision.id,
      );
      const persistedProject = database.shepherd.projects.find(
        (item) => item.id === prepared.project.projectId,
      );
      if (
        !persistedCandidate ||
        !persistedPlane ||
        !persistedCollision ||
        !persistedProject
      ) {
        throw new Error("Promotion records disappeared before final persistence");
      }
      persistedCandidate.promotionState = "promoted";
      persistedCandidate.promotionEvidence = structuredClone(
        promotion.verificationEvidence,
      );
      persistedCandidate.result = `Promoted ${persistedCandidate.targetValue}`;
      persistedCandidate.failure = null;
      persistedCandidate.updatedAt = completedAt;
      if (
        !persistedPlane.verificationEvidenceIds.includes(
          promotion.verificationEvidence.id,
        )
      ) {
        persistedPlane.verificationEvidenceIds.push(
          promotion.verificationEvidence.id,
        );
      }
      persistedPlane.state = "verified";
      persistedPlane.updatedAt = completedAt;
      persistedCollision.state = "resolved";
      persistedCollision.resolvedAt = completedAt;
      persistedCollision.updatedAt = completedAt;
      persistedProject.protectedHeadCommit = promotion.promotedHead;
      persistedProject.activeMissionId = null;
      persistedProject.updatedAt = completedAt;
      this.recordEvent(database, {
        type: "promotion_completed",
        summary: "Promoted the selected resolution to the protected branch",
        missionId: prepared.missionId,
        planeId: selectedPlane.id,
        collisionId: collision.id,
        candidateId: selectedCandidate.id,
        timestamp: completedAt,
        details: {
          previousHead: promotion.previousHead,
          promotedHead: promotion.promotedHead,
        },
      });
      const completionEvent = transitionMissionAndRecord(
        database,
        prepared.missionId,
        "completed",
        {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: completedAt,
        },
      );
      this.appendServerGroupMessage(database, {
        sourceId: completionEvent.id,
        missionId: prepared.missionId,
        content: "Mission completed after final independent re-verification and promotion.",
        timestamp: completedAt,
      });
    });
  }

  private async promoteCandidate(
    prepared: PreparedMission,
    candidate: ResolutionCandidate,
    plane: Plane,
  ) {
    this.ensureMissionRunnable(prepared.missionId);
    const startedAt = this.timestamp();
    await this.store.mutate((database) => {
      this.assertMissionRunnable(database, prepared.missionId);
      const persisted = database.shepherd.candidates.find(
        (item) => item.id === candidate.id,
      );
      if (!persisted) throw new Error("Selected candidate disappeared");
      persisted.promotionState = "reverifying";
      persisted.updatedAt = startedAt;
      this.recordEvent(database, {
        type: "promotion_started",
        summary: "Started final authority and independent verification gate",
        missionId: prepared.missionId,
        planeId: plane.id,
        collisionId: candidate.collisionId,
        candidateId: candidate.id,
        timestamp: startedAt,
      });
    });
    const gate = new PromotionGate(
      prepared.planeManager.git,
      {
        verify: async (request) => {
          this.ensureMissionRunnable(prepared.missionId);
          const evidence = this.sanitizeEvidence(
            await this.verifier.verify(request),
          );
          this.ensureMissionRunnable(prepared.missionId);
          return evidence;
        },
      },
      async (input) => {
        this.ensureMissionRunnable(prepared.missionId);
        const decision = validateChangedPaths(
          input.changedFiles,
          input.plane.authority,
        );
        return {
          allowed: decision.allowed && decision.manifestPaths.length === 0,
          reason: decision.allowed
            ? null
            : "Final candidate diff exceeds scoped authority",
        };
      },
      prepared.planeManager,
    );
    return await gate.promote({
      candidate,
      plane,
      protectedBranch: prepared.project.protectedBranch,
      expectedHead: prepared.project.headCommit,
      checks: [frontendCheck(), backendCheck(), projectCheck()],
      loadPersistedSelectedCandidateId: async () => {
        this.ensureMissionRunnable(prepared.missionId);
        const selected = this.store
          .snapshot()
          .shepherd.candidates.filter(
            (item) =>
              item.collisionId === candidate.collisionId &&
              item.selectionState === "selected",
          );
        return selected.length === 1 ? (selected[0]?.id ?? null) : null;
      },
      persistPromotingEvidence: async ({ evidence, changedFiles, candidateHead }) => {
        const promotingAt = this.timestamp();
        await this.store.mutate((database) => {
          this.assertMissionRunnable(database, prepared.missionId);
          const persistedCandidate = database.shepherd.candidates.find(
            (item) => item.id === candidate.id,
          );
          const persistedPlane = database.shepherd.planes.find(
            (item) => item.id === plane.id,
          );
          if (
            !persistedCandidate ||
            !persistedPlane ||
            persistedCandidate.promotionState !== "reverifying" ||
            persistedCandidate.selectionState !== "selected" ||
            persistedCandidate.planeId !== persistedPlane.id ||
            persistedPlane.candidateId !== persistedCandidate.id ||
            persistedPlane.headCommit !== candidateHead ||
            evidence.targetType !== "promotion" ||
            evidence.targetId !== persistedCandidate.id ||
            !evidence.passed ||
            evidence.id === persistedCandidate.verificationEvidence?.id ||
            changedFiles.length !== persistedCandidate.changedFiles.length ||
            !changedFiles.every((file) => persistedCandidate.changedFiles.includes(file))
          ) {
            throw new Error("Promotion evidence no longer matches durable candidate state");
          }
          persistedCandidate.promotionState = "promoting";
          persistedCandidate.promotionEvidence = structuredClone(evidence);
          persistedCandidate.updatedAt = promotingAt;
          if (!persistedPlane.verificationEvidenceIds.includes(evidence.id)) {
            persistedPlane.verificationEvidenceIds.push(evidence.id);
          }
          persistedPlane.updatedAt = promotingAt;
        });
        await this.checkpoint("promotion_ready_for_cas", {
          missionId: prepared.missionId,
          candidateId: candidate.id,
        });
      },
    });
  }

  private async recordMissionFailure(
    missionId: string,
    error: unknown,
    stage: string,
  ): Promise<void> {
    if (this.store.persistenceRecoveryIntent()?.missionId === missionId) {
      return;
    }
    const failedAt = this.timestamp();
    await this.store.mutate((database) => {
      const mission = database.shepherd.missions.find(
        (item) => item.id === missionId,
      );
      if (
        !mission ||
        terminalMission(mission.state) ||
        mission.state === "attention_required"
      ) {
        return;
      }
      const failure = this.makeFailure(error, stage, failedAt);
      if (canTransitionMission(mission.state, "failed", "control_plane")) {
        transitionMissionAndRecord(database, missionId, "failed", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: failedAt,
          failure,
          ...(failure.code === "agent_timeout"
            ? { summary: "Mission failed because an Agent Runtime timed out" }
            : failure.code === "agent_runtime_error"
              ? { summary: "Mission failed because an Agent Runtime execution failed" }
              : {}),
          details: { failureCode: failure.code },
        });
      }
      const project = database.shepherd.projects.find(
        (item) => item.id === mission.projectId,
      );
      if (project?.activeMissionId === missionId) {
        project.activeMissionId = null;
        project.updatedAt = failedAt;
      }
      for (const plane of database.shepherd.planes) {
        if (
          plane.missionId === missionId &&
          (plane.generalPromotionState === "reverifying" ||
            plane.generalPromotionState === "promoting")
        ) {
          plane.generalPromotionState = "failed";
          if (plane.state !== "verified" && plane.state !== "destroyed") {
            plane.state = "failed";
            plane.error = failure;
          }
          plane.updatedAt = failedAt;
        }
      }
      const contractIds = new Set(mission.contractIds);
      for (const agent of database.agents) {
        if (!agent.currentContractId || !contractIds.has(agent.currentContractId)) {
          continue;
        }
        agent.status = "error";
        agent.currentContractId = null;
        agent.lastError = failure.message;
        agent.updatedAt = failedAt;
      }
    });
  }
}
