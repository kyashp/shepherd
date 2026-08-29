import { execFile } from "node:child_process";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { JsonStore } from "../store.js";
import { WorkspaceManager } from "../workspace.js";
import {
  BEARER_TRANSPORT,
  COOKIE_TRANSPORT,
} from "./auth-fixture.js";
import {
  initializeAuthDemoProject,
} from "./demo-project.js";
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
const backgroundTestMissions: Array<{
  service: ShepherdService;
  missionId: string;
}> = [];
const serviceCaseSentinel = ".service-test-case";
const expectedServiceCaseSentinel = "shepherd service test fixture\n";

async function makeCaseRoot(): Promise<string> {
  await mkdir(repositoryTestRoot, { recursive: true });
  const root = await mkdtemp(path.join(repositoryTestRoot, "service-"));
  await writeFile(path.join(root, serviceCaseSentinel), expectedServiceCaseSentinel, {
    encoding: "utf8",
    mode: 0o600,
  });
  cleanupRoots.push(root);
  return root;
}

async function removeServiceCaseRoot(root: string): Promise<void> {
  let rootStat: Awaited<ReturnType<typeof lstat>>;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Service test cleanup target must be a real directory");
  }
  const canonicalTestRoot = await realpath(repositoryTestRoot);
  const canonicalRoot = await realpath(root);
  if (
    path.dirname(canonicalRoot) !== canonicalTestRoot ||
    !path.basename(canonicalRoot).startsWith("service-")
  ) {
    throw new Error("Service test cleanup escaped its allocated fixture root");
  }
  const sentinelPath = path.join(canonicalRoot, serviceCaseSentinel);
  const sentinelStat = await lstat(sentinelPath);
  if (sentinelStat.isSymbolicLink() || !sentinelStat.isFile()) {
    throw new Error("Service test cleanup sentinel is not a regular file");
  }
  if ((await readFile(sentinelPath, "utf8")) !== expectedServiceCaseSentinel) {
    throw new Error("Service test cleanup sentinel mismatch");
  }

  const makeDeletable = async (directory: string): Promise<void> => {
    await chmod(directory, 0o700);
    for (const name of await readdir(directory)) {
      const entry = path.join(directory, name);
      let entryStat: Awaited<ReturnType<typeof lstat>>;
      try {
        entryStat = await lstat(entry);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
        const canonicalEntry = await realpath(entry);
        if (
          canonicalEntry !== entry ||
          !canonicalEntry.startsWith(canonicalRoot + path.sep)
        ) {
          throw new Error("Service test cleanup encountered an escaping directory");
        }
        await makeDeletable(entry);
      } else if (!entryStat.isSymbolicLink()) {
        await chmod(entry, 0o600);
      }
    }
  };

  await makeDeletable(canonicalRoot);
  await rm(canonicalRoot, { recursive: true, force: false });
}

async function startTrackedTestMission(
  service: ShepherdService,
): Promise<{ missionId: string }> {
  const started = await service.startDeterministicDemo();
  backgroundTestMissions.push({ service, missionId: started.missionId });
  return started;
}

async function quiesceTrackedTestMissions(): Promise<void> {
  while (true) {
    const tracked = backgroundTestMissions.at(-1);
    if (!tracked) return;
    const state = tracked.service.missionDetail(tracked.missionId)?.mission.state;
    const terminal =
      state === "completed" ||
      state === "failed" ||
      state === "cancelled";
    if (!terminal) {
      await tracked.service.cancelMission(tracked.missionId);
    }
    backgroundTestMissions.pop();
  }
}

