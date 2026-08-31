import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isLoopbackHost, type AppConfig } from "./config.js";
import { HttpError } from "./errors.js";
import {
  agentAuthorityPreset,
  listAgentAuthorityPresets,
  type AgentAuthorityPresetId,
  type AgentService,
} from "./agent-service.js";
import type {
  ExecutionContract,
  FailureInfo,
  Mission,
  Plane,
  ProjectGroupMessage,
  ResolutionCandidate,
  ResolutionCandidateAttempt,
  SemanticClaim,
  SemanticCollision,
  ShepherdDatabase,
  ShepherdEvent,
  ShepherdProject,
  ShepherdSettings,
  VerificationEvidence,
} from "./shepherd/domain.js";
import {
  ShepherdControlError,
  type DeterministicDemoResetResult,
  type ShepherdCandidateDetail,
  type ShepherdCollisionDetail,
  type ShepherdMissionDetail,
  type ShepherdPlaneDetail,
  type ShepherdSettingsUpdate,
} from "./shepherd/service.js";
import { normalizeScopedAuthority } from "./shepherd/authority.js";
import { isSensitiveKey, redactText } from "./shepherd/redaction.js";
import type {
  Agent,
  AgentRole,
  AgentRun,
  Message,
  ScopedAuthority,
} from "./types.js";

export type { ShepherdMissionDetail } from "./shepherd/service.js";

export interface ShepherdHttpService {
  state(): ShepherdDatabase;
  initializeProjectGroup(): Promise<ShepherdProject>;
  missionDetail(id: string): ShepherdMissionDetail | null;
  eventsAfter(cursor: number, limit?: number): ShepherdEvent[];
  startDeterministicDemo(options?: Record<string, never>): Promise<{ missionId: string }>;
  startMissionFromMessage(input: {
    content: string;
    preset: "auth-demo";
    clientMessageId?: string;
    frontendAgentId?: string;
    backendAgentId?: string;
    frontendTransport?: "bearer-jwt" | "http-only-session-cookie";
    backendTransport?: "bearer-jwt" | "http-only-session-cookie";
  }): Promise<{ missionId: string; message: ProjectGroupMessage }>;
  submitPrivateContractPrompt(input: {
    agentId: string;
    clientMessageId: string;
    content: string;
  }): Promise<{
    status: "clarification_required" | "awaiting_peer" | "accepted";
    missionId: string | null;
    contractId: string | null;
    clarification: string | null;
    message: ProjectGroupMessage;
  }>;
  projectGroupMessages(projectId: string, limit?: number): ProjectGroupMessage[];
  sendProjectGroupMessage(
    projectId: string,
    input: {
      clientMessageId: string;
      content: string;
      assignmentPreset?: "auth-demo-contract";
    },
  ): Promise<ProjectGroupMessage>;
  cancelMission(id: string): Promise<Mission>;
  selectTiedCandidate(
    collisionId: string,
    candidateId: string,
  ): Promise<ShepherdMissionDetail>;
  resetDeterministicDemo(): Promise<DeterministicDemoResetResult>;
  settings(): ShepherdSettings;
  updateSettings(input: ShepherdSettingsUpdate): Promise<ShepherdSettings>;
  planeDetail(id: string): ShepherdPlaneDetail | null;
  collisionDetail(id: string): ShepherdCollisionDetail | null;
  candidateDetail(id: string): ShepherdCandidateDetail | null;
}

type PublicShepherdProject = Omit<ShepherdProject, "repositoryPath">;
type PublicPlane = Omit<
  Plane,
  | "worktreePath"
  | "runtimeSessionFingerprint"
  | "executionIdentity"
  | "error"
  | "generalPromotionEvidence"
> & {
  runtimeSessionEstablished: boolean;
  error: FailureInfo | null;
  generalPromotionEvidence?: PublicVerificationEvidence | null;
};
export type PublicAgent = Pick<
  Agent,
  | "id"
  | "name"
  | "description"
  | "instructions"
  | "status"
  | "lastError"
  | "role"
  | "authority"
  | "currentContractId"
  | "createdAt"
  | "updatedAt"
>;

type PublicVerificationEvidence = Omit<VerificationEvidence, "checks"> & {
  checks: Array<
    Omit<VerificationEvidence["checks"][number], "stdout" | "stderr" | "error"> & {
      diagnosticOutputAvailable: boolean;
    }
  >;
};

type PublicExecutionContract = Omit<
  ExecutionContract,
  "manifest" | "verificationEvidence"
> & {
  verificationEvidence: PublicVerificationEvidence[];
};

type PublicResolutionCandidate = Omit<
  ResolutionCandidate,
  "verificationEvidence" | "previousAttempts" | "promotionEvidence"
> & {
  verificationEvidence: PublicVerificationEvidence | null;
  previousAttempts?: Array<
    Omit<ResolutionCandidateAttempt, "verificationEvidence"> & {
      verificationEvidence: PublicVerificationEvidence | null;
    }
  >;
  promotionEvidence: PublicVerificationEvidence | null;
};

