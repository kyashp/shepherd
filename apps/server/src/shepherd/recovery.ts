import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { appendShepherdEvent } from "../database.js";
import type { JsonStore } from "../store.js";
import type { Database } from "../types.js";
import type {
  CandidateExecutionState,
  ExecutionContractState,
  FailureInfo,
  Mission,
  PlaneState,
  ResolutionCandidate,
  ShepherdProject,
} from "./domain.js";
import { resolveManagedProjectIdentity } from "./demo-project.js";
import {
  AUTH_BACKEND_CHECK_ID,
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_CHECK_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_CHECK_ID,
  AUTH_PROJECT_PROFILE_ID,
} from "./auth-fixture.js";
import { PlaneManager } from "./plane-manager.js";
import {
  transitionContractAndRecord,
  transitionMissionAndRecord,
} from "./state-machine.js";

const SYSTEM_ACTOR = {
  type: "system",
  id: null,
  displayName: "Startup reconciliation",
} as const;

function isPhysicallyInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

async function trustedProjectPlanesRoot(
  managedRoot: string,
  projectId: string,
): Promise<string> {
  const canonicalManagedRoot = await realpath(managedRoot);
  const planesDirectory = path.join(canonicalManagedRoot, "planes");
  const planesEntry = await lstat(planesDirectory);
  if (!planesEntry.isDirectory() || planesEntry.isSymbolicLink()) {
    throw new Error("Managed planes root must be a real directory");
  }
  const canonicalPlanesDirectory = await realpath(planesDirectory);
  if (!isPhysicallyInside(canonicalManagedRoot, canonicalPlanesDirectory)) {
    throw new Error("Managed planes root escaped the Shepherd root");
  }
  const projectPlanes = path.join(canonicalPlanesDirectory, projectId);
  const projectEntry = await lstat(projectPlanes);
  if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) {
    throw new Error("Project Plane root must be a real directory");
  }
  const canonicalProjectPlanes = await realpath(projectPlanes);
  if (!isPhysicallyInside(canonicalManagedRoot, canonicalProjectPlanes)) {
    throw new Error("Project Plane root escaped the Shepherd root");
  }
  return canonicalProjectPlanes;
}

const interruptedMissionStates = new Set<Mission["state"]>([
  "planning",
  "queued",
  "running",
  "verifying",
  "collision",
  "resolving",
]);
const interruptedContractStates: ReadonlySet<ExecutionContractState> = new Set([
  "created",
  "queued",
  "blocked",
  "running",
  "agent_completed",
  "authority_validation",
  "verifying",
]);
const interruptedCandidateStates: ReadonlySet<CandidateExecutionState> = new Set([
  "created",
  "queued",
  "running",
  "agent_completed",
  "verifying",
]);
const interruptedPlaneStates: ReadonlySet<PlaneState> = new Set([
  "creating",
  "ready",
  "running",
  "inspecting",
]);

export type StartupHeadClassification =
  | "unchanged"
  | "selected_candidate_post_cas"
  | "protected_branch_moved"
  | "protected_worktree_mismatch"
  | "inspection_failed";

interface ProjectObservation {
  projectId: string;
  expectedHead: string;
  observedHead: string | null;
  protectedWorktreeHead: string | null;
  protectedIndexMatchesHead: boolean | null;
  protectedWorktreeClean: boolean | null;
  classification: StartupHeadClassification;
  selectedCandidateId: string | null;
  removedArtifactCount: number;
  inspectionError: string | null;
}

export interface StartupReconciliationResult {
  reconciledMissionIds: string[];
  observations: ProjectObservation[];
}

