import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { JsonStore } from "../store.js";
import { WorkspaceManager } from "../workspace.js";
import {
  BEARER_TRANSPORT,
  COOKIE_TRANSPORT,
} from "./auth-fixture.js";
import { initializeAuthDemoProject } from "./demo-project.js";
import type { VerificationCheckResult, VerificationEvidence } from "./domain.js";
import {
  DeterministicFixtureExecutor,
  type ShepherdExecutionRequest,
  type ShepherdExecutionResult,
  type ShepherdExecutor,
} from "./executor.js";
import {
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_PROFILE_ID,
  ShepherdService,
  type ShepherdIndependentVerifier,
} from "./service.js";
import type { VerificationRequest } from "./verifier.js";

const repositoryTestRoot = fileURLToPath(
  new URL("../../../../.tmp/shepherd-tests/", import.meta.url),
);
const cleanupRoots: string[] = [];

async function makeCaseRoot(): Promise<string> {
  await mkdir(repositoryTestRoot, { recursive: true });
  const root = await mkdtemp(path.join(repositoryTestRoot, "service-"));
  cleanupRoots.push(root);
  return root;
}

afterEach(async () => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

function executeNodeScript(
  cwd: string,
  script: string,
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script],
      {
        cwd,
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: cwd,
          LANG: "C",
          LC_ALL: "C",
          CI: "1",
        },
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 262_144,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const candidate = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
        resolve({
          exitCode:
            candidate === null
              ? 0
              : typeof candidate.code === "number"
                ? candidate.code
                : 1,
          stdout,
          stderr,
          durationMs: Math.max(0, Date.now() - startedAt),
        });
      },
    );
  });
}

class HostTrustedFixtureVerifier implements ShepherdIndependentVerifier {
  private sequence = 0;

  async verify(request: VerificationRequest): Promise<VerificationEvidence> {
    const startedAt = new Date();
    const scripts: Record<string, string> = {
      [AUTH_FRONTEND_PROFILE_ID]: "checks/frontend.cjs",
      [AUTH_BACKEND_PROFILE_ID]: "checks/backend.cjs",
      [AUTH_PROJECT_PROFILE_ID]: "checks/project-security.cjs",
    };
    const checks: VerificationCheckResult[] = [];
    for (const check of request.checks) {
      const script = scripts[check.profileId];
      if (!script) {
        checks.push({
          id: check.id,
          name: check.name,
          profileId: check.profileId,
          mandatory: check.mandatory,
          status: "infrastructure_error",
          passed: false,
          exitCode: null,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: "Unknown trusted fixture profile",
        });
        continue;
      }
      const result = await executeNodeScript(request.planePath, script);
      const passed = result.exitCode === 0;
      checks.push({
        id: check.id,
        name: check.name,
        profileId: check.profileId,
        mandatory: check.mandatory,
        status: passed ? "passed" : "failed",
        passed,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        error: passed ? null : "Trusted fixture check exited non-zero",
      });
    }
    const completedAt = new Date();
    const mandatory = checks.filter((check) => check.mandatory);
    const mandatoryPassed = mandatory.filter((check) => check.passed).length;
    return {
      id: `host-evidence-${++this.sequence}`,
      targetType: request.targetType,
      targetId: request.targetId,
      runner: "independent",
      passed: mandatoryPassed === mandatory.length,
      checks,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      changedFiles: [...request.changedFiles],
      summary: `${mandatoryPassed}/${mandatory.length} mandatory checks passed`,
    };
  }
}