export interface PublicShepherdState {
  projects: PublicShepherdProject[];
  missions: Mission[];
  contracts: PublicExecutionContract[];
  planes: PublicPlane[];
  claims: SemanticClaim[];
  collisions: SemanticCollision[];
  candidates: PublicResolutionCandidate[];
  events: ShepherdEvent[];
  groupMessages: ProjectGroupMessage[];
  settings: ShepherdSettings;
  nextEventSequence: number;
}

export type PublicShepherdMissionDetail = Omit<
  ShepherdMissionDetail,
  "project" | "agents" | "contracts" | "planes" | "candidates"
> & {
  project: PublicShepherdProject;
  agents: PublicAgent[];
  contracts: PublicExecutionContract[];
  planes: PublicPlane[];
  candidates: PublicResolutionCandidate[];
};

export type PublicAgentRun = Omit<AgentRun, "prompt">;

const filesystemPathPattern =
  /(?:[A-Za-z]:[\\/]|\/)(?:[^\s\\/]+[\\/])*[^\s,;:)}\]'"`]*/gu;

const safeText = (
  value: string,
  secrets: readonly string[],
  maxStringLength = 2_000,
): string =>
  redactText(value, { secrets, maxStringLength }).replace(
    filesystemPathPattern,
    "[PATH]",
  );

const publicFailure = (
  failure: FailureInfo | null,
  secrets: readonly string[],
): FailureInfo | null =>
  failure === null
    ? null
    : {
        ...failure,
        message: safeText(failure.message, secrets, 500),
        stage: safeText(failure.stage, secrets, 120),
      };

const withoutProjectPath = (
  project: ShepherdProject,
  secrets: readonly string[],
): PublicShepherdProject => {
  const { repositoryPath, ...publicProject } = project;
  void repositoryPath;
  return {
    ...publicProject,
    displayName: safeText(publicProject.displayName, secrets, 200),
  };
};

const withoutPlanePath = (
  plane: Plane,
  secrets: readonly string[],
): PublicPlane => {
  const {
    worktreePath,
    runtimeSessionFingerprint,
    executionIdentity,
    error,
    generalPromotionEvidence,
    ...publicPlane
  } = plane;
  void worktreePath;
  void executionIdentity;
  return {
    ...publicPlane,
    purpose: safeText(publicPlane.purpose, secrets, 500),
    diffSummary: safeText(publicPlane.diffSummary, secrets, 1_000),
    error: publicFailure(error, secrets),
    runtimeSessionEstablished: Boolean(runtimeSessionFingerprint),
    ...(generalPromotionEvidence === undefined
      ? {}
      : {
          generalPromotionEvidence:
            generalPromotionEvidence === null
              ? null
              : toPublicEvidence(generalPromotionEvidence, secrets),
        }),
  };
};

const toPublicEvidence = (
  evidence: VerificationEvidence,
  secrets: readonly string[],
): PublicVerificationEvidence => ({
  ...evidence,
  summary: safeText(evidence.summary, secrets, 1_000),
  checks: evidence.checks.map(({ stdout, stderr, error, ...check }) => ({
    ...check,
    name: safeText(check.name, secrets, 300),
    diagnosticOutputAvailable: Boolean(stdout || stderr || error),
  })),
});

const toPublicClaim = (
  claim: SemanticClaim,
  secrets: readonly string[],
): SemanticClaim => ({
  ...claim,
  key: safeText(claim.key, secrets, 200),
  value: safeText(claim.value, secrets, 500),
  scope: safeText(claim.scope, secrets, 200),
  evidence: claim.evidence.map((reference) => ({
    ...reference,
    description: safeText(reference.description, secrets, 500),
  })),
  rejectionReason:
    claim.rejectionReason === null
      ? null
      : safeText(claim.rejectionReason, secrets, 500),
});

const toPublicCollision = (
  collision: SemanticCollision,
  secrets: readonly string[],
): SemanticCollision => ({
  ...collision,
  key: safeText(collision.key, secrets, 200),
  scope: safeText(collision.scope, secrets, 200),
  leftClaim: toPublicClaim(collision.leftClaim, secrets),
  rightClaim: toPublicClaim(collision.rightClaim, secrets),
  reason: safeText(collision.reason, secrets, 1_000),
});

const toPublicContract = (
  contract: ExecutionContract,
  secrets: readonly string[],
): PublicExecutionContract => {
  const { manifest, verificationEvidence, ...publicContract } = contract;
  void manifest;
  return {
    ...publicContract,
    title: safeText(publicContract.title, secrets, 300),
    objective: safeText(publicContract.objective, secrets, 2_000),
    contextualInputs: publicContract.contextualInputs.map((input) => ({
      ...input,
      name: safeText(input.name, secrets, 200),
      value: safeText(input.value, secrets, 1_000),
    })),
    expectedArtifacts: publicContract.expectedArtifacts.map((artifact) => ({
      ...artifact,
      description: safeText(artifact.description, secrets, 500),
    })),
    acceptance: {
      ...publicContract.acceptance,
      checks: publicContract.acceptance.checks.map((check) => ({
        ...check,
        name: safeText(check.name, secrets, 300),
      })),
      objectiveTieBreakers: publicContract.acceptance.objectiveTieBreakers.map(
        (tieBreaker) => safeText(tieBreaker, secrets, 200),
      ),
    },
    verificationEvidence: verificationEvidence.map((evidence) =>
      toPublicEvidence(evidence, secrets),
    ),
    failure: publicFailure(publicContract.failure, secrets),
  };
};

