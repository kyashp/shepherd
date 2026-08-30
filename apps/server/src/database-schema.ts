import { z } from "zod";
import path from "node:path";
import type { DatabaseV1, DatabaseV2 } from "./types.js";
import { normalizeRepoPath, normalizeRepoPattern } from "./shepherd/authority.js";
import {
  AUTH_BACKEND_CHECK_ID,
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_CHECK_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_CHECK_ID,
  AUTH_PROJECT_PROFILE_ID,
} from "./shepherd/auth-fixture.js";
import {
  assertFullObjectId,
  assertSafeGitBranch,
} from "./shepherd/git-client.js";

const MAX_COLLECTION_ITEMS = 10_000;
const MAX_ID_LENGTH = 200;
const MAX_PATH_LENGTH = 4_096;
const MAX_TEXT_LENGTH = 1_048_576;

const safeString = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !value.includes("\0"));

const nonEmptyString = (maximum: number) => safeString(maximum).min(1);
const idSchema = nonEmptyString(MAX_ID_LENGTH).regex(
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u,
);
const pathStringSchema = nonEmptyString(MAX_PATH_LENGTH).refine(
  (value) => !/[\u0000-\u001f\u007f]/u.test(value),
);
const hostPathSchema = pathStringSchema.refine(
  (value) => path.isAbsolute(value) && path.resolve(value) === value,
);
const projectPathSchema = pathStringSchema.refine((value) => {
  try {
    return normalizeRepoPath(value) === value;
  } catch {
    return false;
  }
});
const projectPatternSchema = pathStringSchema.refine((value) => {
  try {
    return normalizeRepoPattern(value) === value;
  } catch {
    return false;
  }
});
const gitBranchSchema = nonEmptyString(128).refine((value) => {
  try {
    return assertSafeGitBranch(value) === value;
  } catch {
    return false;
  }
});
const gitObjectIdSchema = nonEmptyString(64).refine((value) => {
  try {
    return assertFullObjectId(value) === value;
  } catch {
    return false;
  }
});
const textSchema = safeString(MAX_TEXT_LENGTH);
const shortTextSchema = safeString(20_000);
const nonEmptyShortTextSchema = nonEmptyString(20_000);
const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveSafeIntegerSchema = safeIntegerSchema.min(1);
const timestampSchema = z
  .string()
  .max(40)
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString() === value,
  );

const nullableTimestampSchema = timestampSchema.nullable();
const nullableIdSchema = idSchema.nullable();

const boundedArray = <T extends z.ZodType>(schema: T, maximum = 256) =>
  z.array(schema).max(maximum);

const authoritySchema = z
  .object({
    readable: boundedArray(projectPatternSchema),
    writable: boundedArray(projectPatternSchema),
    forbidden: boundedArray(projectPatternSchema),
  })
  .strict();

const evidenceReferenceSchema = z
  .object({
    path: projectPathSchema,
    description: nonEmptyString(2_000),
    line: z.number().int().positive().max(10_000_000).optional(),
  })
  .strict();

const failureCodeSchema = z.enum([
  "agent_timeout",
  "agent_runtime_error",
  "missing_result_manifest",
  "malformed_manifest",
  "invalid_semantic_evidence",
  "omitted_declared_claim_key",
  "unauthorized_file_change",
  "failed_independent_acceptance",
  "worktree_creation_failure",
  "git_conflict",
  "semantic_collision",
  "candidate_timeout",
  "single_candidate_failure",
  "all_candidates_failed",
  "objective_tie",
  "manual_confirmation_required",
  "final_reverification_failure",
  "protected_branch_moved",
  "verification_infrastructure_error",
  "execution_interrupted",
  "persistence_error",
  "polling_interrupted",
  "model_review_degraded",
  "cancelled",
  "unknown",
]);

const failureSchema = z
  .object({
    code: failureCodeSchema,
    message: shortTextSchema,
    stage: nonEmptyString(200),
    at: timestampSchema,
    retryable: z.boolean(),
  })
  .strict();

const manifestArtifactSchema = z
  .object({
    path: projectPathSchema,
    kind: z.enum(["changed", "produced"]),
    description: nonEmptyString(2_000),
  })
  .strict();

const manifestClaimSchema = z
  .object({
    key: nonEmptyString(200),
    value: nonEmptyString(2_000),
    scope: nonEmptyString(1_000),
    mode: z.literal("exclusive"),
    evidence: boundedArray(evidenceReferenceSchema, 32).min(1),
  })
  .strict();

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    contractId: idSchema,
    summary: nonEmptyString(4_000),
    artifacts: boundedArray(manifestArtifactSchema, 128),
    semanticClaims: boundedArray(manifestClaimSchema, 32),
    agentDeclaredTests: boundedArray(
      z
        .object({
          name: nonEmptyString(500),
          passed: z.boolean(),
          summary: safeString(2_000),
        })
        .strict(),
      64,
    ),
    notes: safeString(4_000),
  })
  .strict();

const verificationCheckSchema = z
  .object({
    id: idSchema,
    name: nonEmptyString(500),
    profileId: idSchema,
    mandatory: z.boolean(),
    timeoutMs: positiveSafeIntegerSchema.optional(),
    status: z.enum(["passed", "failed", "timed_out", "infrastructure_error"]),
    passed: z.boolean(),
    exitCode: z.number().int().min(-1).max(255).nullable(),
    durationMs: safeIntegerSchema,
    stdout: textSchema,
    stderr: textSchema,
    error: shortTextSchema.nullable(),
  })
  .strict()
  .refine((check) => check.passed === (check.status === "passed"));

const verificationEvidenceSchema = z
  .object({
    id: idSchema,
    targetType: z.enum(["contract", "candidate", "promotion"]),
    targetId: idSchema,
    runner: z.literal("independent"),
    passed: z.boolean(),
    checks: boundedArray(verificationCheckSchema, 32),
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    durationMs: safeIntegerSchema,
    changedFiles: boundedArray(projectPathSchema, MAX_COLLECTION_ITEMS),
    summary: shortTextSchema,
  })
  .strict()
  .refine((evidence) => {
    const mandatory = evidence.checks.filter((check) => check.mandatory);
    return (
      unique(evidence.checks.map((check) => check.id)) &&
      evidence.passed ===
        (mandatory.length > 0 && mandatory.every((check) => check.passed))
    );
  });