class ObservedConcurrentExecutor implements ShepherdExecutor {
  private readonly inner = new DeterministicFixtureExecutor();
  active = 0;
  maximumActive = 0;

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
      return await this.inner.run(request);
    } finally {
      this.active -= 1;
    }
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class UnauthorizedContractExecutor implements ShepherdExecutor {
  private readonly inner = new DeterministicFixtureExecutor();

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    const result = await this.inner.run(request);
    if (request.operation.kind === "frontend_contract") {
      await writeFile(
        path.join(request.workspacePath, "policy.json"),
        JSON.stringify({ allowClientReadableCredential: true }) + "\n",
        "utf8",
      );
    }
    return result;
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class UnauthorizedCandidateExecutor implements ShepherdExecutor {
  private readonly inner = new DeterministicFixtureExecutor();

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    const result = await this.inner.run(request);
    if (request.operation.kind === "resolution_candidate") {
      await writeFile(
        path.join(request.workspacePath, "policy.json"),
        JSON.stringify({ allowClientReadableCredential: true }) + "\n",
        "utf8",
      );
    }
    return result;
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class ForgedSemanticClaimExecutor implements ShepherdExecutor {
  private readonly inner = new DeterministicFixtureExecutor();

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    const result = await this.inner.run(request);
    if (request.operation.kind === "frontend_contract") {
      const manifestPath = path.join(
        request.workspacePath,
        ".shepherd",
        "result.json",
      );
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        semanticClaims: Array<{ value: string }>;
      };
      const claim = manifest.semanticClaims[0];
      if (!claim) throw new Error("Fixture manifest claim is missing");
      claim.value = COOKIE_TRANSPORT;
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    }
    return result;
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class CanaryFailureExecutor implements ShepherdExecutor {
  constructor(
    private readonly canary: string,
    private readonly plantedPath: string,
  ) {}

  async run(): Promise<ShepherdExecutionResult> {
    throw new Error(`executor leaked ${this.canary} from ${this.plantedPath}`);
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

async function waitForTerminalMission(
  service: ShepherdService,
  missionId: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = service.missionDetail(missionId)?.mission.state;
    if (state === "completed") return;
    if (state === "failed" || state === "attention_required" || state === "cancelled") {
      throw new Error(`Background Mission ended in ${state}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Background Mission did not complete before the test deadline");
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: "/nonexistent",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          LANG: "C",
          LC_ALL: "C",
        },
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 262_144,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      },
    );
  });
}

describe("Shepherd deterministic walking skeleton", () => {
  it("runs in the background through real no-conflict Planes and promotes the evidence-derived winner", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const executor = new ObservedConcurrentExecutor();
    const agentWorkspaceRoot = path.join(caseRoot, "agent-workspaces");
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot,
      verifier: new HostTrustedFixtureVerifier(),
      executor,
    });

    const { missionId } = await service.startDeterministicDemo();
    expect(service.missionDetail(missionId)?.mission.state).not.toBe("completed");
    await waitForTerminalMission(service, missionId);

    const detail = service.missionDetail(missionId);
    expect(detail).not.toBeNull();
    if (!detail) throw new Error("Mission detail was not persisted");
    expect(detail.mission).toMatchObject({
      state: "completed",
      collisionIds: [expect.any(String)],
    });
    expect(detail.project.activeMissionId).toBeNull();
    expect(detail.agents).toHaveLength(2);
    for (const agent of detail.agents) {
      expect(() => z.string().uuid().parse(agent.id)).not.toThrow();
      expect(agent.workspacePath.startsWith(agentWorkspaceRoot + path.sep)).toBe(true);
      expect(agent.workspacePath).not.toBe(detail.project.repositoryPath);
      expect(
        detail.planes.some((plane) => plane.worktreePath === agent.workspacePath),
      ).toBe(false);
    }
    expect(detail.contracts).toHaveLength(2);
    expect(detail.contracts.every((contract) => contract.state === "verified")).toBe(true);
    expect(detail.contracts.every((contract) => contract.manifest !== null)).toBe(true);
    expect(detail.claims.map((claim) => claim.value).sort()).toEqual(
      [BEARER_TRANSPORT, COOKIE_TRANSPORT].sort(),
    );
    expect(detail.planes.filter((plane) => plane.kind === "contract")).toHaveLength(2);
    expect(detail.planes.filter((plane) => plane.kind === "integration")).toHaveLength(1);
    expect(detail.planes.filter((plane) => plane.kind === "resolution")).toHaveLength(2);
    const integration = detail.planes.find((plane) => plane.kind === "integration");
    const resolutionPlanes = detail.planes.filter(
      (plane) => plane.kind === "resolution",
    );
    expect(integration?.changedFiles.sort()).toEqual(
      ["src/backend/auth.json", "src/frontend/auth.json"].sort(),
    );
    expect(
      resolutionPlanes.every((plane) => plane.baseCommit === integration?.headCommit),
    ).toBe(true);
    expect(detail.collisions).toHaveLength(1);
    expect(detail.collisions[0]).toMatchObject({
      key: "auth.transport",
      state: "resolved",
      detectionMechanism: "deterministic",
    });
    expect(detail.candidates).toHaveLength(2);
    const selected = detail.candidates.find(
      (candidate) => candidate.selectionState === "selected",
    );
    const rejected = detail.candidates.find(
      (candidate) => candidate.selectionState === "rejected",
    );
    expect(selected).toMatchObject({
      targetValue: COOKIE_TRANSPORT,
      executionState: "passed",
      promotionState: "promoted",
    });
    expect(rejected).toMatchObject({
      targetValue: BEARER_TRANSPORT,
      executionState: "failed",
      promotionState: "not_started",
    });
    expect(executor.maximumActive).toBeGreaterThanOrEqual(2);
    expect(detail.events.map((item) => item.sequence)).toEqual(
      [...detail.events.map((item) => item.sequence)].sort((left, right) => left - right),
    );
    expect(detail.events.some((item) => item.type === "collision_detected")).toBe(true);
    expect(detail.events.some((item) => item.type === "promotion_completed")).toBe(true);
    expect(service.eventsAfter(0, 500)).toHaveLength(detail.events.length);

    for (const plane of detail.planes.filter((item) => item.kind === "contract")) {
      await expect(
        access(path.join(plane.worktreePath, ".shepherd", "result.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }
    const tracked = await gitOutput(detail.project.repositoryPath, ["ls-files"]);
    expect(tracked).not.toContain(".shepherd");
    expect(await gitOutput(detail.project.repositoryPath, ["rev-parse", "HEAD"]))
      .toBe(detail.project.protectedHeadCommit);
    expect(detail.project.protectedHeadCommit).toBe(selected?.planeId
      ? detail.planes.find((plane) => plane.id === selected.planeId)?.headCommit
      : null);
    const frontend = JSON.parse(
      await readFile(
        path.join(detail.project.repositoryPath, "src/frontend/auth.json"),
        "utf8",
      ),
    ) as { transport: string; clientReadableCredential: boolean };
    const backend = JSON.parse(
      await readFile(
        path.join(detail.project.repositoryPath, "src/backend/auth.json"),
        "utf8",
      ),
    ) as { transport: string; clientReadableCredential: boolean };
    expect(frontend).toEqual({
      transport: COOKIE_TRANSPORT,
      clientReadableCredential: false,
    });
    expect(backend).toEqual(frontend);

    const protectedHeadBeforeWorkspaceMutation = await gitOutput(
      detail.project.repositoryPath,
      ["rev-parse", "HEAD"],
    );
    const disposableAgent = detail.agents[0];
    if (!disposableAgent) throw new Error("No disposable demo Agent was persisted");
    await writeFile(
      path.join(disposableAgent.workspacePath, "untrusted-agent-output.txt"),
      "mutation confined to disposable workspace\n",
      "utf8",
    );
    const workspaces = new WorkspaceManager(agentWorkspaceRoot);
    await workspaces.initialize();
    const archived = await workspaces.archive(disposableAgent);
    expect(archived.startsWith(path.join(agentWorkspaceRoot, ".deleted") + path.sep))
      .toBe(true);
    expect(await gitOutput(detail.project.repositoryPath, ["rev-parse", "HEAD"]))
      .toBe(protectedHeadBeforeWorkspaceMutation);
    await service.initialize();
    await expect(access(disposableAgent.workspacePath)).resolves.toBeUndefined();
    expect(await gitOutput(detail.project.repositoryPath, ["rev-parse", "HEAD"]))
      .toBe(protectedHeadBeforeWorkspaceMutation);
  }, 30_000);

  it("flips the selected strategy when the trusted project invariant flips", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
    });

    const result = await service.runDeterministicDemo({
      allowClientReadableCredential: true,
    });

    expect(result.mission.state).toBe("completed");
    expect(result.selectedCandidate).toMatchObject({
      targetValue: BEARER_TRANSPORT,
      executionState: "passed",
      selectionState: "selected",
      promotionState: "promoted",
    });
    const rejected = result.candidates.find(
      (candidate) => candidate.selectionState === "rejected",
    );
    expect(rejected).toMatchObject({
      targetValue: COOKIE_TRANSPORT,
      executionState: "failed",
    });
    expect(result.promotedHead).toBe(result.selectedCandidate.planeId
      ? service
          .missionDetail(result.mission.id)
          ?.planes.find((plane) => plane.id === result.selectedCandidate.planeId)
          ?.headCommit
      : null);
  });

  it("refuses a hostile symlink before any fixture or metadata write", async () => {
    const caseRoot = await makeCaseRoot();
    const managedRoot = path.join(caseRoot, "managed");
    const outside = path.join(caseRoot, "outside");
    await mkdir(managedRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(managedRoot, "repositories"), "dir");

    await expect(
      initializeAuthDemoProject({ managedRoot }),
    ).rejects.toThrow("cannot be a symlink");
    expect(await readFile(path.join(managedRoot, ".shepherd-demo-root.json"), "utf8"))
      .toContain("shepherd-managed-demo-root");
    await expect(access(path.join(outside, "auth-demo"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(path.join(managedRoot, "projects"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("persists authority_denied and never touches the protected branch for an out-of-scope Contract diff", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new UnauthorizedContractExecutor(),
    });

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "Scoped authority denied contract changes",
    );
    const state = service.state();
    const mission = state.missions.at(-1);
    expect(mission).toMatchObject({ state: "failed" });
    if (!mission) throw new Error("Failed Mission was not persisted");
    const detail = service.missionDetail(mission.id);
    const denied = detail?.contracts.find(
      (contract) => contract.state === "authority_denied",
    );
    expect(denied).toMatchObject({
      failure: { code: "unauthorized_file_change" },
    });
    expect(detail?.events.some((item) => item.type === "authority_denied")).toBe(true);
    expect(detail?.planes.some((plane) => plane.kind === "integration")).toBe(false);
    expect(await gitOutput(mission ? detail?.project.repositoryPath ?? "" : "", [
      "rev-parse",
      "HEAD",
    ])).toBe(mission.baseCommit);
    expect(detail?.project.protectedHeadCommit).toBe(mission.baseCommit);
  });

  it("keeps all-candidate authority failures in attention_required without promotion", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new UnauthorizedCandidateExecutor(),
    });

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "Resolution requires attention: all_candidates_failed",
    );
    const mission = service.state().missions.at(-1);
    expect(mission).toMatchObject({
      state: "attention_required",
      attentionReason: "all_candidates_failed",
      failure: null,
    });
    if (!mission) throw new Error("Attention Mission was not persisted");
    const detail = service.missionDetail(mission.id);
    expect(detail?.candidates).toHaveLength(2);
    expect(
      detail?.candidates.every(
        (candidate) =>
          candidate.executionState === "failed" &&
          candidate.failure?.code === "unauthorized_file_change",
      ),
    ).toBe(true);
    expect(detail?.events.some((item) => item.type === "promotion_started")).toBe(false);
    expect(detail?.project.protectedHeadCommit).toBe(mission.baseCommit);
    expect(await gitOutput(detail?.project.repositoryPath ?? "", ["rev-parse", "HEAD"]))
      .toBe(mission.baseCommit);
  });

  it("rejects an Agent-declared semantic value that trusted verification does not corroborate", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new ForgedSemanticClaimExecutor(),
    });

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "semantic claim was not corroborated",
    );
    const mission = service.state().missions.at(-1);
    const detail = service.missionDetail(mission?.id ?? "missing");
    expect(mission?.state).toBe("failed");
    expect(
      detail?.contracts.some(
        (contract) =>
          contract.state === "claim_rejected" &&
          contract.failure?.code === "invalid_semantic_evidence",
      ),
    ).toBe(true);
    expect(detail?.collisions).toHaveLength(0);
    expect(detail?.events.some((event) => event.type === "claim_rejected")).toBe(
      true,
    );
    expect(detail?.events.some((event) => event.type === "promotion_started")).toBe(
      false,
    );
    expect(detail?.project.protectedHeadCommit).toBe(mission?.baseCommit);
  });

  it("redacts planted secrets and absolute paths from every persisted failure surface", async () => {
    const caseRoot = await makeCaseRoot();
    const canary = "ARK-CANARY-super-secret-998877";
    const plantedPath = path.join(caseRoot, "managed", "repositories", "auth-demo");
    const storePath = path.join(caseRoot, "state.json");
    const store = new JsonStore(storePath);
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new CanaryFailureExecutor(canary, plantedPath),
      sensitiveValues: [canary],
    });

    await expect(service.runDeterministicDemo()).rejects.toThrow(canary);
    const persisted = await readFile(storePath, "utf8");
    expect(persisted).not.toContain(canary);
    const snapshot = store.snapshot();
    const failureSurfaces = JSON.stringify({
      agentErrors: snapshot.agents.map((agent) => agent.lastError),
      missionFailures: snapshot.shepherd.missions.map((mission) => mission.failure),
      contractFailures: snapshot.shepherd.contracts.map((contract) => contract.failure),
      planeErrors: snapshot.shepherd.planes.map((plane) => plane.error),
      candidateFailures: snapshot.shepherd.candidates.map(
        (candidate) => candidate.failure,
      ),
      events: snapshot.shepherd.events.map((item) => ({
        summary: item.summary,
        details: item.details,
      })),
    });
    expect(failureSurfaces).not.toContain(canary);
    expect(failureSurfaces).not.toContain(plantedPath);
    expect(failureSurfaces).toContain("[REDACTED]");
    expect(failureSurfaces).toContain("[PATH]");
    const mission = service.state().missions.at(-1);
    expect(mission?.state).toBe("failed");
    expect(
      service
        .missionDetail(mission?.id ?? "missing")
        ?.contracts.every((contract) => contract.state === "execution_failed"),
    ).toBe(true);
  });
});