const toPublicCandidate = (
  candidate: ResolutionCandidate,
  secrets: readonly string[],
): PublicResolutionCandidate => {
  const {
    verificationEvidence,
    previousAttempts,
    promotionEvidence,
    ...publicCandidate
  } = candidate;
  return {
    ...publicCandidate,
    strategy: safeText(publicCandidate.strategy, secrets, 1_000),
    targetKey: safeText(publicCandidate.targetKey, secrets, 200),
    targetValue: safeText(publicCandidate.targetValue, secrets, 500),
    diffSummary: safeText(publicCandidate.diffSummary, secrets, 1_000),
    result:
      publicCandidate.result === null
        ? null
        : safeText(publicCandidate.result, secrets, 1_000),
    failure: publicFailure(publicCandidate.failure, secrets),
    verificationEvidence:
      verificationEvidence === null
        ? null
        : toPublicEvidence(verificationEvidence, secrets),
    ...(previousAttempts === undefined
      ? {}
      : {
          previousAttempts: previousAttempts.map((attempt) => ({
            ...attempt,
            diffSummary: safeText(attempt.diffSummary, secrets, 1_000),
            failure: publicFailure(attempt.failure, secrets)!,
            verificationEvidence:
              attempt.verificationEvidence === null
                ? null
                : toPublicEvidence(attempt.verificationEvidence, secrets),
          })),
        }),
    promotionEvidence:
      promotionEvidence === null
        ? null
        : toPublicEvidence(promotionEvidence, secrets),
  };
};

const toPublicMission = (
  mission: Mission,
  secrets: readonly string[],
): Mission => ({
  ...mission,
  originalIntent: safeText(mission.originalIntent, secrets, 2_000),
  attentionReason:
    mission.attentionReason === null
      ? null
      : safeText(mission.attentionReason, secrets, 500),
  failure: publicFailure(mission.failure, secrets),
});

const toPublicEvent = (
  event: ShepherdEvent,
  secrets: readonly string[],
): ShepherdEvent => ({
  ...event,
  summary: safeText(event.summary, secrets, 500),
  actor: {
    ...event.actor,
    displayName: safeText(event.actor.displayName, secrets, 200),
  },
  details: Object.fromEntries(
    Object.entries(event.details).flatMap(([key, value]) => {
      const canonicalKey = key
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9]/gu, "");
      if (
        isSensitiveKey(key) ||
        [
          "executionsessionfingerprint",
          "repositorypath",
          "runtimesessionfingerprint",
          "worktreepath",
        ].includes(canonicalKey)
      ) {
        return [];
      }
      return [
        [key, typeof value === "string" ? safeText(value, secrets, 500) : value],
      ];
    }),
  ),
});

const toPublicGroupMessage = (
  message: ProjectGroupMessage,
  secrets: readonly string[],
): ProjectGroupMessage => {
  const { requestFingerprint: _requestFingerprint, ...publicMessage } = message;
  const contractAssignment =
    message.contractAssignment?.preset === "general-contract"
      ? {
          ...message.contractAssignment,
          acceptanceSummary:
            message.contractAssignment.acceptanceSummary === null
              ? null
              : safeText(message.contractAssignment.acceptanceSummary, secrets, 500),
          requiredContent:
            message.contractAssignment.requiredContent === null
              ? null
              : safeText(message.contractAssignment.requiredContent, secrets, 200),
        }
      : message.contractAssignment;
  return {
    ...publicMessage,
    content: safeText(message.content, secrets, 2_000),
    ...(contractAssignment === undefined ? {} : { contractAssignment }),
  };
};