function selectedPromotionCandidate(
  database: Database,
  mission: Mission,
): ResolutionCandidate | null {
  if (mission.state !== "resolving") return null;
  const selected = database.shepherd.candidates.filter(
    (candidate) => {
      const collision = database.shepherd.collisions.find(
        (item) => item.id === candidate.collisionId,
      );
      const sourceContracts = collision
        ? database.shepherd.contracts.filter(
            (contract) =>
              contract.id === collision.leftContractId ||
              contract.id === collision.rightContractId,
          )
        : [];
      const sourceMandatory = sourceContracts.flatMap((contract) =>
        contract.acceptance.checks
          .filter((check) => check.mandatory)
          .map((check) => `${check.id}\u0000${check.profileId}`),
      );
      const candidateMandatory =
        candidate.verificationEvidence?.checks
          .filter((check) => check.mandatory && check.passed && check.status === "passed")
          .map((check) => `${check.id}\u0000${check.profileId}`) ?? [];
      const promotionMandatory =
        candidate.promotionEvidence?.checks
          .filter((check) => check.mandatory && check.passed && check.status === "passed")
          .map((check) => `${check.id}\u0000${check.profileId}`) ?? [];
      const expectedMandatory = [
        `${AUTH_FRONTEND_CHECK_ID}\u0000${AUTH_FRONTEND_PROFILE_ID}`,
        `${AUTH_BACKEND_CHECK_ID}\u0000${AUTH_BACKEND_PROFILE_ID}`,
        `${AUTH_PROJECT_CHECK_ID}\u0000${AUTH_PROJECT_PROFILE_ID}`,
      ];
      return (
      candidate.missionId === mission.id &&
      database.shepherd.collisions.some(
        (collision) =>
          collision.id === candidate.collisionId &&
          collision.missionId === mission.id &&
          collision.state === "resolving",
      ) &&
      candidate.selectionState === "selected" &&
      candidate.promotionState === "promoting" &&
      candidate.promotionEvidence?.passed === true &&
      candidate.promotionEvidence.targetType === "promotion" &&
      candidate.promotionEvidence.targetId === candidate.id &&
      candidate.promotionEvidence.changedFiles.length === candidate.changedFiles.length &&
      candidate.promotionEvidence.changedFiles.every((file) =>
        candidate.changedFiles.includes(file),
      ) &&
      database.shepherd.planes.some(
        (plane) =>
          plane.id === candidate.planeId &&
          plane.verificationEvidenceIds.includes(candidate.promotionEvidence!.id),
      ) &&
      sourceContracts.length === 2 &&
      sourceMandatory.length > 0 &&
      sourceMandatory.length === 2 &&
      expectedMandatory.slice(0, 2).every((required) => sourceMandatory.includes(required)) &&
      candidateMandatory.length === expectedMandatory.length &&
      expectedMandatory.every((required) => candidateMandatory.includes(required)) &&
      candidateMandatory.length === promotionMandatory.length &&
      candidateMandatory.every((required) => promotionMandatory.includes(required))
      );
    },
  );
  return selected.length === 1 ? (selected[0] ?? null) : null;
}

export function classifyStartupProtectedHead(
  database: Database,
  project: ShepherdProject,
  observedHead: string,
  protectedWorktreeHead: string,
  protectedWorktreeSynchronized = protectedWorktreeHead === observedHead,
  selectedCandidateIsFastForward = false,
  selectedPlaneIsCorroborated = false,
): Pick<ProjectObservation, "classification" | "selectedCandidateId"> {
  if (!protectedWorktreeSynchronized) {
    return {
      classification: "protected_worktree_mismatch",
      selectedCandidateId: null,
    };
  }
  if (observedHead === project.protectedHeadCommit) {
    return { classification: "unchanged", selectedCandidateId: null };
  }
  const mission = database.shepherd.missions.find(
    (item) =>
      item.id === project.activeMissionId && interruptedMissionStates.has(item.state),
  );
  const selected = mission ? selectedPromotionCandidate(database, mission) : null;
  const selectedPlane = selected
    ? database.shepherd.planes.find((plane) => plane.id === selected.planeId)
    : null;
  if (
    selected &&
    selectedPlane?.headCommit === observedHead &&
    selectedCandidateIsFastForward &&
    selectedPlaneIsCorroborated
  ) {
    return {
      classification: "selected_candidate_post_cas",
      selectedCandidateId: selected.id,
    };
  }
  return { classification: "protected_branch_moved", selectedCandidateId: null };
}

