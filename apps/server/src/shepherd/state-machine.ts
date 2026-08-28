import { appendShepherdEvent } from "../database.js";
import type { Database } from "../types.js";
import type {
  ExecutionContract,
  ExecutionContractState,
  FailureInfo,
  Mission,
  MissionState,
  ShepherdEvent,
  ShepherdEventActor,
  ShepherdEventType,
  VerificationEvidence,
} from "./domain.js";

export type MissionTransitionActor = "control_plane" | "human" | "system";
export type ContractTransitionActor =
  | "control_plane"
  | "agent_runtime"
  | "independent_verifier"
  | "human"
  | "system";

export class IllegalStateTransitionError extends Error {
  constructor(
    readonly entity: "mission" | "contract",
    readonly currentState: string,
    readonly targetState: string,
    readonly actor: string,
  ) {
    super(
      `Illegal ${entity} transition ${currentState} -> ${targetState} by ${actor}`,
    );
    this.name = "IllegalStateTransitionError";
  }
}

const missionTransitions = {
  planning: ["queued", "failed", "cancelled", "attention_required"],
  queued: ["running", "failed", "cancelled", "attention_required"],
  running: [
    "verifying",
    "failed",
    "cancelled",
    "attention_required",
  ],
  verifying: [
    "running",
    "collision",
    "completed",
    "failed",
    "cancelled",
    "attention_required",
  ],
  collision: ["resolving", "failed", "cancelled", "attention_required"],
  resolving: ["completed", "failed", "cancelled", "attention_required"],
  attention_required: ["resolving", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<MissionState, readonly MissionState[]>;

type ContractTransitionRule = Readonly<{
  to: ExecutionContractState;
  actors: readonly ContractTransitionActor[];
}>;

const transition = (
  to: ExecutionContractState,
  ...actors: ContractTransitionActor[]
): ContractTransitionRule => ({ to, actors });

const contractTransitions = {
  created: [
    transition("queued", "control_plane"),
    transition("blocked", "control_plane"),
    transition("cancelled", "control_plane", "human"),
  ],
  queued: [
    transition("running", "control_plane"),
    transition("blocked", "control_plane"),
    transition("execution_failed", "control_plane", "system"),
    transition("cancelled", "control_plane", "human"),
    transition("interrupted", "control_plane", "system"),
  ],
  blocked: [
    transition("queued", "control_plane"),
    transition("execution_failed", "control_plane", "system"),
    transition("cancelled", "control_plane", "human"),
    transition("interrupted", "control_plane", "system"),
  ],
  running: [
    transition("agent_completed", "agent_runtime", "control_plane"),
    transition("execution_failed", "control_plane", "system"),
    transition("execution_timed_out", "control_plane", "system"),
    transition("cancelled", "control_plane", "human"),
    transition("interrupted", "control_plane", "system"),
  ],
  agent_completed: [
    transition("authority_validation", "control_plane"),
    transition("manifest_missing", "control_plane"),
    transition("manifest_malformed", "control_plane"),
    transition("cancelled", "control_plane", "human"),
    transition("interrupted", "control_plane", "system"),
  ],
  authority_validation: [
    transition("verifying", "control_plane"),
    transition("authority_denied", "control_plane"),
    transition("claim_rejected", "control_plane"),
    transition("attention_required", "control_plane"),
    transition("cancelled", "control_plane", "human"),
    transition("interrupted", "control_plane", "system"),
  ],
  verifying: [
    // Deliberately only the independent verifier may certify success.
    transition("verified", "independent_verifier"),
    transition("verification_failed", "independent_verifier", "control_plane"),
    transition("claim_rejected", "control_plane"),
    transition("attention_required", "control_plane"),
    transition("cancelled", "control_plane", "human"),
    transition("interrupted", "control_plane", "system"),
  ],
  verified: [],
  execution_failed: [],
  execution_timed_out: [],
  manifest_missing: [],
  manifest_malformed: [],
  authority_denied: [],
  verification_failed: [],
  claim_rejected: [],
  attention_required: [],
  cancelled: [],
  interrupted: [],
} as const satisfies Record<ExecutionContractState, readonly ContractTransitionRule[]>;

export const MISSION_TRANSITIONS: Readonly<
  Record<MissionState, readonly MissionState[]>
> = missionTransitions;

export const CONTRACT_TRANSITIONS: Readonly<
  Record<ExecutionContractState, readonly ContractTransitionRule[]>
> = contractTransitions;

export const canTransitionMission = (
  current: MissionState,
  target: MissionState,
  actor?: MissionTransitionActor,
): boolean => {
  if (!missionTransitions[current].some((state) => state === target)) return false;
  if (actor === undefined) return true;
  if (target === "cancelled") return actor === "human" || actor === "control_plane";
  if (current === "attention_required" && target === "resolving") {
    return actor === "human" || actor === "control_plane";
  }
  return actor === "control_plane" || actor === "system";
};

export const canTransitionContract = (
  current: ExecutionContractState,
  target: ExecutionContractState,
  actor: ContractTransitionActor,
): boolean =>
  contractTransitions[current].some(
    (rule) => rule.to === target && rule.actors.some((allowed) => allowed === actor),
  );

const missionTerminalStates = new Set<MissionState>([
  "completed",
  "failed",
  "cancelled",
]);

const contractTerminalStates = new Set<ExecutionContractState>([
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

export interface MissionTransitionOptions {
  actor: MissionTransitionActor;
  timestamp?: string;
  attentionReason?: string | null;
  failure?: FailureInfo | null;
}

export const applyMissionTransition = (
  mission: Mission,
  target: MissionState,
  options: MissionTransitionOptions,
): Mission => {
  if (!canTransitionMission(mission.state, target, options.actor)) {
    throw new IllegalStateTransitionError(
      "mission",
      mission.state,
      target,
      options.actor,
    );
  }
  if (target === "attention_required" && !options.attentionReason?.trim()) {
    throw new Error("An attention_required Mission transition needs a reason");
  }
  if (target === "failed" && !options.failure) {
    throw new Error("A failed Mission transition needs failure evidence");
  }
  const timestamp = options.timestamp ?? new Date().toISOString();
  mission.state = target;
  mission.updatedAt = timestamp;
  if (target === "running" && mission.startedAt === null) {
    mission.startedAt = timestamp;
  }
  if (options.attentionReason !== undefined) {
    mission.attentionReason = options.attentionReason;
  } else if (target !== "attention_required") {
    mission.attentionReason = null;
  }
  if (options.failure !== undefined) {
    mission.failure = options.failure;
  }
  if (missionTerminalStates.has(target)) {
    mission.completedAt = timestamp;
  }
  return mission;
};

const hasPassingIndependentEvidence = (
  contract: ExecutionContract,
  evidence: VerificationEvidence | undefined,
): evidence is VerificationEvidence => {
  if (
    !evidence ||
    evidence.runner !== "independent" ||
    evidence.targetType !== "contract" ||
    evidence.targetId !== contract.id ||
    !evidence.passed
  ) {
    return false;
  }
  return contract.acceptance.checks
    .filter((check) => check.mandatory)
    .every((required) =>
      evidence.checks.some(
        (actual) =>
          actual.id === required.id &&
          actual.mandatory &&
          actual.passed &&
          actual.status === "passed",
      ),
    );
};

export interface ContractTransitionOptions {
  actor: ContractTransitionActor;
  timestamp?: string;
  failure?: FailureInfo | null;
  verificationEvidence?: VerificationEvidence;
}

export const applyContractTransition = (
  contract: ExecutionContract,
  target: ExecutionContractState,
  options: ContractTransitionOptions,
): ExecutionContract => {
  if (!canTransitionContract(contract.state, target, options.actor)) {
    throw new IllegalStateTransitionError(
      "contract",
      contract.state,
      target,
      options.actor,
    );
  }
  if (target === "verified") {
    if (!hasPassingIndependentEvidence(contract, options.verificationEvidence)) {
      throw new Error(
        "A verified Contract transition needs passing independent evidence for every mandatory check",
      );
    }
  }
  const failureStates = new Set<ExecutionContractState>([
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
  if (failureStates.has(target) && !options.failure) {
    throw new Error(`A ${target} Contract transition needs failure evidence`);
  }
  const timestamp = options.timestamp ?? new Date().toISOString();
  contract.state = target;
  contract.updatedAt = timestamp;
  if (target === "running" && contract.startedAt === null) {
    contract.startedAt = timestamp;
  }
  if (target === "agent_completed") {
    contract.agentCompletedAt = timestamp;
  }
  if (options.failure !== undefined) {
    contract.failure = options.failure;
  }
  if (target === "verified" && options.verificationEvidence) {
    contract.verificationEvidence.push(structuredClone(options.verificationEvidence));
    contract.verifiedAt = timestamp;
  }
  if (contractTerminalStates.has(target)) {
    contract.completedAt = timestamp;
  }
  return contract;
};

const missionEventType = (target: MissionState): ShepherdEventType => {
  switch (target) {
    case "completed":
      return "mission_completed";
    case "failed":
      return "mission_failed";
    case "cancelled":
      return "mission_cancelled";
    case "resolving":
      return "resolution_started";
    default:
      return "mission_state_changed";
  }
};

const contractEventType = (target: ExecutionContractState): ShepherdEventType => {
  switch (target) {
    case "blocked":
      return "contract_blocked";
    case "running":
      return "contract_started";
    case "agent_completed":
      return "agent_completed";
    case "verifying":
      return "verification_started";
    case "verified":
      return "verification_passed";
    case "authority_denied":
      return "authority_denied";
    case "verification_failed":
      return "verification_failed";
    case "claim_rejected":
      return "claim_rejected";
    case "interrupted":
      return "execution_interrupted";
    default:
      return "mission_state_changed";
  }
};

interface RecordedTransitionOptions {
  eventActor: ShepherdEventActor;
  summary?: string;
}

/** Mutates state and appends its polling event in the same store transaction. */
export const transitionMissionAndRecord = (
  database: Database,
  missionId: string,
  target: MissionState,
  options: MissionTransitionOptions & RecordedTransitionOptions,
): ShepherdEvent => {
  const mission = database.shepherd.missions.find((item) => item.id === missionId);
  if (!mission) throw new Error(`Mission not found: ${missionId}`);
  const from = mission.state;
  applyMissionTransition(mission, target, options);
  return appendShepherdEvent(database, {
    ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
    type: missionEventType(target),
    summary: options.summary ?? `Mission ${mission.id} transitioned ${from} -> ${target}`,
    actor: options.eventActor,
    missionId: mission.id,
    contractId: null,
    agentId: null,
    planeId: null,
    collisionId: null,
    candidateId: null,
    details: { from, to: target },
  });
};

/** Mutates state and appends its polling event in the same store transaction. */
export const transitionContractAndRecord = (
  database: Database,
  contractId: string,
  target: ExecutionContractState,
  options: ContractTransitionOptions & RecordedTransitionOptions,
): ShepherdEvent => {
  const contract = database.shepherd.contracts.find((item) => item.id === contractId);
  if (!contract) throw new Error(`Contract not found: ${contractId}`);
  const from = contract.state;
  applyContractTransition(contract, target, options);
  return appendShepherdEvent(database, {
    ...(options.timestamp === undefined ? {} : { timestamp: options.timestamp }),
    type: contractEventType(target),
    summary:
      options.summary ?? `Contract ${contract.id} transitioned ${from} -> ${target}`,
    actor: options.eventActor,
    missionId: contract.missionId,
    contractId: contract.id,
    agentId: contract.agentId,
    planeId: contract.planeId,
    collisionId: null,
    candidateId: null,
    details: { from, to: target },
  });
};