export const toPublicAgent = (
  agent: Agent,
  secrets: readonly string[] = [],
): PublicAgent => {
  return {
    id: agent.id,
    name: safeText(agent.name, secrets, 200),
    description: safeText(agent.description, secrets, 500),
    instructions: safeText(agent.instructions, secrets, 10_000),
    status: agent.status,
    lastError:
      agent.lastError === null ? null : safeText(agent.lastError, secrets, 500),
    ...(agent.role === undefined ? {} : { role: agent.role }),
    ...(agent.authority === undefined ? {} : { authority: agent.authority }),
    ...(agent.currentContractId === undefined
      ? {}
      : { currentContractId: agent.currentContractId }),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
};

export const toPublicShepherdState = (
  state: ShepherdDatabase,
  secrets: readonly string[] = [],
): PublicShepherdState => ({
  projects: state.projects.map((project) => withoutProjectPath(project, secrets)),
  missions: state.missions.map((mission) => toPublicMission(mission, secrets)),
  contracts: state.contracts.map((contract) => toPublicContract(contract, secrets)),
  planes: state.planes.map((plane) => withoutPlanePath(plane, secrets)),
  claims: state.claims.map((claim) => toPublicClaim(claim, secrets)),
  collisions: state.collisions.map((collision) =>
    toPublicCollision(collision, secrets),
  ),
  candidates: state.candidates.map((candidate) =>
    toPublicCandidate(candidate, secrets),
  ),
  events: state.events.map((event) => toPublicEvent(event, secrets)),
  groupMessages: state.groupMessages.map((message) =>
    toPublicGroupMessage(message, secrets),
  ),
  settings: state.settings,
  nextEventSequence: state.nextEventSequence,
});

export const toPublicMissionDetail = (
  detail: ShepherdMissionDetail,
  secrets: readonly string[] = [],
): PublicShepherdMissionDetail => ({
  mission: toPublicMission(detail.mission, secrets),
  project: withoutProjectPath(detail.project, secrets),
  agents: detail.agents.map((agent) => toPublicAgent(agent, secrets)),
  contracts: detail.contracts.map((contract) => toPublicContract(contract, secrets)),
  planes: detail.planes.map((plane) => withoutPlanePath(plane, secrets)),
  claims: detail.claims.map((claim) => toPublicClaim(claim, secrets)),
  collisions: detail.collisions.map((collision) =>
    toPublicCollision(collision, secrets),
  ),
  candidates: detail.candidates.map((candidate) =>
    toPublicCandidate(candidate, secrets),
  ),
  events: detail.events.map((event) => toPublicEvent(event, secrets)),
});

const toPublicPlaneDetail = (
  detail: ShepherdPlaneDetail,
  secrets: readonly string[],
) => ({
  plane: withoutPlanePath(detail.plane, secrets),
  mission: toPublicMission(detail.mission, secrets),
  project: withoutProjectPath(detail.project, secrets),
  contract:
    detail.contract === null ? null : toPublicContract(detail.contract, secrets),
  candidate:
    detail.candidate === null ? null : toPublicCandidate(detail.candidate, secrets),
  verificationEvidence: detail.verificationEvidence.map((evidence) =>
    toPublicEvidence(evidence, secrets),
  ),
});

const toPublicCollisionDetail = (
  detail: ShepherdCollisionDetail,
  secrets: readonly string[],
) => ({
  collision: toPublicCollision(detail.collision, secrets),
  mission: toPublicMission(detail.mission, secrets),
  project: withoutProjectPath(detail.project, secrets),
  sourceContracts: detail.sourceContracts.map((contract) =>
    toPublicContract(contract, secrets),
  ),
  candidates: detail.candidates.map((candidate) =>
    toPublicCandidate(candidate, secrets),
  ),
  planes: detail.planes.map((plane) => withoutPlanePath(plane, secrets)),
});

const toPublicCandidateDetail = (
  detail: ShepherdCandidateDetail,
  secrets: readonly string[],
) => ({
  candidate: toPublicCandidate(detail.candidate, secrets),
  collision: toPublicCollision(detail.collision, secrets),
  mission: toPublicMission(detail.mission, secrets),
  project: withoutProjectPath(detail.project, secrets),
  plane: withoutPlanePath(detail.plane, secrets),
  previousPlanes: detail.previousPlanes.map((plane) =>
    withoutPlanePath(plane, secrets),
  ),
});

const toPublicMessage = (
  message: Message,
  secrets: readonly string[],
): Message => ({
  ...message,
  content: safeText(message.content, secrets, 50_000),
});

const toPublicRun = (
  run: AgentRun,
  secrets: readonly string[],
): PublicAgentRun => {
  const { prompt, ...publicRun } = run;
  void prompt;
  return {
    ...publicRun,
    output:
      publicRun.output === null
        ? null
        : safeText(publicRun.output, secrets, 50_000),
    error:
      publicRun.error === null
        ? null
        : safeText(publicRun.error, secrets, 500),
  };
};

const internalErrorForLog = (
  error: Error,
  secrets: readonly string[],
): { errorName: string; errorMessage: string } => ({
  errorName: redactText(error.name, { secrets, maxStringLength: 80 }),
  errorMessage: redactText(error.message, {
    secrets,
    maxStringLength: 500,
  }).replace(filesystemPathPattern, "[PATH]"),
});

const agentIdParams = z.object({ id: z.string().uuid() });
const runIdParams = z.object({ id: z.string().uuid() });
const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/);
const safeIdParams = z.object({ id: safeIdSchema }).strict();
const projectIdParams = safeIdParams;
const missionIdParams = safeIdParams;
const collisionIdParams = safeIdParams;
const planeIdParams = safeIdParams;
const candidateIdParams = safeIdParams;
const agentRoleSchema = z.enum([
  "Frontend",
  "Backend",
  "Verification",
  "Generalist",
]);
const authorityPresetSchema = z.enum([
  "frontend",
  "backend",
  "verification",
  "generalist",
]);
const authorityPatternSchema = z.string().trim().min(1).max(256);
const scopedAuthoritySchema = z
  .object({
    readable: z.array(authorityPatternSchema).max(32),
    writable: z.array(authorityPatternSchema).max(32),
    forbidden: z.array(authorityPatternSchema).max(32),
  })
  .strict();
