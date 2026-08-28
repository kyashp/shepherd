import type {
  ContractDependencyEdge,
  ExecutionContractState,
  SemanticClaim,
  SemanticCollision,
} from "./domain.js";
import {
  normalizeClaimKey,
  normalizeClaimScope,
  normalizeClaimValue,
} from "./manifest.js";

export interface CollisionContractView {
  id: string;
  missionId: string;
  state: ExecutionContractState;
  claims: readonly CollisionClaimView[];
}

/** Structural input permits fail-closed handling of untrusted/legacy modes. */
export type CollisionClaimView = Omit<SemanticClaim, "mode"> & { mode: string };

export type CollisionNearMissReason =
  | "same_contract"
  | "different_mission"
  | "contract_not_verified"
  | "claim_contract_mismatch"
  | "different_key"
  | "different_scope"
  | "non_exclusive"
  | "same_value"
  | "invalid_evidence"
  | "dependency_supersession";

export type CollisionPredicateResult =
  | {
      collides: true;
      key: string;
      scope: string;
      leftValue: string;
      rightValue: string;
    }
  | { collides: false; reason: CollisionNearMissReason };

function isSupersedingDependency(
  leftContractId: string,
  rightContractId: string,
  dependencyEdges: readonly Pick<
    ContractDependencyEdge,
    "fromContractId" | "toContractId"
  >[],
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of dependencyEdges) {
    const current = outgoing.get(edge.fromContractId) ?? [];
    current.push(edge.toContractId);
    outgoing.set(edge.fromContractId, current);
  }

  const reaches = (from: string, target: string): boolean => {
    const pending = [...(outgoing.get(from) ?? [])];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || visited.has(current)) continue;
      if (current === target) return true;
      visited.add(current);
      pending.push(...(outgoing.get(current) ?? []));
    }
    return false;
  };

  return reaches(leftContractId, rightContractId) || reaches(rightContractId, leftContractId);
}

function hasValidatedEvidence(claim: CollisionClaimView): boolean {
  return (
    claim.valid &&
    claim.rejectionReason === null &&
    claim.evidence.length > 0 &&
    claim.evidence.every(
      (reference) =>
        reference.path.trim().length > 0 && reference.description.trim().length > 0,
    )
  );
}

/** Evaluate every mandatory deterministic-collision condition, in order. */
export function evaluateDeterministicCollision(
  leftContract: CollisionContractView,
  leftClaim: CollisionClaimView,
  rightContract: CollisionContractView,
  rightClaim: CollisionClaimView,
  dependencyEdges: readonly Pick<
    ContractDependencyEdge,
    "fromContractId" | "toContractId"
  >[] = [],
): CollisionPredicateResult {
  if (leftContract.id === rightContract.id) {
    return { collides: false, reason: "same_contract" };
  }
  if (leftContract.missionId !== rightContract.missionId) {
    return { collides: false, reason: "different_mission" };
  }
  if (leftContract.state !== "verified" || rightContract.state !== "verified") {
    return { collides: false, reason: "contract_not_verified" };
  }
  if (
    leftClaim.contractId !== leftContract.id ||
    rightClaim.contractId !== rightContract.id ||
    leftClaim.missionId !== leftContract.missionId ||
    rightClaim.missionId !== rightContract.missionId
  ) {
    return { collides: false, reason: "claim_contract_mismatch" };
  }

  const key = normalizeClaimKey(leftClaim.key);
  if (!key || key !== normalizeClaimKey(rightClaim.key)) {
    return { collides: false, reason: "different_key" };
  }
  const scope = normalizeClaimScope(leftClaim.scope);
  if (!scope || scope !== normalizeClaimScope(rightClaim.scope)) {
    return { collides: false, reason: "different_scope" };
  }
  if (leftClaim.mode !== "exclusive" || rightClaim.mode !== "exclusive") {
    return { collides: false, reason: "non_exclusive" };
  }

  const leftValue = normalizeClaimValue(leftClaim.value);
  const rightValue = normalizeClaimValue(rightClaim.value);
  if (leftValue === rightValue) {
    return { collides: false, reason: "same_value" };
  }
  if (!hasValidatedEvidence(leftClaim) || !hasValidatedEvidence(rightClaim)) {
    return { collides: false, reason: "invalid_evidence" };
  }
  if (
    isSupersedingDependency(
      leftContract.id,
      rightContract.id,
      dependencyEdges,
    )
  ) {
    return { collides: false, reason: "dependency_supersession" };
  }

  return { collides: true, key, scope, leftValue, rightValue };
}

export function isDeterministicCollision(
  leftContract: CollisionContractView,
  leftClaim: CollisionClaimView,
  rightContract: CollisionContractView,
  rightClaim: CollisionClaimView,
  dependencyEdges: readonly Pick<
    ContractDependencyEdge,
    "fromContractId" | "toContractId"
  >[] = [],
): boolean {
  return evaluateDeterministicCollision(
    leftContract,
    leftClaim,
    rightContract,
    rightClaim,
    dependencyEdges,
  ).collides;
}

export interface DetectCollisionOptions {
  dependencyEdges?: readonly Pick<
    ContractDependencyEdge,
    "fromContractId" | "toContractId"
  >[];
  createdAt: string;
  collisionId?: (
    leftContractId: string,
    rightContractId: string,
    key: string,
    scope: string,
    index: number,
  ) => string;
}

/** Detect stable, pairwise collisions without consulting a model. */
export function detectDeterministicCollisions(
  contractInputs: readonly CollisionContractView[],
  options: DetectCollisionOptions,
): SemanticCollision[] {
  const contracts = [...contractInputs].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const collisions: SemanticCollision[] = [];
  for (let leftIndex = 0; leftIndex < contracts.length; leftIndex += 1) {
    const leftContract = contracts[leftIndex];
    if (!leftContract) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < contracts.length; rightIndex += 1) {
      const rightContract = contracts[rightIndex];
      if (!rightContract) continue;
      const leftClaims = [...leftContract.claims].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      const rightClaims = [...rightContract.claims].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      for (const leftClaim of leftClaims) {
        for (const rightClaim of rightClaims) {
          const result = evaluateDeterministicCollision(
            leftContract,
            leftClaim,
            rightContract,
            rightClaim,
            options.dependencyEdges ?? [],
          );
          if (!result.collides) continue;
          const index = collisions.length;
          const id =
            options.collisionId?.(
              leftContract.id,
              rightContract.id,
              result.key,
              result.scope,
              index,
            ) ?? `collision:${leftContract.id}:${rightContract.id}:${index + 1}`;
          collisions.push({
            id,
            missionId: leftContract.missionId,
            key: result.key,
            scope: result.scope,
            leftContractId: leftContract.id,
            rightContractId: rightContract.id,
            leftClaimId: leftClaim.id,
            rightClaimId: rightClaim.id,
            leftClaim: {
              ...leftClaim,
              mode: "exclusive",
              key: result.key,
              value: result.leftValue,
              scope: result.scope,
            },
            rightClaim: {
              ...rightClaim,
              mode: "exclusive",
              key: result.key,
              value: result.rightValue,
              scope: result.scope,
            },
            reason: `Exclusive '${result.key}' claims disagree in scope '${result.scope}': '${result.leftValue}' versus '${result.rightValue}'`,
            detectionMechanism: "deterministic",
            candidateIds: [],
            state: "detected",
            createdAt: options.createdAt,
            updatedAt: options.createdAt,
            resolvedAt: null,
          });
        }
      }
    }
  }
  return collisions;
}
