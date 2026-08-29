import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonStore } from "../store.js";
import type {
  ExecutionContract,
  Plane,
  ResolutionCandidate,
  SemanticCollision,
  VerificationEvidence,
} from "./domain.js";
import {
  initializeAuthDemoProject,
  initializeShepherdManagedRoot,
} from "./demo-project.js";
import { PlaneManager } from "./plane-manager.js";
import {
  classifyStartupProtectedHead,
  reconcileShepherdStartup,
} from "./recovery.js";
import { ShepherdService } from "./service.js";
import {
  AUTH_BACKEND_CHECK_ID,
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_CHECK_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_CHECK_ID,
  AUTH_PROJECT_PROFILE_ID,
} from "./auth-fixture.js";

const timestamp = "2026-08-29T12:00:00.000Z";
const recoveredAt = new Date("2026-08-29T12:05:00.000Z");
const roots: string[] = [];

async function makeFifo(target: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("mkfifo", [target], (error) => (error ? reject(error) : resolve()));
  });
}

async function runFixtureGit(repositoryPath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "git",
      ["-C", repositoryPath, ...args],
      {
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: "/nonexistent",
          LANG: "C",
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    await import("node:fs/promises").then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    );
  }
});

const authority = {
  readable: ["**"],
  writable: ["src/**"],
  forbidden: [".git/**", ".shepherd/**"],
};

function contract(id: string, planeId: string): ExecutionContract {
  return {
    id,
    missionId: "mission-1",
    agentId: "agent-1",
    title: "Interrupted Contract",
    objective: "Exercise recovery",
    contextualInputs: [],
    dependencyIds: [],
    semanticScopes: ["authentication"],
    declaredClaimKeys: ["auth.transport"],
    authority,
    expectedArtifacts: [],
    acceptance: { checks: [], objectiveTieBreakers: [] },
    planeId,
    resultManifestPath: ".shepherd/result.json",
    manifest: null,
    verificationEvidence: [],
    state: "created",
    failure: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    agentCompletedAt: null,
    verifiedAt: null,
    completedAt: null,
  };
}

function verifiedContract(
  id: string,
  planeId: string,
  claim: SemanticCollision["leftClaim"],
  evidenceId: string,
  changedFiles: string[],
): ExecutionContract {
  const acceptanceId =
    id === "contract-1" ? AUTH_FRONTEND_CHECK_ID : AUTH_BACKEND_CHECK_ID;
  const acceptanceProfile =
    id === "contract-1" ? AUTH_FRONTEND_PROFILE_ID : AUTH_BACKEND_PROFILE_ID;
  return {
    ...contract(id, planeId),
    declaredClaimKeys: [claim.key],
    acceptance: {
      checks: [
        {
          id: acceptanceId,
          name: "Source Contract acceptance",
          profileId: acceptanceProfile,
          mandatory: true,
          timeoutMs: 5_000,
        },
      ],
      objectiveTieBreakers: [],
    },
    manifest: {
      schemaVersion: 1,
      contractId: id,
      summary: "Verified before recovery",
      artifacts: changedFiles.map((filePath) => ({
        path: filePath,
        kind: "changed" as const,
        description: "Verified source artifact",
      })),
      semanticClaims: [
        {
          key: claim.key,
          value: claim.value,
          scope: claim.scope,
          mode: claim.mode,
          evidence: structuredClone(claim.evidence),
        },
      ],
      agentDeclaredTests: [],
      notes: "",
    },
    verificationEvidence: [
      {
        id: evidenceId,
        targetType: "contract",
        targetId: id,
        runner: "independent",
        passed: true,
        checks: [
          {
            id: acceptanceId,
            name: "Source Contract acceptance",
            profileId: acceptanceProfile,
            mandatory: true,
            status: "passed",
            passed: true,
            exitCode: 0,
            durationMs: 1,
            stdout: "ok",
            stderr: "",
            error: null,
          },
        ],
        startedAt: timestamp,
        completedAt: timestamp,
        durationMs: 1,
        changedFiles,
        summary: "Source Contract passed before recovery",
      },
    ],
    state: "verified",
    updatedAt: timestamp,
    startedAt: timestamp,
    agentCompletedAt: timestamp,
    verifiedAt: timestamp,
    completedAt: timestamp,
  };
}