const agentConfigurationFields = {
  role: agentRoleSchema.optional(),
  authorityPreset: authorityPresetSchema.optional(),
  authority: scopedAuthoritySchema.optional(),
};
const validateAgentAuthorityChoice = (
  value: {
    role?: AgentRole | undefined;
    authorityPreset?: AgentAuthorityPresetId | undefined;
    authority?: ScopedAuthority | undefined;
  },
  context: z.RefinementCtx,
) => {
  if (value.authorityPreset !== undefined && value.authority !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["authority"],
      message: "Choose either authorityPreset or authority, not both",
      input: value,
    });
  }
  if (
    value.authorityPreset !== undefined &&
    value.role !== undefined &&
    agentAuthorityPreset(value.authorityPreset).recommendedRole !== value.role
  ) {
    context.addIssue({
      code: "custom",
      path: ["role"],
      message: "Role must match the selected authority preset",
      input: value,
    });
  }
};
const createAgentBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).optional(),
    instructions: z.string().max(10_000).optional(),
    ...agentConfigurationFields,
  })
  .strict()
  .superRefine(validateAgentAuthorityChoice);
const updateAgentBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().max(500).optional(),
    instructions: z.string().max(10_000).optional(),
    ...agentConfigurationFields,
  })
  .strict()
  .superRefine(validateAgentAuthorityChoice)
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");
const resolvedPreset = (
  body: z.infer<typeof createAgentBody> | z.infer<typeof updateAgentBody>,
) => {
  const { authorityPreset, ...input } = body;
  if (authorityPreset === undefined) return input;
  const preset = agentAuthorityPreset(authorityPreset);
  return {
    ...input,
    role: preset.recommendedRole,
    authority: preset.authority,
  };
};
const validatedAuthority = (authority: ScopedAuthority): ScopedAuthority => {
  try {
    return normalizeScopedAuthority(authority);
  } catch {
    throw new HttpError(
      400,
      "Authority must contain normalized repository-relative patterns only",
    );
  }
};
const resolveCreateAgentInput = (
  body: z.infer<typeof createAgentBody>,
) => {
  const resolved = resolvedPreset(body);
  return {
    name: body.name,
    ...(resolved.description === undefined
      ? {}
      : { description: resolved.description }),
    ...(resolved.instructions === undefined
      ? {}
      : { instructions: resolved.instructions }),
    ...(resolved.role === undefined ? {} : { role: resolved.role }),
    ...(resolved.authority === undefined
      ? {}
      : { authority: validatedAuthority(resolved.authority) }),
  };
};
const resolveUpdateAgentInput = (
  body: z.infer<typeof updateAgentBody>,
) => {
  const resolved = resolvedPreset(body);
  return {
    ...(resolved.name === undefined ? {} : { name: resolved.name }),
    ...(resolved.description === undefined
      ? {}
      : { description: resolved.description }),
    ...(resolved.instructions === undefined
      ? {}
      : { instructions: resolved.instructions }),
    ...(resolved.role === undefined ? {} : { role: resolved.role }),
    ...(resolved.authority === undefined
      ? {}
      : { authority: validatedAuthority(resolved.authority) }),
  };
};
const messageBody = z
  .object({ content: z.string().trim().min(1).max(50_000) })
  .strict();
const privateContractPromptBody = z
  .object({
    clientMessageId: safeIdSchema,
    content: z.string().trim().min(1).max(2_000),
    preset: z.literal("managed-contract"),
  })
  .strict();
const decimalInteger = (name: string, minimum: number, maximum: number) =>
  z
    .string()
    .regex(/^\d+$/, `${name} must be a decimal integer`)
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isSafeInteger(value) && value >= minimum && value <= maximum,
      `${name} must be between ${minimum} and ${maximum}`,
    );
const eventQuery = z
  .object({
    cursor: decimalInteger("cursor", 0, Number.MAX_SAFE_INTEGER).optional(),
    limit: decimalInteger("limit", 1, 200).optional(),
  })
  .strict();
const groupMessageQuery = z
  .object({ limit: decimalInteger("limit", 1, 200).optional() })
  .strict();
const shepherdMessageBody = z
  .object({
    content: z.string().trim().min(1).max(2_000),
    preset: z.string().trim().min(1).max(32),
    clientMessageId: safeIdSchema.optional(),
    assignments: z
      .object({
        frontend: z
          .object({
            agentId: z.string().uuid(),
            transport: z.enum(["bearer-jwt", "http-only-session-cookie"]),
          })
          .strict(),
        backend: z
          .object({
            agentId: z.string().uuid(),
            transport: z.enum(["bearer-jwt", "http-only-session-cookie"]),
          })
          .strict(),
      })
      .strict()
      .refine(
        (value) => value.frontend.agentId !== value.backend.agentId,
        "Frontend and Backend assignments require different Agents",
      )
      .refine(
        (value) => value.frontend.transport !== value.backend.transport,
        "The collision demo requires incompatible authentication transports",
      )
      .optional(),
  })
  .strict();