const semanticClaimSchema = z
  .object({
    id: idSchema,
    missionId: idSchema,
    contractId: idSchema,
    key: nonEmptyString(200),
    value: nonEmptyString(2_000),
    scope: nonEmptyString(1_000),
    mode: z.literal("exclusive"),
    evidence: boundedArray(evidenceReferenceSchema, 32).min(1),
    valid: z.boolean(),
    rejectionReason: shortTextSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();

const projectSchema = z
  .object({
    id: idSchema,
    displayName: nonEmptyString(500),
    repositoryPath: hostPathSchema,
    protectedBranch: gitBranchSchema,
    protectedHeadCommit: gitObjectIdSchema,
    activeMissionId: nullableIdSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const missionSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    originalIntent: nonEmptyShortTextSchema,
    baseCommit: gitObjectIdSchema,
    contractIds: boundedArray(idSchema, MAX_COLLECTION_ITEMS),
    dependencyEdges: boundedArray(
      z
        .object({
          fromContractId: idSchema,
          toContractId: idSchema,
          required: z.boolean(),
        })
        .strict(),
      MAX_COLLECTION_ITEMS,
    ),
    collisionIds: boundedArray(idSchema, MAX_COLLECTION_ITEMS),
    resolutionIds: boundedArray(idSchema, MAX_COLLECTION_ITEMS),
    state: z.enum([
      "planning",
      "queued",
      "running",
      "verifying",
      "collision",
      "resolving",
      "completed",
      "failed",
      "cancelled",
      "attention_required",
    ]),
    attentionReason: shortTextSchema.nullable(),
    failure: failureSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    startedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
  })
  .strict();

const acceptanceCheckSchema = z
  .object({
    id: idSchema,
    name: nonEmptyString(500),
    profileId: idSchema,
    mandatory: z.boolean(),
    timeoutMs: positiveSafeIntegerSchema,
  })
  .strict();

const expectedArtifactSchema = z
  .object({
    path: projectPathSchema,
    description: nonEmptyString(2_000),
    required: z.boolean(),
  })
  .strict();

const contractSchema = z
  .object({
    id: idSchema,
    missionId: idSchema,
    agentId: idSchema,
    title: nonEmptyString(1_000),
    objective: nonEmptyShortTextSchema,
    contextualInputs: boundedArray(
      z
        .object({
          name: nonEmptyString(500),
          value: shortTextSchema,
          sourceContractId: nullableIdSchema,
        })
        .strict(),
      256,
    ),
    dependencyIds: boundedArray(idSchema, MAX_COLLECTION_ITEMS),
    semanticScopes: boundedArray(nonEmptyString(1_000), 256),
    declaredClaimKeys: boundedArray(nonEmptyString(200), 256),
    authority: authoritySchema,
    expectedArtifacts: boundedArray(expectedArtifactSchema, 256),
    acceptance: z
      .object({
        checks: boundedArray(acceptanceCheckSchema, 32),
        objectiveTieBreakers: boundedArray(nonEmptyString(1_000), 64),
      })
      .strict(),
    planeId: nullableIdSchema,
    resultManifestPath: z.literal(".shepherd/result.json"),
    manifest: manifestSchema.nullable(),
    verificationEvidence: boundedArray(verificationEvidenceSchema, 128),
    state: z.enum([
      "created",
      "queued",
      "blocked",
      "running",
      "agent_completed",
      "authority_validation",
      "verifying",
      "verified",
      "execution_failed",
      "execution_timed_out",
      "manifest_missing",
      "manifest_malformed",
      "authority_denied",
      "verification_failed",
      "claim_rejected",
      "attention_required",
      "cancelled",
      "interrupted",
    ]),
    failure: failureSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    startedAt: nullableTimestampSchema,
    agentCompletedAt: nullableTimestampSchema,
    verifiedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
  })
  .strict();

const planeSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    missionId: idSchema,
    kind: z.enum(["contract", "integration", "resolution"]),
    contractId: nullableIdSchema,
    candidateId: nullableIdSchema,
    branch: gitBranchSchema,
    worktreePath: hostPathSchema,
    baseCommit: gitObjectIdSchema,
    headCommit: gitObjectIdSchema.nullable(),
    purpose: nonEmptyShortTextSchema,
    executionIdentity: idSchema,
    runtimeSessionFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable()
      .optional(),
    authority: authoritySchema,
    state: z.enum([
      "creating",
      "ready",
      "running",
      "inspecting",
      "verified",
      "failed",
      "interrupted",
      "destroyed",
    ]),
    changedFiles: boundedArray(projectPathSchema, MAX_COLLECTION_ITEMS),
    diffSummary: shortTextSchema,
    verificationEvidenceIds: boundedArray(idSchema, 256),
    generalPromotionState: z
      .enum(["not_started", "reverifying", "promoting", "promoted", "failed"])
      .optional(),
    generalPromotionEvidence: verificationEvidenceSchema.nullable().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    destroyedAt: nullableTimestampSchema,
    error: failureSchema.nullable(),
  })
  .strict();

const collisionSchema = z
  .object({
    id: idSchema,
    missionId: idSchema,
    key: nonEmptyString(200),
    scope: nonEmptyString(1_000),
    leftContractId: idSchema,
    rightContractId: idSchema,
    leftClaimId: idSchema,
    rightClaimId: idSchema,
    leftClaim: semanticClaimSchema,
    rightClaim: semanticClaimSchema,
    reason: nonEmptyShortTextSchema,
    detectionMechanism: z.enum(["deterministic", "model_assisted"]),
    candidateIds: boundedArray(idSchema, MAX_COLLECTION_ITEMS),
    state: z.enum(["detected", "resolving", "resolved", "attention_required"]),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    resolvedAt: nullableTimestampSchema,
  })
  .strict();

const candidateAttemptSchema = z
  .object({
    planeId: idSchema,
    executionState: z.enum(["failed", "timed_out", "interrupted"]),
    verificationEvidence: verificationEvidenceSchema.nullable(),
    changedFiles: boundedArray(projectPathSchema, MAX_COLLECTION_ITEMS),
    diffSummary: shortTextSchema,
    failure: failureSchema,
    startedAt: timestampSchema,
    completedAt: timestampSchema,
  })
  .strict();

