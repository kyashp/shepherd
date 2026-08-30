import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
  watch,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toPublicMissionDetail } from "../app.js";
import { RuntimeExecutionError } from "../errors.js";
import { JsonStore, type PersistenceFaultStage } from "../store.js";
import type { Agent, Database } from "../types.js";
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
  GENERAL_CONTRACT_PROFILE_ID,
  ShepherdService,
  type ShepherdIndependentVerifier,
  type ShepherdServiceOptions,
} from "./service.js";
import { PlaneManager } from "./plane-manager.js";
import { assertSafeProjectPath } from "./git-client.js";
import { reconcilePersistenceRecoveryIntent } from "./recovery.js";
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

async function removeServiceCaseRoot(
  root: string,
  hooks: { beforeEntryChmod?: (entry: string) => Promise<void> } = {},
): Promise<void> {
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
        await hooks.beforeEntryChmod?.(entry);
        try {
          await chmod(entry, 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
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
      [GENERAL_CONTRACT_PROFILE_ID]: "checks/general-contract.cjs",
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

class CandidateExecutionIntervalExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
  private readonly inner = new DeterministicFixtureExecutor();
  private releaseCandidates!: () => void;
  private readonly candidatesReleased: Promise<void>;
  candidateStarts: string[] = [];
  candidateCompletes: string[] = [];

  constructor() {
    this.candidatesReleased = new Promise<void>((resolve) => {
      this.releaseCandidates = resolve;
    });
  }

  async waitForBothCandidates(): Promise<void> {
    const firstCandidateDeadline = Date.now() + 15_000;
    while (Date.now() < firstCandidateDeadline) {
      if (this.candidateStarts.length >= 1) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.candidateStarts.length === 0) {
      throw new Error("candidate execution did not start before the setup deadline");
    }

    const pairDeadline = Date.now() + 3_000;
    while (Date.now() < pairDeadline) {
      if (this.candidateStarts.length === 2) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("second candidate execution did not start within the bounded pair deadline");
  }

  release(): void {
    this.releaseCandidates();
  }

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    if (request.operation.kind !== "resolution_candidate") {
      return await this.inner.run(request);
    }
    this.candidateStarts = [...this.candidateStarts, new Date().toISOString()];
    await this.candidatesReleased;
    const result = await this.inner.run(request);
    this.candidateCompletes = [...this.candidateCompletes, new Date().toISOString()];
    return result;
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

class TypedFailingCandidateExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
  private readonly inner = new DeterministicFixtureExecutor();

  constructor(private readonly diagnostic: string) {}

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    if (request.operation.kind === "resolution_candidate") {
      const failure = new RuntimeExecutionError("execution");
      failure.message = this.diagnostic;
      throw failure;
    }
    return await this.inner.run(request);
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

class TypedFailingContractExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;

  constructor(private readonly error: Error) {}

  async run(): Promise<ShepherdExecutionResult> {
    throw this.error;
  }

  async cancel(): Promise<boolean> {
    return false;
  }
}

class MustNotRunExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
  calls = 0;

  async run(): Promise<ShepherdExecutionResult> {
    this.calls += 1;
    throw new Error("Executor ran after Plane creation failed");
  }

  async cancel(): Promise<boolean> {
    return false;
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

function returnedContractInfrastructureEvidence(
  evidence: VerificationEvidence,
  canary: string,
  privatePath: string,
): VerificationEvidence {
  return {
    ...evidence,
    passed: false,
    checks: evidence.checks.map((check, index) =>
      index === 0
        ? {
            ...check,
            status: "infrastructure_error",
            passed: false,
            exitCode: 125,
            stderr: `Synthetic returned verifier failure ${canary}`,
            error: `Verifier launch failed at ${privatePath}`,
          }
        : check,
    ),
    summary: `Synthetic returned verifier failure ${canary} at ${privatePath}`,
  };
}

class ContractInfrastructureEvidenceVerifier extends HostTrustedFixtureVerifier {
  readonly siblingSnapshotCaptured: Promise<string>;
  private markSiblingSnapshotCaptured!: (snapshotPath: string) => void;
  readonly siblingReturned: Promise<void>;
  private markSiblingReturned!: () => void;
  private readonly siblingReleased: Promise<void>;
  private releaseSiblingVerification!: () => void;
  private readonly contractPair = new TwoArrivalBarrier();

  constructor(
    private readonly canary: string,
    private readonly privatePath: string,
  ) {
    super();
    this.siblingSnapshotCaptured = new Promise<string>((resolve) => {
      this.markSiblingSnapshotCaptured = resolve;
    });
    this.siblingReturned = new Promise<void>((resolve) => {
      this.markSiblingReturned = resolve;
    });
    this.siblingReleased = new Promise<void>((resolve) => {
      this.releaseSiblingVerification = resolve;
    });
  }

  override async verify(
    request: VerificationRequest,
  ): Promise<VerificationEvidence> {
    if (request.targetType !== "contract") return await super.verify(request);
    if (!request.targetId.includes("front")) {
      this.markSiblingSnapshotCaptured(request.planePath);
    }
    await this.contractPair.arrive();
    if (request.targetId.includes("front")) {
      return returnedContractInfrastructureEvidence(
        await super.verify(request),
        this.canary,
        this.privatePath,
      );
    }
    await this.siblingReleased;
    try {
      return await super.verify(request);
    } finally {
      this.markSiblingReturned();
    }
  }

  releaseSibling(): void {
    this.contractPair.release();
    this.releaseSiblingVerification();
  }
}

class ContractAcceptanceFailureEvidenceVerifier extends HostTrustedFixtureVerifier {
  override async verify(
    request: VerificationRequest,
  ): Promise<VerificationEvidence> {
    const evidence = await super.verify(request);
    if (request.targetType !== "contract") return evidence;
    return {
      ...evidence,
      passed: false,
      checks: evidence.checks.map((check, index) =>
        index === 0
          ? {
              ...check,
              status: "failed",
              passed: false,
              exitCode: 1,
              error: "Trusted verification check exited non-zero",
            }
          : check,
      ),
      summary: "A mandatory Contract acceptance check failed",
    };
  }
}

class TwoArrivalBarrier {
  private arrivals = 0;
  private readonly arrived: Promise<void>;
  private releaseArrivals!: () => void;

  constructor() {
    this.arrived = new Promise<void>((resolve) => {
      this.releaseArrivals = resolve;
    });
  }

  async arrive(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals === 2) this.releaseArrivals();
    await this.arrived;
  }

  release(): void {
    this.releaseArrivals();
  }
}

class SnapshotTrackingContractThrowingVerifier extends HostTrustedFixtureVerifier {
  readonly siblingSnapshotCaptured: Promise<string>;
  private markSiblingSnapshotCaptured!: (snapshotPath: string) => void;
  readonly siblingReturned: Promise<void>;
  private markSiblingReturned!: () => void;
  private readonly siblingReleased: Promise<void>;
  private releaseSiblingVerification!: () => void;
  private readonly contractPair = new TwoArrivalBarrier();

  constructor(
    private readonly canary: string,
    private readonly privatePath: string,
  ) {
    super();
    this.siblingSnapshotCaptured = new Promise<string>((resolve) => {
      this.markSiblingSnapshotCaptured = resolve;
    });
    this.siblingReturned = new Promise<void>((resolve) => {
      this.markSiblingReturned = resolve;
    });
    this.siblingReleased = new Promise<void>((resolve) => {
      this.releaseSiblingVerification = resolve;
    });
  }

  override async verify(
    request: VerificationRequest,
  ): Promise<VerificationEvidence> {
    if (request.targetType !== "contract") {
      return await super.verify(request);
    }
    if (!request.targetId.includes("front")) {
      this.markSiblingSnapshotCaptured(request.planePath);
    }
    await this.contractPair.arrive();
    if (request.targetId.includes("front")) {
      throw new Error(
        `Synthetic Contract verifier failure ${this.canary} at ${this.privatePath}`,
      );
    }
    await this.siblingReleased;
    try {
      return await super.verify(request);
    } finally {
      this.markSiblingReturned();
    }
  }

  releaseSibling(): void {
    this.contractPair.release();
    this.releaseSiblingVerification();
  }
}

class OneContractThrowingVerifier extends HostTrustedFixtureVerifier {
  readonly siblingEntered: Promise<void>;
  private markSiblingEntered!: () => void;
  readonly siblingExited: Promise<void>;
  private markSiblingExited!: () => void;
  private readonly siblingReleased: Promise<void>;
  private releaseSiblingVerification!: () => void;
  private readonly contractPair = new TwoArrivalBarrier();

  constructor() {
    super();
    this.siblingEntered = new Promise<void>((resolve) => {
      this.markSiblingEntered = resolve;
    });
    this.siblingExited = new Promise<void>((resolve) => {
      this.markSiblingExited = resolve;
    });
    this.siblingReleased = new Promise<void>((resolve) => {
      this.releaseSiblingVerification = resolve;
    });
  }

  override async verify(
    request: VerificationRequest,
  ): Promise<VerificationEvidence> {
    if (request.targetType !== "contract") {
      return await super.verify(request);
    }
    if (!request.targetId.includes("front")) this.markSiblingEntered();
    await this.contractPair.arrive();
    if (request.targetId.includes("front")) {
      throw new Error("Synthetic frontend Contract verifier failure");
    }
    await this.siblingReleased;
    try {
      return await super.verify(request);
    } finally {
      this.markSiblingExited();
    }
  }

  releaseSibling(): void {
    this.contractPair.release();
    this.releaseSiblingVerification();
  }
}

class OneContractInfrastructureEvidenceVerifier extends HostTrustedFixtureVerifier {
  readonly siblingEntered: Promise<void>;
  private markSiblingEntered!: () => void;
  readonly siblingExited: Promise<void>;
  private markSiblingExited!: () => void;
  private readonly siblingReleased: Promise<void>;
  private releaseSiblingVerification!: () => void;
  private readonly contractPair = new TwoArrivalBarrier();

  constructor() {
    super();
    this.siblingEntered = new Promise<void>((resolve) => {
      this.markSiblingEntered = resolve;
    });
    this.siblingExited = new Promise<void>((resolve) => {
      this.markSiblingExited = resolve;
    });
    this.siblingReleased = new Promise<void>((resolve) => {
      this.releaseSiblingVerification = resolve;
    });
  }

  override async verify(
    request: VerificationRequest,
  ): Promise<VerificationEvidence> {
    if (request.targetType !== "contract") {
      return await super.verify(request);
    }
    if (!request.targetId.includes("front")) this.markSiblingEntered();
    await this.contractPair.arrive();
    if (request.targetId.includes("front")) {
      return returnedContractInfrastructureEvidence(
        await super.verify(request),
        "concurrent-returned-canary",
        "/private/concurrent-returned-path",
      );
    }
    await this.siblingReleased;
    try {
      return await super.verify(request);
    } finally {
      this.markSiblingExited();
    }
  }

  releaseSibling(): void {
    this.contractPair.release();
    this.releaseSiblingVerification();
  }
}

class RecordingFrontendInfrastructureVerifier extends HostTrustedFixtureVerifier {
  readonly targetIds: string[] = [];

  override async verify(
    request: VerificationRequest,
  ): Promise<VerificationEvidence> {
    this.targetIds.push(request.targetId);
    const evidence = await super.verify(request);
    if (
      request.targetType === "contract" &&
      request.targetId.includes("front")
    ) {
      return returnedContractInfrastructureEvidence(
        evidence,
        "pre-invocation-canary",
        "/private/pre-invocation-path",
      );
    }
    return evidence;
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
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = service.missionDetail(missionId)?.mission.state;
    if (state === "completed") return;
    if (state === "failed" || state === "attention_required" || state === "cancelled") {
      const failure = service.missionDetail(missionId)?.mission.failure;
      const detail = service.missionDetail(missionId);
      throw new Error(
        `Background Mission ended in ${state}${failure ? `: ${failure.stage}: ${failure.message}` : ""}; contracts=${detail?.contracts.map((item) => item.state).join(",")}; planes=${detail?.planes.map((item) => `${item.kind}:${item.state}`).join(",")}; last=${detail?.events.at(-1)?.summary}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Background Mission did not complete before the test deadline");
}

async function createGeneralContractFixture(
  options: Pick<
    ShepherdServiceOptions,
    "faultCheckpoint" | "gitPromotionFaults"
  > & {
    verifier?: ShepherdIndependentVerifier;
    persistenceFaultCheckpoint?: (stage: PersistenceFaultStage) => void;
  } = {},
) {
  const caseRoot = await makeCaseRoot();
  const store = new JsonStore(path.join(caseRoot, "state.json"), {
    ...(options.persistenceFaultCheckpoint === undefined
      ? {}
      : { persistenceFaultCheckpoint: options.persistenceFaultCheckpoint }),
  });
  await store.initialize();
  const agentWorkspaceRoot = path.join(caseRoot, "agent-workspaces");
  const workspaces = new WorkspaceManager(agentWorkspaceRoot);
  await workspaces.initialize();
  const createdAt = "2026-08-30T00:00:00.000Z";
  const id = "41111111-1111-4111-8111-111111111111";
  const agent: Agent = {
    id,
    name: "General Contract Agent",
    description: "Handles bounded general work",
    instructions: "Complete only confirmed Shepherd Contracts.",
    status: "ready",
    workspacePath: workspaces.workspacePath(id),
    codexThreadId: null,
    lastError: null,
    role: "Generalist",
    authority: {
      readable: ["**"],
      writable: ["scripts/**"],
      forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
    },
    currentContractId: null,
    createdAt,
    updatedAt: createdAt,
  };
  await workspaces.create(agent);
  await store.mutate((database) => database.agents.push(agent));
  const service = new ShepherdService({
    store,
    managedRoot: path.join(caseRoot, "managed"),
    agentWorkspaceRoot,
    verifier: options.verifier ?? new HostTrustedFixtureVerifier(),
    ...(options.faultCheckpoint === undefined
      ? {}
      : { faultCheckpoint: options.faultCheckpoint }),
    ...(options.gitPromotionFaults === undefined
      ? {}
      : { gitPromotionFaults: options.gitPromotionFaults }),
  });
  return { agent, caseRoot, service, store };
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

async function waitForOwnedPathRemoval(targetPath: string): Promise<void> {
  const parent = path.dirname(targetPath);
  const targetName = path.basename(targetPath);
  const watcher = watch(parent);
  try {
    for await (const event of watcher) {
      if (event.filename !== targetName) continue;
      try {
        await lstat(targetPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
    }
    throw new Error("Owned verification snapshot watcher ended before cleanup");
  } finally {
    await watcher.return?.();
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
  it("binds concurrent Mission idempotency to both transport assignments", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
    });
    const input = {
      content: "Run the bounded assignment idempotently.",
      preset: "auth-demo" as const,
      clientMessageId: "same-mission-request",
      frontendTransport: COOKIE_TRANSPORT,
      backendTransport: BEARER_TRANSPORT,
    };
    const [first, duplicate] = await Promise.all([
      service.startMissionFromMessage(input),
      service.startMissionFromMessage(input),
    ]);
    expect(duplicate.missionId).toBe(first.missionId);
    expect(store.snapshot().shepherd.missions).toHaveLength(1);
    expect(
      store.snapshot().shepherd.groupMessages.find(
        (message) => message.missionId === first.missionId && message.senderType === "human",
      )?.requestFingerprint,
    ).toMatch(/^[a-f0-9]{64}$/u);
    const recoveredService = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
    });
    await expect(recoveredService.startMissionFromMessage(input)).resolves.toMatchObject({
      missionId: first.missionId,
    });
    expect(store.snapshot().shepherd.missions).toHaveLength(1);
    await expect(service.startMissionFromMessage({
      ...input,
      frontendTransport: BEARER_TRANSPORT,
      backendTransport: COOKIE_TRANSPORT,
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(store.snapshot().shepherd.missions).toHaveLength(1);
    backgroundTestMissions.push({ service, missionId: first.missionId });
  }, 30_000);

  it("clarifies an incomplete private request before executing and promoting a general Contract", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const agentWorkspaceRoot = path.join(caseRoot, "agent-workspaces");
    const workspaces = new WorkspaceManager(agentWorkspaceRoot);
    await workspaces.initialize();
    const createdAt = "2026-08-30T00:00:00.000Z";
    const agent: Agent = {
      id: "41111111-1111-4111-8111-111111111111",
      name: "General Contract Agent",
      description: "Handles bounded general work",
      instructions: "Complete only confirmed Shepherd Contracts.",
      status: "ready",
      workspacePath: workspaces.workspacePath("41111111-1111-4111-8111-111111111111"),
      codexThreadId: null,
      lastError: null,
      role: "Generalist",
      authority: {
        readable: ["**"],
        writable: ["scripts/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
      currentContractId: null,
      createdAt,
      updatedAt: createdAt,
    };
    await workspaces.create(agent);
    await store.mutate((database) => database.agents.push(agent));
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot,
      verifier: new HostTrustedFixtureVerifier(),
    });

    const draft = await service.submitPrivateContractPrompt({
      agentId: agent.id,
      clientMessageId: "general-draft-one",
      content: "Build the greeting feature.",
    });
    expect(draft).toMatchObject({
      status: "clarification_required",
      missionId: null,
      contractId: null,
    });
    expect(draft.clarification).toContain("project-relative file");
    expect(store.snapshot().shepherd.missions).toHaveLength(0);
    expect(store.snapshot().shepherd.contracts).toHaveLength(0);
    expect(store.snapshot().shepherd.planes).toHaveLength(0);
    await expect(service.submitPrivateContractPrompt({
      agentId: agent.id,
      clientMessageId: "general-draft-one",
      content: "Build the greeting feature.",
    })).resolves.toMatchObject({
      status: "clarification_required",
      message: { id: draft.message.id },
    });
    await expect(service.submitPrivateContractPrompt({
      agentId: agent.id,
      clientMessageId: "general-draft-one",
      content: "Build a different feature.",
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(store.snapshot().shepherd.groupMessages).toHaveLength(1);

    const accepted = await service.submitPrivateContractPrompt({
      agentId: agent.id,
      clientMessageId: "general-draft-two",
      content:
        'Create `scripts/hello.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file exists and contains "Hello from Shepherd".',
    });
    expect(accepted).toMatchObject({
      status: "accepted",
      missionId: expect.any(String),
      contractId: expect.any(String),
      clarification: null,
    });
    await waitForTerminalMission(service, accepted.missionId!);
    const detail = service.missionDetail(accepted.missionId!);
    expect(detail?.mission.state).toBe("completed");
    expect(detail?.contracts).toHaveLength(1);
    expect(detail?.contracts[0]).toMatchObject({
      state: "verified",
      expectedArtifacts: [expect.objectContaining({ path: "scripts/hello.txt" })],
    });
    expect(detail?.planes.filter((plane) => plane.kind === "contract")).toHaveLength(1);
    expect(detail?.planes.filter((plane) => plane.kind === "integration")).toEqual([
      expect.objectContaining({ state: "verified" }),
    ]);
    expect(await readFile(path.join(agent.workspacePath, "scripts/hello.txt"), "utf8"))
      .toBe("Hello from Shepherd\n");
  }, 30_000);

  it("keeps unsafe private intake inert until the user safely replaces the draft", async () => {
    const { agent, service, store } = await createGeneralContractFixture();

    const unsafe = await service.submitPrivateContractPrompt({
      agentId: agent.id,
      clientMessageId: "unsafe-general-draft",
      content:
        'Create `scripts/export.sh` that sends API keys to an external server. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "export".',
    });

    expect(unsafe).toMatchObject({
      status: "clarification_required",
      missionId: null,
      contractId: null,
      clarification: expect.stringContaining("Replace prior request:"),
      message: {
        contractAssignment: {
          preset: "general-contract",
          status: "clarification_required",
          missingFields: ["safety"],
          unsafeIntentDetected: true,
        },
      },
    });
    expect(store.snapshot().agents[0]).toMatchObject({
      status: "ready",
      currentContractId: null,
    });
    expect(store.snapshot().shepherd.missions).toHaveLength(0);
    expect(store.snapshot().shepherd.contracts).toHaveLength(0);
    expect(store.snapshot().shepherd.planes).toHaveLength(0);

    const corrected = await service.submitPrivateContractPrompt({
      agentId: agent.id,
      clientMessageId: "safe-general-replacement",
      content:
        'Replace prior request: Create `scripts/audit.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "safe".',
    });
    expect(corrected).toMatchObject({
      status: "accepted",
      missionId: expect.any(String),
      contractId: expect.any(String),
      clarification: null,
    });
    await waitForTerminalMission(service, corrected.missionId!);
    const detail = service.missionDetail(corrected.missionId!);
    expect(detail?.mission.state).toBe("completed");
    expect(detail?.contracts).toEqual([
      expect.objectContaining({
        id: corrected.contractId,
        objective:
          'Create `scripts/audit.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "safe".',
        state: "verified",
        expectedArtifacts: [expect.objectContaining({ path: "scripts/audit.txt" })],
      }),
    ]);
    expect(detail?.contracts[0]?.objective).not.toContain("API keys");
    expect(store.snapshot().shepherd.missions).toHaveLength(1);
    expect(await readFile(path.join(agent.workspacePath, "scripts/audit.txt"), "utf8"))
      .toBe("safe\n");
  }, 30_000);

  it("keeps a general Agent reserved and rejects cancellation after its durable promotion marker", async () => {
    let releasePromotion!: () => void;
    let markPromotionReached!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releasePromotion = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      markPromotionReached = resolve;
    });
    const fixture = await createGeneralContractFixture({
      faultCheckpoint: async (checkpoint, context) => {
        if (checkpoint !== "promotion_ready_for_cas" || !context.planeId) return;
        markPromotionReached();
        await blocked;
      },
    });
    const accepted = await fixture.service.submitPrivateContractPrompt({
      agentId: fixture.agent.id,
      clientMessageId: "general-promotion-race",
      content:
        'Create `scripts/held.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "held by Shepherd".',
    });
    try {
      await reached;
      const detail = fixture.service.missionDetail(accepted.missionId!);
      expect(detail?.planes.find((plane) => plane.kind === "integration")).toMatchObject({
        generalPromotionState: "promoting",
        generalPromotionEvidence: { passed: true, targetType: "promotion" },
      });
      expect(detail?.agents.find((agent) => agent.id === fixture.agent.id)).toMatchObject({
        status: "busy",
        currentContractId: accepted.contractId,
      });
      await expect(
        access(path.join(fixture.agent.workspacePath, "scripts", "held.txt")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        fixture.service.cancelMission(accepted.missionId!),
      ).rejects.toMatchObject({ code: "conflict" });
    } finally {
      releasePromotion();
    }
    await waitForTerminalMission(fixture.service, accepted.missionId!);
    expect(
      await readFile(path.join(fixture.agent.workspacePath, "scripts", "held.txt"), "utf8"),
    ).toBe("held by Shepherd\n");
  }, 30_000);

  it("rolls back a failed general CAS before any Agent workspace mutation", async () => {
    const fixture = await createGeneralContractFixture({
      gitPromotionFaults: {
        beforeWorktreeSynchronization: () => {
          throw new Error("synthetic protected worktree synchronization failure");
        },
      },
    });
    const accepted = await fixture.service.submitPrivateContractPrompt({
      agentId: fixture.agent.id,
      clientMessageId: "general-cas-failure",
      content:
        'Create `scripts/not-promoted.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "must stay isolated".',
    });
    await vi.waitFor(
      () =>
        expect(
          fixture.service.missionDetail(accepted.missionId!)?.mission.state,
        ).toBe("failed"),
      { timeout: 15_000 },
    );
    const detail = fixture.service.missionDetail(accepted.missionId!);
    expect(detail?.project.protectedHeadCommit).toBe(detail?.mission.baseCommit);
    expect(
      await gitOutput(detail?.project.repositoryPath ?? "", ["rev-parse", "main"]),
    ).toBe(detail?.mission.baseCommit);
    expect(detail?.planes.find((plane) => plane.kind === "integration")).toMatchObject({
      state: "failed",
      generalPromotionState: "failed",
      generalPromotionEvidence: { passed: true, targetType: "promotion" },
    });
    expect(detail?.agents.find((agent) => agent.id === fixture.agent.id)).toMatchObject({
      status: "error",
      currentContractId: null,
    });
    await expect(
      access(path.join(fixture.agent.workspacePath, "scripts", "not-promoted.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("records attention with durable evidence when failure lands after general CAS", async () => {
    const fixture = await createGeneralContractFixture({
      faultCheckpoint: (checkpoint, context) => {
        if (checkpoint === "promotion_cas_completed" && context.planeId) {
          throw new Error("synthetic post-CAS process boundary");
        }
      },
    });
    const accepted = await fixture.service.submitPrivateContractPrompt({
      agentId: fixture.agent.id,
      clientMessageId: "general-post-cas-failure",
      content:
        'Create `scripts/post-cas.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "protected only".',
    });
    await vi.waitFor(
      () =>
        expect(
          ["attention_required", "failed"],
        ).toContain(
          fixture.service.missionDetail(accepted.missionId!)?.mission.state,
        ),
      { timeout: 15_000 },
    );
    const detail = fixture.service.missionDetail(accepted.missionId!);
    expect(
      detail?.mission.state,
      JSON.stringify({
        failure: detail?.mission.failure,
        plane: detail?.planes.find((plane) => plane.kind === "integration"),
        lastEvent: detail?.events.at(-1),
      }),
    ).toBe("attention_required");
    const integration = detail?.planes.find((plane) => plane.kind === "integration");
    expect(integration).toMatchObject({
      state: "verified",
      generalPromotionState: "promoted",
      generalPromotionEvidence: { passed: true, targetType: "promotion" },
    });
    expect(detail?.project.protectedHeadCommit).toBe(integration?.headCommit);
    expect(
      await gitOutput(detail?.project.repositoryPath ?? "", ["rev-parse", "main"]),
    ).toBe(integration?.headCommit);
    expect(detail?.mission.failure).toMatchObject({
      code: "persistence_error",
      stage: "agent_workspace_materialization",
    });
    await expect(
      access(path.join(fixture.agent.workspacePath, "scripts", "post-cas.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("preserves post-CAS evidence when final completion persistence fails once", async () => {
    let completionPersistenceArmed = false;
    let injected = false;
    const fixture = await createGeneralContractFixture({
      faultCheckpoint: (checkpoint) => {
        if (checkpoint === "general_completion_persistence") {
          completionPersistenceArmed = true;
        }
      },
      persistenceFaultCheckpoint: (stage) => {
        if (
          completionPersistenceArmed &&
          !injected &&
          stage === "primary_temp_open"
        ) {
          injected = true;
          throw new Error("synthetic one-shot completion persistence failure");
        }
      },
    });
    const accepted = await fixture.service.submitPrivateContractPrompt({
      agentId: fixture.agent.id,
      clientMessageId: "general-completion-persistence-failure",
      content:
        'Create `scripts/materialized.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "durable output".',
    });
    await vi.waitFor(
      () =>
        expect(
          fixture.service.missionDetail(accepted.missionId!)?.mission.state,
        ).toBe("attention_required"),
      { timeout: 15_000 },
    );
    const detail = fixture.service.missionDetail(accepted.missionId!);
    const integration = detail?.planes.find((plane) => plane.kind === "integration");
    expect(injected).toBe(true);
    expect(detail?.mission.failure).toMatchObject({
      code: "persistence_error",
      stage: "general_completion_persistence",
    });
    expect(integration).toMatchObject({
      state: "verified",
      generalPromotionState: "promoted",
      generalPromotionEvidence: { passed: true, targetType: "promotion" },
    });
    expect(detail?.project.protectedHeadCommit).toBe(integration?.headCommit);
    expect(
      await readFile(
        path.join(fixture.agent.workspacePath, "scripts", "materialized.txt"),
        "utf8",
      ),
    ).toBe("durable output\n");

    const restartedStore = new JsonStore(path.join(fixture.caseRoot, "state.json"));
    await restartedStore.initialize();
    const restarted = new ShepherdService({
      store: restartedStore,
      managedRoot: path.join(fixture.caseRoot, "managed"),
      agentWorkspaceRoot: path.join(fixture.caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
    });
    await restarted.initialize();
    expect(restarted.missionDetail(accepted.missionId!)?.mission.state).toBe(
      "attention_required",
    );
  }, 30_000);

  it("reconciles a general post-CAS crash without claiming workspace materialization", async () => {
    let releasePostCas!: () => void;
    let markPostCasReached!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releasePostCas = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      markPostCasReached = resolve;
    });
    const fixture = await createGeneralContractFixture({
      faultCheckpoint: async (checkpoint, context) => {
        if (checkpoint !== "promotion_cas_completed" || !context.planeId) return;
        markPostCasReached();
        await blocked;
        throw new Error("synthetic stopped process");
      },
    });
    const accepted = await fixture.service.submitPrivateContractPrompt({
      agentId: fixture.agent.id,
      clientMessageId: "general-post-cas-restart",
      content:
        'Create `scripts/recovered.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "recover visibly".',
    });
    try {
      await reached;
      const restartedStore = new JsonStore(path.join(fixture.caseRoot, "state.json"));
      await restartedStore.initialize();
      const restarted = new ShepherdService({
        store: restartedStore,
        managedRoot: path.join(fixture.caseRoot, "managed"),
        agentWorkspaceRoot: path.join(fixture.caseRoot, "agent-workspaces"),
        verifier: new HostTrustedFixtureVerifier(),
      });
      await restarted.initialize();
      const recovered = restarted.missionDetail(accepted.missionId!);
      const integration = recovered?.planes.find((plane) => plane.kind === "integration");
      expect(recovered?.mission).toMatchObject({
        state: "attention_required",
        failure: {
          code: "execution_interrupted",
          stage: "startup_reconciliation",
        },
      });
      expect(integration).toMatchObject({
        state: "verified",
        generalPromotionState: "promoted",
        generalPromotionEvidence: { passed: true, targetType: "promotion" },
      });
      expect(recovered?.project.protectedHeadCommit).toBe(integration?.headCommit);
      expect(
        recovered?.events.some(
          (event) => event.details.classification === "general_contract_post_cas",
        ),
      ).toBe(true);
      await expect(
        access(path.join(fixture.agent.workspacePath, "scripts", "recovered.txt")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      releasePostCas();
    }
    await vi.waitFor(
      () =>
        expect(
          fixture.service.missionDetail(accepted.missionId!)?.mission.state,
        ).toBe("attention_required"),
      { timeout: 15_000 },
    );
  }, 30_000);

  it("resumes one accepted unbound general draft exactly once on an exact retry", async () => {
    const fixture = await createGeneralContractFixture();
    let releaseStart!: () => void;
    let markStartReached!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      markStartReached = resolve;
    });
    type StartGeneral = (input: unknown) => Promise<{ missionId: string }>;
    const internal = fixture.service as unknown as {
      startGeneralAgentMission: StartGeneral;
    };
    const originalStart = internal.startGeneralAgentMission.bind(fixture.service);
    internal.startGeneralAgentMission = async (input) => {
      markStartReached();
      await blocked;
      return await originalStart(input);
    };
    const request = {
      agentId: fixture.agent.id,
      clientMessageId: "general-accepted-retry",
      content:
        'Create `scripts/resumed.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "resumed once".',
    };
    const interrupted = fixture.service.submitPrivateContractPrompt(request);
    await reached;
    expect(fixture.store.snapshot().shepherd.missions).toHaveLength(0);
    expect(
      fixture.store.snapshot().shepherd.groupMessages.find(
        (message) => message.contractAssignment?.preset === "general-contract",
      )?.contractAssignment,
    ).toMatchObject({ status: "accepted" });

    const recovered = new ShepherdService({
      store: fixture.store,
      managedRoot: path.join(fixture.caseRoot, "managed"),
      agentWorkspaceRoot: path.join(fixture.caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
    });
    const resumed = await recovered.submitPrivateContractPrompt(request);
    expect(resumed).toMatchObject({
      status: "accepted",
      missionId: expect.any(String),
      contractId: expect.any(String),
    });
    releaseStart();
    await expect(interrupted).rejects.toMatchObject({ code: "conflict" });
    await waitForTerminalMission(recovered, resumed.missionId!);
    expect(fixture.store.snapshot().shepherd.missions).toHaveLength(1);
    expect(
      await readFile(path.join(fixture.agent.workspacePath, "scripts", "resumed.txt"), "utf8"),
    ).toBe("resumed once\n");
  }, 30_000);

  it("lets cancellation win while a general promotion is still reverifying", async () => {
    const verifier = new BlockingPromotionVerifier();
    const fixture = await createGeneralContractFixture({ verifier });
    const accepted = await fixture.service.submitPrivateContractPrompt({
      agentId: fixture.agent.id,
      clientMessageId: "general-cancel-reverification",
      content:
        'Create `scripts/cancelled.txt`. Safety: project files only; no external, production, privileged, destructive, or credential operations. Acceptance: the file contains "never promote".',
    });
    await verifier.entered;
    const plane = fixture.service
      .missionDetail(accepted.missionId!)
      ?.planes.find((item) => item.generalPromotionState === "reverifying");
    expect(plane).toBeDefined();
    await fixture.service.cancelMission(accepted.missionId!);
    expect(verifier.cancelledIds).toEqual([plane?.id]);
    expect(fixture.service.missionDetail(accepted.missionId!)?.mission.state).toBe(
      "cancelled",
    );
    await expect(
      access(path.join(fixture.agent.workspacePath, "scripts", "cancelled.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 30_000);

  it("assigns user-created role Agents to opposite auth transport contracts", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const agentWorkspaceRoot = path.join(caseRoot, "agent-workspaces");
    const workspaces = new WorkspaceManager(agentWorkspaceRoot);
    await workspaces.initialize();
    const createdAt = "2026-08-30T00:00:00.000Z";
    const frontendAgent: Agent = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Demo Frontend",
      description: "User-created frontend specialist",
      instructions: "Implement only assigned frontend contracts.",
      status: "ready",
      workspacePath: workspaces.workspacePath("11111111-1111-4111-8111-111111111111"),
      codexThreadId: null,
      lastError: null,
      role: "Frontend",
      authority: {
        readable: ["**"],
        writable: ["src/frontend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
      createdAt,
      updatedAt: createdAt,
    };
    const backendAgent: Agent = {
      ...frontendAgent,
      id: "22222222-2222-4222-8222-222222222222",
      name: "Demo Backend",
      description: "User-created backend specialist",
      role: "Backend",
      workspacePath: workspaces.workspacePath("22222222-2222-4222-8222-222222222222"),
      authority: {
        readable: ["**"],
        writable: ["src/backend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
    };
    await workspaces.create(frontendAgent);
    await workspaces.create(backendAgent);
    await store.mutate((database) => database.agents.push(frontendAgent, backendAgent));
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot,
      verifier: new HostTrustedFixtureVerifier(),
    });

    const result = await service.runDeterministicDemo({
      originalIntent: "Demonstrate a user-assigned authentication collision.",
      frontendAgentId: frontendAgent.id,
      backendAgentId: backendAgent.id,
      frontendTransport: COOKIE_TRANSPORT,
      backendTransport: BEARER_TRANSPORT,
    });
    const detail = service.missionDetail(result.mission.id);
    expect(detail?.agents.map((agent) => [agent.id, agent.name])).toEqual([
      [frontendAgent.id, frontendAgent.name],
      [backendAgent.id, backendAgent.name],
    ]);
    expect(detail?.contracts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: frontendAgent.id,
        objective: expect.stringContaining(COOKIE_TRANSPORT),
      }),
      expect.objectContaining({
        agentId: backendAgent.id,
        objective: expect.stringContaining(BEARER_TRANSPORT),
      }),
    ]));
    expect(detail?.claims.map((claim) => claim.value).sort()).toEqual(
      [BEARER_TRANSPORT, COOKIE_TRANSPORT].sort(),
    );
    expect(result.selectedCandidate.targetValue).toBe(COOKIE_TRANSPORT);
    expect(result.mission.state).toBe("completed");
  }, 30_000);

  it("pairs idempotent private Agent-chat prompts into one verified Mission", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const agentWorkspaceRoot = path.join(caseRoot, "agent-workspaces");
    const workspaces = new WorkspaceManager(agentWorkspaceRoot);
    await workspaces.initialize();
    const createdAt = "2026-08-30T00:00:00.000Z";
    const frontendAgent: Agent = {
      id: "31111111-1111-4111-8111-111111111111",
      name: "Frontend Auth Agent",
      description: "User-created frontend specialist",
      instructions: "Implement only assigned frontend contracts.",
      status: "ready",
      workspacePath: workspaces.workspacePath("31111111-1111-4111-8111-111111111111"),
      codexThreadId: null,
      lastError: null,
      role: "Frontend",
      authority: {
        readable: ["**"],
        writable: ["src/frontend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
      createdAt,
      updatedAt: createdAt,
    };
    const backendAgent: Agent = {
      ...frontendAgent,
      id: "32222222-2222-4222-8222-222222222222",
      name: "Backend Auth Agent",
      role: "Backend",
      workspacePath: workspaces.workspacePath("32222222-2222-4222-8222-222222222222"),
      authority: {
        readable: ["**"],
        writable: ["src/backend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
    };
    await workspaces.create(frontendAgent);
    await workspaces.create(backendAgent);
    await store.mutate((database) => database.agents.push(frontendAgent, backendAgent));
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot,
      verifier: new HostTrustedFixtureVerifier(),
    });
    const frontendPrompt =
      "Implement the frontend authentication client using an HttpOnly session cookie.";
    const backendPrompt =
      "Implement the backend authentication service using a bearer JWT.";

    await expect(service.submitPrivateContractPrompt({
      agentId: frontendAgent.id,
      clientMessageId: "frontend-private-prompt",
      content: "Use both an HttpOnly cookie and a bearer JWT.",
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(store.snapshot().shepherd.projects).toHaveLength(0);

    const first = await service.submitPrivateContractPrompt({
      agentId: frontendAgent.id,
      clientMessageId: "frontend-private-prompt",
      content: frontendPrompt,
    });
    expect(first).toMatchObject({
      status: "awaiting_peer",
      missionId: null,
      contractId: null,
      message: {
        targetAgentId: frontendAgent.id,
        contractAssignment: {
          role: "Frontend",
          transport: COOKIE_TRANSPORT,
        },
      },
    });
    expect(store.snapshot().shepherd.missions).toHaveLength(0);

    await expect(service.submitPrivateContractPrompt({
      agentId: backendAgent.id,
      clientMessageId: "same-transport-prompt",
      content: "Implement backend authentication with an HttpOnly cookie.",
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(store.snapshot().shepherd.groupMessages).toHaveLength(1);
    expect(store.snapshot().shepherd.missions).toHaveLength(0);

    const recoveredService = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot,
      verifier: new HostTrustedFixtureVerifier(),
    });
    const backendInput = {
      agentId: backendAgent.id,
      clientMessageId: "backend-private-prompt",
      content: backendPrompt,
    };
    const [started, duplicate] = await Promise.all([
      recoveredService.submitPrivateContractPrompt(backendInput),
      recoveredService.submitPrivateContractPrompt(backendInput),
    ]);
    expect(started.status).toBe("accepted");
    expect(duplicate).toMatchObject({
      status: "accepted",
      missionId: started.missionId,
      contractId: started.contractId,
    });
    expect(started.missionId).not.toBeNull();
    backgroundTestMissions.push({ service: recoveredService, missionId: started.missionId! });
    await waitForTerminalMission(recoveredService, started.missionId!);

    const detail = recoveredService.missionDetail(started.missionId!);
    expect(detail?.mission.state).toBe("completed");
    expect(detail?.contracts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: frontendAgent.id,
        objective: frontendPrompt,
        state: "verified",
      }),
      expect.objectContaining({
        agentId: backendAgent.id,
        objective: backendPrompt,
        state: "verified",
      }),
    ]));
    const promptMessages = store.snapshot().shepherd.groupMessages.filter(
      (message) => message.contractAssignment?.preset === "auth-demo-contract",
    );
    expect(promptMessages).toHaveLength(2);
    expect(promptMessages.every(
      (message) =>
        message.missionId === started.missionId &&
        message.contractId !== null &&
        /^[a-f0-9]{64}$/u.test(message.requestFingerprint ?? ""),
    )).toBe(true);
    expect(detail?.collisions).toEqual([
      expect.objectContaining({ key: "auth.transport" }),
    ]);
  }, 30_000);

  it("replies to an unmentioned Project Group message without starting work", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const agentWorkspaceRoot = path.join(caseRoot, "agent-workspaces");
    const workspaces = new WorkspaceManager(agentWorkspaceRoot);
    await workspaces.initialize();
    const createdAt = "2026-08-30T00:00:00.000Z";
    const frontendAgent: Agent = {
      id: "41111111-1111-4111-8111-111111111111",
      name: "Group Frontend Agent",
      description: "User-created frontend specialist",
      instructions: "Implement only assigned frontend contracts.",
      status: "ready",
      workspacePath: workspaces.workspacePath("41111111-1111-4111-8111-111111111111"),
      codexThreadId: null,
      lastError: null,
      role: "Frontend",
      authority: {
        readable: ["**"],
        writable: ["src/frontend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
      createdAt,
      updatedAt: createdAt,
    };
    await workspaces.create(frontendAgent);
    await store.mutate((database) => database.agents.push(frontendAgent));
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot,
      verifier: new HostTrustedFixtureVerifier(),
    });

    await service.submitPrivateContractPrompt({
      agentId: frontendAgent.id,
      clientMessageId: "initialize-group-project",
      content: "Implement frontend authentication with an HttpOnly session cookie.",
    });
    const message = await service.sendProjectGroupMessage("auth-demo", {
      clientMessageId: "unmentioned-group-message",
      content: "Please explain the fixed authentication flow.",
    });

    expect(message).toMatchObject({
      senderType: "human",
      content: "Please explain the fixed authentication flow.",
      missionId: null,
      contractId: null,
    });
    expect(service.projectGroupMessages("auth-demo")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          senderType: "shepherd",
          content: "Mention a ready Frontend or Backend Agent and request exactly one supported authentication transport.",
        }),
      ]),
    );
    expect(store.snapshot().shepherd.missions).toHaveLength(0);
    expect(store.snapshot().shepherd.contracts).toHaveLength(0);
  });

  it("initializes the fixed Project Group idempotently without starting a Mission", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const executor = new DeterministicFixtureExecutor();
    const run = vi.spyOn(executor, "run");
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor,
    });
    const groupService = service as ShepherdService & {
      initializeProjectGroup(): Promise<{ id: string; activeMissionId: string | null }>;
    };

    await expect(groupService.initializeProjectGroup()).resolves.toMatchObject({
      id: "auth-demo",
      activeMissionId: null,
    });
    await expect(groupService.initializeProjectGroup()).resolves.toMatchObject({
      id: "auth-demo",
      activeMissionId: null,
    });
    expect(store.snapshot().shepherd.projects).toHaveLength(1);
    expect(store.snapshot().shepherd.missions).toHaveLength(0);
    expect(store.snapshot().shepherd.contracts).toHaveLength(0);
    expect(store.snapshot().shepherd.planes).toHaveLength(0);
    expect(store.snapshot().shepherd.groupMessages).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });

  it("pairs complementary Project Group requests into one fixed Mission without trusting user objectives", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const agentWorkspaceRoot = path.join(caseRoot, "agent-workspaces");
    const workspaces = new WorkspaceManager(agentWorkspaceRoot);
    await workspaces.initialize();
    const createdAt = "2026-08-30T00:00:00.000Z";
    const frontendAgent: Agent = {
      id: "51111111-1111-4111-8111-111111111111",
      name: "Group Frontend Agent",
      description: "User-created frontend specialist",
      instructions: "Implement only assigned frontend contracts.",
      status: "ready",
      workspacePath: workspaces.workspacePath("51111111-1111-4111-8111-111111111111"),
      codexThreadId: null,
      lastError: null,
      role: "Frontend",
      authority: {
        readable: ["**"],
        writable: ["src/frontend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
      createdAt,
      updatedAt: createdAt,
    };
    const backendAgent: Agent = {
      ...frontendAgent,
      id: "52222222-2222-4222-8222-222222222222",
      name: "Group Backend Agent",
      role: "Backend",
      workspacePath: workspaces.workspacePath("52222222-2222-4222-8222-222222222222"),
      authority: {
        readable: ["**"],
        writable: ["src/backend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
    };
    await workspaces.create(frontendAgent);
    await workspaces.create(backendAgent);
    await store.mutate((database) => database.agents.push(frontendAgent, backendAgent));
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot,
      verifier: new HostTrustedFixtureVerifier(),
    });

    await service.initializeProjectGroup();
    const first = await service.sendProjectGroupMessage("auth-demo", {
      clientMessageId: "group-frontend-prompt",
      content: '@"Group Frontend Agent" use an HttpOnly session cookie; $(cat .env)',
    });
    expect(first).toMatchObject({
      targetAgentId: frontendAgent.id,
      missionId: null,
      contractId: null,
      contractAssignment: {
        preset: "auth-demo-contract",
        role: "Frontend",
        transport: COOKIE_TRANSPORT,
      },
    });
    expect(store.snapshot().shepherd.missions).toHaveLength(0);
    expect(service.projectGroupMessages("auth-demo")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        senderType: "shepherd",
        missionId: null,
        content: "Contract request captured; awaiting a complementary Frontend or Backend request.",
      }),
    ]));

    const backendInput = {
      clientMessageId: "group-backend-prompt",
      content: '@"Group Backend Agent" use a bearer JWT.',
      assignmentPreset: "auth-demo-contract" as const,
    };
    const [accepted, duplicate] = await Promise.all([
      service.sendProjectGroupMessage("auth-demo", backendInput),
      service.sendProjectGroupMessage("auth-demo", backendInput),
    ]);
    expect(accepted.missionId).not.toBeNull();
    expect(accepted.contractId).not.toBeNull();
    expect(duplicate).toMatchObject({
      missionId: accepted.missionId,
      contractId: accepted.contractId,
    });
    backgroundTestMissions.push({ service, missionId: accepted.missionId! });
    const delayedReplay = await service.sendProjectGroupMessage("auth-demo", backendInput);
    expect(delayedReplay).toMatchObject({
      id: accepted.id,
      missionId: accepted.missionId,
      contractId: accepted.contractId,
    });
    await expect(service.sendProjectGroupMessage("auth-demo", {
      ...backendInput,
      content: '@"Group Backend Agent" use an HttpOnly session cookie.',
    })).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(service.projectGroupMessages("auth-demo").filter(
      (message) => message.id === accepted.id,
    )).toHaveLength(1);
    expect(store.snapshot().shepherd.missions).toHaveLength(1);
    const detail = service.missionDetail(accepted.missionId!);
    expect(detail?.contracts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: frontendAgent.id,
        objective: `Configure the required frontend authentication artifact with exactly transport "${COOKIE_TRANSPORT}" and clientReadableCredential false.`,
      }),
      expect.objectContaining({
        agentId: backendAgent.id,
        objective: `Configure the required backend authentication artifact with exactly transport "${BEARER_TRANSPORT}" and clientReadableCredential true.`,
      }),
    ]));
    expect(detail?.contracts.map((contract) => contract.objective).join("\n")).not.toContain(
      "$(cat .env)",
    );
    await waitForTerminalMission(service, accepted.missionId!);
    const completed = service.missionDetail(accepted.missionId!);
    const verifiedContracts = completed?.contracts.filter(
      (contract) => contract.state === "verified" && contract.manifest,
    ) ?? [];
    const agentSummaries = service.projectGroupMessages("auth-demo").filter(
      (message) => message.senderType === "agent" && message.missionId === accepted.missionId,
    );
    expect(agentSummaries).toHaveLength(verifiedContracts.length);
    expect(agentSummaries).toEqual(expect.arrayContaining(verifiedContracts.map((contract) =>
      expect.objectContaining({
        senderId: contract.agentId,
        targetAgentId: contract.agentId,
        contractId: contract.id,
        content: contract.manifest?.summary,
      }),
    )));
  }, 30_000);

  it("does not pair a Project Group prompt with the private Agent-chat intake", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const agentWorkspaceRoot = path.join(caseRoot, "agent-workspaces");
    const workspaces = new WorkspaceManager(agentWorkspaceRoot);
    await workspaces.initialize();
    const createdAt = "2026-08-30T00:00:00.000Z";
    const frontendAgent: Agent = {
      id: "53333333-3333-4333-8333-333333333333",
      name: "Isolated Group Frontend Agent",
      description: "User-created frontend specialist",
      instructions: "Implement only assigned frontend contracts.",
      status: "ready",
      workspacePath: workspaces.workspacePath("53333333-3333-4333-8333-333333333333"),
      codexThreadId: null,
      lastError: null,
      role: "Frontend",
      authority: {
        readable: ["**"],
        writable: ["src/frontend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
      createdAt,
      updatedAt: createdAt,
    };
    const backendAgent: Agent = {
      ...frontendAgent,
      id: "54444444-4444-4444-8444-444444444444",
      name: "Isolated Private Backend Agent",
      role: "Backend",
      workspacePath: workspaces.workspacePath("54444444-4444-4444-8444-444444444444"),
      authority: {
        readable: ["**"],
        writable: ["src/backend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
    };
    await workspaces.create(frontendAgent);
    await workspaces.create(backendAgent);
    await store.mutate((database) => database.agents.push(frontendAgent, backendAgent));
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot,
      verifier: new HostTrustedFixtureVerifier(),
    });

    await service.initializeProjectGroup();
    const mixedRoute = await Promise.allSettled([
      service.sendProjectGroupMessage("auth-demo", {
        clientMessageId: "isolated-mixed-route",
        content: '@"Isolated Group Frontend Agent" use an HttpOnly session cookie.',
      }),
      service.sendProjectGroupMessage("auth-demo", {
        clientMessageId: "isolated-mixed-route",
        content: "Explain the fixed authentication flow.",
      }),
    ]);
    expect(mixedRoute.map((outcome) => outcome.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(service.projectGroupMessages("auth-demo").filter(
      (message) => message.senderType === "human",
    )).toHaveLength(1);

    await service.resetDeterministicDemo();
    await service.sendProjectGroupMessage("auth-demo", {
      clientMessageId: "isolated-group-frontend",
      content: '@"Isolated Group Frontend Agent" use an HttpOnly session cookie; $(cat .env)',
    });

    await expect(service.submitPrivateContractPrompt({
      agentId: backendAgent.id,
      clientMessageId: "isolated-private-backend",
      content: "Implement backend authentication with an HttpOnly session cookie.",
    })).rejects.toThrow(
      "A Contract prompt from another intake is already waiting; reset the demo to replace it",
    );
    expect(store.snapshot().shepherd.missions).toHaveLength(0);
    expect(store.snapshot().shepherd.contracts).toHaveLength(0);

    await service.resetDeterministicDemo();
    await service.submitPrivateContractPrompt({
      agentId: backendAgent.id,
      clientMessageId: "isolated-private-first",
      content: "Implement backend authentication with a bearer JWT.",
    });
    await expect(service.sendProjectGroupMessage("auth-demo", {
      clientMessageId: "isolated-group-second",
      content: '@"Isolated Group Frontend Agent" use an HttpOnly session cookie.',
    })).rejects.toThrow(
      "A Contract prompt from another intake is already waiting; reset the demo to replace it",
    );
    expect(store.snapshot().shepherd.missions).toHaveLength(0);
    expect(store.snapshot().shepherd.contracts).toHaveLength(0);
  });

  it("rolls back only the new Project Group prompt when Mission preparation fails", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const createdAt = "2026-08-30T00:00:00.000Z";
    const frontendAgent: Agent = {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Rollback Frontend Agent",
      description: "User-created frontend specialist",
      instructions: "Implement only assigned frontend contracts.",
      status: "ready",
      workspacePath: path.join(caseRoot, "agent-workspaces", "55555555-5555-4555-8555-555555555555"),
      codexThreadId: null,
      lastError: null,
      role: "Frontend",
      authority: {
        readable: ["**"],
        writable: ["src/frontend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
      createdAt,
      updatedAt: createdAt,
    };
    const backendAgent: Agent = {
      ...frontendAgent,
      id: "56666666-6666-4666-8666-666666666666",
      name: "Rollback Backend Agent",
      role: "Backend",
      workspacePath: path.join(caseRoot, "agent-workspaces", "56666666-6666-4666-8666-666666666666"),
      authority: {
        readable: ["**"],
        writable: ["src/backend/**"],
        forbidden: [".git/**", ".shepherd/**", "checks/**", "policy.json"],
      },
    };
    await store.mutate((database) => database.agents.push(frontendAgent, backendAgent));
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
    });

    await service.initializeProjectGroup();
    const pending = await service.sendProjectGroupMessage("auth-demo", {
      clientMessageId: "rollback-frontend",
      content: '@"Rollback Frontend Agent" use an HttpOnly session cookie.',
    });
    const start = vi.spyOn(service, "startDeterministicDemo").mockRejectedValueOnce(
      new Error("synthetic preparation failure"),
    );

    await expect(service.sendProjectGroupMessage("auth-demo", {
      clientMessageId: "rollback-backend",
      content: '@"Rollback Backend Agent" use a bearer JWT.',
    })).rejects.toThrow("synthetic preparation failure");

    expect(start).toHaveBeenCalledOnce();
    expect(store.snapshot().shepherd.groupMessages.filter(
      (message) => message.contractAssignment?.preset === "auth-demo-contract",
    )).toEqual([pending]);
    expect(store.snapshot().agents.map((agent) => ({
      status: agent.status,
      currentContractId: agent.currentContractId ?? null,
    }))).toEqual([
      { status: "ready", currentContractId: null },
      { status: "ready", currentContractId: null },
    ]);
    expect(store.snapshot().shepherd.missions).toHaveLength(0);
    expect(store.snapshot().shepherd.contracts).toHaveLength(0);
    expect(store.snapshot().shepherd.planes).toHaveLength(0);
  });

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

  it("tolerates a managed file disappearing after cleanup lstat and before chmod", async () => {
    const caseRoot = await makeCaseRoot();
    const disappearingFile = path.join(caseRoot, "managed", "candidate.ts");
    await mkdir(path.dirname(disappearingFile), { recursive: true });
    await writeFile(disappearingFile, "candidate\n", "utf8");
    await expect(
      removeServiceCaseRoot(caseRoot, {
        beforeEntryChmod: async (entry) => {
          if (entry === disappearingFile) await rm(disappearingFile);
        },
      }),
    ).resolves.toBeUndefined();
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
    await waitForTerminalMission(service, missionId, 25_000);

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

  it("PERF-01 proves real scheduled candidate executor intervals overlap before release", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const executor = new CandidateExecutionIntervalExecutor();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor,
    });

    const { missionId } = await startTrackedTestMission(service);
    try {
      await executor.waitForBothCandidates();
      expect(executor.candidateStarts).toHaveLength(2);
      expect(executor.candidateCompletes).toEqual([]);
      expect(executor.candidateStarts.every((timestamp) => Number.isFinite(Date.parse(timestamp)))).toBe(true);
    } finally {
      executor.release();
    }
    await waitForTerminalMission(service, missionId, 25_000);
    expect(service.missionDetail(missionId)?.mission.state).toBe("completed");
    expect(executor.candidateCompletes).toHaveLength(2);
    expect(executor.candidateCompletes.every((timestamp) => Number.isFinite(Date.parse(timestamp)))).toBe(true);
    expect(Math.max(...executor.candidateStarts.map(Date.parse))).toBeLessThanOrEqual(
      Math.min(...executor.candidateCompletes.map(Date.parse)),
    );
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

  it("terminalizes Contract verification infrastructure failures without promotion or sensitive diagnostics", async () => {
    const caseRoot = await makeCaseRoot();
    const canary = "F03-CANARY-verifier-secret-443322";
    const privatePath = path.join(caseRoot, "private-verifier-diagnostic.txt");
    const storePath = path.join(caseRoot, "state.json");
    const store = new JsonStore(storePath, { sensitiveValues: [canary] });
    await store.initialize();
    const verifier = new SnapshotTrackingContractThrowingVerifier(
      canary,
      privatePath,
    );
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
      sensitiveValues: [canary],
    });

    const run = service.runDeterministicDemo();
    const runOutcome = run.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    let siblingSnapshotRoot = "";
    let snapshotRemoved: Promise<void> | undefined;
    let thrownMessage = "";
    try {
      siblingSnapshotRoot = path.resolve(await verifier.siblingSnapshotCaptured);
      expect(path.basename(siblingSnapshotRoot)).toMatch(/^verify-/u);
      expect(path.basename(path.dirname(siblingSnapshotRoot))).toBe(
        ".trusted-verification",
      );
      expect(siblingSnapshotRoot.startsWith(path.resolve(caseRoot) + path.sep)).toBe(
        true,
      );
      const outcome = await runOutcome;
      expect(outcome.status).toBe("rejected");
      if (outcome.status !== "rejected") {
        throw new Error("Contract verifier infrastructure Mission unexpectedly fulfilled");
      }
      expect(outcome.reason).toBeInstanceOf(Error);
      thrownMessage = (outcome.reason as Error).message;
      await expect(access(siblingSnapshotRoot)).resolves.toBeUndefined();

      snapshotRemoved = settleWithin(
        waitForOwnedPathRemoval(siblingSnapshotRoot),
      );
      verifier.releaseSibling();
      await verifier.siblingReturned;
      await snapshotRemoved;
    } finally {
      verifier.releaseSibling();
      await Promise.allSettled([
        run,
        verifier.siblingReturned,
        ...(snapshotRemoved ? [snapshotRemoved] : []),
      ]);
    }
    await expect(access(siblingSnapshotRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const mission = service.state().missions.at(-1);
    const detail = service.missionDetail(mission?.id ?? "missing");
    if (!detail) throw new Error("Failed Mission detail disappeared");
    const contractPlanes = detail.planes.filter((plane) => plane.kind === "contract");
    expect({
      thrownMessage,
      mission: {
        state: detail.mission.state,
        failureCode: detail.mission.failure?.code,
        failureStage: detail.mission.failure?.stage,
        activeMissionId: detail.project.activeMissionId,
      },
      contractStates: detail.contracts.map((contract) => contract.state).sort(),
      contractFailureCodes: detail.contracts
        .map((contract) => contract.failure?.code)
        .sort(),
      planeStates: contractPlanes.map((plane) => plane.state).sort(),
      planeFailureCodes: contractPlanes.map((plane) => plane.error?.code).sort(),
      agentStatuses: detail.agents.map((agent) => agent.status).sort(),
      agentContractIds: detail.agents.map((agent) => agent.currentContractId),
    }).toEqual({
      thrownMessage: "Contract independent verification infrastructure failed",
      mission: {
        state: "failed",
        failureCode: "verification_infrastructure_error",
        failureStage: "contract_verification",
        activeMissionId: null,
      },
      contractStates: ["interrupted", "verification_failed"],
      contractFailureCodes: [
        "verification_infrastructure_error",
        "verification_infrastructure_error",
      ],
      planeStates: ["failed", "interrupted"],
      planeFailureCodes: [
        "verification_infrastructure_error",
        "verification_infrastructure_error",
      ],
      agentStatuses: ["error", "error"],
      agentContractIds: [null, null],
    });
    expect(detail.collisions).toEqual([]);
    expect(detail.candidates).toEqual([]);
    expect(detail.planes.some((plane) => plane.kind !== "contract")).toBe(false);
    expect(detail.project.protectedHeadCommit).toBe(detail.mission.baseCommit);
    const verificationFailures = detail.events.filter(
      (event) => event.type === "verification_failed",
    );
    expect(verificationFailures).toHaveLength(1);
    expect(verificationFailures).toSatisfy((events: typeof verificationFailures) =>
      events.every(
        (event) =>
          event.summary ===
            "Contract independent verification infrastructure failed" &&
          event.details.failureCode === "verification_infrastructure_error" &&
          event.details.stage === "contract_verification",
      ),
    );
    expect(
      detail.events.filter((event) => event.type === "execution_interrupted"),
    ).toHaveLength(1);
    expect(
      detail.events.some((event) =>
        [
          "collision_detected",
          "candidate_created",
          "candidate_selected",
          "promotion_started",
          "promotion_completed",
        ].includes(event.type),
      ),
    ).toBe(false);

    const publicDetail = toPublicMissionDetail(detail, [canary]);
    const durableDetailText = JSON.stringify(detail);
    const publicText = JSON.stringify(publicDetail);
    const persistedText = await readFile(storePath, "utf8");
    for (const output of [durableDetailText, publicText, persistedText]) {
      expect(output).not.toContain(canary);
      expect(output).not.toContain(privatePath);
      expect(output).not.toContain("Synthetic Contract verifier failure");
    }
    expect(publicDetail.mission.failure).toMatchObject({
      code: "verification_infrastructure_error",
      stage: "contract_verification",
    });
    expect(publicDetail.contracts).toSatisfy((contracts: typeof publicDetail.contracts) =>
      contracts.every(
        (contract) =>
          contract.failure?.code === "verification_infrastructure_error",
      ),
    );
    expect(publicDetail.planes).toSatisfy((planes: typeof publicDetail.planes) =>
      planes.every((plane) => !("worktreePath" in plane)),
    );
  }, 30_000);

  it("terminalizes returned Contract verification infrastructure evidence", async () => {
    const caseRoot = await makeCaseRoot();
    const canary = "F03-RETURNED-CANARY-775533";
    const privatePath = path.join(caseRoot, "private-returned-diagnostic.txt");
    const storePath = path.join(caseRoot, "state.json");
    const store = new JsonStore(storePath, { sensitiveValues: [canary] });
    await store.initialize();
    const verifier = new ContractInfrastructureEvidenceVerifier(canary, privatePath);
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
      sensitiveValues: [canary],
    });

    const run = service.runDeterministicDemo();
    const runOutcome = run.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    let siblingSnapshotRoot = "";
    let snapshotRemoved: Promise<void> | undefined;
    let thrownMessage = "";
    try {
      siblingSnapshotRoot = path.resolve(await verifier.siblingSnapshotCaptured);
      expect(path.basename(siblingSnapshotRoot)).toMatch(/^verify-/u);
      expect(path.basename(path.dirname(siblingSnapshotRoot))).toBe(
        ".trusted-verification",
      );
      expect(siblingSnapshotRoot.startsWith(path.resolve(caseRoot) + path.sep)).toBe(
        true,
      );
      const outcome = await runOutcome;
      expect(outcome.status).toBe("rejected");
      if (outcome.status !== "rejected") {
        throw new Error("Returned infrastructure Mission unexpectedly fulfilled");
      }
      expect(outcome.reason).toBeInstanceOf(Error);
      thrownMessage = (outcome.reason as Error).message;
      await expect(access(siblingSnapshotRoot)).resolves.toBeUndefined();

      snapshotRemoved = settleWithin(waitForOwnedPathRemoval(siblingSnapshotRoot));
      verifier.releaseSibling();
      await verifier.siblingReturned;
      await snapshotRemoved;
    } finally {
      verifier.releaseSibling();
      await Promise.allSettled([
        run,
        verifier.siblingReturned,
        ...(snapshotRemoved ? [snapshotRemoved] : []),
      ]);
    }
    await expect(access(siblingSnapshotRoot)).rejects.toMatchObject({ code: "ENOENT" });

    const missionId = service.state().missions.at(-1)?.id;
    const detail = service.missionDetail(missionId ?? "missing");
    if (!detail) throw new Error("Failed Mission detail disappeared");
    expect({
      thrownMessage,
      mission: {
        state: detail.mission.state,
        code: detail.mission.failure?.code,
        stage: detail.mission.failure?.stage,
        activeMissionId: detail.project.activeMissionId,
      },
      contracts: detail.contracts.map((contract) => contract.state).sort(),
      contractCodes: detail.contracts
        .map((contract) => contract.failure?.code)
        .sort(),
      planes: detail.planes.map((plane) => plane.state).sort(),
      planeCodes: detail.planes.map((plane) => plane.error?.code).sort(),
      agents: detail.agents.map((agent) => ({
        status: agent.status,
        currentContractId: agent.currentContractId,
      })),
    }).toEqual({
      thrownMessage: "Contract independent verification infrastructure failed",
      mission: {
        state: "failed",
        code: "verification_infrastructure_error",
        stage: "contract_verification",
        activeMissionId: null,
      },
      contracts: ["interrupted", "verification_failed"],
      contractCodes: [
        "verification_infrastructure_error",
        "verification_infrastructure_error",
      ],
      planes: ["failed", "interrupted"],
      planeCodes: [
        "verification_infrastructure_error",
        "verification_infrastructure_error",
      ],
      agents: [
        { status: "error", currentContractId: null },
        { status: "error", currentContractId: null },
      ],
    });
    expect(detail.collisions).toEqual([]);
    expect(detail.candidates).toEqual([]);
    expect(detail.planes.every((plane) => plane.kind === "contract")).toBe(true);
    expect(
      detail.events.some((event) =>
        [
          "verification_passed",
          "collision_detected",
          "candidate_created",
          "promotion_started",
          "promotion_completed",
        ].includes(event.type),
      ),
    ).toBe(false);

    const publicText = JSON.stringify(toPublicMissionDetail(detail, [canary]));
    const durableText = JSON.stringify(detail);
    const persistedText = await readFile(storePath, "utf8");
    for (const output of [publicText, durableText, persistedText]) {
      expect(output).not.toContain(canary);
      expect(output).not.toContain(privatePath);
      expect(output).not.toContain("Synthetic returned verifier failure");
    }
  }, 30_000);

  it("preserves ordinary failed mandatory Contract acceptance semantics", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new ContractAcceptanceFailureEvidenceVerifier(),
    });

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      /failed independent verification/u,
    );
    const missionId = service.state().missions.at(-1)?.id;
    const detail = service.missionDetail(missionId ?? "missing");
    if (!detail) throw new Error("Failed Mission detail disappeared");
    expect(detail.contracts.map((contract) => contract.failure?.code)).toEqual([
      "failed_independent_acceptance",
      "failed_independent_acceptance",
    ]);
    expect(
      detail.events.filter((event) => event.type === "verification_failed"),
    ).toHaveLength(2);
    expect(detail.mission.failure?.code).not.toBe(
      "verification_infrastructure_error",
    );
    expect(detail.planes.every((plane) => plane.kind === "contract")).toBe(true);
    expect(detail.collisions).toEqual([]);
    expect(detail.candidates).toEqual([]);
  }, 30_000);

  it.each([
    {
      boundary: "thrown verifier exception",
      createVerifier: () => new OneContractThrowingVerifier(),
    },
    {
      boundary: "returned infrastructure evidence",
      createVerifier: () => new OneContractInfrastructureEvidenceVerifier(),
    },
  ])("atomically interrupts a blocked sibling after $boundary", async ({
    createVerifier,
  }) => {
    const caseRoot = await makeCaseRoot();
    const storePath = path.join(caseRoot, "state.json");
    const store = new JsonStore(storePath);
    await store.initialize();
    const verifier = createVerifier();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
    });

    const run = service.runDeterministicDemo();
    const runOutcome = run.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );

    try {
      await verifier.siblingEntered;
      const outcome = await runOutcome;
      expect(outcome.status).toBe("rejected");
      if (outcome.status !== "rejected") {
        throw new Error("Infrastructure failure Mission unexpectedly fulfilled");
      }
      expect(outcome.reason).toBeInstanceOf(Error);
      expect((outcome.reason as Error).message).toContain(
        "Contract independent verification infrastructure failed",
      );

      const missionId = service.state().missions.at(-1)?.id;
      if (!missionId) throw new Error("Failed Mission identity disappeared");
      const detailBeforeRelease = service.missionDetail(missionId);
      if (!detailBeforeRelease) throw new Error("Failed Mission detail disappeared");
      expect({
        mission: detailBeforeRelease.mission.state,
        activeMissionId: detailBeforeRelease.project.activeMissionId,
        contracts: detailBeforeRelease.contracts
          .map((contract) => contract.state)
          .sort(),
        planes: detailBeforeRelease.planes.map((plane) => plane.state).sort(),
        agents: detailBeforeRelease.agents.map((agent) => ({
          status: agent.status,
          currentContractId: agent.currentContractId,
        })),
      }).toEqual({
        mission: "failed",
        activeMissionId: null,
        contracts: ["interrupted", "verification_failed"],
        planes: ["failed", "interrupted"],
        agents: [
          { status: "error", currentContractId: null },
          { status: "error", currentContractId: null },
        ],
      });

      const reloadedStore = new JsonStore(storePath);
      await reloadedStore.initialize();
      const reloaded = reloadedStore.snapshot();
      expect({
        mission: reloaded.shepherd.missions.find((item) => item.id === missionId)
          ?.state,
        activeMissionId: reloaded.shepherd.projects.find(
          (project) => project.id === detailBeforeRelease.project.id,
        )?.activeMissionId,
        contracts: reloaded.shepherd.contracts
          .filter((contract) => contract.missionId === missionId)
          .map((contract) => contract.state)
          .sort(),
        planes: reloaded.shepherd.planes
          .filter((plane) => plane.missionId === missionId)
          .map((plane) => plane.state)
          .sort(),
        activeAgentContracts: reloaded.agents
          .filter((agent) => agent.currentContractId !== null)
          .map((agent) => agent.currentContractId),
      }).toEqual({
        mission: "failed",
        activeMissionId: null,
        contracts: ["interrupted", "verification_failed"],
        planes: ["failed", "interrupted"],
        activeAgentContracts: [],
      });

      verifier.releaseSibling();
      await verifier.siblingExited;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const detailAfterRelease = service.missionDetail(missionId);
      expect(
        detailAfterRelease?.contracts.map((contract) => contract.state).sort(),
      ).toEqual(["interrupted", "verification_failed"]);
      expect(
        detailAfterRelease?.events.filter(
          (event) => event.type === "verification_passed",
        ),
      ).toEqual([]);
      expect(detailAfterRelease?.collisions).toEqual([]);
      expect(detailAfterRelease?.candidates).toEqual([]);
      expect(detailAfterRelease?.planes.every((plane) => plane.kind === "contract"))
        .toBe(true);
    } finally {
      verifier.releaseSibling();
      await Promise.allSettled([run, verifier.siblingExited]);
    }
  }, 30_000);

  it("keeps a truly untyped execution exception classified as unknown", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new TypedFailingContractExecutor(new Error("untyped synthetic failure")),
    });

    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(
      () => expect(service.missionDetail(missionId)?.mission.state).toBe("failed"),
      { timeout: 10_000 },
    );
    const detail = service.missionDetail(missionId);
    expect(detail?.mission.failure).toMatchObject({ code: "unknown", stage: "background_demo" });
    expect(detail?.contracts.every((contract) => contract.state === "execution_failed" && contract.failure?.code === "unknown")).toBe(true);
    expect(detail?.candidates).toEqual([]);
  });

  it("persists a Contract-owned failure when its Plane worktree cannot be created", async () => {
    const caseRoot = await makeCaseRoot();
    const managedRoot = path.join(caseRoot, "managed");
    const storePath = path.join(caseRoot, "state.json");
    const outsideCanary = path.join(caseRoot, "outside-canary.txt");
    await writeFile(outsideCanary, "outside unchanged\n", "utf8");
    const store = new JsonStore(storePath);
    await store.initialize();
    const executor = new MustNotRunExecutor();
    const verifier = new HostTrustedFixtureVerifier();
    const verify = vi.spyOn(verifier, "verify");
    let failedPlanePath = "";
    const service = new ShepherdService({
      store,
      managedRoot,
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
      executor,
      faultCheckpoint: async (checkpoint, context) => {
        if (checkpoint !== "contract_plane_creation_start" || failedPlanePath) return;
        failedPlanePath = path.join(managedRoot, "planes", "auth-demo", `contract-${context.planeId}`);
        await mkdir(failedPlanePath);
        await writeFile(path.join(failedPlanePath, "partial-canary"), "partial\n", "utf8");
      },
    });

    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(
      () => expect(service.missionDetail(missionId)?.mission.state).toBe("failed"),
      { timeout: 10_000 },
    );
    const detail = service.missionDetail(missionId);
    if (!detail) throw new Error("Plane creation failure detail disappeared");
    expect(detail.mission.failure).toMatchObject({ code: "worktree_creation_failure", stage: "plane_creation" });
    expect(detail.project.activeMissionId).toBeNull();
    const failedContracts = detail.contracts.filter((contract) => contract.failure?.code === "worktree_creation_failure");
    expect(failedContracts).toHaveLength(1);
    expect(failedContracts[0]).toMatchObject({ state: "execution_failed", planeId: null });
    expect(detail.contracts.filter((contract) => contract.state === "queued" && contract.failure === null)).toHaveLength(1);
    expect(detail.agents.filter((agent) => agent.status === "error" && agent.currentContractId === null)).toHaveLength(1);
    expect(detail.planes).toEqual([]);
    expect(detail.collisions).toEqual([]);
    expect(detail.candidates).toEqual([]);
    expect(detail.project.protectedHeadCommit).toBe(detail.mission.baseCommit);
    expect(executor.calls).toBe(0);
    expect(verify).not.toHaveBeenCalled();
    expect(detail.events.filter((event) => event.contractId === failedContracts[0]?.id && event.details.failureCode === "worktree_creation_failure")).toHaveLength(1);
    expect(detail.events.filter((event) => event.type === "mission_failed" && event.details.failureCode === "worktree_creation_failure")).toHaveLength(1);
    const publicDetail = JSON.stringify(toPublicMissionDetail(detail, []));
    expect(publicDetail).toContain('"code":"worktree_creation_failure"');
    expect(publicDetail).toContain('"stage":"plane_creation"');
    expect(publicDetail).not.toContain(caseRoot);
    await expect(access(failedPlanePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(outsideCanary, "utf8")).toBe("outside unchanged\n");

    const reloaded = new JsonStore(storePath);
    await reloaded.initialize();
    const persisted = reloaded.snapshot();
    expect(persisted.shepherd.planes).toEqual([]);
    expect(persisted.shepherd.missions.find((mission) => mission.id === missionId)?.failure).toMatchObject({ code: "worktree_creation_failure", stage: "plane_creation" });
    expect(persisted.shepherd.contracts.filter((contract) => contract.missionId === missionId && contract.failure?.code === "worktree_creation_failure")).toHaveLength(1);
  });

  it("unwinds the first initial Contract Plane when the second Plane creation fails", async () => {
    const caseRoot = await makeCaseRoot();
    const managedRoot = path.join(caseRoot, "managed");
    const storePath = path.join(caseRoot, "state.json");
    const outsideCanary = path.join(caseRoot, "outside-canary.txt");
    await writeFile(outsideCanary, "outside unchanged\n", "utf8");
    const store = new JsonStore(storePath);
    await store.initialize();
    const executor = new MustNotRunExecutor();
    const verifier = new HostTrustedFixtureVerifier();
    const verify = vi.spyOn(verifier, "verify");
    let service!: ShepherdService;
    let creationCalls = 0;
    let survivingPath = "";
    let survivingBranch = "";
    let failedPlanePath = "";
    service = new ShepherdService({
      store,
      managedRoot,
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
      executor,
      faultCheckpoint: async (checkpoint, context) => {
        if (checkpoint !== "contract_plane_creation_start") return;
        creationCalls += 1;
        if (creationCalls !== 2) return;
        const partial = service
          .state()
          .planes.find((plane) => plane.missionId === context.missionId);
        if (!partial) throw new Error("First Plane was not durable before second creation");
        survivingPath = partial.worktreePath;
        survivingBranch = partial.branch;
        failedPlanePath = path.join(
          managedRoot,
          "planes",
          "auth-demo",
          `contract-${context.planeId}`,
        );
        await mkdir(failedPlanePath);
        await writeFile(path.join(failedPlanePath, "partial-canary"), "partial\n", "utf8");
      },
    });

    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(
      () => expect(service.missionDetail(missionId)?.mission.state).toBe("failed"),
      { timeout: 10_000 },
    );
    const detail = service.missionDetail(missionId);
    if (!detail) throw new Error("Plane batch failure detail disappeared");
    expect(creationCalls).toBe(2);
    expect(detail.mission.failure).toMatchObject({
      code: "worktree_creation_failure",
      stage: "plane_creation",
    });
    expect(detail.project.activeMissionId).toBeNull();
    expect(detail.planes).toEqual([]);
    expect(detail.contracts.every((contract) => contract.planeId === null)).toBe(true);
    expect(detail.contracts.map((contract) => contract.state).sort()).toEqual([
      "execution_failed",
      "queued",
    ]);
    expect(
      detail.contracts.filter(
        (contract) => contract.failure?.code === "worktree_creation_failure",
      ),
    ).toHaveLength(1);
    expect(detail.agents.every((agent) => agent.currentContractId === null)).toBe(true);
    expect(detail.agents.every((agent) => agent.status !== "busy")).toBe(true);
    expect(detail.collisions).toEqual([]);
    expect(detail.candidates).toEqual([]);
    expect(detail.project.protectedHeadCommit).toBe(detail.mission.baseCommit);
    expect(executor.calls).toBe(0);
    expect(verify).not.toHaveBeenCalled();
    expect(JSON.stringify(toPublicMissionDetail(detail, []))).not.toContain(caseRoot);
    await expect(access(survivingPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(failedPlanePath)).rejects.toMatchObject({ code: "ENOENT" });
    const repositoryPath = detail.project.repositoryPath;
    await expect(access(repositoryPath)).resolves.toBeUndefined();
    const branchResult = await new Promise<string>((resolve, reject) => {
      execFile(
        "git",
        ["-C", repositoryPath, "branch", "--list", survivingBranch],
        { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } },
        (error, stdout) => {
          if (error) reject(new Error("Git branch inspection failed"));
          else resolve(stdout.trim());
        },
      );
    });
    expect(branchResult).toBe("");
    expect(await readFile(outsideCanary, "utf8")).toBe("outside unchanged\n");

    const reloaded = new JsonStore(storePath);
    await reloaded.initialize();
    const persisted = reloaded.snapshot();
    expect(persisted.shepherd.planes.filter((plane) => plane.missionId === missionId)).toEqual([]);
    expect(
      persisted.shepherd.contracts
        .filter((contract) => contract.missionId === missionId)
        .every((contract) => contract.planeId === null),
    ).toBe(true);
  }, 30_000);

  it("fails closed with bounded attention evidence when initial Plane unwind fails", async () => {
    const caseRoot = await makeCaseRoot();
    const managedRoot = path.join(caseRoot, "managed");
    const storePath = path.join(caseRoot, "state.json");
    const store = new JsonStore(storePath);
    await store.initialize();
    const executor = new MustNotRunExecutor();
    const verifier = new HostTrustedFixtureVerifier();
    const verify = vi.spyOn(verifier, "verify");
    const cleanupCanary =
      "TST17_CLEANUP_SECRET EPERM Darwin /Users/private/plane-worktree";
    vi.spyOn(PlaneManager.prototype, "destroyPlane").mockRejectedValue(
      new Error(cleanupCanary),
    );
    let service!: ShepherdService;
    let creationCalls = 0;
    let survivingPath = "";
    let failedPlanePath = "";
    service = new ShepherdService({
      store,
      managedRoot,
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
      executor,
      sensitiveValues: ["TST17_CLEANUP_SECRET"],
      faultCheckpoint: async (checkpoint, context) => {
        if (checkpoint !== "contract_plane_creation_start") return;
        creationCalls += 1;
        if (creationCalls !== 2) return;
        const partial = service
          .state()
          .planes.find((plane) => plane.missionId === context.missionId);
        if (!partial) throw new Error("First Plane was not durable before second creation");
        survivingPath = partial.worktreePath;
        failedPlanePath = path.join(
          managedRoot,
          "planes",
          "auth-demo",
          `contract-${context.planeId}`,
        );
        await mkdir(failedPlanePath);
      },
    });

    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(
      () =>
        expect(service.missionDetail(missionId)?.mission.state).toBe(
          "attention_required",
        ),
      { timeout: 10_000 },
    );
    await store.mutate(() => undefined);
    const detail = service.missionDetail(missionId);
    if (!detail) throw new Error("Plane unwind attention detail disappeared");
    expect(detail.mission).toMatchObject({
      state: "attention_required",
      attentionReason: "plane_unwind_failed",
      failure: { code: "worktree_creation_failure", stage: "plane_creation" },
    });
    expect(detail.project.activeMissionId).toBe(missionId);
    expect(detail.planes).toHaveLength(1);
    expect(detail.planes[0]).toMatchObject({
      state: "failed",
      error: {
        code: "worktree_creation_failure",
        message: "Initial Contract Plane cleanup requires operator attention",
        stage: "plane_unwind",
      },
    });
    expect(
      detail.contracts.map((contract) => contract.state).sort(),
    ).toEqual(["execution_failed", "interrupted"]);
    expect(detail.agents.every((agent) => agent.currentContractId === null)).toBe(true);
    expect(detail.agents.every((agent) => agent.status !== "busy")).toBe(true);
    expect(
      detail.events.some((event) => event.details.failureCode === "persistence_error"),
    ).toBe(false);
    expect(detail.collisions).toEqual([]);
    expect(detail.candidates).toEqual([]);
    expect(detail.project.protectedHeadCommit).toBe(detail.mission.baseCommit);
    expect(executor.calls).toBe(0);
    expect(verify).not.toHaveBeenCalled();
    await expect(access(survivingPath)).resolves.toBeUndefined();
    await expect(access(failedPlanePath)).rejects.toMatchObject({ code: "ENOENT" });

    const reloaded = new JsonStore(storePath, {
      sensitiveValues: ["TST17_CLEANUP_SECRET"],
    });
    await reloaded.initialize();
    const reloadedState = reloaded.snapshot();
    expect(
      reloadedState.shepherd.missions.find((mission) => mission.id === missionId),
    ).toMatchObject({
      state: "attention_required",
      attentionReason: "plane_unwind_failed",
      failure: { code: "worktree_creation_failure", stage: "plane_creation" },
    });
    expect(
      reloadedState.shepherd.planes.filter((plane) => plane.missionId === missionId),
    ).toEqual([
      expect.objectContaining({
        state: "failed",
        error: expect.objectContaining({
          code: "worktree_creation_failure",
          stage: "plane_unwind",
        }),
      }),
    ]);
    const surfaces = [
      JSON.stringify(detail),
      JSON.stringify(toPublicMissionDetail(detail, [])),
      JSON.stringify(reloadedState),
      await readFile(storePath, "utf8"),
    ].join("\n");
    for (const canary of [
      cleanupCanary,
      "TST17_CLEANUP_SECRET",
      "/Users/private/plane-worktree",
      "EPERM Darwin",
    ]) {
      expect(surfaces).not.toContain(canary);
    }
  }, 30_000);

  it.each([
    ["clean abort", false],
    ["unproved cleanup", true],
  ] as const)("persists an actual textual integration conflict with %s", async (_case, cleanupFault) => {
    const caseRoot = await makeCaseRoot();
    const outsideCanary = path.join(caseRoot, "outside-conflict-canary.txt");
    await writeFile(outsideCanary, "outside unchanged\n", "utf8");
    const storePath = path.join(caseRoot, "state.json");
    const store = new JsonStore(storePath);
    await store.initialize();
    let injected = false;
    const conflictFiles = [
      ...Array.from({ length: 9 }, (_, index) => `conflicts/shared-${index}.txt`),
      `conflicts/${"long-name-".repeat(7)}tail.txt`,
    ];
    let service!: ShepherdService;
    service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      ...(cleanupFault
        ? { gitMergeFaults: { beforePostAbortInspection: () => { throw new Error("TST18_PRIVATE /Users/private EPERM Darwin"); } } }
        : {}),
      faultCheckpoint: async (checkpoint, context) => {
        if (checkpoint !== "integration_merge_start" || injected) return;
        injected = true;
        const contractPlanes = service
          .state()
          .planes.filter((plane) => plane.missionId === context.missionId && plane.kind === "contract")
          .sort((left, right) => left.id.localeCompare(right.id));
        expect(contractPlanes).toHaveLength(2);
        for (const [index, plane] of contractPlanes.entries()) {
          await mkdir(path.join(plane.worktreePath, "conflicts"), { recursive: true });
          for (const conflictFile of conflictFiles) {
            await writeFile(path.join(plane.worktreePath, conflictFile), `side-${index}\n`, "utf8");
          }
          await gitOutput(plane.worktreePath, ["add", "--", "conflicts"]);
          await gitOutput(plane.worktreePath, [
            "-c", "user.name=Fixture", "-c", "user.email=fixture@local.invalid",
            "commit", "-m", `test conflict side ${index}`,
          ]);
          const headCommit = await gitOutput(plane.worktreePath, ["rev-parse", "HEAD"]);
          const changedFiles = (await gitOutput(plane.worktreePath, [
            "diff", "--name-only", `${plane.baseCommit}..${headCommit}`, "--",
          ])).split("\n").filter(Boolean).sort();
          await store.mutate((database) => {
            const persisted = database.shepherd.planes.find((item) => item.id === plane.id);
            if (!persisted) throw new Error("Contract Plane disappeared during conflict injection");
            persisted.headCommit = headCommit;
            persisted.changedFiles = changedFiles;
            persisted.authority = {
              readable: ["**"], writable: ["**"], forbidden: [".git/**", ".shepherd/**"],
            };
            const contract = database.shepherd.contracts.find((item) => item.id === plane.contractId);
            if (!contract) throw new Error("Contract disappeared during conflict injection");
            contract.verificationEvidence = contract.verificationEvidence.map((evidence) => ({
              ...evidence, changedFiles,
            }));
          });
        }
      },
    });

    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(
      () => expect(service.missionDetail(missionId)?.mission.state).toBe(cleanupFault ? "attention_required" : "failed"),
      { timeout: 10_000 },
    );
    const detail = service.missionDetail(missionId);
    if (!detail) throw new Error("Git conflict Mission detail disappeared");
    if (cleanupFault) {
      expect(detail.mission).toMatchObject({
        state: "attention_required",
        failure: { code: "git_conflict", stage: "integration_cleanup" },
      });
      expect(detail.project.activeMissionId).toBe(missionId);
      expect(detail.contracts.every((contract) => contract.state === "verified")).toBe(true);
      expect(detail.agents.every((agent) => agent.currentContractId === null && agent.status !== "busy")).toBe(true);
      expect(detail.planes.find((plane) => plane.kind === "integration")).toMatchObject({
        state: "failed", error: { code: "git_conflict", stage: "integration_cleanup" },
      });
      expect(detail.candidates).toEqual([]);
      expect(detail.collisions).toEqual([]);
      const surfaces = JSON.stringify([detail, toPublicMissionDetail(detail, []), service.state()]);
      expect(surfaces).not.toMatch(/TST18_PRIVATE|\/Users\/private|EPERM|Darwin/);
      expect(detail.events.some((event) => event.details.stage === "integration_cleanup")).toBe(true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      backgroundTestMissions.pop();
      const integrationPlane = detail.planes.find((plane) => plane.kind === "integration");
      if (!integrationPlane) throw new Error("Attention integration Plane disappeared");
      await expect(access(integrationPlane.worktreePath)).resolves.toBeUndefined();
      expect(await readFile(outsideCanary, "utf8")).toBe("outside unchanged\n");
      return;
    }
    expect(detail.mission.failure).toMatchObject({
      code: "git_conflict",
      message: "Verified Contract changes conflict during integration",
      stage: "integration_merge",
    });
    expect(detail.contracts.every((contract) => contract.state === "verified")).toBe(true);
    expect(detail.agents.every((agent) => agent.currentContractId === null)).toBe(true);
    expect(detail.agents.every((agent) => agent.status !== "busy")).toBe(true);
    expect(detail.planes.filter((plane) => plane.kind === "integration")).toHaveLength(1);
    const integrationPlane = detail.planes.find((plane) => plane.kind === "integration");
    expect(integrationPlane).toMatchObject({
      state: "failed", error: { code: "git_conflict", stage: "integration_merge" },
    });
    expect(detail.candidates).toEqual([]);
    expect(detail.collisions).toEqual([]);
    expect(detail.project.protectedHeadCommit).toBe(detail.mission.baseCommit);
    const repositoryPath = detail.project.repositoryPath;
    const retainedPlanes = detail.planes.map((plane) => ({
      worktreePath: plane.worktreePath,
      branch: plane.branch,
    }));
    expect(detail.events.some((event) =>
      event.details.failureCode === "git_conflict" &&
      event.details.conflictFileCount === conflictFiles.length,
    )).toBe(true);
    const conflictEvent = detail.events.find((event) => event.details.failureCode === "git_conflict");
    const preview = JSON.parse(String(conflictEvent?.details.conflictFiles)) as string[];
    expect(preview).toHaveLength(8);
    expect(preview.every((file) => file.length <= 48)).toBe(true);
    expect(preview.every((file) => !path.isAbsolute(file))).toBe(true);
    expect(preview.every((file) => !file.split("/").includes(".."))).toBe(true);
    const publicDetail = JSON.stringify(toPublicMissionDetail(detail, []));
    expect(publicDetail).toContain("conflicts/shared-0.txt");
    expect(publicDetail).not.toContain(caseRoot);
    if (!integrationPlane) throw new Error("Failed integration Plane disappeared");
    await expect(access(integrationPlane.worktreePath)).resolves.toBeUndefined();
    expect(await gitOutput(integrationPlane.worktreePath, ["status", "--porcelain=v1"])).toBe("");

    const reloaded = new JsonStore(storePath);
    await reloaded.initialize();
    expect(reloaded.snapshot().shepherd.missions.find((mission) => mission.id === missionId)?.failure)
      .toMatchObject({ code: "git_conflict", stage: "integration_merge" });

    await new Promise<void>((resolve) => setImmediate(resolve));
    backgroundTestMissions.pop();
    const reset = await service.resetDeterministicDemo();
    expect(reset.restoredHead).toBe(detail.mission.baseCommit);
    for (const plane of retainedPlanes) {
      await expect(access(plane.worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await gitOutput(repositoryPath, ["branch", "--list", plane.branch])).toBe("");
    }
    expect(await gitOutput(repositoryPath, ["rev-parse", "HEAD"])).toBe(detail.mission.baseCommit);
    expect(await readFile(outsideCanary, "utf8")).toBe("outside unchanged\n");
  }, 30_000);

  it("rejects unsafe conflict paths at the Git boundary", () => {
    for (const unsafe of ["../escape", "/absolute", "control\u0000name"]) {
      expect(() => assertSafeProjectPath(unsafe)).toThrow();
    }
    expect(assertSafeProjectPath("back\\slash")).toBe("back/slash");
  });

  it("reconciles a transient Mission verification persistence failure without promotion", async () => {
    const caseRoot = await makeCaseRoot();
    const storePath = path.join(caseRoot, "state.json");
    let store!: JsonStore;
    let injected = false;
    store = new JsonStore(storePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (
          !injected &&
          stage === "primary_write" &&
          store.persistenceRecoveryIntent()?.operation === "mission_verification_transition"
        ) {
          injected = true;
          throw new Error("F06_SECRET EIO /Users/private/state.json");
        }
      },
      sensitiveValues: ["F06_SECRET"],
    });
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      sensitiveValues: ["F06_SECRET"],
    });
    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(
      () => expect(["attention_required", "failed"]).toContain(service.missionDetail(missionId)?.mission.state),
      { timeout: 10_000 },
    );
    await vi.waitFor(
      () => expect(store.persistenceRecoveryIntent()).toBeNull(),
      { timeout: 10_000 },
    );
    await store.mutate(() => undefined);
    const detail = service.missionDetail(missionId);
    if (!detail) throw new Error("Persistence failure Mission disappeared");
    expect(injected).toBe(true);
    expect(detail.mission).toMatchObject({
      state: "attention_required",
      attentionReason: "persistence_error",
      failure: {
        code: "persistence_error",
        stage: "mission_verification_persistence",
        message: "Mission persistence failed before integration and requires attention",
      },
    });
    expect(detail.contracts.every((contract) => contract.state === "verified")).toBe(true);
    expect(detail.planes.every((plane) => plane.kind === "contract" && plane.state === "verified")).toBe(true);
    expect(detail.agents.every((agent) => agent.currentContractId === null && agent.status !== "busy")).toBe(true);
    expect(detail.project.activeMissionId).toBe(missionId);
    expect(detail.project.protectedHeadCommit).toBe(detail.mission.baseCommit);
    expect(detail.collisions).toEqual([]);
    expect(detail.candidates).toEqual([]);
    expect(detail.events.filter((event) => event.details.failureCode === "persistence_error")).toHaveLength(1);
    expect(store.persistenceRecoveryIntent()).toBeNull();
    const surfaces = [
      JSON.stringify(detail),
      JSON.stringify(toPublicMissionDetail(detail, [])),
      await readFile(storePath, "utf8"),
    ].join("\n");
    for (const canary of ["F06_SECRET", "EIO", "/Users/private/state.json"]) {
      expect(surfaces).not.toContain(canary);
    }
    const retainedPaths = detail.planes.map((plane) => plane.worktreePath);
    backgroundTestMissions.pop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await service.cancelMission(missionId);
    await service.resetDeterministicDemo();
    await expect(access(storePath + ".persistence-intent.json"))
      .rejects.toMatchObject({ code: "ENOENT" });
    for (const retainedPath of retainedPaths) {
      await expect(access(retainedPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
  }, 30_000);

  it("reconciles a retained persistence journal exactly once across two restarts", async () => {
    const caseRoot = await makeCaseRoot();
    const storePath = path.join(caseRoot, "state.json");
    let store!: JsonStore;
    let failures = 0;
    store = new JsonStore(storePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (
          failures < 2 &&
          stage === "primary_write" &&
          store.persistenceRecoveryIntent()?.operation === "mission_verification_transition"
        ) {
          failures += 1;
          throw new Error("F06_RESTART_SECRET ENOSPC /private/state");
        }
      },
      sensitiveValues: ["F06_RESTART_SECRET"],
    });
    await store.initialize();
    const firstService = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      sensitiveValues: ["F06_RESTART_SECRET"],
    });
    const { missionId } = await firstService.startDeterministicDemo();
    await vi.waitFor(() => expect(failures).toBe(2), { timeout: 10_000 });
    expect(firstService.missionDetail(missionId)?.mission.state).toBe("running");
    expect(store.persistenceRecoveryIntent()).not.toBeNull();

    const originalState = JSON.parse(await readFile(storePath, "utf8")) as Database;
    const originalJournal = JSON.parse(
      await readFile(storePath + ".persistence-intent.json", "utf8"),
    ) as Record<string, unknown>;
    const mismatchPath = path.join(caseRoot, "mismatch", "state.json");
    await mkdir(path.dirname(mismatchPath), { recursive: true });
    const mismatchedState = structuredClone(originalState);
    mismatchedState.shepherd.settings.autoResolution = false;
    await writeFile(mismatchPath, JSON.stringify(mismatchedState, null, 2) + "\n", "utf8");
    await writeFile(
      mismatchPath + ".persistence-intent.json",
      JSON.stringify(originalJournal) + "\n",
      { encoding: "utf8", mode: 0o600 },
    );
    const mismatchStore = new JsonStore(mismatchPath);
    await mismatchStore.initialize();
    await expect(reconcilePersistenceRecoveryIntent({ store: mismatchStore }))
      .rejects.toThrow("Persistence recovery journal does not match durable Mission state");
    expect(mismatchStore.persistenceRecoveryIntent()).not.toBeNull();

    const stalePath = path.join(caseRoot, "stale", "state.json");
    await mkdir(path.dirname(stalePath), { recursive: true });
    const staleState = structuredClone(originalState);
    const staleMission = staleState.shepherd.missions.find((mission) => mission.id === missionId);
    if (!staleMission) throw new Error("Persistence stale fixture Mission disappeared");
    staleMission.state = "queued";
    const staleSerialized = JSON.stringify(staleState, null, 2) + "\n";
    const staleJournal = {
      ...originalJournal,
      beforeDigest: createHash("sha256").update(staleSerialized, "utf8").digest("hex"),
    };
    await writeFile(stalePath, staleSerialized, "utf8");
    await writeFile(
      stalePath + ".persistence-intent.json",
      JSON.stringify(staleJournal) + "\n",
      { encoding: "utf8", mode: 0o600 },
    );
    const staleStore = new JsonStore(stalePath);
    await staleStore.initialize();
    await expect(reconcilePersistenceRecoveryIntent({ store: staleStore }))
      .rejects.toThrow("Persistence recovery journal precondition is stale");
    expect(staleStore.persistenceRecoveryIntent()).not.toBeNull();

    const restartedStore = new JsonStore(storePath, {
      sensitiveValues: ["F06_RESTART_SECRET"],
    });
    await restartedStore.initialize();
    const restartedService = new ShepherdService({
      store: restartedStore,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      sensitiveValues: ["F06_RESTART_SECRET"],
    });
    await restartedService.initialize();
    const recovered = restartedService.missionDetail(missionId);
    expect(recovered?.mission).toMatchObject({
      state: "attention_required",
      failure: { code: "persistence_error", stage: "mission_verification_persistence" },
    });
    expect(recovered?.events.filter((event) => event.details.failureCode === "persistence_error"))
      .toHaveLength(1);
    expect(restartedStore.persistenceRecoveryIntent()).toBeNull();

    const secondStore = new JsonStore(storePath, {
      sensitiveValues: ["F06_RESTART_SECRET"],
    });
    await secondStore.initialize();
    const secondService = new ShepherdService({
      store: secondStore,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      sensitiveValues: ["F06_RESTART_SECRET"],
    });
    await secondService.initialize();
    const twiceRecovered = secondService.missionDetail(missionId);
    expect(twiceRecovered?.events.filter((event) => event.details.failureCode === "persistence_error"))
      .toHaveLength(1);
    const surfaces = [JSON.stringify(twiceRecovered), await readFile(storePath, "utf8")].join("\n");
    for (const canary of ["F06_RESTART_SECRET", "ENOSPC", "/private/state"]) {
      expect(surfaces).not.toContain(canary);
    }
  }, 30_000);

  it("does not invoke a sibling verifier after infrastructure terminalization", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const verifier = new RecordingFrontendInfrastructureVerifier();
    let markBackendReady!: () => void;
    const backendReady = new Promise<void>((resolve) => {
      markBackendReady = resolve;
    });
    let releaseBackend!: () => void;
    const backendReleased = new Promise<void>((resolve) => {
      releaseBackend = resolve;
    });
    let markBackendLifecycleExited!: () => void;
    const backendLifecycleExited = new Promise<void>((resolve) => {
      markBackendLifecycleExited = resolve;
    });
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier,
      faultCheckpoint: async (checkpoint, context) => {
        if (
          checkpoint === "contract_verification_snapshot_ready" &&
          context.contractId?.includes("back")
        ) {
          markBackendReady();
          try {
            await backendReleased;
          } finally {
            markBackendLifecycleExited();
          }
        }
      },
    });

    const run = service.runDeterministicDemo();
    const runOutcome = run.then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    );
    try {
      await backendReady;
      const { error } = await runOutcome;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Contract independent verification infrastructure failed",
      );
      expect(verifier.targetIds).toHaveLength(1);
      expect(verifier.targetIds[0]).toContain("front");
    } finally {
      releaseBackend();
      await backendLifecycleExited;
      await store.mutate(() => undefined);
    }
    expect(verifier.targetIds).toHaveLength(1);
    const missionId = service.state().missions.at(-1)?.id;
    const detail = service.missionDetail(missionId ?? "missing");
    expect(detail?.contracts.map((contract) => contract.state).sort()).toEqual([
      "interrupted",
      "verification_failed",
    ]);
    expect(
      detail?.events.filter((event) => event.type === "verification_passed"),
    ).toEqual([]);
    expect(detail?.planes.every((plane) => plane.kind === "contract")).toBe(true);
  }, 30_000);

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

  it("keeps typed candidate Runtime diagnostics out of durable no-promotion state", async () => {
    const caseRoot = await makeCaseRoot();
    const storePath = path.join(caseRoot, "state.json");
    const store = new JsonStore(storePath);
    await store.initialize();
    const opaqueCanary = "OPAQUE_CANDIDATE_RUNTIME_424242";
    const privatePath = "/Users/private-user/candidate/result.json";
    const diagnostic = `${opaqueCanary} ${privatePath}`;
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new TypedFailingCandidateExecutor(diagnostic),
    });

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "Resolution requires attention: all_candidates_failed",
    );
    const mission = service.state().missions.at(-1);
    expect(mission).toMatchObject({
      state: "attention_required",
      attentionReason: "all_candidates_failed",
    });
    const detail = service.missionDetail(mission?.id ?? "missing");
    expect(detail?.candidates.every((candidate) =>
      candidate.executionState === "failed" &&
      candidate.promotionState === "not_started" &&
      candidate.failure?.message === "Agent Runtime execution failed"
    )).toBe(true);
    expect(detail?.events.some((event) => event.type === "promotion_started")).toBe(false);
    expect(detail?.project.protectedHeadCommit).toBe(mission?.baseCommit);

    const reloaded = new JsonStore(storePath);
    await reloaded.initialize();
    const surfaces = [
      JSON.stringify(detail),
      JSON.stringify(toPublicMissionDetail(detail!, [])),
      JSON.stringify(reloaded.snapshot()),
      await readFile(storePath, "utf8"),
    ].join("\n");
    for (const canary of [opaqueCanary, privatePath]) {
      expect(surfaces).not.toContain(canary);
    }
  }, 30_000);

  it.each([
    {
      kind: "timeout" as const,
      code: "agent_timeout" as const,
      contractState: "execution_timed_out" as const,
      message: "Agent Runtime exceeded the 1234 ms execution deadline",
    },
    {
      kind: "execution" as const,
      code: "agent_runtime_error" as const,
      contractState: "execution_failed" as const,
      message: "Agent Runtime execution failed",
    },
  ])("persists typed Agent Runtime $kind failures across every terminal surface", async ({ kind, code, contractState, message }) => {
    const caseRoot = await makeCaseRoot();
    const statePath = path.join(caseRoot, "state.json");
    const store = new JsonStore(statePath);
    await store.initialize();
    const opaqueCanary = "OPAQUE_TYPED_RUNTIME_CANARY_314159";
    const secretCanary = "SECRET_TYPED_RUNTIME_CANARY_271828";
    const privatePath = "/Users/private-user/runtime/private.sock";
    const runtimeError = new RuntimeExecutionError(
      kind,
      kind === "timeout" ? 1_234 : undefined,
    );
    runtimeError.message = `${opaqueCanary} ${secretCanary} ${privatePath}`;
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new TypedFailingContractExecutor(runtimeError),
    });

    const { missionId } = await startTrackedTestMission(service);
    await vi.waitFor(
      () => expect(service.missionDetail(missionId)?.mission.state).toBe("failed"),
      { timeout: 10_000 },
    );
    const detail = service.missionDetail(missionId);
    if (!detail) throw new Error("Typed Runtime failure detail disappeared");
    expect(detail.mission).toMatchObject({ state: "failed", failure: { code, message } });
    expect(detail.project.activeMissionId).toBeNull();
    expect(detail.contracts.every((contract) => contract.state === contractState && contract.failure?.code === code)).toBe(true);
    expect(detail.planes.every((plane) => plane.kind === "contract" && plane.state === "failed" && plane.error?.code === code)).toBe(true);
    expect(detail.agents.every((agent) => agent.status === "error" && agent.currentContractId === null && agent.lastError === message)).toBe(true);
    expect(detail.candidates).toEqual([]);
    expect(detail.collisions).toEqual([]);
    expect(detail.project.protectedHeadCommit).toBe(detail.mission.baseCommit);
    expect(detail.events.filter((event) => event.contractId !== null && event.details.failureCode === code)).toHaveLength(2);
    expect(detail.events.filter((event) => event.type === "mission_failed" && event.details.failureCode === code)).toHaveLength(1);
    expect(JSON.stringify(toPublicMissionDetail(detail, []))).toContain(`"code":"${code}"`);

    const reloaded = new JsonStore(statePath);
    await reloaded.initialize();
    const persisted = reloaded.snapshot();
    expect(persisted.shepherd.missions.find((mission) => mission.id === missionId)?.failure?.code).toBe(code);
    expect(persisted.shepherd.contracts.filter((contract) => contract.missionId === missionId).every((contract) => contract.failure?.code === code)).toBe(true);
    const publicAndDurable = [
      JSON.stringify(detail),
      JSON.stringify(toPublicMissionDetail(detail, [])),
      JSON.stringify(persisted),
      await readFile(statePath, "utf8"),
    ].join("\n");
    for (const canary of [opaqueCanary, secretCanary, privatePath]) {
      expect(publicAndDurable).not.toContain(canary);
    }
    expect(publicAndDurable).toContain(message);
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

  it("returns the same empty result when a clean demo is reset repeatedly", async () => {
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
    await service.initialize();
    const before = store.snapshot();
    const expected = {
      projectId: "auth-demo",
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

    await expect(service.resetDeterministicDemo()).resolves.toEqual(expected);
    await expect(service.resetDeterministicDemo()).resolves.toEqual(expected);

    expect(store.snapshot()).toEqual(before);
    await expect(
      access(path.join(managedRoot, "repositories", "auth-demo")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      access(path.join(managedRoot, "projects", "auth-demo.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reserves a clean demo reset against a concurrent Mission start", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new CanaryFailureExecutor("concurrent start", "reset reservation"),
    });
    await service.initialize();

    const [reset, start] = await Promise.allSettled([
      service.resetDeterministicDemo(),
      service.runDeterministicDemo(),
    ]);

    expect(reset).toMatchObject({
      status: "fulfilled",
      value: {
        projectId: "auth-demo",
        restoredHead: null,
        removed: { missions: 0 },
      },
    });
    expect(start).toMatchObject({
      status: "rejected",
      reason: { message: "A deterministic Mission is already active for this project" },
    });
    expect(service.state().projects).toEqual([]);
    expect(service.state().missions).toEqual([]);
  });

  it("reserves an initialized demo reset against a concurrent Mission start", async () => {
    const caseRoot = await makeCaseRoot();
    const store = new JsonStore(path.join(caseRoot, "state.json"));
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: path.join(caseRoot, "managed"),
      agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
      verifier: new HostTrustedFixtureVerifier(),
      executor: new CanaryFailureExecutor("concurrent start", "reset reservation"),
    });
    await service.initialize();
    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "executor leaked concurrent start from reset reservation",
    );
    expect(service.state().projects).toHaveLength(1);
    expect(service.state().missions).toHaveLength(1);

    const [reset, start] = await Promise.allSettled([
      service.resetDeterministicDemo(),
      service.runDeterministicDemo(),
    ]);

    expect(reset).toMatchObject({
      status: "fulfilled",
      value: {
        projectId: "auth-demo",
        restoredHead: expect.stringMatching(/^[0-9a-f]{40}$/u),
        removed: { missions: 1 },
      },
    });
    expect(start).toMatchObject({
      status: "rejected",
      reason: { message: "A deterministic Mission is already active for this project" },
    });
    expect(service.state().missions).toEqual([]);
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
    expect(reset.removed.missions).toBe(1);
    expect(reset.removed.events).toBeGreaterThan(0);
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