const groupMessageBody = z
  .object({
    clientMessageId: safeIdSchema,
    content: z.string().trim().min(1).max(2_000),
    assignmentPreset: z.literal("auth-demo-contract").optional(),
  })
  .strict();
const candidateSelectionBody = z
  .object({ candidateId: safeIdSchema })
  .strict();

const settingsUpdateBody = z
  .object({
    contractTimeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    candidateTimeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    autoResolution: z.boolean().optional(),
    maxConcurrentPlanes: z.number().int().min(2).max(16).optional(),
    modelReviewEnabled: z.boolean().optional(),
    notifications: z
      .object({
        missionCompleted: z.boolean().optional(),
        attentionRequired: z.boolean().optional(),
        collisionDetected: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one setting is required")
  .refine(
    (value) =>
      value.notifications === undefined || Object.keys(value.notifications).length > 0,
    "At least one notification setting is required",
  );
const resolveSettingsUpdate = (
  body: z.infer<typeof settingsUpdateBody>,
): ShepherdSettingsUpdate => ({
  ...(body.contractTimeoutMs === undefined
    ? {}
    : { contractTimeoutMs: body.contractTimeoutMs }),
  ...(body.candidateTimeoutMs === undefined
    ? {}
    : { candidateTimeoutMs: body.candidateTimeoutMs }),
  ...(body.autoResolution === undefined
    ? {}
    : { autoResolution: body.autoResolution }),
  ...(body.maxConcurrentPlanes === undefined
    ? {}
    : { maxConcurrentPlanes: body.maxConcurrentPlanes }),
  ...(body.modelReviewEnabled === undefined
    ? {}
    : { modelReviewEnabled: body.modelReviewEnabled }),
  ...(body.notifications === undefined
    ? {}
    : {
        notifications: {
          ...(body.notifications.missionCompleted === undefined
            ? {}
            : { missionCompleted: body.notifications.missionCompleted }),
          ...(body.notifications.attentionRequired === undefined
            ? {}
            : { attentionRequired: body.notifications.attentionRequired }),
          ...(body.notifications.collisionDetected === undefined
            ? {}
            : { collisionDetected: body.notifications.collisionDetected }),
        },
      }),
});
const emptyDemoBody = z.object({}).strict();

export async function createApp(
  config: AppConfig,
  service: AgentService,
  shepherdService?: ShepherdHttpService,
): Promise<FastifyInstance> {
  const publicSecrets = [config.authToken, config.arkApiKey].filter(
    (value) => value.length > 0,
  );
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin:
      config.nodeEnv === "development"
        ? ["http://localhost:5173", "http://127.0.0.1:5173"]
        : false,
  });

  app.addHook("onRequest", async (request, reply) => {
    // Decide from the parsed, decoded PATH, never from the raw request target.
    // Two distinct bypasses came from testing the raw string: Fastify percent-decodes
    // static segments before route matching, so `/%61pi/...` skipped the hook; and
    // HTTP/1.1 permits an absolute-form target, so `http://host/api/...` does not
    // start with "/api/" at all while the router still matches the path component.
    // Parsing against a base handles origin-form, absolute-form and
    // protocol-relative targets uniformly. Anything that fails to parse or decode is
    // treated as protected, never exempt.
    let routedPath: string;
    let routedUrl: string;
    try {
      routedPath = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      routedUrl = decodeURIComponent(request.url);
    } catch {
      routedPath = "/api/";
      routedUrl = "/api/";
    }
    if (!config.authToken && routedPath.startsWith("/api/")) {
      const hostHeader = request.headers.host?.trim().toLowerCase() ?? "";
      let requestHostname = "";
      try {
        requestHostname = new URL(`http://${hostHeader}`).hostname;
      } catch {
        requestHostname = "";
      }
      const originHeader = request.headers.origin;
      let originAllowed = originHeader === undefined;
      if (typeof originHeader === "string") {
        try {
          const origin = new URL(originHeader);
          originAllowed =
            origin.protocol === `${request.protocol}:` &&
            origin.host.toLowerCase() === hostHeader &&
            isLoopbackHost(origin.hostname);
        } catch {
          originAllowed = false;
        }
      }
      if (!isLoopbackHost(requestHostname) || !originAllowed) {
        return reply.code(403).send({ error: "Local API origin required" });
      }
    }
    if (
      !config.authToken ||
      !routedPath.startsWith("/api/") ||
      // Exemptions stay exact-match on the whole target, so a query string or a
      // non-origin-form spelling of a public route still fails closed.
      routedUrl === "/api/health" ||
      routedUrl === "/api/auth"
    ) {
      return;
    }
    const header = request.headers.authorization ?? "";
    const candidate = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expectedBuffer = Buffer.from(config.authToken);
    const candidateBuffer = Buffer.from(candidate);
    const valid =
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer);
    if (!valid) {
      return reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "volc-agent-launchpad",
  }));

  app.get("/api/auth", async () => ({ required: config.authToken.length > 0 }));

  app.get("/api/system", async () => service.systemInfo());

  app.get("/api/agent-authority-presets", async () => ({
    presets: listAgentAuthorityPresets(),
  }));

  app.get("/api/agents", async () => ({
    agents: service.listAgents().map((agent) =>
      toPublicAgent(agent, publicSecrets),
    ),
  }));

  app.post("/api/agents", async (request, reply) => {
    const body = createAgentBody.parse(request.body);
    const agent = await service.createAgent(resolveCreateAgentInput(body));
    return reply.code(201).send({ agent: toPublicAgent(agent, publicSecrets) });
  });

  app.get("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: toPublicAgent(service.getAgent(id), publicSecrets) };
  });

  app.patch("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    const body = updateAgentBody.parse(request.body);
    return {
      agent: toPublicAgent(
        await service.updateAgent(id, resolveUpdateAgentInput(body)),
        publicSecrets,
      ),
    };
  });

  app.delete("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return service.deleteAgent(id);
  });

  app.post("/api/agents/:id/start", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: toPublicAgent(await service.startAgent(id), publicSecrets) };
  });

  app.post("/api/agents/:id/stop", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: toPublicAgent(await service.stopAgent(id), publicSecrets) };
  });

  app.get("/api/agents/:id/messages", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return {
      messages: service
        .getMessages(id)
        .map((message) => toPublicMessage(message, publicSecrets)),
    };
  });

  app.get("/api/agents/:id/runs", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return {
      runs: service.getRuns(id).map((run) => toPublicRun(run, publicSecrets)),
    };
  });

  app.post("/api/agents/:id/messages", async (request, reply) => {
    const { id } = agentIdParams.parse(request.params);
    const body = messageBody.parse(request.body);
    const result = await service.sendMessage(id, body.content);
    return reply.code(202).send({
      run: toPublicRun(result.run, publicSecrets),
      message: toPublicMessage(result.message, publicSecrets),
    });
  });

  app.get("/api/runs/:id", async (request) => {
    const { id } = runIdParams.parse(request.params);
    return { run: toPublicRun(service.getRun(id), publicSecrets) };
  });

  if (shepherdService) {
    app.get("/api/shepherd/state", async () => ({
      state: toPublicShepherdState(shepherdService.state(), publicSecrets),
    }));

    app.post("/api/shepherd/agents/:id/contracts", async (request, reply) => {
      const { id } = agentIdParams.parse(request.params);
      const body = privateContractPromptBody.parse(request.body);
      const accepted = await shepherdService.submitPrivateContractPrompt({
        agentId: id,
        clientMessageId: body.clientMessageId,
        content: body.content,
      });
      return reply.code(accepted.status === "accepted" ? 202 : 201).send({
        status: accepted.status,
        missionId: accepted.missionId,
        contractId: accepted.contractId,
        clarification: accepted.clarification,
        message: toPublicGroupMessage(accepted.message, publicSecrets),
        executionMode: config.shepherdExecutionMode,
      });
    });

    app.get("/api/shepherd/missions/:id", async (request) => {
      const { id } = missionIdParams.parse(request.params);
      const detail = shepherdService.missionDetail(id);
      if (!detail) {
        throw new HttpError(404, "Mission not found");
      }
      return toPublicMissionDetail(detail, publicSecrets);
    });

    app.get("/api/shepherd/planes/:id", async (request) => {
      const { id } = planeIdParams.parse(request.params);
      const detail = shepherdService.planeDetail(id);
      if (!detail) throw new HttpError(404, "Plane not found");
      return toPublicPlaneDetail(detail, publicSecrets);
    });

    app.get("/api/shepherd/collisions/:id", async (request) => {
      const { id } = collisionIdParams.parse(request.params);
      const detail = shepherdService.collisionDetail(id);
      if (!detail) throw new HttpError(404, "Collision not found");
      return toPublicCollisionDetail(detail, publicSecrets);
    });

    app.get("/api/shepherd/candidates/:id", async (request) => {
      const { id } = candidateIdParams.parse(request.params);
      const detail = shepherdService.candidateDetail(id);
      if (!detail) throw new HttpError(404, "Candidate not found");
      return toPublicCandidateDetail(detail, publicSecrets);
    });

    app.get("/api/shepherd/events", async (request) => {
      const query = eventQuery.parse(request.query);
      const cursor = query.cursor ?? 0;
      const events = shepherdService.eventsAfter(cursor, query.limit ?? 100);
      return {
        events: events.map((event) => toPublicEvent(event, publicSecrets)),
        nextCursor: events.at(-1)?.sequence ?? cursor,
      };
    });

    app.post("/api/shepherd/messages", async (request, reply) => {
      const body = shepherdMessageBody.parse(request.body);
      if (body.preset !== "auth-demo") {
        throw new HttpError(422, "Only the fixed auth-demo Mission preset is supported");
      }
      const accepted = await shepherdService.startMissionFromMessage({
        content: body.content,
        preset: body.preset,
        ...(body.clientMessageId === undefined
          ? {}
          : { clientMessageId: body.clientMessageId }),
        ...(body.assignments === undefined
          ? {}
          : {
              frontendAgentId: body.assignments.frontend.agentId,
              backendAgentId: body.assignments.backend.agentId,
              frontendTransport: body.assignments.frontend.transport,
              backendTransport: body.assignments.backend.transport,
            }),
      });
      return reply.code(202).send({
        status: "accepted",
        missionId: accepted.missionId,
        message: toPublicGroupMessage(accepted.message, publicSecrets),
        executionMode: config.shepherdExecutionMode,
      });
    });

    app.post("/api/shepherd/projects/auth-demo/group-initialization", async (request) => {
      emptyDemoBody.parse(request.body ?? {});
      const project = await shepherdService.initializeProjectGroup();
      return { project: withoutProjectPath(project, publicSecrets) };
    });

    app.get("/api/shepherd/projects/:id/group-messages", async (request) => {
      const { id } = projectIdParams.parse(request.params);
      const query = groupMessageQuery.parse(request.query);
      if (!shepherdService.state().projects.some((project) => project.id === id)) {
        throw new HttpError(404, "Project not found");
      }
      return {
        messages: shepherdService
          .projectGroupMessages(id, query.limit ?? 200)
          .map((message) => toPublicGroupMessage(message, publicSecrets)),
      };
    });

    app.post(
      "/api/shepherd/projects/:id/group-messages",
      async (request, reply) => {
        const { id } = projectIdParams.parse(request.params);
        const body = groupMessageBody.parse(request.body);
        const message = await shepherdService.sendProjectGroupMessage(id, {
          clientMessageId: body.clientMessageId,
          content: body.content,
          ...(body.assignmentPreset === undefined
            ? {}
            : { assignmentPreset: body.assignmentPreset }),
        });
        return reply
          .code(201)
          .send({ message: toPublicGroupMessage(message, publicSecrets) });
      },
    );

    app.post("/api/shepherd/missions/:id/cancel", async (request) => {
      const { id } = missionIdParams.parse(request.params);
      emptyDemoBody.parse(request.body ?? {});
      const mission = await shepherdService.cancelMission(id);
      return { mission: toPublicMission(mission, publicSecrets) };
    });

    app.post("/api/shepherd/collisions/:id/select", async (request) => {
      const { id } = collisionIdParams.parse(request.params);
      const body = candidateSelectionBody.parse(request.body);
      const detail = await shepherdService.selectTiedCandidate(id, body.candidateId);
      return toPublicMissionDetail(detail, publicSecrets);
    });

    app.get("/api/shepherd/settings", async () => ({
      settings: shepherdService.settings(),
    }));

    app.patch("/api/shepherd/settings", async (request) => {
      const body = settingsUpdateBody.parse(request.body);
      return {
        settings: await shepherdService.updateSettings(resolveSettingsUpdate(body)),
      };
    });

    app.post("/api/shepherd/demo/missions", async (request, reply) => {
      if (!config.shepherdDemoMode) {
        throw new HttpError(403, "Shepherd demo mode is disabled");
      }
      emptyDemoBody.parse(request.body ?? {});
      const accepted = await shepherdService.startDeterministicDemo({});
      return reply.code(202).send({
        status: "accepted",
        missionId: accepted.missionId,
        executionMode: config.shepherdExecutionMode,
      });
    });

    app.post("/api/shepherd/demo/reset", async (request) => {
      if (!config.shepherdDemoMode) {
        throw new HttpError(403, "Shepherd demo mode is disabled");
      }
      emptyDemoBody.parse(request.body ?? {});
      const reset = await shepherdService.resetDeterministicDemo();
      return {
        reset: true,
        projectId: reset.projectId,
        restoredHead: reset.restoredHead,
        removedPlaneCount: reset.removedPlanePaths.length,
        removed: reset.removed,
      };
    });
  }

  if (config.nodeEnv === "production") {
    const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "API route not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const appError = error instanceof Error ? error : new Error(String(error));
    const validationError = error instanceof z.ZodError;
    const frameworkStatus =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : null;
    const shepherdStatus =
      error instanceof ShepherdControlError
        ? error.code === "not_found"
          ? 404
          : error.code === "conflict" || error.code === "idempotency_conflict"
            ? 409
            : error.code === "unsupported_assignment"
              ? 422
              : 400
        : null;
    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : shepherdStatus !== null
          ? shepherdStatus
          : validationError
            ? 400
            : frameworkStatus && frameworkStatus >= 400 && frameworkStatus <= 599
              ? frameworkStatus
              : 500;
    if (statusCode >= 500) {
      request.log.error(
        internalErrorForLog(appError, [config.authToken, config.arkApiKey]),
        "Unhandled request error",
      );
    }
    return reply.code(statusCode).send({
      error:
        statusCode >= 500
          ? "Internal server error"
          : validationError
            ? "Request validation failed"
            : safeText(appError.message, publicSecrets, 500),
      ...(validationError
        ? {
            details: error.issues.slice(0, 20).map((issue) => ({
              code: issue.code,
              path: issue.path.slice(0, 12).map((part) => String(part).slice(0, 80)),
              message: issue.message.slice(0, 300),
            })),
          }
        : {}),
    });
  });

  return app;
}