const candidateSchema = z
  .object({
    id: idSchema,
    missionId: idSchema,
    collisionId: idSchema,
    strategy: nonEmptyShortTextSchema,
    targetKey: nonEmptyString(200),
    targetValue: nonEmptyString(2_000),
    planeId: idSchema,
    executionState: z.enum([
      "created",
      "queued",
      "running",
      "agent_completed",
      "verifying",
      "passed",
      "failed",
      "timed_out",
      "interrupted",
    ]),
    selectionState: z.enum(["pending", "selected", "rejected", "tied"]),
    promotionState: z.enum([
      "not_started",
      "reverifying",
      "promoting",
      "interrupted",
      "promoted",
      "failed",
    ]),
    verificationEvidence: verificationEvidenceSchema.nullable(),
    previousAttempts: boundedArray(candidateAttemptSchema, 1).optional(),
    promotionEvidence: verificationEvidenceSchema.nullable(),
    changedFiles: boundedArray(projectPathSchema, MAX_COLLECTION_ITEMS),
    diffSummary: shortTextSchema,
    result: shortTextSchema.nullable(),
    retryCount: z.union([z.literal(0), z.literal(1)]),
    failure: failureSchema.nullable(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const eventSchema = z
  .object({
    id: idSchema,
    sequence: positiveSafeIntegerSchema,
    timestamp: timestampSchema,
    type: z.enum([
      "mission_created",
      "mission_state_changed",
      "contract_created",
      "contract_blocked",
      "contract_started",
      "agent_completed",
      "authority_accepted",
      "authority_denied",
      "verification_started",
      "verification_passed",
      "verification_failed",
      "claims_loaded",
      "claim_rejected",
      "collision_detected",
      "resolution_started",
      "candidate_created",
      "candidate_passed",
      "candidate_failed",
      "candidate_retried",
      "candidate_selected",
      "tie_escalated",
      "promotion_started",
      "promotion_completed",
      "mission_completed",
      "mission_failed",
      "mission_cancelled",
      "execution_interrupted",
      "model_review_completed",
      "model_review_degraded",
      "persistence_failed",
    ]),
    summary: safeString(500),
    actor: z
      .object({
        type: z.enum(["human", "shepherd", "agent", "verifier", "system"]),
        id: nullableIdSchema,
        displayName: safeString(120),
      })
      .strict(),
    missionId: nullableIdSchema,
    contractId: nullableIdSchema,
    agentId: nullableIdSchema,
    planeId: nullableIdSchema,
    collisionId: nullableIdSchema,
    candidateId: nullableIdSchema,
    details: z
      .record(
        nonEmptyString(64),
        z.union([safeString(2_000), z.number().finite(), z.boolean(), z.null()]),
      )
      .refine((details) => Object.keys(details).length <= 32),
  })
  .strict();

const groupMessageSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    missionId: nullableIdSchema,
    senderType: z.enum(["human", "shepherd", "agent"]),
    senderId: nullableIdSchema,
    content: textSchema,
    targetAgentId: nullableIdSchema,
    contractId: nullableIdSchema,
    contractAssignment: z
      .discriminatedUnion("preset", [
        z
          .object({
            preset: z.literal("auth-demo-contract"),
            role: z.enum(["Frontend", "Backend"]),
            transport: z.enum(["bearer-jwt", "http-only-session-cookie"]),
          })
          .strict(),
        z
          .object({
            preset: z.literal("general-contract"),
            role: z.enum(["Frontend", "Backend", "Verification", "Generalist"]),
            draftId: idSchema,
            status: z.enum(["clarification_required", "accepted"]),
            missingFields: boundedArray(
              z.enum([
                "objective",
                "expected_artifact",
                "acceptance_evidence",
                "authority",
                "safety",
              ]),
              5,
            ),
            unsafeIntentDetected: z.boolean().optional(),
            expectedArtifacts: boundedArray(expectedArtifactSchema, 8),
            acceptanceSummary: safeString(500).nullable(),
            requiredContent: safeString(200).nullable(),
          })
          .strict(),
      ])
      .optional(),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    createdAt: timestampSchema,
  })
  .strict();

const settingsSchema = z
  .object({
    mode: z.enum(["production", "deterministic_test"]),
    contractTimeoutMs: positiveSafeIntegerSchema.max(86_400_000),
    candidateTimeoutMs: positiveSafeIntegerSchema.max(86_400_000),
    autoResolution: z.boolean(),
    maxConcurrentPlanes: positiveSafeIntegerSchema.min(2).max(16),
    retainCompletedPlanes: z.boolean(),
    modelReviewEnabled: z.boolean(),
    notifications: z
      .object({
        missionCompleted: z.boolean(),
        attentionRequired: z.boolean(),
        collisionDetected: z.boolean(),
      })
      .strict(),
    updatedAt: timestampSchema,
  })
  .strict();

const agentSchema = z
  .object({
    id: idSchema,
    name: nonEmptyString(500),
    description: shortTextSchema,
    instructions: textSchema,
    status: z.enum(["ready", "busy", "stopped", "error"]),
    workspacePath: hostPathSchema,
    codexThreadId: safeString(1_024).nullable(),
    lastError: shortTextSchema.nullable(),
    role: z.enum(["Frontend", "Backend", "Verification", "Generalist"]).optional(),
    authority: authoritySchema.optional(),
    currentContractId: nullableIdSchema.optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const messageSchema = z
  .object({
    id: idSchema,
    agentId: idSchema,
    runId: idSchema,
    role: z.enum(["user", "assistant"]),
    content: textSchema,
    createdAt: timestampSchema,
  })
  .strict();

const runSchema = z
  .object({
    id: idSchema,
    agentId: idSchema,
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    prompt: textSchema,
    output: textSchema.nullable(),
    error: shortTextSchema.nullable(),
    usage: z
      .object({
        inputTokens: safeIntegerSchema.optional(),
        cachedInputTokens: safeIntegerSchema.optional(),
        outputTokens: safeIntegerSchema.optional(),
      })
      .strict()
      .nullable(),
    startedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
    createdAt: timestampSchema,
  })
  .strict();

const databaseV2Schema = z
  .object({
    version: z.literal(2),
    agents: boundedArray(agentSchema, MAX_COLLECTION_ITEMS),
    messages: boundedArray(messageSchema, MAX_COLLECTION_ITEMS),
    runs: boundedArray(runSchema, MAX_COLLECTION_ITEMS),
    shepherd: z
      .object({
        projects: boundedArray(projectSchema, MAX_COLLECTION_ITEMS),
        missions: boundedArray(missionSchema, MAX_COLLECTION_ITEMS),
        contracts: boundedArray(contractSchema, MAX_COLLECTION_ITEMS),
        planes: boundedArray(planeSchema, MAX_COLLECTION_ITEMS),
        claims: boundedArray(semanticClaimSchema, MAX_COLLECTION_ITEMS),
        collisions: boundedArray(collisionSchema, MAX_COLLECTION_ITEMS),
        candidates: boundedArray(candidateSchema, MAX_COLLECTION_ITEMS),
        events: boundedArray(eventSchema, MAX_COLLECTION_ITEMS),
        groupMessages: boundedArray(groupMessageSchema, MAX_COLLECTION_ITEMS),
        settings: settingsSchema,
        nextEventSequence: positiveSafeIntegerSchema,
      })
      .strict(),
  })
  .strict();

const databaseV1Schema = z
  .object({
    version: z.literal(1),
    agents: boundedArray(agentSchema, MAX_COLLECTION_ITEMS),
    messages: boundedArray(messageSchema, MAX_COLLECTION_ITEMS),
    runs: boundedArray(runSchema, MAX_COLLECTION_ITEMS),
  })
  .strict();

const unique = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  unique(left) &&
  unique(right) &&
  (() => {
    const rightIds = new Set(right);
    return left.every((value) => rightIds.has(value));
  })();

const terminalMissionStates = new Set(["completed", "failed", "cancelled"]);

function hasValidLegacyReferences(
  database: Pick<DatabaseV1, "agents" | "messages" | "runs">,
): boolean {
  const agents = new Map(database.agents.map((item) => [item.id, item]));
  const runs = new Map(database.runs.map((item) => [item.id, item]));
  const entities = [...database.agents, ...database.messages, ...database.runs];
  if (!unique(entities.map((item) => item.id))) return false;
  if (database.runs.some((run) => !agents.has(run.agentId))) return false;
  return database.messages.every((message) => {
    const run = runs.get(message.runId);
    return agents.has(message.agentId) && run?.agentId === message.agentId;
  });
}

const contractTerminalStates = new Set([
  "verified",
  "execution_failed",
  "execution_timed_out",
  "manifest_missing",
  "manifest_malformed",
  "authority_denied",
  "verification_failed",
  "claim_rejected",
  "attention_required",
  "cancelled",
  "interrupted",
]);

const contractFailureStates = new Set([
  "execution_failed",
  "execution_timed_out",
  "manifest_missing",
  "manifest_malformed",
  "authority_denied",
  "verification_failed",
  "claim_rejected",
  "attention_required",
  "interrupted",
]);

const notBefore = (later: string, earlier: string): boolean => later >= earlier;

const sameEvidenceReferences = (
  left: readonly { path: string; description: string; line?: number | undefined }[],
  right: readonly { path: string; description: string; line?: number | undefined }[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

const sameSemanticClaim = (
  left: DatabaseV2["shepherd"]["claims"][number],
  right: DatabaseV2["shepherd"]["claims"][number],
): boolean =>
  left.id === right.id &&
  left.missionId === right.missionId &&
  left.contractId === right.contractId &&
  left.key === right.key &&
  left.value === right.value &&
  left.scope === right.scope &&
  left.mode === right.mode &&
  left.valid === right.valid &&
  left.rejectionReason === right.rejectionReason &&
  left.createdAt === right.createdAt &&
  sameEvidenceReferences(left.evidence, right.evidence);

const evidenceCoversContract = (
  contract: DatabaseV2["shepherd"]["contracts"][number],
  evidence: DatabaseV2["shepherd"]["contracts"][number]["verificationEvidence"][number],
  plane: DatabaseV2["shepherd"]["planes"][number],
): boolean =>
  (() => {
    const mandatory = contract.acceptance.checks.filter((check) => check.mandatory);
    return (
      evidence.runner === "independent" &&
      evidence.targetType === "contract" &&
      evidence.targetId === contract.id &&
      evidence.passed &&
      mandatory.length > 0 &&
      unique(contract.acceptance.checks.map((check) => check.id)) &&
      unique(evidence.checks.map((check) => check.id)) &&
      sameIds(evidence.changedFiles, plane.changedFiles) &&
      mandatory.every((required) =>
        evidence.checks.some(
          (actual) =>
            actual.id === required.id &&
            actual.profileId === required.profileId &&
            actual.mandatory &&
            actual.passed &&
            actual.status === "passed",
        ),
      )
    );
  })();

function hasValidLifecycle(database: DatabaseV2): boolean {
  const { shepherd } = database;
  const projects = new Map(shepherd.projects.map((item) => [item.id, item]));
  const missions = new Map(shepherd.missions.map((item) => [item.id, item]));
  const contracts = new Map(shepherd.contracts.map((item) => [item.id, item]));
  const planes = new Map(shepherd.planes.map((item) => [item.id, item]));
  const collisions = new Map(shepherd.collisions.map((item) => [item.id, item]));
  const candidates = new Map(shepherd.candidates.map((item) => [item.id, item]));

  for (const project of shepherd.projects) {
    if (!notBefore(project.updatedAt, project.createdAt)) return false;
  }

  for (const mission of shepherd.missions) {
    if (!notBefore(mission.updatedAt, mission.createdAt)) return false;
    const terminal = terminalMissionStates.has(mission.state);
    if (terminal !== (mission.completedAt !== null)) return false;
    if (
      mission.startedAt !== null &&
      (!notBefore(mission.startedAt, mission.createdAt) ||
        !notBefore(mission.updatedAt, mission.startedAt))
    ) {
      return false;
    }
    if (
      mission.completedAt !== null &&
      (!notBefore(mission.completedAt, mission.createdAt) ||
        !notBefore(mission.updatedAt, mission.completedAt))
    ) {
      return false;
    }
    if (mission.state === "failed" && mission.failure === null) return false;
    if (
      mission.state === "attention_required" !==
      (mission.attentionReason !== null && mission.attentionReason.trim().length > 0)
    ) {
      return false;
    }
    if (mission.state === "completed") {
      const missionContracts = mission.contractIds.map((id) => contracts.get(id));
      if (
        mission.startedAt === null ||
        mission.failure !== null ||
        missionContracts.length === 0 ||
        missionContracts.some((contract) => contract?.state !== "verified") ||
        !sameIds(mission.resolutionIds, mission.collisionIds) ||
        !shepherd.events.some(
          (event) => event.type === "mission_completed" && event.missionId === mission.id,
        )
      ) {
        return false;
      }
      if (mission.collisionIds.length === 0) {
        const project = projects.get(mission.projectId);
        const finalIntegrationPlanes = shepherd.planes.filter(
          (plane) =>
            plane.missionId === mission.id &&
            plane.kind === "integration" &&
            plane.state === "verified" &&
            plane.baseCommit === mission.baseCommit &&
            plane.headCommit !== null &&
            plane.headCommit === project?.protectedHeadCommit,
        );
        if (finalIntegrationPlanes.length !== 1) return false;
      }
      for (const collisionId of mission.collisionIds) {
        const collision = shepherd.collisions.find((item) => item.id === collisionId);
        const selected = shepherd.candidates.filter(
          (candidate) =>
            candidate.collisionId === collisionId &&
            candidate.selectionState === "selected" &&
            candidate.promotionState === "promoted",
        );
        if (!collision || collision.state !== "resolved" || selected.length !== 1) {
          return false;
        }
        const plane = planes.get(selected[0]!.planeId);
        const project = projects.get(mission.projectId);
        if (
          !plane?.headCommit ||
          plane.state !== "verified" ||
          project?.protectedHeadCommit !== plane.headCommit
        ) {
          return false;
        }
      }
    }
  }

  for (const contract of shepherd.contracts) {
    if (!notBefore(contract.updatedAt, contract.createdAt)) return false;
    const terminal = contractTerminalStates.has(contract.state);
    if (terminal !== (contract.completedAt !== null)) return false;
    for (const value of [
      contract.startedAt,
      contract.agentCompletedAt,
      contract.verifiedAt,
      contract.completedAt,
    ]) {
      if (
        value !== null &&
        (!notBefore(value, contract.createdAt) || !notBefore(contract.updatedAt, value))
      ) {
        return false;
      }
    }
    if (contractFailureStates.has(contract.state) !== (contract.failure !== null)) {
      return false;
    }
    if (contract.state === "verified") {
      const plane = contract.planeId ? planes.get(contract.planeId) : undefined;
      const passing = plane
        ? contract.verificationEvidence.find((evidence) =>
            evidenceCoversContract(contract, evidence, plane),
          )
        : undefined;
      const contractClaims = shepherd.claims.filter(
        (claim) => claim.contractId === contract.id,
      );
      if (
        !contract.manifest ||
        contract.startedAt === null ||
        contract.agentCompletedAt === null ||
        contract.verifiedAt === null ||
        !passing ||
        !plane ||
        plane.state !== "verified" ||
        !plane.verificationEvidenceIds.includes(passing.id) ||
        contract.manifest.semanticClaims.length !== contractClaims.length ||
        !sameIds(
          contract.declaredClaimKeys,
          contract.manifest.semanticClaims.map((claim) => claim.key),
        )
      ) {
        return false;
      }
    } else if (contract.verifiedAt !== null) {
      return false;
    }
  }

  for (const plane of shepherd.planes) {
    if (!notBefore(plane.updatedAt, plane.createdAt)) return false;
    if ((plane.state === "destroyed") !== (plane.destroyedAt !== null)) return false;
    if (plane.state === "verified") {
      if (plane.headCommit === null || plane.error !== null) return false;
      if (plane.kind === "contract") {
        const contract = plane.contractId ? contracts.get(plane.contractId) : undefined;
        if (contract?.state !== "verified") return false;
      }
      if (plane.kind === "integration") {
        const missionContracts = shepherd.contracts.filter(
          (contract) => contract.missionId === plane.missionId,
        );
        if (
          missionContracts.length === 0 ||
          missionContracts.some((contract) => contract.state !== "verified")
        ) {
          return false;
        }
      }
      if (plane.kind === "resolution") {
        const candidate = plane.candidateId
          ? candidates.get(plane.candidateId)
          : undefined;
        if (
          candidate?.executionState !== "passed" ||
          !candidate.verificationEvidence?.passed ||
          !plane.verificationEvidenceIds.includes(candidate.verificationEvidence.id)
        ) {
          return false;
        }
      }
    }
  }

  for (const collision of shepherd.collisions) {
    if (!notBefore(collision.updatedAt, collision.createdAt)) return false;
    if ((collision.state === "resolved") !== (collision.resolvedAt !== null)) {
      return false;
    }
    if (collision.state === "resolved") {
      const selected = collision.candidateIds
        .map((id) => candidates.get(id))
        .filter(
          (candidate) =>
            candidate?.selectionState === "selected" &&
            candidate.promotionState === "promoted",
        );
      if (selected.length !== 1) return false;
    }
    if (
      collision.candidateIds.filter(
        (id) => candidates.get(id)?.selectionState === "selected",
      ).length > 1
    ) {
      return false;
    }
  }

  for (const candidate of shepherd.candidates) {
    if (!notBefore(candidate.updatedAt, candidate.createdAt)) return false;
    if (candidate.executionState === "passed") {
      const plane = planes.get(candidate.planeId);
      const collision = collisions.get(candidate.collisionId);
      const sourceContracts = collision
        ? [contracts.get(collision.leftContractId), contracts.get(collision.rightContractId)]
        : [];
      const sourceMandatory = sourceContracts.flatMap((contract) =>
        contract?.acceptance.checks
          .filter((check) => check.mandatory)
          .map((check) => `${check.id}\u0000${check.profileId}`) ?? [],
      );
      const candidateMandatory =
        candidate.verificationEvidence?.checks
          .filter((check) => check.mandatory)
          .map((check) => `${check.id}\u0000${check.profileId}`) ?? [];
      const expectedMandatory = [
        `${AUTH_FRONTEND_CHECK_ID}\u0000${AUTH_FRONTEND_PROFILE_ID}`,
        `${AUTH_BACKEND_CHECK_ID}\u0000${AUTH_BACKEND_PROFILE_ID}`,
        `${AUTH_PROJECT_CHECK_ID}\u0000${AUTH_PROJECT_PROFILE_ID}`,
      ];
      if (
        !candidate.verificationEvidence?.passed ||
        candidate.verificationEvidence.targetType !== "candidate" ||
        candidate.verificationEvidence.targetId !== candidate.id ||
        !sameIds(candidate.verificationEvidence.changedFiles, candidate.changedFiles) ||
        !plane?.headCommit ||
        plane.state !== "verified" ||
        !plane.verificationEvidenceIds.includes(candidate.verificationEvidence.id) ||
        !sameIds(candidate.changedFiles, plane.changedFiles) ||
        sourceContracts.some((contract) => !contract) ||
        sourceMandatory.length === 0 ||
        !sameIds(sourceMandatory, expectedMandatory.slice(0, 2)) ||
        !sameIds(candidateMandatory, expectedMandatory) ||
        candidate.verificationEvidence.checks.some(
          (check) =>
            check.mandatory &&
            (!check.passed || check.status !== "passed"),
        )
      ) {
        return false;
      }
    }
    if (
      candidate.selectionState === "selected" &&
      candidate.executionState !== "passed"
    ) {
      return false;
    }
    if (
      candidate.promotionState === "reverifying" ||
      candidate.promotionState === "promoting"
    ) {
      const plane = planes.get(candidate.planeId);
      const mission = missions.get(candidate.missionId);
      const collision = collisions.get(candidate.collisionId);
      if (
        candidate.selectionState !== "selected" ||
        candidate.executionState !== "passed" ||
        !candidate.verificationEvidence?.passed ||
        plane?.state !== "verified" ||
        !plane.verificationEvidenceIds.includes(candidate.verificationEvidence.id) ||
        mission?.state !== "resolving" ||
        collision?.state !== "resolving"
      ) {
        return false;
      }
    }
    const promotionEvidenceRequired =
      candidate.promotionState === "promoting" ||
      candidate.promotionState === "promoted";
    const promotionEvidenceForbidden =
      candidate.promotionState === "not_started" ||
      candidate.promotionState === "reverifying";
    if (promotionEvidenceRequired && candidate.promotionEvidence === null) return false;
    if (promotionEvidenceForbidden && candidate.promotionEvidence !== null) return false;
    if (candidate.promotionEvidence !== null) {
      const plane = planes.get(candidate.planeId);
      const preservesFinalVerificationFailure =
        candidate.promotionState === "failed" &&
        candidate.failure?.code === "final_reverification_failure" &&
        candidate.failure.stage === "promotion" &&
        !candidate.promotionEvidence.passed;
      const candidateMandatory =
        candidate.verificationEvidence?.checks
          .filter((check) => check.mandatory)
          .map((check) => `${check.id}\u0000${check.profileId}`) ?? [];
      const promotionMandatory = candidate.promotionEvidence.checks
        .filter((check) => check.mandatory)
        .map((check) => `${check.id}\u0000${check.profileId}`);
      if (
        (!candidate.promotionEvidence.passed && !preservesFinalVerificationFailure) ||
        candidate.promotionEvidence.targetType !== "promotion" ||
        candidate.promotionEvidence.targetId !== candidate.id ||
        !sameIds(candidate.promotionEvidence.changedFiles, candidate.changedFiles) ||
        !plane?.verificationEvidenceIds.includes(candidate.promotionEvidence.id) ||
        plane.state !== "verified" ||
        !sameIds(promotionMandatory, candidateMandatory) ||
        (candidate.promotionEvidence.passed && candidate.promotionEvidence.checks.some(
          (check) =>
            check.mandatory &&
            (!check.passed || check.status !== "passed"),
        ))
      ) {
        return false;
      }
    }
    if (candidate.promotionState === "promoted") {
      const plane = planes.get(candidate.planeId);
      const mission = missions.get(candidate.missionId);
      const collision = collisions.get(candidate.collisionId);
      if (
        candidate.executionState !== "passed" ||
        candidate.selectionState !== "selected" ||
        mission?.state !== "completed" ||
        collision?.state !== "resolved" ||
        candidate.failure !== null ||
        candidate.result === null
      ) {
        return false;
      }
    }
  }
  return true;
}

function hasValidReferences(database: DatabaseV2): boolean {
  const { shepherd } = database;
  const agents = new Map(database.agents.map((item) => [item.id, item]));
  const runs = new Map(database.runs.map((item) => [item.id, item]));
  const projects = new Map(shepherd.projects.map((item) => [item.id, item]));
  const missions = new Map(shepherd.missions.map((item) => [item.id, item]));
  const contracts = new Map(shepherd.contracts.map((item) => [item.id, item]));
  const planes = new Map(shepherd.planes.map((item) => [item.id, item]));
  const claims = new Map(shepherd.claims.map((item) => [item.id, item]));
  const collisions = new Map(shepherd.collisions.map((item) => [item.id, item]));
  const candidates = new Map(shepherd.candidates.map((item) => [item.id, item]));

  if (!unique(shepherd.planes.map((plane) => plane.executionIdentity))) return false;
  const runtimeSessionFingerprints = shepherd.planes.flatMap((plane) =>
    plane.runtimeSessionFingerprint ? [plane.runtimeSessionFingerprint] : [],
  );
  if (!unique(runtimeSessionFingerprints)) return false;

  const rootEntities = [
    ...database.agents,
    ...database.messages,
    ...database.runs,
    ...shepherd.projects,
    ...shepherd.missions,
    ...shepherd.contracts,
    ...shepherd.planes,
    ...shepherd.claims,
    ...shepherd.collisions,
    ...shepherd.candidates,
    ...shepherd.events,
    ...shepherd.groupMessages,
  ];
  if (!unique(rootEntities.map((item) => item.id))) return false;
  if (database.runs.some((run) => !agents.has(run.agentId))) return false;
  if (
    database.messages.some((message) => {
      const run = runs.get(message.runId);
      return !agents.has(message.agentId) || run?.agentId !== message.agentId;
    })
  ) {
    return false;
  }

  for (const agent of database.agents) {
    if (agent.currentContractId) {
      const contract = contracts.get(agent.currentContractId);
      if (!contract || contract.agentId !== agent.id) return false;
    }
  }

  for (const project of shepherd.projects) {
    const active = shepherd.missions.filter(
      (mission) =>
        mission.projectId === project.id && !terminalMissionStates.has(mission.state),
    );
    if (active.length > 1) return false;
    if ((active[0]?.id ?? null) !== project.activeMissionId) return false;
  }

  for (const mission of shepherd.missions) {
    if (!projects.has(mission.projectId)) return false;
    const missionContractIds = shepherd.contracts
      .filter((contract) => contract.missionId === mission.id)
      .map((contract) => contract.id);
    const missionCollisionIds = shepherd.collisions
      .filter((collision) => collision.missionId === mission.id)
      .map((collision) => collision.id);
    if (
      !sameIds(mission.contractIds, missionContractIds) ||
      !sameIds(mission.collisionIds, missionCollisionIds) ||
      !unique(mission.resolutionIds) ||
      !mission.resolutionIds.every((id) => missionCollisionIds.includes(id))
    ) {
      return false;
    }
    for (const edge of mission.dependencyEdges) {
      if (
        edge.fromContractId === edge.toContractId ||
        !mission.contractIds.includes(edge.fromContractId) ||
        !mission.contractIds.includes(edge.toContractId)
      ) {
        return false;
      }
    }
  }

  const evidenceIds: string[] = [];
  for (const contract of shepherd.contracts) {
    const mission = missions.get(contract.missionId);
    if (!mission || !agents.has(contract.agentId)) return false;
    if (
      !unique(contract.dependencyIds) ||
      !contract.dependencyIds.every((id) => mission.contractIds.includes(id)) ||
      contract.contextualInputs.some((input) => {
        if (!input.sourceContractId) return false;
        const source = contracts.get(input.sourceContractId);
        return !source || source.missionId !== contract.missionId;
      })
    ) {
      return false;
    }
    if (contract.planeId) {
      const plane = planes.get(contract.planeId);
      if (!plane || plane.contractId !== contract.id) return false;
    }
    if (contract.manifest && contract.manifest.contractId !== contract.id) return false;
    for (const evidence of contract.verificationEvidence) {
      if (evidence.targetType !== "contract" || evidence.targetId !== contract.id) {
        return false;
      }
      evidenceIds.push(evidence.id);
    }
  }

  for (const claim of shepherd.claims) {
    const contract = contracts.get(claim.contractId);
    if (!missions.has(claim.missionId) || !contract || contract.missionId !== claim.missionId) {
      return false;
    }
    if (claim.valid !== (claim.rejectionReason === null)) return false;
    if (!claim.valid && claim.rejectionReason?.trim().length === 0) return false;
    if (contract.state === "verified") {
      const manifestClaim = contract.manifest?.semanticClaims.find(
        (item) =>
          item.key === claim.key &&
          item.value === claim.value &&
          item.scope === claim.scope &&
          item.mode === claim.mode &&
          sameEvidenceReferences(item.evidence, claim.evidence),
      );
      if (!claim.valid || !manifestClaim) return false;
    }
  }

  for (const plane of shepherd.planes) {
    const mission = missions.get(plane.missionId);
    if (!projects.has(plane.projectId) || !mission || mission.projectId !== plane.projectId) {
      return false;
    }
    if (!unique(plane.verificationEvidenceIds)) return false;
    if (
      (plane.generalPromotionState !== undefined ||
        plane.generalPromotionEvidence !== undefined) &&
      plane.kind !== "integration"
    ) {
      return false;
    }
    if (plane.generalPromotionState !== undefined) {
      const promotionEvidence = plane.generalPromotionEvidence ?? null;
      if (
        ((plane.generalPromotionState === "not_started" ||
          plane.generalPromotionState === "reverifying") &&
          promotionEvidence !== null) ||
        ((plane.generalPromotionState === "promoting" ||
          plane.generalPromotionState === "promoted") &&
          (!promotionEvidence?.passed ||
            promotionEvidence.targetType !== "promotion" ||
            promotionEvidence.targetId !== plane.id ||
            !plane.verificationEvidenceIds.includes(promotionEvidence.id))) ||
        (plane.generalPromotionState === "promoted" && plane.state !== "verified")
      ) {
        return false;
      }
      if (promotionEvidence) evidenceIds.push(promotionEvidence.id);
    } else if (plane.generalPromotionEvidence !== undefined) {
      return false;
    }
    if (plane.kind === "contract") {
      const contract = plane.contractId ? contracts.get(plane.contractId) : undefined;
      if (!contract || contract.missionId !== plane.missionId || plane.candidateId !== null) {
        return false;
      }
    } else if (plane.kind === "integration") {
      if (plane.contractId !== null || plane.candidateId !== null) return false;
    } else {
      const candidate = plane.candidateId ? candidates.get(plane.candidateId) : undefined;
      if (!candidate || candidate.missionId !== plane.missionId || plane.contractId !== null) {
        return false;
      }
    }
  }

  for (const collision of shepherd.collisions) {
    const leftContract = contracts.get(collision.leftContractId);
    const rightContract = contracts.get(collision.rightContractId);
    const leftClaim = claims.get(collision.leftClaimId);
    const rightClaim = claims.get(collision.rightClaimId);
    if (
      !missions.has(collision.missionId) ||
      !leftContract ||
      !rightContract ||
      leftContract.state !== "verified" ||
      rightContract.state !== "verified" ||
      leftContract.id === rightContract.id ||
      leftContract.missionId !== collision.missionId ||
      rightContract.missionId !== collision.missionId ||
      !leftClaim ||
      !rightClaim ||
      leftClaim.id === rightClaim.id ||
      leftClaim.contractId !== leftContract.id ||
      rightClaim.contractId !== rightContract.id ||
      leftClaim.missionId !== collision.missionId ||
      rightClaim.missionId !== collision.missionId ||
      collision.leftClaim.id !== leftClaim.id ||
      collision.rightClaim.id !== rightClaim.id ||
      !sameSemanticClaim(collision.leftClaim, leftClaim) ||
      !sameSemanticClaim(collision.rightClaim, rightClaim) ||
      !leftClaim.valid ||
      !rightClaim.valid ||
      leftClaim.rejectionReason !== null ||
      rightClaim.rejectionReason !== null ||
      collision.key !== leftClaim.key ||
      collision.key !== rightClaim.key ||
      collision.scope !== leftClaim.scope ||
      collision.scope !== rightClaim.scope
    ) {
      return false;
    }
    const linkedCandidates = shepherd.candidates
      .filter((candidate) => candidate.collisionId === collision.id)
      .map((candidate) => candidate.id);
    if (!sameIds(collision.candidateIds, linkedCandidates)) return false;
  }

  for (const candidate of shepherd.candidates) {
    const collision = collisions.get(candidate.collisionId);
    const plane = planes.get(candidate.planeId);
    if (
      !missions.has(candidate.missionId) ||
      !collision ||
      collision.missionId !== candidate.missionId ||
      candidate.targetKey !== collision.key ||
      (candidate.targetValue !== collision.leftClaim.value &&
        candidate.targetValue !== collision.rightClaim.value) ||
      !plane ||
      plane.candidateId !== candidate.id ||
      plane.missionId !== candidate.missionId
    ) {
      return false;
    }
    if (candidate.verificationEvidence) {
      if (
        candidate.verificationEvidence.targetType !== "candidate" ||
        candidate.verificationEvidence.targetId !== candidate.id
      ) {
        return false;
      }
      evidenceIds.push(candidate.verificationEvidence.id);
    }
    for (const attempt of candidate.previousAttempts ?? []) {
      if (
        !planes.has(attempt.planeId) ||
        planes.get(attempt.planeId)?.candidateId !== candidate.id ||
        attempt.completedAt < attempt.startedAt
      ) {
        return false;
      }
      const evidence = attempt.verificationEvidence;
      if (evidence) {
        if (
          evidence.targetType !== "candidate" ||
          evidence.targetId !== candidate.id ||
          !planes.get(attempt.planeId)?.verificationEvidenceIds.includes(evidence.id)
        ) {
          return false;
        }
        evidenceIds.push(evidence.id);
      }
    }
    if (candidate.promotionEvidence) {
      if (
        candidate.promotionEvidence.targetType !== "promotion" ||
        candidate.promotionEvidence.targetId !== candidate.id
      ) {
        return false;
      }
      evidenceIds.push(candidate.promotionEvidence.id);
    }
  }
  if (!unique(evidenceIds)) return false;
  const evidenceById = new Map<string, { targetType: string; targetId: string }>();
  for (const contract of shepherd.contracts) {
    for (const evidence of contract.verificationEvidence) {
      evidenceById.set(evidence.id, evidence);
    }
  }
  for (const candidate of shepherd.candidates) {
    for (const attempt of candidate.previousAttempts ?? []) {
      if (attempt.verificationEvidence) {
        evidenceById.set(attempt.verificationEvidence.id, attempt.verificationEvidence);
      }
    }
    if (candidate.verificationEvidence) {
      evidenceById.set(candidate.verificationEvidence.id, candidate.verificationEvidence);
    }
    if (candidate.promotionEvidence) {
      evidenceById.set(candidate.promotionEvidence.id, candidate.promotionEvidence);
    }
  }
  for (const plane of shepherd.planes) {
    if (plane.generalPromotionEvidence) {
      evidenceById.set(plane.generalPromotionEvidence.id, plane.generalPromotionEvidence);
    }
  }
  for (const plane of shepherd.planes) {
    for (const evidenceId of plane.verificationEvidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) return false;
      if (
        (plane.kind === "contract" &&
          (evidence.targetType !== "contract" || evidence.targetId !== plane.contractId)) ||
        (plane.kind === "integration" &&
          (evidence.targetType !== "promotion" || evidence.targetId !== plane.id)) ||
        (plane.kind === "resolution" &&
          (evidence.targetId !== plane.candidateId ||
            (evidence.targetType !== "candidate" &&
              evidence.targetType !== "promotion")))
      ) {
        return false;
      }
    }
  }

  for (const event of shepherd.events) {
    const mission = event.missionId ? missions.get(event.missionId) : undefined;
    if (event.missionId && !mission) return false;
    if (event.agentId && !agents.has(event.agentId)) return false;
    const references = [
      [event.contractId, event.contractId ? contracts.get(event.contractId) : undefined],
      [event.planeId, event.planeId ? planes.get(event.planeId) : undefined],
      [event.collisionId, event.collisionId ? collisions.get(event.collisionId) : undefined],
      [event.candidateId, event.candidateId ? candidates.get(event.candidateId) : undefined],
    ] as const;
    for (const [id, entity] of references) {
      if (id !== null && (!entity || !mission || entity.missionId !== mission.id)) {
        return false;
      }
    }
  }

  for (const message of shepherd.groupMessages) {
    const mission = message.missionId ? missions.get(message.missionId) : undefined;
    const contract = message.contractId ? contracts.get(message.contractId) : undefined;
    if (!projects.has(message.projectId)) return false;
    if (message.missionId && (!mission || mission.projectId !== message.projectId)) {
      return false;
    }
    if (message.contractId && (!contract || contract.missionId !== message.missionId)) {
      return false;
    }
    if (message.targetAgentId && !agents.has(message.targetAgentId)) return false;
    if (message.senderType === "agent") {
      if (
        !message.senderId ||
        !agents.has(message.senderId) ||
        !contract ||
        contract.agentId !== message.senderId ||
        message.targetAgentId !== message.senderId ||
        contract.state !== "verified" ||
        !contract.manifest ||
        message.content !== contract.manifest.summary
      ) {
        return false;
      }
    }
    if (message.contractAssignment) {
      const targetAgent = message.targetAgentId
        ? agents.get(message.targetAgentId)
        : undefined;
      if (
        message.senderType !== "human" ||
        message.senderId !== null ||
        !targetAgent ||
        targetAgent.role !== message.contractAssignment.role ||
        message.requestFingerprint === undefined ||
        (message.missionId === null) !== (message.contractId === null) ||
        (contract !== undefined && contract.agentId !== targetAgent.id)
      ) {
        return false;
      }
    }
  }

  const sequences = shepherd.events.map((event) => event.sequence);
  if (!unique(sequences.map(String))) return false;
  if (sequences.some((sequence, index) => index > 0 && sequence <= sequences[index - 1]!)) {
    return false;
  }
  const lastSequence = sequences.length === 0 ? 0 : sequences[sequences.length - 1]!;
  return (
    shepherd.nextEventSequence > lastSequence &&
    hasValidLifecycle(database)
  );
}

/** Validate untrusted persisted V1 state before performing the lossless migration. */
export function isValidDatabaseV1(value: unknown): value is DatabaseV1 {
  const parsed = databaseV1Schema.safeParse(value);
  return parsed.success && hasValidLegacyReferences(parsed.data as DatabaseV1);
}

/** Validate untrusted persisted V2 state without returning sensitive issue values. */
export function isValidDatabaseV2(value: unknown): value is DatabaseV2 {
  const parsed = databaseV2Schema.safeParse(value);
  return parsed.success && hasValidReferences(parsed.data as DatabaseV2);
}