function evidence(candidateId: string): VerificationEvidence {
  const checks = [
    [AUTH_FRONTEND_CHECK_ID, AUTH_FRONTEND_PROFILE_ID],
    [AUTH_BACKEND_CHECK_ID, AUTH_BACKEND_PROFILE_ID],
    [AUTH_PROJECT_CHECK_ID, AUTH_PROJECT_PROFILE_ID],
  ].map(([id, profileId]) => ({
    id: id!,
    name: id!,
    profileId: profileId!,
    mandatory: true,
    status: "passed" as const,
    passed: true,
    exitCode: 0,
    durationMs: 1,
    stdout: "ok",
    stderr: "",
    error: null,
  }));
  return {
    id: "evidence-1",
    targetType: "candidate",
    targetId: candidateId,
    runner: "independent",
    passed: true,
    checks,
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 1,
    changedFiles: ["src/recovery.txt"],
    summary: "Passed before the process stopped",
  };
}

describe("startup reconciliation", () => {
  it("keeps fixture Git commits in the selected repository when GIT_DIR is poisoned", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "recovery-git-env-"),
    );
    roots.push(temporaryRoot);
    const fixtureRepository = path.join(temporaryRoot, "fixture");
    const decoyRepository = path.join(temporaryRoot, "decoy");
    await mkdir(fixtureRepository);
    await mkdir(decoyRepository);

    for (const repository of [fixtureRepository, decoyRepository]) {
      await runFixtureGit(repository, ["init", "--initial-branch=main"]);
      await writeFile(path.join(repository, "tracked.txt"), `${path.basename(repository)}\n`);
      await runFixtureGit(repository, ["add", "--", "tracked.txt"]);
      await runFixtureGit(repository, [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@local.invalid",
        "commit",
        "-m",
        "initial fixture",
      ]);
    }
    const fixtureHeadBefore = await readFile(
      path.join(fixtureRepository, ".git", "refs", "heads", "main"),
      "utf8",
    );
    const decoyHeadBefore = await readFile(
      path.join(decoyRepository, ".git", "refs", "heads", "main"),
      "utf8",
    );
    await writeFile(path.join(fixtureRepository, "tracked.txt"), "fixture changed\n");

    vi.stubEnv("GIT_DIR", path.join(decoyRepository, ".git"));
    try {
      await runFixtureGit(fixtureRepository, ["add", "--", "tracked.txt"]);
      await runFixtureGit(fixtureRepository, [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@local.invalid",
        "commit",
        "-m",
        "fixture change",
      ]);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(
      await readFile(path.join(fixtureRepository, ".git", "refs", "heads", "main"), "utf8"),
    ).not.toBe(fixtureHeadBefore);
    await expect(
      readFile(path.join(decoyRepository, ".git", "refs", "heads", "main"), "utf8"),
    ).resolves.toBe(decoyHeadBefore);
    await expect(readFile(path.join(decoyRepository, "tracked.txt"), "utf8")).resolves.toBe(
      "decoy\n",
    );
  });

  it("fails closed, recognizes the exact post-CAS window, cleans private artifacts, and is idempotent", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "recovery-"),
    );
    roots.push(temporaryRoot);
    const managedRoot = path.join(temporaryRoot, "managed");
    const store = new JsonStore(path.join(temporaryRoot, "state.json"));
    await store.initialize();
    const project = await initializeAuthDemoProject({ managedRoot });
    const manager = new PlaneManager({
      repositoryPath: project.repositoryPath,
      planesRoot: project.planesRoot,
      protectedBranch: project.protectedBranch,
    });
    await manager.initialize();

    const contractPlane = await manager.createPlane({
      id: "contract-plane",
      projectId: project.projectId,
      missionId: "mission-1",
      kind: "contract",
      contractId: "contract-interrupted",
      baseCommit: project.headCommit,
      purpose: "Interrupted work",
      executionIdentity: "execution-1",
      authority,
    });
    const leftSourcePlane = await manager.createPlane({
      id: "contract-left-plane",
      projectId: project.projectId,
      missionId: "mission-1",
      kind: "contract",
      contractId: "contract-1",
      baseCommit: project.headCommit,
      purpose: "Verified collision source",
      executionIdentity: "execution-left",
      authority,
    });
    const rightSourcePlane = await manager.createPlane({
      id: "contract-right-plane",
      projectId: project.projectId,
      missionId: "mission-1",
      kind: "contract",
      contractId: "contract-2",
      baseCommit: project.headCommit,
      purpose: "Verified collision source",
      executionIdentity: "execution-right",
      authority,
    });
    await mkdir(path.join(leftSourcePlane.worktreePath, "src", "frontend"), {
      recursive: true,
    });
    await mkdir(path.join(rightSourcePlane.worktreePath, "src", "backend"), {
      recursive: true,
    });
    await writeFile(
      path.join(leftSourcePlane.worktreePath, "src", "frontend", "auth.json"),
      '{"transport":"bearer-jwt"}\n',
    );
    await writeFile(
      path.join(rightSourcePlane.worktreePath, "src", "backend", "auth.json"),
      '{"transport":"http-only-session-cookie"}\n',
    );
    const committedLeft = await manager.commitPlane(
      leftSourcePlane,
      "Verified left source",
    );
    const committedRight = await manager.commitPlane(
      rightSourcePlane,
      "Verified right source",
    );
    const resolutionPlane = await manager.createResolutionPlane({
      id: "resolution-plane",
      projectId: project.projectId,
      missionId: "mission-1",
      candidateId: "candidate-1",
      baseCommit: project.headCommit,
      purpose: "Selected future",
      executionIdentity: "execution-2",
      authority,
    });
    await writeFile(
      path.join(resolutionPlane.worktreePath, "src", "recovery.txt"),
      "selected future\n",
    );
    const committedResolution = await manager.commitPlane(
      resolutionPlane,
      "Selected recovery future",
    );
    const candidateHead = committedResolution.headCommit;
    if (!candidateHead) throw new Error("Test candidate has no head");
    await manager.git.compareAndSwapFastForward(
      project.protectedBranch,
      project.headCommit,
      candidateHead,
    );

    const executionArtifact = path.join(
      project.planesRoot,
      ".execution-workspaces",
      "execution-orphan",
    );
    const verificationArtifact = path.join(
      project.planesRoot,
      ".trusted-verification",
      "verify-orphan",
    );
    const materializationArtifact = path.join(
      project.planesRoot,
      ".trusted-materialization",
      "materialize-orphan",
    );
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(executionArtifact);
      await mkdir(verificationArtifact);
    });
    await manager.git.addDetachedWorktree(materializationArtifact, candidateHead);

    const candidateEvidence = evidence("candidate-1");
    const promotionEvidence: VerificationEvidence = {
      ...candidateEvidence,
      id: "evidence-promotion-1",
      targetType: "promotion",
    };
    const candidate: ResolutionCandidate = {
      id: "candidate-1",
      missionId: "mission-1",
      collisionId: "collision-1",
      strategy: "Use the selected future",
      targetKey: "auth.transport",
      targetValue: "http-only-session-cookie",
      planeId: committedResolution.id,
      executionState: "passed",
      selectionState: "selected",
      promotionState: "promoting",
      verificationEvidence: candidateEvidence,
      promotionEvidence,
      changedFiles: ["src/recovery.txt"],
      diffSummary: "selected future",
      result: null,
      retryCount: 0,
      failure: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const collision: SemanticCollision = {
      id: "collision-1",
      missionId: "mission-1",
      key: "auth.transport",
      scope: "authentication",
      leftContractId: "contract-1",
      rightContractId: "contract-2",
      leftClaimId: "claim-1",
      rightClaimId: "claim-2",
      leftClaim: {
        id: "claim-1",
        missionId: "mission-1",
        contractId: "contract-1",
        key: "auth.transport",
        value: "bearer-jwt",
        scope: "authentication",
        mode: "exclusive",
        evidence: [
          { path: "src/frontend/auth.json", description: "frontend transport" },
        ],
        valid: true,
        rejectionReason: null,
        createdAt: timestamp,
      },
      rightClaim: {
        id: "claim-2",
        missionId: "mission-1",
        contractId: "contract-2",
        key: "auth.transport",
        value: "http-only-session-cookie",
        scope: "authentication",
        mode: "exclusive",
        evidence: [
          { path: "src/backend/auth.json", description: "backend transport" },
        ],
        valid: true,
        rejectionReason: null,
        createdAt: timestamp,
      },
      reason: "Conflicting transport",
      detectionMechanism: "deterministic",
      candidateIds: [candidate.id],
      state: "resolving",
      createdAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
    };

    await store.mutate((database) => {
      database.agents.push({
        id: "agent-1",
        name: "Recovery Agent",
        description: "",
        instructions: "",
        status: "busy",
        workspacePath: path.join(temporaryRoot, "agent-1"),
        codexThreadId: null,
        lastError: null,
        currentContractId: "contract-interrupted",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      database.shepherd.projects.push({
        id: project.projectId,
        displayName: "Recovery fixture",
        repositoryPath: project.repositoryPath,
        protectedBranch: project.protectedBranch,
        protectedHeadCommit: project.headCommit,
        activeMissionId: "mission-1",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      database.shepherd.missions.push({
        id: "mission-1",
        projectId: project.projectId,
        originalIntent: "Test crash recovery",
        baseCommit: project.headCommit,
        contractIds: ["contract-interrupted", "contract-1", "contract-2"],
        dependencyEdges: [],
        collisionIds: [collision.id],
        resolutionIds: [collision.id],
        state: "resolving",
        attentionReason: null,
        failure: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: timestamp,
        completedAt: null,
      });
      database.shepherd.contracts.push(
        contract("contract-interrupted", contractPlane.id),
        verifiedContract(
          "contract-1",
          committedLeft.id,
          collision.leftClaim,
          "evidence-contract-left",
          committedLeft.changedFiles,
        ),
        verifiedContract(
          "contract-2",
          committedRight.id,
          collision.rightClaim,
          "evidence-contract-right",
          committedRight.changedFiles,
        ),
      );
      database.shepherd.planes.push(
        { ...contractPlane, state: "running" } satisfies Plane,
        {
          ...committedLeft,
          state: "verified",
          verificationEvidenceIds: ["evidence-contract-left"],
        } satisfies Plane,
        {
          ...committedRight,
          state: "verified",
          verificationEvidenceIds: ["evidence-contract-right"],
        } satisfies Plane,
        {
          ...committedResolution,
          state: "verified",
          verificationEvidenceIds: [candidateEvidence.id, promotionEvidence.id],
        } satisfies Plane,
      );
      database.shepherd.candidates.push(candidate);
      database.shepherd.collisions.push(collision);
      database.shepherd.claims.push(collision.leftClaim, collision.rightClaim);
    });

    const beforeRecovery = store.snapshot();
    const persistedProject = beforeRecovery.shepherd.projects[0];
    if (!persistedProject) throw new Error("Test project was not persisted");
    expect(
      classifyStartupProtectedHead(
        beforeRecovery,
        persistedProject,
        candidateHead,
        candidateHead,
        true,
        true,
        true,
      ),
    ).toEqual({
      classification: "selected_candidate_post_cas",
      selectedCandidateId: candidate.id,
    });
    expect(
      classifyStartupProtectedHead(
        beforeRecovery,
        persistedProject,
        candidateHead,
        candidateHead,
        true,
        false,
        true,
      ),
    ).toEqual({
      classification: "protected_branch_moved",
      selectedCandidateId: null,
    });
    const missingCandidateProjectProof = structuredClone(beforeRecovery);
    const candidateWithoutProjectProof =
      missingCandidateProjectProof.shepherd.candidates.find(
        (item) => item.id === candidate.id,
      );
    if (!candidateWithoutProjectProof?.verificationEvidence) {
      throw new Error("Candidate proof fixture disappeared");
    }
    candidateWithoutProjectProof.verificationEvidence.checks =
      candidateWithoutProjectProof.verificationEvidence.checks.filter(
        (check) => check.id !== AUTH_PROJECT_CHECK_ID,
      );
    expect(
      classifyStartupProtectedHead(
        missingCandidateProjectProof,
        persistedProject,
        candidateHead,
        candidateHead,
        true,
        true,
        true,
      ).classification,
    ).toBe("protected_branch_moved");
    const unknownExtraProof = structuredClone(beforeRecovery);
    const candidateWithUnknownExtra = unknownExtraProof.shepherd.candidates.find(
      (item) => item.id === candidate.id,
    );
    if (!candidateWithUnknownExtra?.verificationEvidence) {
      throw new Error("Candidate proof fixture disappeared");
    }
    candidateWithUnknownExtra.verificationEvidence.checks.push({
      ...candidateWithUnknownExtra.verificationEvidence.checks[0]!,
      id: "unknown-extra",
      profileId: "unknown-profile",
    });
    expect(
      classifyStartupProtectedHead(
        unknownExtraProof,
        persistedProject,
        candidateHead,
        candidateHead,
        true,
        true,
        true,
      ).classification,
    ).toBe("protected_branch_moved");

    const substitutedPromotionProof = structuredClone(beforeRecovery);
    const candidateWithSubstitutedPromotion =
      substitutedPromotionProof.shepherd.candidates.find(
        (item) => item.id === candidate.id,
      );
    if (!candidateWithSubstitutedPromotion?.promotionEvidence) {
      throw new Error("Promotion proof fixture disappeared");
    }
    candidateWithSubstitutedPromotion.promotionEvidence.checks[0]!.profileId =
      "substituted-profile";
    expect(
      classifyStartupProtectedHead(
        substitutedPromotionProof,
        persistedProject,
        candidateHead,
        candidateHead,
        true,
        true,
        true,
      ).classification,
    ).toBe("protected_branch_moved");
    const reverifying = structuredClone(beforeRecovery);
    const reverifyingCandidate = reverifying.shepherd.candidates.find(
      (item) => item.id === candidate.id,
    );
    if (!reverifyingCandidate) throw new Error("Candidate fixture disappeared");
    reverifyingCandidate.promotionState = "reverifying";
    reverifyingCandidate.promotionEvidence = null;
    expect(
      classifyStartupProtectedHead(
        reverifying,
        persistedProject,
        candidateHead,
        candidateHead,
        true,
        true,
        true,
      ),
    ).toEqual({
      classification: "protected_branch_moved",
      selectedCandidateId: null,
    });
    expect(
      classifyStartupProtectedHead(
        beforeRecovery,
        persistedProject,
        candidateHead,
        candidateHead,
        true,
        true,
        false,
      ),
    ).toEqual({
      classification: "protected_branch_moved",
      selectedCandidateId: null,
    });
    expect(
      classifyStartupProtectedHead(
        beforeRecovery,
        persistedProject,
        "c".repeat(40),
        "c".repeat(40),
      ),
    ).toEqual({
      classification: "protected_branch_moved",
      selectedCandidateId: null,
    });
    expect(
      classifyStartupProtectedHead(
        beforeRecovery,
        persistedProject,
        candidateHead,
        project.headCommit,
        false,
      ).classification,
    ).toBe("protected_worktree_mismatch");

    const result = await reconcileShepherdStartup({
      store,
      managedRoot,
      now: () => recoveredAt,
    });
    expect(result.reconciledMissionIds).toEqual(["mission-1"]);
    expect(result.observations[0]).toMatchObject({
      expectedHead: project.headCommit,
      observedHead: candidateHead,
      protectedWorktreeHead: candidateHead,
      classification: "selected_candidate_post_cas",
      selectedCandidateId: candidate.id,
      removedArtifactCount: 3,
    });
    const recovered = store.snapshot();
    expect(recovered.shepherd.missions[0]).toMatchObject({
      state: "attention_required",
      failure: {
        code: "execution_interrupted",
        stage: "startup_reconciliation",
        retryable: true,
      },
      completedAt: null,
    });
    expect(recovered.shepherd.projects[0]).toMatchObject({
      protectedHeadCommit: candidateHead,
      activeMissionId: "mission-1",
    });
    expect(recovered.shepherd.contracts[0]?.state).toBe("interrupted");
    expect(recovered.agents[0]).toMatchObject({
      status: "ready",
      currentContractId: null,
    });
    expect(recovered.agents[0]?.lastError).toContain("Server stopped");
    expect(recovered.shepherd.candidates[0]).toMatchObject({
      executionState: "passed",
      promotionState: "interrupted",
      verificationEvidence: candidateEvidence,
    });
    expect(recovered.shepherd.planes.find((item) => item.id === contractPlane.id)?.state)
      .toBe("interrupted");
    expect(recovered.shepherd.planes.find((item) => item.id === committedResolution.id)?.state)
      .toBe("verified");
    expect(recovered.shepherd.collisions[0]?.state).toBe("attention_required");
    const recoveryEvents = recovered.shepherd.events.filter(
      (item) => item.type === "execution_interrupted",
    );
    expect(recoveryEvents.some((item) => item.candidateId === candidate.id)).toBe(true);
    expect(recoveryEvents.some((item) => item.planeId === contractPlane.id)).toBe(true);
    const missionEvent = recovered.shepherd.events.find(
      (item) => item.missionId === "mission-1" && item.details.classification,
    );
    expect(missionEvent?.details).toMatchObject({
      classification: "selected_candidate_post_cas",
      expectedHead: project.headCommit,
      observedHead: candidateHead,
      protectedWorktreeHead: candidateHead,
    });
    expect(await readdir(path.dirname(executionArtifact))).toEqual([]);
    expect(await readdir(path.dirname(verificationArtifact))).toEqual([]);
    expect(await readdir(path.dirname(materializationArtifact))).toEqual([]);

    const cursor = store.snapshot().shepherd.nextEventSequence;
    const second = await reconcileShepherdStartup({
      store,
      managedRoot,
      now: () => recoveredAt,
    });
    expect(second.reconciledMissionIds).toEqual([]);
    expect(store.snapshot().shepherd.nextEventSequence).toBe(cursor);
  }, 15_000);

  it("calls verifier cleanup once per service instance even when initialize is reused", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "recovery-hook-"),
    );
    roots.push(temporaryRoot);
    const store = new JsonStore(path.join(temporaryRoot, "state.json"));
    await store.initialize();
    const reconcileInterrupted = vi.fn(async () => undefined);
    const service = new ShepherdService({
      store,
      managedRoot: path.join(temporaryRoot, "managed"),
      verifier: {
        reconcileInterrupted,
        verify: async () => {
          throw new Error("not used");
        },
      },
    });
    await service.initialize();
    await service.initialize();
    expect(reconcileInterrupted).toHaveBeenCalledTimes(1);
  });

  it("refuses unknown and symlinked entries in private artifact roots", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "recovery-adversarial-"),
    );
    roots.push(temporaryRoot);
    const project = await initializeAuthDemoProject({
      managedRoot: path.join(temporaryRoot, "managed"),
    });
    const manager = new PlaneManager({
      repositoryPath: project.repositoryPath,
      planesRoot: project.planesRoot,
      protectedBranch: project.protectedBranch,
    });
    await manager.initialize();
    const executionRoot = path.join(project.planesRoot, ".execution-workspaces");
    const unknown = path.join(executionRoot, "unexpected-entry");
    await mkdir(unknown);
    await expect(manager.reconcileInterruptedArtifacts()).rejects.toThrow(
      "Unexpected entry",
    );
    await rm(unknown, { recursive: true });

    const external = path.join(temporaryRoot, "external-artifact");
    await mkdir(external);
    await symlink(external, path.join(executionRoot, "execution-escape"));
    await expect(manager.reconcileInterruptedArtifacts()).rejects.toThrow(
      "not a real directory",
    );
  });

  it.each([
    "planes_symlink",
    "missing_repository",
    "missing_plane_sentinel",
    "plane_sentinel_symlink",
    "empty_plane_replacement",
    "persisted_external_repository",
    "repository_symlink",
  ] as const)(
    "persists attention and aborts startup for %s",
    async (fault) => {
      const temporaryRoot = await mkdtemp(
        path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "recovery-root-"),
      );
      roots.push(temporaryRoot);
      const managedRoot = path.join(temporaryRoot, "managed");
      const store = new JsonStore(path.join(temporaryRoot, "state.json"));
      await store.initialize();
      let repositoryPath = path.join(managedRoot, "repositories", "auth-demo");
      let externalMarker: string | null = null;
      let missingPlaneSentinel: string | null = null;
      if (fault === "planes_symlink") {
        const project = await initializeAuthDemoProject({ managedRoot });
        repositoryPath = project.repositoryPath;
        const externalPlanes = path.join(temporaryRoot, "external-planes");
        await mkdir(path.join(externalPlanes, "auth-demo"), { recursive: true });
        await rm(path.join(managedRoot, "planes"), {
          recursive: true,
          force: true,
        });
        await symlink(externalPlanes, path.join(managedRoot, "planes"));
      } else if (fault === "missing_repository") {
        await initializeShepherdManagedRoot(managedRoot);
        await mkdir(path.join(managedRoot, "planes", "auth-demo"), {
          recursive: true,
        });
      } else if (fault === "missing_plane_sentinel") {
        const project = await initializeAuthDemoProject({ managedRoot });
        repositoryPath = project.repositoryPath;
        const manager = new PlaneManager({
          repositoryPath: project.repositoryPath,
          planesRoot: project.planesRoot,
          protectedBranch: project.protectedBranch,
        });
        await manager.initialize();
        await rm(path.join(project.planesRoot, ".shepherd-plane-root.json"));
      } else if (fault === "plane_sentinel_symlink") {
        const project = await initializeAuthDemoProject({ managedRoot });
        repositoryPath = project.repositoryPath;
        const manager = new PlaneManager({
          repositoryPath: project.repositoryPath,
          planesRoot: project.planesRoot,
          protectedBranch: project.protectedBranch,
        });
        await manager.initialize();
        const externalSentinel = path.join(temporaryRoot, "external-sentinel.json");
        await writeFile(externalSentinel, "external must survive\n");
        const sentinel = path.join(project.planesRoot, ".shepherd-plane-root.json");
        await rm(sentinel);
        await symlink(externalSentinel, sentinel);
        externalMarker = externalSentinel;
      } else if (fault === "empty_plane_replacement") {
        const project = await initializeAuthDemoProject({ managedRoot });
        repositoryPath = project.repositoryPath;
        const manager = new PlaneManager({
          repositoryPath: project.repositoryPath,
          planesRoot: project.planesRoot,
          protectedBranch: project.protectedBranch,
        });
        await manager.initialize();
        await rm(project.planesRoot, { recursive: true });
        await mkdir(project.planesRoot);
        missingPlaneSentinel = path.join(
          project.planesRoot,
          ".shepherd-plane-root.json",
        );
      } else if (fault === "persisted_external_repository") {
        await initializeAuthDemoProject({ managedRoot });
        repositoryPath = path.join(temporaryRoot, "hostile-external-repository");
        await mkdir(repositoryPath);
        externalMarker = path.join(repositoryPath, "must-survive.txt");
        await writeFile(externalMarker, "external\n");
      } else {
        const project = await initializeAuthDemoProject({ managedRoot });
        const externalRepository = path.join(temporaryRoot, "external-repository");
        await mkdir(externalRepository);
        externalMarker = path.join(externalRepository, "must-survive.txt");
        await writeFile(externalMarker, "external\n");
        await rm(project.repositoryPath, { recursive: true });
        await symlink(externalRepository, project.repositoryPath);
        repositoryPath = project.repositoryPath;
      }
      await store.mutate((database) => {
        database.shepherd.projects.push({
          id: "auth-demo",
          displayName: "Broken recovery fixture",
          repositoryPath,
          protectedBranch: "main",
          protectedHeadCommit: "a".repeat(40),
          activeMissionId: "mission-broken",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        database.shepherd.missions.push({
          id: "mission-broken",
          projectId: "auth-demo",
          originalIntent: "Exercise fail-closed startup",
          baseCommit: "a".repeat(40),
          contractIds: [],
          dependencyEdges: [],
          collisionIds: [],
          resolutionIds: [],
          state: "running",
          attentionReason: null,
          failure: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          startedAt: timestamp,
          completedAt: null,
        });
      });
      const service = new ShepherdService({
        store,
        managedRoot,
        now: () => recoveredAt,
        verifier: {
          verify: async () => {
            throw new Error("not used");
          },
        },
      });
      await expect(service.initialize()).rejects.toThrow(
        "startup artifact reconciliation failed",
      );
      expect(store.snapshot().shepherd.missions[0]).toMatchObject({
        state: "attention_required",
        completedAt: null,
        failure: {
          code: "execution_interrupted",
          stage: "startup_reconciliation",
        },
      });
      if (externalMarker) {
        await expect(import("node:fs/promises").then(({ access }) => access(externalMarker)))
          .resolves.toBeUndefined();
      }
      if (missingPlaneSentinel) {
        await expect(
          import("node:fs/promises").then(({ access }) =>
            access(missingPlaneSentinel!),
          ),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );

  it.each(["missing", "tampered"] as const)(
    "aborts before recovery when a persisted project's root sentinel is %s",
    async (fault) => {
      const temporaryRoot = await mkdtemp(
        path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "root-sentinel-"),
      );
      roots.push(temporaryRoot);
      const managedRoot = path.join(temporaryRoot, "managed");
      const project = await initializeAuthDemoProject({ managedRoot });
      const marker = path.join(managedRoot, "must-survive.txt");
      await writeFile(marker, "preserve me\n");
      const sentinel = path.join(managedRoot, ".shepherd-demo-root.json");
      if (fault === "missing") {
        await rm(sentinel);
      } else {
        await writeFile(sentinel, '{"schemaVersion":1,"marker":"hostile"}\n');
      }

      const store = new JsonStore(path.join(temporaryRoot, "state.json"));
      await store.initialize();
      await store.mutate((database) => {
        database.shepherd.projects.push({
          id: project.projectId,
          displayName: "Persisted project",
          repositoryPath: project.repositoryPath,
          protectedBranch: project.protectedBranch,
          protectedHeadCommit: project.headCommit,
          activeMissionId: "mission-persisted",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        database.shepherd.missions.push({
          id: "mission-persisted",
          projectId: project.projectId,
          originalIntent: "Must not adopt a damaged root",
          baseCommit: project.headCommit,
          contractIds: [],
          dependencyEdges: [],
          collisionIds: [],
          resolutionIds: [],
          state: "running",
          attentionReason: null,
          failure: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          startedAt: timestamp,
          completedAt: null,
        });
      });
      const service = new ShepherdService({
        store,
        managedRoot,
        verifier: { verify: async () => { throw new Error("not used"); } },
      });

      await expect(service.initialize()).rejects.toThrow(
        fault === "missing" ? "sentinel is missing" : "sentinel is malformed",
      );
      await expect(
        import("node:fs/promises").then(({ readFile }) => readFile(marker, "utf8")),
      ).resolves.toBe("preserve me\n");
      expect(store.snapshot().shepherd.missions[0]?.state).toBe("running");
    },
  );

  it("does not adopt a non-empty unsentinelled root on an empty first run", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "root-adoption-"),
    );
    roots.push(temporaryRoot);
    const managedRoot = path.join(temporaryRoot, "managed");
    await mkdir(managedRoot);
    const marker = path.join(managedRoot, "must-survive.txt");
    await writeFile(marker, "unowned\n");
    const store = new JsonStore(path.join(temporaryRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot,
      verifier: { verify: async () => { throw new Error("not used"); } },
    });

    await expect(service.initialize()).rejects.toThrow(
      "unknown managed-root entry",
    );
    await expect(
      import("node:fs/promises").then(({ readFile }) => readFile(marker, "utf8")),
    ).resolves.toBe("unowned\n");
  });

  it("rejects an empty database when managed project artifacts already exist", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "missing-db-"),
    );
    roots.push(temporaryRoot);
    const managedRoot = path.join(temporaryRoot, "managed");
    const project = await initializeAuthDemoProject({ managedRoot });
    await writeFile(path.join(project.repositoryPath, "external-move.txt"), "moved\n");
    await runFixtureGit(project.repositoryPath, ["add", "--", "external-move.txt"]);
    await runFixtureGit(project.repositoryPath, [
      "-c",
      "user.name=External",
      "-c",
      "user.email=external@example.invalid",
      "commit",
      "-m",
      "external move after database loss",
    ]);
    const store = new JsonStore(path.join(temporaryRoot, "replacement-state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot,
      verifier: { verify: async () => { throw new Error("not used"); } },
    });

    await expect(service.initialize()).rejects.toThrow(
      "persisted managed project artifacts",
    );
    await expect(service.startDeterministicDemo()).rejects.toThrow(
      "persisted managed project artifacts",
    );
    expect(store.snapshot().shepherd.projects).toEqual([]);
    await expect(
      import("node:fs/promises").then(({ access }) => access(project.repositoryPath)),
    ).resolves.toBeUndefined();
  });

  it("accepts a sentinel-only managed root with an empty database", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "sentinel-only-"),
    );
    roots.push(temporaryRoot);
    const managedRoot = path.join(temporaryRoot, "managed");
    await initializeShepherdManagedRoot(managedRoot);
    const store = new JsonStore(path.join(temporaryRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot,
      verifier: { verify: async () => { throw new Error("not used"); } },
    });
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(store.snapshot().shepherd.projects).toEqual([]);
  });

  it("rejects FIFO ownership sentinels without blocking startup", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "fifo-sentinel-"),
    );
    roots.push(temporaryRoot);
    const managedRoot = path.join(temporaryRoot, "managed");
    const project = await initializeAuthDemoProject({ managedRoot });
    const manager = new PlaneManager({
      repositoryPath: project.repositoryPath,
      planesRoot: project.planesRoot,
      protectedBranch: project.protectedBranch,
    });
    await manager.initialize();

    const planeSentinel = path.join(project.planesRoot, ".shepherd-plane-root.json");
    await rm(planeSentinel);
    await makeFifo(planeSentinel);
    const validatingManager = new PlaneManager({
      repositoryPath: project.repositoryPath,
      planesRoot: project.planesRoot,
      protectedBranch: project.protectedBranch,
      createRootSentinel: false,
    });
    await expect(validatingManager.initialize()).rejects.toThrow(
      "bounded regular file",
    );

    const rootSentinel = path.join(managedRoot, ".shepherd-demo-root.json");
    await rm(rootSentinel);
    await makeFifo(rootSentinel);
    await expect(initializeShepherdManagedRoot(managedRoot)).rejects.toThrow(
      "regular file",
    );
  });
});