function interruptionFailure(
  observation: ProjectObservation,
  timestamp: string,
): FailureInfo {
  if (
    observation.classification === "protected_branch_moved" ||
    observation.classification === "protected_worktree_mismatch"
  ) {
    return {
      code: "protected_branch_moved",
      message:
        observation.classification === "protected_worktree_mismatch"
          ? "Protected branch ref, index, and checked-out worktree are not synchronized"
          : "Protected branch moved before startup reconciliation completed",
      stage: "startup_reconciliation",
      at: timestamp,
      retryable: false,
    };
  }
  return {
    code: "execution_interrupted",
    message:
      observation.classification === "selected_candidate_post_cas"
        ? "Server stopped after the selected candidate advanced the protected branch but before completion was durably recorded"
        : observation.inspectionError
          ? "Server stopped during the Mission and protected state could not be fully inspected"
          : "Server stopped while the Mission was in flight",
    stage: "startup_reconciliation",
    at: timestamp,
    retryable: true,
  };
}

async function observeProject(
  database: Database,
  managedRoot: string,
  project: ShepherdProject,
): Promise<ProjectObservation> {
  const base: ProjectObservation = {
    projectId: project.id,
    expectedHead: project.protectedHeadCommit,
    observedHead: null,
    protectedWorktreeHead: null,
    protectedIndexMatchesHead: null,
    protectedWorktreeClean: null,
    classification: "inspection_failed",
    selectedCandidateId: null,
    removedArtifactCount: 0,
    inspectionError: null,
  };
  try {
    const identity = await resolveManagedProjectIdentity({
      managedRoot,
      projectId: project.id,
      protectedBranch: project.protectedBranch,
      persistedRepositoryPath: project.repositoryPath,
    });
    const planesRoot = await trustedProjectPlanesRoot(
      identity.managedRoot,
      project.id,
    );
    if (planesRoot !== identity.planesRoot) {
      throw new Error("Project Plane root does not match managed metadata");
    }
    const manager = new PlaneManager({
      repositoryPath: identity.repositoryPath,
      planesRoot,
      protectedBranch: identity.protectedBranch,
      createRootSentinel: false,
    });
    await manager.initialize();
    const protectedInspection = await manager.git.inspectProtectedWorktree(
      identity.protectedBranch,
    );
    const observedHead = protectedInspection.branchHead;
    const protectedWorktreeHead = protectedInspection.worktreeHead;
    const activeMission = database.shepherd.missions.find(
      (mission) => mission.id === project.activeMissionId,
    );
    const selected = activeMission
      ? selectedPromotionCandidate(database, activeMission)
      : null;
    const selectedPlane = selected
      ? database.shepherd.planes.find((plane) => plane.id === selected.planeId)
      : null;
    const expectedSelectedPath = selectedPlane
      ? path.join(identity.planesRoot, `resolution-${selectedPlane.id}`)
      : null;
    const expectedSelectedBranch = selectedPlane
      ? `shepherd/resolution/${selectedPlane.id}`
      : null;
    let selectedPlaneIsCorroborated = false;
    if (
      selected &&
      selectedPlane &&
      expectedSelectedPath &&
      expectedSelectedBranch &&
      selectedPlane.kind === "resolution" &&
      selectedPlane.projectId === project.id &&
      selectedPlane.missionId === selected.missionId &&
      selectedPlane.candidateId === selected.id &&
      path.resolve(selectedPlane.worktreePath) === expectedSelectedPath &&
      selectedPlane.branch === expectedSelectedBranch &&
      selectedPlane.headCommit === observedHead
    ) {
      const registration = (await manager.git.listWorktrees()).find(
        (worktree) => path.resolve(worktree.path) === expectedSelectedPath,
      );
      selectedPlaneIsCorroborated = Boolean(
        registration &&
          registration.branch === `refs/heads/${expectedSelectedBranch}` &&
          registration.head === observedHead &&
          !registration.detached &&
          !registration.prunable &&
          (await realpath(expectedSelectedPath)) === expectedSelectedPath &&
          (await manager.git.currentHead(expectedSelectedPath)) === observedHead &&
          (await manager.git.uncommittedFiles(expectedSelectedPath)).length === 0,
      );
    }
    const selectedCandidateIsFastForward =
      selectedPlane?.headCommit === observedHead &&
      (await manager.git.isAncestor(project.protectedHeadCommit, observedHead));
    const classification = classifyStartupProtectedHead(
      database,
      project,
      observedHead,
      protectedWorktreeHead,
      protectedInspection.synchronized,
      selectedCandidateIsFastForward,
      selectedPlaneIsCorroborated,
    );
    const removed = await manager.reconcileInterruptedArtifacts();
    return {
      ...base,
      ...classification,
      observedHead,
      protectedWorktreeHead,
      protectedIndexMatchesHead: protectedInspection.indexMatchesHead,
      protectedWorktreeClean: protectedInspection.clean,
      removedArtifactCount: removed.length,
    };
  } catch (error) {
    return {
      ...base,
      inspectionError:
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Unknown startup inspection failure",
    };
  }
}

