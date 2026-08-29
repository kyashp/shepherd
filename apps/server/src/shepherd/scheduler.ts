import type {
  ContractDependencyEdge,
  ExecutionContract,
  Mission,
} from "./domain.js";

export type SchedulableMission = Pick<
  Mission,
  "id" | "state" | "contractIds" | "dependencyEdges"
>;

export type SchedulableContract = Pick<
  ExecutionContract,
  "id" | "missionId" | "agentId" | "dependencyIds" | "state"
>;

export type DagValidationCode =
  | "duplicate_contract"
  | "mission_contract_mismatch"
  | "unknown_dependency"
  | "self_dependency"
  | "duplicate_dependency"
  | "dependency_mismatch"
  | "cycle";

export class DagValidationError extends Error {
  constructor(
    public readonly code: DagValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "DagValidationError";
  }
}

export type SchedulerBlockReason =
  | { code: "mission_inactive"; missionState: Mission["state"] }
  | { code: "dependency_pending"; dependencyIds: string[] }
  | { code: "dependency_failed"; dependencyIds: string[] }
  | { code: "agent_unavailable"; agentId: string }
  | { code: "mutation_lock_held" }
  | { code: "plane_capacity_exhausted" };

export interface SchedulerRuntime {
  busyAgentIds?: ReadonlySet<string>;
  mutationLockHeld?: boolean;
  activePlaneCount: number;
  maxPlaneConcurrency: number;
}

export interface SchedulerDecision {
  /** Contracts selected in stable ID order. */
  selected: SchedulableContract[];
  /** Eligible contracts not selected, with deterministic and actionable reasons. */
  blocked: Array<{
    contract: SchedulableContract;
    reason: SchedulerBlockReason;
  }>;
}