afterEach(async () => {
  await quiesceTrackedTestMissions();
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) await removeServiceCaseRoot(root);
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
  readonly kind = "deterministic_fixture" as const;
  private readonly inner = new DeterministicFixtureExecutor();
  private readonly firstPairArrived: Promise<void>;
  private releaseFirstPair!: () => void;
  private arrivals = 0;
  active = 0;
  maximumActive = 0;

  constructor() {
    this.firstPairArrived = new Promise<void>((resolve) => {
      this.releaseFirstPair = resolve;
    });
  }

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    this.active += 1;
    this.arrivals += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    if (this.arrivals === 2) this.releaseFirstPair();
    try {
      await this.firstPairArrived;
      return await this.inner.run(request);
    } finally {
      this.active -= 1;
    }
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class SessionTrackingExecutor implements ShepherdExecutor {
  readonly kind = "codex_ephemeral" as const;
  private readonly inner = new DeterministicFixtureExecutor();
  readonly requests: ShepherdExecutionRequest[] = [];

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    this.requests.push(structuredClone(request));
    const result = await this.inner.run(request);
    return {
      ...result,
      runtimeSessionId: `private-thread-${request.executionId}`,
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class FailingPreflightExecutor implements ShepherdExecutor {
  readonly kind = "codex_ephemeral" as const;
  private readonly inner = new DeterministicFixtureExecutor();
  preflightCalls = 0;

  async preflight(): Promise<void> {
    this.preflightCalls += 1;
    throw new Error("synthetic Runtime preflight denial");
  }

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    return await this.inner.run(request);
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class UnauthorizedContractExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
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
  readonly kind = "deterministic_fixture" as const;
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
  readonly kind = "deterministic_fixture" as const;
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

class TargetSubstitutionExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
  private readonly inner = new DeterministicFixtureExecutor();

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    const result = await this.inner.run(request);
    if (
      request.operation.kind === "resolution_candidate" &&
      request.operation.targetTransport === BEARER_TRANSPORT
    ) {
      const substituted = JSON.stringify(
        {
          transport: COOKIE_TRANSPORT,
          clientReadableCredential: false,
        },
        null,
        2,
      ) + "\n";
      await Promise.all([
        writeFile(
          path.join(request.workspacePath, "src/frontend/auth.json"),
          substituted,
          "utf8",
        ),
        writeFile(
          path.join(request.workspacePath, "src/backend/auth.json"),
          substituted,
          "utf8",
        ),
      ]);
    }
    return result;
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class CanaryFailureExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
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

class FailCookieCandidateOnceExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
  private readonly inner = new DeterministicFixtureExecutor();
  failed = false;

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    if (
      request.operation.kind === "resolution_candidate" &&
      request.operation.targetTransport === COOKIE_TRANSPORT &&
      !this.failed
    ) {
      this.failed = true;
      throw new Error("Synthetic transient Agent Runtime transport failure");
    }
    return await this.inner.run(request);
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class BlockingExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
  readonly executionIds: string[] = [];
  readonly cancelledIds: string[] = [];
  private readonly rejectors = new Map<string, (error: Error) => void>();

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    this.executionIds.push(request.executionId);
    return await new Promise<ShepherdExecutionResult>((_resolve, reject) => {
      this.rejectors.set(request.executionId, reject);
    });
  }

  async cancel(executionId: string): Promise<boolean> {
    this.cancelledIds.push(executionId);
    const reject = this.rejectors.get(executionId);
    if (!reject) return false;
    this.rejectors.delete(executionId);
    reject(new Error("Synthetic execution cancellation"));
    return true;
  }
}

class BlockingVerifier implements ShepherdIndependentVerifier {
  readonly targetIds: string[] = [];
  readonly cancelledIds: string[] = [];
  private readonly rejectors = new Map<string, (error: Error) => void>();

  async verify(request: VerificationRequest): Promise<VerificationEvidence> {
    this.targetIds.push(request.targetId);
    return await new Promise<VerificationEvidence>((_resolve, reject) => {
      this.rejectors.set(request.targetId, reject);
    });
  }

  async cancel(targetId: string): Promise<boolean> {
    this.cancelledIds.push(targetId);
    const reject = this.rejectors.get(targetId);
    if (!reject) return false;
    this.rejectors.delete(targetId);
    reject(new Error("Synthetic verification cancellation"));
    return true;
  }
}

class PromotionThrowingVerifier extends HostTrustedFixtureVerifier {
  override async verify(
    request: VerificationRequest,
  ): Promise<VerificationEvidence> {
    if (request.targetType === "promotion") {
      throw new Error("Synthetic promotion verifier infrastructure failure");
    }
    return await super.verify(request);
  }
}

class BlockingPromotionVerifier extends HostTrustedFixtureVerifier {
  readonly cancelledIds: string[] = [];
  readonly entered: Promise<void>;
  private markEntered!: () => void;
  private readonly released: Promise<void>;
  private releaseVerification!: () => void;
  private isReleased = false;

  constructor() {
    super();
    this.entered = new Promise<void>((resolve) => {
      this.markEntered = resolve;
    });
    this.released = new Promise<void>((resolve) => {
      this.releaseVerification = resolve;
    });
  }

  override async verify(
    request: VerificationRequest,
  ): Promise<VerificationEvidence> {
    if (request.targetType === "promotion") {
      this.markEntered();
      await this.released;
    }
    return await super.verify(request);
  }

  async cancel(targetId: string): Promise<boolean> {
    this.cancelledIds.push(targetId);
    this.release();
    return true;
  }

  release(): void {
    if (this.isReleased) return;
    this.isReleased = true;
    this.releaseVerification();
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

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Background Mission did not quiesce before teardown")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
  it("cleans a case root containing a read-only trusted verification snapshot", async () => {
    const caseRoot = await makeCaseRoot();
    const snapshotPath = path.join(
      caseRoot,
      "managed",
      "planes",
      ".trusted-verification",
      "verify-interrupted",
    );
    const snapshotFile = path.join(snapshotPath, "candidate.ts");
    await mkdir(snapshotPath, { recursive: true });
    await writeFile(snapshotFile, "candidate\n", "utf8");
    await chmod(snapshotFile, 0o400);
    await chmod(snapshotPath, 0o500);

    await expect(removeServiceCaseRoot(caseRoot)).resolves.toBeUndefined();
  });

  it("refuses to clean a root outside its allocated test fixture", async () => {
    const externalRoot = await mkdtemp(path.join(repositoryTestRoot, "external-"));
    await writeFile(path.join(externalRoot, "preserve.txt"), "preserve\n", "utf8");
    try {
      await expect(removeServiceCaseRoot(externalRoot)).rejects.toThrow();
      await expect(readFile(path.join(externalRoot, "preserve.txt"), "utf8")).resolves.toBe(
        "preserve\n",
      );
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  });

  it("cleans an allocated fixture without mutating a linked external target", async () => {
    const caseRoot = await makeCaseRoot();
    const externalRoot = await mkdtemp(path.join(repositoryTestRoot, "external-"));
    const marker = path.join(externalRoot, "marker.txt");
    const linkedTarget = path.join(caseRoot, "managed", "planes", "linked-external");
    await writeFile(marker, "must survive\n", "utf8");
    await chmod(externalRoot, 0o700);
    try {
      await mkdir(path.dirname(linkedTarget), { recursive: true });
      await symlink(externalRoot, linkedTarget);

      await removeServiceCaseRoot(caseRoot);

      await expect(readFile(marker, "utf8")).resolves.toBe("must survive\n");
      expect((await stat(externalRoot)).mode & 0o777).toBe(0o700);
    } finally {
      await chmod(externalRoot, 0o700);
      await rm(externalRoot, { recursive: true, force: true });
    }
  });

  it("fails startup closed when the live Runtime preflight is denied", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const executor = new FailingPreflightExecutor();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor,
    });

    await expect(service.initialize()).rejects.toThrow(
      "synthetic Runtime preflight denial",
    );
    await expect(service.initialize()).rejects.toThrow(
      "synthetic Runtime preflight denial",
    );
    expect(executor.preflightCalls).toBe(1);
    expect(store.snapshot().shepherd.projects).toEqual([]);
  });

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

    const { missionId } = await startTrackedTestMission(service);
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

    await gitOutput(detail.project.repositoryPath, ["switch", "-c", "unexpected"]);
    const restarted = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot,
      verifier: new HostTrustedFixtureVerifier(),
      executor,
    });
    await expect(restarted.initialize()).rejects.toThrow(
      "startup artifact reconciliation failed",
    );
    const afterMismatch = store.snapshot();
    expect(afterMismatch.shepherd.missions.find((mission) => mission.id === missionId)?.state)
      .toBe("completed");
    expect(afterMismatch.shepherd.projects[0]?.protectedHeadCommit)
      .toBe(protectedHeadBeforeWorkspaceMutation);
    expect(afterMismatch.shepherd.events).toContainEqual(
      expect.objectContaining({
        type: "execution_interrupted",
        missionId,
        details: expect.objectContaining({
          classification: "protected_worktree_mismatch",
          expectedHead: protectedHeadBeforeWorkspaceMutation,
        }),
      }),
    );
  }, 30_000);

  it("builds bounded prompts and persists only unique live-session fingerprints", async () => {
    const caseRoot = await makeCaseRoot();
    const databasePath = path.join(caseRoot, "state.json");
    const store = new JsonStore(databasePath);
    await store.initialize();
    const executor = new SessionTrackingExecutor();
    const canary = "ARK_PROMPT_CANARY_91c0f4";
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor,
      sensitiveValues: [canary],
    });

    const result = await service.runDeterministicDemo();
    const detail = service.missionDetail(result.mission.id);
    if (!detail) throw new Error("Live-session Mission detail was not persisted");

    expect(executor.requests).toHaveLength(4);
    expect(new Set(executor.requests.map((request) => request.executionId)).size).toBe(4);
    expect(
      executor.requests.every(
        (request) =>
          request.prompt?.startsWith("SHEPHERD_EXECUTION_ENVELOPE_V1\n") &&
          !request.prompt.includes(canary),
      ),
    ).toBe(true);
    expect(
      executor.requests.filter((request) => request.operation.kind !== "resolution_candidate")
        .every((request) => request.prompt?.includes('"required": true')),
    ).toBe(true);
    expect(
      executor.requests.filter((request) => request.operation.kind === "resolution_candidate")
        .every(
          (request) =>
            request.prompt?.includes('"forbidden": true') &&
            !request.prompt.includes("ARK_PROMPT_CANARY"),
        ),
    ).toBe(true);

    const executedPlanes = detail.planes.filter(
      (plane) => plane.kind === "contract" || plane.kind === "resolution",
    );
    const fingerprints = executedPlanes.map(
      (plane) => plane.runtimeSessionFingerprint,
    );
    expect(fingerprints).toHaveLength(4);
    expect(fingerprints.every((value) => /^[a-f0-9]{64}$/u.test(value ?? "")))
      .toBe(true);
    expect(new Set(fingerprints).size).toBe(4);
    expect(
      detail.planes.find((plane) => plane.kind === "integration")
        ?.runtimeSessionFingerprint,
    ).toBeNull();

    const persisted = await readFile(databasePath, "utf8");
    for (const request of executor.requests) {
      expect(persisted).not.toContain(`private-thread-${request.executionId}`);
      expect(persisted).not.toContain(request.prompt ?? "missing-prompt");
    }
    expect(persisted).not.toContain(canary);
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
  }, 30_000);

  it("persists a non-green compensated state when the protected head moves after the durable marker", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const managedRoot = path.join(caseRoot, "managed");
    const repositoryPath = path.join(managedRoot, "repositories", "auth-demo");
    let expectedTrustedHead: string | null = null;
    const service = new ShepherdService({
      store,
      managedRoot,
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new ObservedConcurrentExecutor(),
      faultCheckpoint: async (checkpoint) => {
        if (checkpoint !== "promotion_ready_for_cas") return;
        expectedTrustedHead = await gitOutput(repositoryPath, ["rev-parse", "main"]);
        await writeFile(path.join(repositoryPath, "external-move.txt"), "external\n");
        await gitOutput(repositoryPath, ["add", "--", "external-move.txt"]);
        await gitOutput(repositoryPath, [
          "-c",
          "user.name=External",
          "-c",
          "user.email=external@example.invalid",
          "commit",
          "-m",
          "external protected move",
        ]);
      },
    });

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "Promotion failed: protected_branch_moved",
    );
    const missionId = store.snapshot().shepherd.missions[0]?.id;
    if (!missionId) throw new Error("Compensated Mission was not persisted");
    const detail = service.missionDetail(missionId);
    expect(detail?.mission.state).toBe("attention_required");
    expect(detail?.project.activeMissionId).toBe(missionId);
    expect(detail?.project.protectedHeadCommit).toBe(expectedTrustedHead);
    const externallyMovedHead = await gitOutput(repositoryPath, ["rev-parse", "main"]);
    expect(externallyMovedHead).not.toBe(expectedTrustedHead);
    expect(
      detail?.candidates.find((candidate) => candidate.selectionState === "selected"),
    ).toMatchObject({
      promotionState: "failed",
      promotionEvidence: { passed: true, targetType: "promotion" },
      failure: { stage: "promotion" },
    });
    expect(detail?.collisions[0]?.state).toBe("attention_required");
    const missionCount = store.snapshot().shepherd.missions.length;
    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "already has a non-terminal Mission",
    );
    expect(store.snapshot().shepherd.missions).toHaveLength(missionCount);
    expect(service.missionDetail(missionId)?.project.protectedHeadCommit).toBe(
      expectedTrustedHead,
    );
    expect(await gitOutput(repositoryPath, ["rev-parse", "main"])).toBe(
      externallyMovedHead,
    );
  }, 30_000);

  it("refuses a hostile symlink before any fixture or metadata write", async () => {
    const caseRoot = await makeCaseRoot();
    const managedRoot = path.join(caseRoot, "managed");
    const outside = path.join(caseRoot, "outside");
    await mkdir(managedRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(managedRoot, "repositories"), "dir");

    await expect(
      initializeAuthDemoProject({ managedRoot }),
    ).rejects.toThrow("Refusing to adopt a non-empty unsentinelled managed root");
    await expect(
      access(path.join(managedRoot, ".shepherd-demo-root.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(path.join(outside, "auth-demo"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(path.join(managedRoot, "projects"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects a second live Mission when the protected head moved externally", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new ObservedConcurrentExecutor(),
    });
    const first = await service.runDeterministicDemo();
    const beforeExternalMove = store.snapshot();
    const trustedHead = first.mission.projectId
      ? beforeExternalMove.shepherd.projects.find(
          (project) => project.id === first.mission.projectId,
        )!.protectedHeadCommit
      : "";
    const repositoryPath = beforeExternalMove.shepherd.projects[0]!.repositoryPath;
    await writeFile(path.join(repositoryPath, "external-live-move.txt"), "external\n");
    await gitOutput(repositoryPath, ["add", "--", "external-live-move.txt"]);
    await gitOutput(repositoryPath, [
      "-c",
      "user.name=External",
      "-c",
      "user.email=external@example.invalid",
      "commit",
      "-m",
      "external live protected move",
    ]);
    const externalHead = await gitOutput(repositoryPath, ["rev-parse", "main"]);
    expect(externalHead).not.toBe(trustedHead);
    const immutableCounts = {
      missions: beforeExternalMove.shepherd.missions.length,
      agents: beforeExternalMove.agents.length,
      planes: beforeExternalMove.shepherd.planes.length,
      projects: beforeExternalMove.shepherd.projects.length,
    };

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "Protected checkout differs from the durable trusted head",
    );
    const afterRejected = store.snapshot();
    expect(afterRejected.shepherd.missions).toHaveLength(immutableCounts.missions);
    expect(afterRejected.agents).toHaveLength(immutableCounts.agents);
    expect(afterRejected.shepherd.planes).toHaveLength(immutableCounts.planes);
    expect(afterRejected.shepherd.projects).toHaveLength(immutableCounts.projects);
    expect(afterRejected.shepherd.projects[0]?.protectedHeadCommit).toBe(trustedHead);
    expect(await gitOutput(repositoryPath, ["rev-parse", "main"])).toBe(externalHead);
  }, 30_000);

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
      failure: {
        code: "all_candidates_failed",
        stage: "resolution_selection",
        retryable: false,
      },
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
  }, 15_000);

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
  }, 15_000);

  it("rejects a candidate that substitutes a different target even when every independent check passes", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new TargetSubstitutionExecutor(),
    });

    const result = await service.runDeterministicDemo();
    expect(result.mission.state).toBe("completed");
    const detail = service.missionDetail(result.mission.id);
    const substituted = detail?.candidates.find(
      (candidate) => candidate.targetValue === BEARER_TRANSPORT,
    );
    expect(substituted).toMatchObject({
      executionState: "failed",
      selectionState: "rejected",
      failure: {
        code: "invalid_semantic_evidence",
        stage: "candidate_target_corroboration",
      },
      verificationEvidence: { passed: true },
    });
    expect(
      detail?.events.some(
        (event) =>
          event.type === "candidate_failed" &&
          event.candidateId === substituted?.id &&
          event.details?.targetCorroborated === false,
      ),
    ).toBe(true);
    expect(result.selectedCandidate.targetValue).toBe(COOKIE_TRANSPORT);
    expect(detail?.mission.attentionReason).toBeNull();
  }, 15_000);

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

  it("archives one transient candidate attempt and retries from the same integration commit", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const executor = new FailCookieCandidateOnceExecutor();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor,
    });

    const result = await service.runDeterministicDemo();
    expect(executor.failed).toBe(true);
    const retried = result.candidates.find(
      (candidate) => candidate.targetValue === COOKIE_TRANSPORT,
    );
    expect(retried).toMatchObject({
      retryCount: 1,
      executionState: "passed",
      promotionState: "promoted",
      previousAttempts: [
        {
          executionState: "failed",
          verificationEvidence: null,
          failure: { code: "agent_runtime_error", retryable: true },
        },
      ],
    });
    const detail = service.candidateDetail(retried?.id ?? "missing");
    expect(detail?.previousPlanes).toHaveLength(1);
    expect(detail?.previousPlanes[0]?.baseCommit).toBe(detail?.plane.baseCommit);
    expect(detail?.previousPlanes[0]?.id).toBe(
      retried?.previousAttempts?.[0]?.planeId,
    );
    expect(
      service
        .missionDetail(result.mission.id)
        ?.events.some((event) => event.type === "candidate_retried"),
    ).toBe(true);
  }, 30_000);

  it("persists cancellation before stopping exact executor identities", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const executor = new BlockingExecutor();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor,
    });

    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(() => expect(executor.executionIds).toHaveLength(2), {
      timeout: 10_000,
    });
    const cancelled = await service.cancelMission(missionId);
    expect(cancelled).toMatchObject({
      state: "cancelled",
      failure: { code: "cancelled", stage: "mission_cancellation" },
    });
    expect([...executor.cancelledIds].sort()).toEqual(
      [...executor.executionIds].sort(),
    );
    await vi.waitFor(
      () =>
        expect(service.missionDetail(missionId)?.contracts).toSatisfy(
          (contracts: Array<{ state: string }>) =>
            contracts.every((contract) => contract.state === "cancelled"),
        ),
      { timeout: 10_000 },
    );
    expect(
      service
        .missionDetail(missionId)
        ?.planes.every((plane) => plane.state === "interrupted"),
    ).toBe(true);
    expect(
      service
        .projectGroupMessages("auth-demo")
        .some((message) => message.content.startsWith("Mission cancelled")),
    ).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }, 30_000);

  it("cancels exact verifier targets and never overwrites durable cancellation", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const verifier = new BlockingVerifier();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
    });

    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(() => expect(verifier.targetIds).toHaveLength(2), {
      timeout: 10_000,
    });
    const expected = service
      .missionDetail(missionId)
      ?.contracts.map((contract) => contract.id)
      .sort();
    await service.cancelMission(missionId);
    expect([...verifier.cancelledIds].sort()).toEqual(expected);
    await vi.waitFor(
      () => expect(service.missionDetail(missionId)?.mission.state).toBe("cancelled"),
      { timeout: 10_000 },
    );
    expect(
      service
        .missionDetail(missionId)
        ?.contracts.every((contract) => contract.state === "cancelled"),
    ).toBe(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }, 30_000);

  it("pauses for manual confirmation, rejects failed selection, and emits durable lifecycle summaries", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const executor = new SessionTrackingExecutor();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor,
    });
    await service.initialize();
    expect(service.settings()).toMatchObject({
      mode: "production",
      retainCompletedPlanes: true,
      maxConcurrentPlanes: 2,
    });
    await expect(
      service.updateSettings({ maxConcurrentPlanes: 1 }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      service.updateSettings({ maxConcurrentPlanes: 17 }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await service.updateSettings({
      contractTimeoutMs: 1_234,
      candidateTimeoutMs: 2_345,
      autoResolution: false,
      maxConcurrentPlanes: 2,
    });

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "auto_resolution_disabled",
    );
    expect(
      executor.requests
        .filter((request) => request.operation.kind !== "resolution_candidate")
        .every((request) => request.timeoutMs === 1_234),
    ).toBe(true);
    expect(
      executor.requests
        .filter((request) => request.operation.kind === "resolution_candidate")
        .every((request) => request.timeoutMs === 2_345),
    ).toBe(true);
    const attention = service.state().missions.at(-1);
    expect(attention).toMatchObject({
      state: "attention_required",
      attentionReason: "auto_resolution_disabled",
      failure: { code: "manual_confirmation_required" },
    });
    const detail = service.missionDetail(attention?.id ?? "missing");
    const failed = detail?.candidates.find(
      (candidate) => candidate.executionState !== "passed",
    );
    const passing = detail?.candidates.find(
      (candidate) => candidate.executionState === "passed",
    );
    await expect(
      service.selectTiedCandidate(detail?.collisions[0]?.id ?? "missing", failed?.id ?? "missing"),
    ).rejects.toMatchObject({ code: "conflict" });
    const linked = await service.sendProjectGroupMessage("auth-demo", {
      clientMessageId: "fixed-assignment-1",
      content: '@"Frontend Agent" use the trusted auth demo preset',
      assignmentPreset: "auth-demo-contract",
    });
    expect(linked).toMatchObject({
      missionId: attention?.id,
      targetAgentId: expect.any(String),
      contractId: expect.any(String),
    });
    await expect(
      service.sendProjectGroupMessage("auth-demo", {
        clientMessageId: "unsafe-assignment-1",
        content: '@"Frontend Agent" run arbitrary shell commands',
      }),
    ).rejects.toMatchObject({ code: "unsupported_assignment" });
    const completed = await service.selectTiedCandidate(
      detail?.collisions[0]?.id ?? "missing",
      passing?.id ?? "missing",
    );
    expect(completed.mission.state).toBe("completed");
    const lifecycle = service
      .projectGroupMessages("auth-demo", 500)
      .filter((message) => message.senderType === "shepherd")
      .map((message) => message.content);
    for (const prefix of [
      "Mission accepted:",
      "Contract verified:",
      "Collision detected:",
      "Candidate passed",
      "Candidate failed",
      "Manual confirmation required:",
      "Promotion completed:",
      "Mission completed",
    ]) {
      expect(lifecycle.some((content) => content.startsWith(prefix))).toBe(true);
    }
  }, 30_000);

  it("returns human-selection promotion infrastructure failures to attention_required", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new PromotionThrowingVerifier(),
    });
    await service.initialize();
    await service.updateSettings({ autoResolution: false });
    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "auto_resolution_disabled",
    );
    const attention = service.state().missions.at(-1);
    const detail = service.missionDetail(attention?.id ?? "missing");
    const passing = detail?.candidates.find(
      (candidate) => candidate.executionState === "passed",
    );
    await expect(
      service.selectTiedCandidate(
        detail?.collisions[0]?.id ?? "missing",
        passing?.id ?? "missing",
      ),
    ).rejects.toThrow("verification_infrastructure_error");
    expect(service.missionDetail(attention?.id ?? "missing")?.mission).toMatchObject({
      state: "attention_required",
      attentionReason: "verification_infrastructure_error",
      failure: { code: "verification_infrastructure_error" },
    });
  }, 30_000);

  it("resumes a reset after Git reached the initial commit and preserves unrelated cursors", async () => {
    const caseRoot = await makeCaseRoot();
    const managedRoot = path.join(caseRoot, "managed");
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot,
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
    });
    const unrelated = await service.runDeterministicDemo({ projectId: "other-demo" });
    const target = await service.runDeterministicDemo();
    const before = store.snapshot();
    const unrelatedEvents = before.shepherd.events.filter(
      (event) => event.missionId === unrelated.mission.id,
    );
    const nextCursor = before.shepherd.nextEventSequence;

    const mutateFailure = vi
      .spyOn(store, "mutate")
      .mockRejectedValueOnce(new Error("Synthetic reset persistence crash"));
    await expect(service.resetDeterministicDemo()).rejects.toThrow(
      "Synthetic reset persistence crash",
    );
    mutateFailure.mockRestore();
    const repositoryPath = store
      .snapshot()
      .shepherd.projects.find((project) => project.id === "auth-demo")
      ?.repositoryPath;
    if (!repositoryPath) throw new Error("Auth demo repository disappeared");
    const initialCommit = (
      await gitOutput(repositoryPath, ["rev-list", "--max-parents=0", "main"])
    ).trim();
    expect(await gitOutput(repositoryPath, ["rev-parse", "HEAD"])).toBe(
      initialCommit,
    );
    expect(
      store.snapshot().shepherd.projects.find((project) => project.id === "auth-demo")
        ?.protectedHeadCommit,
    ).toBe(target.promotedHead);

    const reset = await service.resetDeterministicDemo();
    expect(reset.restoredHead).toBe(initialCommit);
    expect(service.missionDetail(target.mission.id)).toBeNull();
    expect(
      store.snapshot().shepherd.events.filter(
        (event) => event.missionId === unrelated.mission.id,
      ),
    ).toEqual(unrelatedEvents);
    expect(store.snapshot().shepherd.nextEventSequence).toBe(nextCursor);
    expect(service.eventsAfter(0, 500)).toEqual(
      store.snapshot().shepherd.events,
    );
  }, 45_000);

  it("rejects cancellation after the durable promoting marker wins the race", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    let releasePromotion!: () => void;
    let promotionReached!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releasePromotion = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      promotionReached = resolve;
    });
    let promotionReleased = false;
    const releaseBlockedPromotion = (): void => {
      if (promotionReleased) return;
      promotionReleased = true;
      releasePromotion();
    };
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      faultCheckpoint: async (checkpoint) => {
        if (checkpoint !== "promotion_ready_for_cas") return;
        promotionReached();
        await blocked;
      },
    });
    const { missionId } = await startTrackedTestMission(service);
    try {
      await reached;
      expect(
        service
          .missionDetail(missionId)
          ?.candidates.some((candidate) => candidate.promotionState === "promoting"),
      ).toBe(true);
      await expect(service.cancelMission(missionId)).rejects.toMatchObject({
        code: "conflict",
      });
    } finally {
      releaseBlockedPromotion();
      await waitForTerminalMission(service, missionId);
    }
    expect(service.missionDetail(missionId)?.mission.state).toBe("completed");
  }, 30_000);

  it("lets durable cancellation win while final promotion verification is reverifying", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const verifier = new BlockingPromotionVerifier();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
    });
    const { missionId } = await startTrackedTestMission(service);
    let cancellation: Promise<unknown> | undefined;
    try {
      await verifier.entered;
      const before = service.missionDetail(missionId);
      expect(
        before?.candidates.some(
          (candidate) => candidate.promotionState === "reverifying",
        ),
      ).toBe(true);
      const protectedHead = before?.project.protectedHeadCommit;
      const selectedId = before?.candidates.find(
        (candidate) => candidate.selectionState === "selected",
      )?.id;
      cancellation = service.cancelMission(missionId);
      await vi.waitFor(
        () => expect(service.missionDetail(missionId)?.mission.state).toBe("cancelled"),
        { timeout: 10_000 },
      );
      await cancellation;
      const after = service.missionDetail(missionId);
      expect(verifier.cancelledIds).toEqual([selectedId]);
      expect(after?.mission.state).toBe("cancelled");
      expect(after?.project.protectedHeadCommit).toBe(protectedHead);
      expect(await gitOutput(after?.project.repositoryPath ?? "", ["rev-parse", "HEAD"]))
        .toBe(protectedHead);
      expect(
        after?.events.some((event) => event.type === "promotion_completed"),
      ).toBe(false);
    } finally {
      cancellation ??= service.cancelMission(missionId);
      try {
        await cancellation;
      } finally {
        verifier.release();
      }
    }
  }, 30_000);

  it("releases a blocked promotion verifier before tracked fixture teardown", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const verifier = new BlockingPromotionVerifier();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
    });

    const { missionId } = await startTrackedTestMission(service);
    await verifier.entered;
    const quiescence = quiesceTrackedTestMissions();
    try {
      await expect(settleWithin(quiescence)).resolves.toBeUndefined();
    } finally {
      verifier.release();
      await quiescence;
    }
    expect(service.missionDetail(missionId)?.mission.state).toBe("cancelled");
    expect(backgroundTestMissions).toHaveLength(0);
    await removeServiceCaseRoot(caseRoot);
    const cleanupRootIndex = cleanupRoots.indexOf(caseRoot);
    if (cleanupRootIndex >= 0) cleanupRoots.splice(cleanupRootIndex, 1);
    await expect(access(caseRoot)).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("cancels tracked attention-required Missions before fixture cleanup", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
    });
    await service.initialize();
    await service.updateSettings({ autoResolution: false });

    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(
      () =>
        expect(service.missionDetail(missionId)?.mission.state).toBe(
          "attention_required",
        ),
      { timeout: 10_000 },
    );
    await quiesceTrackedTestMissions();
    expect(service.missionDetail(missionId)?.mission.state).toBe("cancelled");
    expect(backgroundTestMissions).toHaveLength(0);
  }, 30_000);
});