/**
 * Converts all persisted in-flight work to explicit interrupted evidence in one
 * atomic mutation. Re-running it is a no-op because every affected lifecycle is
 * moved to an interruption/attention terminal state on the first pass.
 */
export async function reconcileShepherdStartup(options: {
  store: JsonStore;
  managedRoot: string;
  now?: () => Date;
}): Promise<StartupReconciliationResult> {
  const snapshot = options.store.snapshot();
  const observations: ProjectObservation[] = [];
  for (const project of snapshot.shepherd.projects) {
    observations.push(
      await observeProject(snapshot, path.resolve(options.managedRoot), project),
    );
  }
  const observationByProject = new Map(
    observations.map((observation) => [observation.projectId, observation]),
  );
  const timestamp = (options.now ?? (() => new Date()))().toISOString();
  const reconciledMissionIds = await options.store.mutate((database) => {
    const reconciled: string[] = [];
    for (const mission of database.shepherd.missions) {
      if (!interruptedMissionStates.has(mission.state)) continue;
      const observation = observationByProject.get(mission.projectId) ?? {
        projectId: mission.projectId,
        expectedHead: "unknown",
        observedHead: null,
        protectedWorktreeHead: null,
        protectedIndexMatchesHead: null,
        protectedWorktreeClean: null,
        classification: "inspection_failed" as const,
        selectedCandidateId: null,
        removedArtifactCount: 0,
        inspectionError: "Mission project was not available during startup",
      };
      const failure = interruptionFailure(observation, timestamp);
      const contractIds = new Set(mission.contractIds);

      for (const contract of database.shepherd.contracts) {
        if (
          contract.missionId !== mission.id ||
          !interruptedContractStates.has(contract.state)
        ) {
          continue;
        }
        transitionContractAndRecord(database, contract.id, "interrupted", {
          actor: "system",
          eventActor: SYSTEM_ACTOR,
          timestamp,
          failure: { ...failure, code: "execution_interrupted" },
          summary: "Startup reconciliation interrupted an in-flight Contract",
          details: { recovery: "startup", missionId: mission.id },
        });
      }
      for (const candidate of database.shepherd.candidates) {
        if (candidate.missionId !== mission.id) continue;
        if (
          interruptedCandidateStates.has(candidate.executionState)
        ) {
          candidate.executionState = "interrupted";
        }
        if (
          candidate.promotionState === "reverifying" ||
          candidate.promotionState === "promoting"
        ) {
          candidate.promotionState = "interrupted";
        }
        if (
          candidate.executionState === "interrupted" ||
          candidate.promotionState === "interrupted"
        ) {
          candidate.failure = { ...failure, code: "execution_interrupted" };
          candidate.updatedAt = timestamp;
          appendShepherdEvent(database, {
            timestamp,
            type: "execution_interrupted",
            summary: "Startup reconciliation interrupted a resolution candidate",
            actor: SYSTEM_ACTOR,
            missionId: mission.id,
            contractId: null,
            agentId: null,
            planeId: candidate.planeId,
            collisionId: candidate.collisionId,
            candidateId: candidate.id,
            details: {
              executionState: candidate.executionState,
              promotionState: candidate.promotionState,
              recovery: "startup",
            },
          });
        }
      }
      for (const plane of database.shepherd.planes) {
        if (
          plane.missionId === mission.id &&
          interruptedPlaneStates.has(plane.state)
        ) {
          plane.state = "interrupted";
          plane.error = { ...failure, code: "execution_interrupted" };
          plane.updatedAt = timestamp;
          appendShepherdEvent(database, {
            timestamp,
            type: "execution_interrupted",
            summary: "Startup reconciliation preserved an interrupted Plane",
            actor: SYSTEM_ACTOR,
            missionId: mission.id,
            contractId: plane.contractId,
            agentId: null,
            planeId: plane.id,
            collisionId: null,
            candidateId: plane.candidateId,
            details: { planeKind: plane.kind, recovery: "startup" },
          });
        }
      }
      for (const collision of database.shepherd.collisions) {
        if (
          collision.missionId === mission.id &&
          (collision.state === "detected" || collision.state === "resolving")
        ) {
          collision.state = "attention_required";
          collision.updatedAt = timestamp;
        }
      }
      for (const agent of database.agents) {
        const affected = database.shepherd.contracts.some(
          (contract) =>
            contractIds.has(contract.id) && contract.agentId === agent.id,
        );
        if (!affected) continue;
        agent.currentContractId = null;
        if (agent.status === "busy") agent.status = "ready";
        agent.lastError = failure.message.slice(0, 500);
        agent.updatedAt = timestamp;
      }
      const project = database.shepherd.projects.find(
        (item) => item.id === mission.projectId,
      );
      if (
        project &&
        observation.classification === "selected_candidate_post_cas" &&
        observation.observedHead
      ) {
        project.protectedHeadCommit = observation.observedHead;
        project.updatedAt = timestamp;
      }
      transitionMissionAndRecord(database, mission.id, "attention_required", {
        actor: "system",
        eventActor: SYSTEM_ACTOR,
        timestamp,
        attentionReason: failure.message,
        failure,
        summary: "Startup reconciliation preserved interrupted Mission evidence",
        details: {
          classification: observation.classification,
          expectedHead: observation.expectedHead,
          observedHead: observation.observedHead,
          protectedWorktreeHead: observation.protectedWorktreeHead,
          protectedIndexMatchesHead: observation.protectedIndexMatchesHead,
          protectedWorktreeClean: observation.protectedWorktreeClean,
          selectedCandidateId: observation.selectedCandidateId,
          removedArtifactCount: observation.removedArtifactCount,
        },
      });
      reconciled.push(mission.id);
    }
    for (const observation of observations) {
      if (
        observation.classification !== "protected_branch_moved" &&
        observation.classification !== "protected_worktree_mismatch"
      ) {
        continue;
      }
      const hasInterruptedMission = database.shepherd.missions.some(
        (mission) =>
          mission.projectId === observation.projectId && reconciled.includes(mission.id),
      );
      if (hasInterruptedMission) continue;
      const alreadyRecorded = database.shepherd.events.some(
        (event) => {
          const eventProjectId =
            typeof event.details.projectId === "string"
              ? event.details.projectId
              : database.shepherd.missions.find(
                  (mission) => mission.id === event.missionId,
                )?.projectId;
          return (
            eventProjectId === observation.projectId &&
            event.details.classification === observation.classification &&
            event.details.expectedHead === observation.expectedHead &&
            event.details.observedHead === observation.observedHead
          );
        },
      );
      if (alreadyRecorded) continue;
      const latestMission = database.shepherd.missions
        .filter((mission) => mission.projectId === observation.projectId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      appendShepherdEvent(database, {
        timestamp,
        type: "execution_interrupted",
        summary: "Startup reconciliation detected an untrusted protected checkout",
        actor: SYSTEM_ACTOR,
        missionId: latestMission?.id ?? null,
        contractId: null,
        agentId: null,
        planeId: null,
        collisionId: null,
        candidateId: null,
        details: {
          recovery: "startup",
          projectId: observation.projectId,
          classification: observation.classification,
          expectedHead: observation.expectedHead,
          observedHead: observation.observedHead,
          protectedWorktreeHead: observation.protectedWorktreeHead,
          protectedIndexMatchesHead: observation.protectedIndexMatchesHead,
          protectedWorktreeClean: observation.protectedWorktreeClean,
        },
      });
    }
    return reconciled;
  });
  return { reconciledMissionIds, observations };
}