const RUNNABLE_STATES = new Set<ExecutionContract["state"]>([
  "created",
  "queued",
  "blocked",
]);
const SATISFIED_STATES = new Set<ExecutionContract["state"]>(["verified"]);
const FAILED_STATES = new Set<ExecutionContract["state"]>([
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
const ACTIVE_MISSION_STATES = new Set<Mission["state"]>(["queued", "running"]);

function edgeKey(edge: ContractDependencyEdge): string {
  return `${edge.fromContractId}\0${edge.toContractId}`;
}

/** Validate both persisted graph representations and reject ambiguity fail-closed. */
export function validateContractDag(
  mission: SchedulableMission,
  contracts: readonly SchedulableContract[],
): void {
  const byId = new Map<string, SchedulableContract>();
  for (const contract of contracts) {
    if (byId.has(contract.id)) {
      throw new DagValidationError("duplicate_contract", `Duplicate Contract '${contract.id}'`);
    }
    if (contract.missionId !== mission.id) {
      throw new DagValidationError(
        "mission_contract_mismatch",
        `Contract '${contract.id}' belongs to another Mission`,
      );
    }
    byId.set(contract.id, contract);
  }

  const declaredIds = new Set(mission.contractIds);
  if (
    declaredIds.size !== mission.contractIds.length ||
    declaredIds.size !== byId.size ||
    [...declaredIds].some((id) => !byId.has(id))
  ) {
    throw new DagValidationError(
      "mission_contract_mismatch",
      "Mission Contract IDs do not exactly match the supplied Contracts",
    );
  }

  const edgeKeys = new Set<string>();
  const incoming = new Map<string, Set<string>>(
    contracts.map((contract) => [contract.id, new Set<string>()]),
  );
  const outgoing = new Map<string, string[]>(
    contracts.map((contract) => [contract.id, []]),
  );
  for (const edge of mission.dependencyEdges) {
    if (!byId.has(edge.fromContractId) || !byId.has(edge.toContractId)) {
      throw new DagValidationError("unknown_dependency", "Dependency references an unknown Contract");
    }
    if (edge.fromContractId === edge.toContractId) {
      throw new DagValidationError("self_dependency", "A Contract cannot depend on itself");
    }
    const key = edgeKey(edge);
    if (edgeKeys.has(key)) {
      throw new DagValidationError("duplicate_dependency", "Duplicate dependency edge");
    }
    edgeKeys.add(key);
    incoming.get(edge.toContractId)?.add(edge.fromContractId);
    outgoing.get(edge.fromContractId)?.push(edge.toContractId);
  }

  for (const contract of contracts) {
    const dependencies = new Set(contract.dependencyIds);
    if (dependencies.size !== contract.dependencyIds.length) {
      throw new DagValidationError("duplicate_dependency", "Duplicate Contract dependency");
    }
    if (dependencies.has(contract.id)) {
      throw new DagValidationError("self_dependency", "A Contract cannot depend on itself");
    }
    if ([...dependencies].some((id) => !byId.has(id))) {
      throw new DagValidationError("unknown_dependency", "Contract references an unknown dependency");
    }
    const graphDependencies = incoming.get(contract.id) ?? new Set<string>();
    if (
      dependencies.size !== graphDependencies.size ||
      [...dependencies].some((id) => !graphDependencies.has(id))
    ) {
      throw new DagValidationError(
        "dependency_mismatch",
        `Contract '${contract.id}' dependencies disagree with the Mission graph`,
      );
    }
  }

  const indegree = new Map<string, number>(
    [...incoming].map(([id, dependencies]) => [id, dependencies.size]),
  );
  const ready = [...indegree]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort();
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift();
    if (!id) break;
    visited += 1;
    for (const dependent of (outgoing.get(id) ?? []).sort()) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  if (visited !== contracts.length) {
    throw new DagValidationError("cycle", "Contract dependency graph contains a cycle");
  }
}

/** Select the maximal safe deterministic batch for the current scheduler tick. */
export function selectRunnableContracts(
  mission: SchedulableMission,
  contracts: readonly SchedulableContract[],
  runtime: SchedulerRuntime,
): SchedulerDecision {
  validateContractDag(mission, contracts);
  if (
    !Number.isSafeInteger(runtime.activePlaneCount) ||
    runtime.activePlaneCount < 0 ||
    !Number.isSafeInteger(runtime.maxPlaneConcurrency) ||
    runtime.maxPlaneConcurrency < 1
  ) {
    throw new RangeError("Plane concurrency values must be bounded non-negative integers");
  }

  const byId = new Map(contracts.map((contract) => [contract.id, contract]));
  const candidates = contracts
    .filter((contract) => RUNNABLE_STATES.has(contract.state))
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  const selected: SchedulableContract[] = [];
  const blocked: SchedulerDecision["blocked"] = [];
  const occupiedAgents = new Set(runtime.busyAgentIds ?? []);
  let capacity = Math.max(0, runtime.maxPlaneConcurrency - runtime.activePlaneCount);

  for (const contract of candidates) {
    let reason: SchedulerBlockReason | null = null;
    if (!ACTIVE_MISSION_STATES.has(mission.state)) {
      reason = { code: "mission_inactive", missionState: mission.state };
    } else {
      const dependencies = contract.dependencyIds.map((id) => byId.get(id)!);
      const failed = dependencies
        .filter((dependency) => FAILED_STATES.has(dependency.state))
        .map((dependency) => dependency.id)
        .sort();
      const pending = dependencies
        .filter((dependency) => !SATISFIED_STATES.has(dependency.state) && !FAILED_STATES.has(dependency.state))
        .map((dependency) => dependency.id)
        .sort();
      if (failed.length > 0) reason = { code: "dependency_failed", dependencyIds: failed };
      else if (pending.length > 0) reason = { code: "dependency_pending", dependencyIds: pending };
      else if (occupiedAgents.has(contract.agentId)) {
        reason = { code: "agent_unavailable", agentId: contract.agentId };
      } else if (runtime.mutationLockHeld) reason = { code: "mutation_lock_held" };
      else if (capacity === 0) reason = { code: "plane_capacity_exhausted" };
    }

    if (reason) blocked.push({ contract, reason });
    else {
      selected.push(contract);
      occupiedAgents.add(contract.agentId);
      capacity -= 1;
    }
  }
  return { selected, blocked };
}
