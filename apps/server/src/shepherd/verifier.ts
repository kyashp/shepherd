import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import type {
  AcceptanceCheck,
  VerificationCheckResult,
  VerificationEvidence,
} from "./domain.js";
import { assertSafeProjectPath } from "./git-client.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
const SAFE_COMMAND = /^(?:\/[A-Za-z0-9._+/-]+|[A-Za-z0-9][A-Za-z0-9._+-]{0,127})$/;
const SAFE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/;

export interface TrustedCheckProfile {
  id: string;
  command: string;
  args: readonly string[];
  /** Project-relative POSIX directory, or `.` for project root. */
  cwd: string;
}

export interface ResolvedVerificationCheck {
  acceptance: AcceptanceCheck;
  profile: TrustedCheckProfile;
}

export class TrustedCheckRegistry {
  private readonly profiles = new Map<string, TrustedCheckProfile>();

  constructor(profiles: readonly TrustedCheckProfile[]) {
    if (profiles.length === 0) throw new Error("At least one trusted verification profile is required");
    for (const input of profiles) {
      if (!SAFE_IDENTIFIER.test(input.id)) throw new Error("Invalid verification profile ID");
      if (this.profiles.has(input.id)) throw new Error("Duplicate verification profile ID");
      if (!SAFE_COMMAND.test(input.command) || input.command.includes("\0")) {
        throw new Error("Invalid trusted verification command");
      }
      if (input.args.length > 128) throw new Error("Verification profile has too many arguments");
      const args = input.args.map((argument) => {
        if (argument.includes("\0") || argument.length > 4_096) {
          throw new Error("Invalid trusted verification argument");
        }
        return argument;
      });
      const cwd = input.cwd === "." ? "." : assertSafeProjectPath(input.cwd);
      this.profiles.set(input.id, Object.freeze({ id: input.id, command: input.command, args, cwd }));
    }
  }

  resolve(check: AcceptanceCheck): ResolvedVerificationCheck {
    const profile = this.profiles.get(check.profileId);
    if (!profile) throw new Error("Unknown trusted verification profile: " + check.profileId);
    return { acceptance: { ...check }, profile };
  }

  list(): TrustedCheckProfile[] {
    return [...this.profiles.values()].map((profile) => ({
      ...profile,
      args: [...profile.args],
    }));
  }
}

export interface VerificationRequest {
  targetType: VerificationEvidence["targetType"];
  targetId: string;
  planePath: string;
  checks: readonly AcceptanceCheck[];
  changedFiles: readonly string[];
}

export interface VerifierContainerInvocation {
  key: string;
  engine: string;
  args: string[];
  containerName: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface VerifierContainerResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  outputExceeded: boolean;
  cancelled: boolean;
  startError: string | null;
}

export interface VerifierContainerExecutor {
  run(invocation: VerifierContainerInvocation): Promise<VerifierContainerResult>;
  cancel(key: string): Promise<boolean>;
  cleanupOwned?(input: { engine: string; ownerId: string }): Promise<string[]>;
}

interface ActiveContainer {
  child: ChildProcess;
  name: string;
  engine: string;
  cancelled: boolean;
  settled: Promise<void>;
  termination: Promise<void> | null;
}

interface ActiveVerificationTarget {
  cancelled: boolean;
  cancellation: Promise<boolean> | null;
}

function verifierHostEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
  };
  for (const name of [
    "HOME",
    "TMPDIR",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "XDG_RUNTIME_DIR",
  ] as const) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

/** Runs only the already-constructed container-engine argv invocation. */
export class DockerVerifierExecutor implements VerifierContainerExecutor {
  private readonly active = new Map<string, ActiveContainer>();
  private readonly reserved = new Set<string>();
  private readonly cancelledReservations = new Set<string>();
  private readonly terminating = new Set<string>();

  private async removeByName(engine: string, name: string): Promise<void> {
    await new Promise<void>((resolve) => {
      execFile(
        engine,
        ["rm", "--force", name],
        {
          env: verifierHostEnvironment(),
          timeout: 8_000,
          encoding: "utf8",
          maxBuffer: 32_768,
          windowsHide: true,
        },
        () => resolve(),
      );
    });
  }

  private async listOwned(engine: string, ownerId: string): Promise<string[]> {
    return await new Promise<string[]>((resolve, reject) => {
      execFile(
        engine,
        [
          "ps",
          "--all",
          "--quiet",
          "--filter",
          "label=io.codejam.shepherd=independent-verifier",
          "--filter",
          "label=io.codejam.verifier-owner=" + ownerId,
        ],
        {
          env: verifierHostEnvironment(),
          timeout: 8_000,
          encoding: "utf8",
          maxBuffer: 65_536,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error) {
            reject(new Error("Unable to inspect interrupted verifier containers"));
            return;
          }
          const ids = stdout
            .split(/\r?\n/u)
            .map((value) => value.trim())
            .filter((value) => value.length > 0);
          if (ids.some((value) => !/^[a-f0-9]{12,64}$/u.test(value))) {
            reject(new Error("Container engine returned an unsafe verifier identity"));
            return;
          }
          resolve([...new Set(ids)].sort());
        },
      );
    });
  }

  async cleanupOwned(input: { engine: string; ownerId: string }): Promise<string[]> {
    const engine = assertSimpleValue(input.engine, "container engine");
    if (!SAFE_IDENTIFIER.test(input.ownerId)) {
      throw new Error("Invalid verifier owner ID");
    }
    if (
      this.active.size > 0 ||
      this.reserved.size > 0 ||
      this.terminating.size > 0
    ) {
      throw new Error("Cannot reconcile verifier containers while checks are active");
    }
    const owned = await this.listOwned(engine, input.ownerId);
    for (const id of owned) await this.removeByName(engine, id);
    if ((await this.listOwned(engine, input.ownerId)).length > 0) {
      throw new Error("Interrupted verifier containers remain after reconciliation");
    }
    return owned;
  }

  private cleanup(active: ActiveContainer, kill: boolean): Promise<void> {
    if (!active.termination) {
      if (kill) active.child.kill("SIGKILL");
      active.termination = (async () => {
        await active.settled;
        await this.removeByName(active.engine, active.name);
      })();
    }
    return active.termination;
  }

  async run(invocation: VerifierContainerInvocation): Promise<VerifierContainerResult> {
    if (
      this.active.has(invocation.key) ||
      this.reserved.has(invocation.key) ||
      this.terminating.has(invocation.key)
    ) {
      throw new Error("Verification target already has a running container");
    }
    if (invocation.args[0] !== "run" || invocation.args[1] !== "--rm") {
      throw new Error("Verifier invocation must be a disposable container run");
    }
    this.reserved.add(invocation.key);
    const startedAt = Date.now();
    // Create must complete before the check timeout begins. This establishes a
    // removable container identity first, eliminating the `docker run` race in
    // which a short timeout removes by name before the daemon creates it.
    const createArgs = ["create", ...invocation.args.slice(2)];
    const created = await new Promise<boolean>((resolve) => {
      execFile(
        invocation.engine,
        createArgs,
        {
          env: verifierHostEnvironment(),
          timeout: 8_000,
          encoding: "utf8",
          maxBuffer: 32_768,
          windowsHide: true,
        },
        (error) => resolve(!error),
      );
    });
    const cancelledBeforeStart = this.cancelledReservations.delete(invocation.key);
    if (!created || cancelledBeforeStart) {
      this.reserved.delete(invocation.key);
      this.terminating.add(invocation.key);
      try {
        await this.removeByName(invocation.engine, invocation.containerName);
      } finally {
        this.terminating.delete(invocation.key);
      }
      return {
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - startedAt,
        timedOut: false,
        outputExceeded: false,
        cancelled: cancelledBeforeStart,
        startError: created
          ? null
          : "Container engine failed to create the verifier",
      };
    }

    const child = spawn(invocation.engine, ["start", "--attach", invocation.containerName], {
      env: verifierHostEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const settled = new Promise<void>((resolve) => {
      child.once("error", () => resolve());
      child.once("close", () => resolve());
    });
    const active: ActiveContainer = {
      child,
      name: invocation.containerName,
      engine: invocation.engine,
      cancelled: false,
      settled,
      termination: null,
    };
    this.active.set(invocation.key, active);
    this.reserved.delete(invocation.key);

    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    let startError: string | null = null;

    const consume = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const remaining = Math.max(0, invocation.maxOutputBytes - totalBytes);
      if (remaining > 0) {
        const text = chunk.subarray(0, remaining).toString("utf8");
        if (stream === "stdout") stdout += text;
        else stderr += text;
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > invocation.maxOutputBytes && !outputExceeded) {
        outputExceeded = true;
        void this.cleanup(active, true);
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => consume(chunk, "stderr"));

    const timeout = setTimeout(() => {
      timedOut = true;
      void this.cleanup(active, true);
    }, invocation.timeoutMs);
    timeout.unref();

    return await new Promise<VerifierContainerResult>((resolve) => {
      let settled = false;
      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void (async () => {
          await this.cleanup(active, false);
          this.active.delete(invocation.key);
          resolve({
            exitCode,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
            timedOut,
            outputExceeded,
            cancelled: active.cancelled,
            startError,
          });
        })();
      };
      child.once("error", (error) => {
        startError = error instanceof Error ? error.message : "Container engine failed to start";
        finish(null);
      });
      child.once("close", (code) => finish(code));
    });
  }

  async cancel(key: string): Promise<boolean> {
    if (this.terminating.has(key)) return true;
    if (this.reserved.has(key)) {
      this.cancelledReservations.add(key);
      return true;
    }
    const active = this.active.get(key);
    if (!active) return false;
    active.cancelled = true;
    await this.cleanup(active, true);
    return true;
  }
}

export interface ContainerVerifierOptions {
  planesRoot: string;
  containerEngine: string;
  containerImage: string;
  containerUser: string;
  /** Stable per installation so restart cleanup cannot cross installation boundaries. */
  ownerId: string;
  cpuLimit?: number;
  memoryLimit?: string;
  pidsLimit?: number;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
  tmpfsSize?: string;
  sensitiveValues?: readonly string[];
  executor?: VerifierContainerExecutor;
  now?: () => Date;
  idFactory?: () => string;
}

interface NormalizedVerifierOptions {
  planesRoot: string;
  containerEngine: string;
  containerImage: string;
  containerUser: string;
  ownerId: string;
  cpuLimit: number;
  memoryLimit: string;
  pidsLimit: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
  tmpfsSize: string;
  sensitiveValues: string[];
}

function assertSimpleValue(value: string, label: string): string {
  if (value.length === 0 || value.length > 256 || value.includes("\0") || /[\r\n]/.test(value)) {
    throw new Error("Invalid " + label);
  }
  return value;
}

function normalizeOptions(options: ContainerVerifierOptions): NormalizedVerifierOptions {
  const normalized: NormalizedVerifierOptions = {
    planesRoot: path.resolve(options.planesRoot),
    containerEngine: assertSimpleValue(options.containerEngine, "container engine"),
    containerImage: assertSimpleValue(options.containerImage, "container image"),
    containerUser: assertSimpleValue(options.containerUser, "container user"),
    ownerId: options.ownerId,
    cpuLimit: options.cpuLimit ?? 1,
    memoryLimit: options.memoryLimit ?? "512m",
    pidsLimit: options.pidsLimit ?? 128,
    maxTimeoutMs: options.maxTimeoutMs ?? 120_000,
    maxOutputBytes: options.maxOutputBytes ?? 262_144,
    tmpfsSize: options.tmpfsSize ?? "64m",
    sensitiveValues: (options.sensitiveValues ?? []).filter((value) => value.length >= 4),
  };
  if (!SAFE_IDENTIFIER.test(normalized.ownerId)) throw new Error("Invalid verifier owner ID");
  if (!SAFE_IMAGE.test(normalized.containerImage)) throw new Error("Invalid verifier image reference");
  if (!Number.isFinite(normalized.cpuLimit) || normalized.cpuLimit <= 0 || normalized.cpuLimit > 16) {
    throw new Error("Invalid verifier CPU limit");
  }
  if (!/^\d+(?:\.\d+)?[bkmg]$/i.test(normalized.memoryLimit)) {
    throw new Error("Invalid verifier memory limit");
  }
  if (!Number.isInteger(normalized.pidsLimit) || normalized.pidsLimit < 16 || normalized.pidsLimit > 4_096) {
    throw new Error("Invalid verifier PID limit");
  }
  if (normalized.maxTimeoutMs < 100 || normalized.maxTimeoutMs > 600_000) {
    throw new Error("Invalid verifier timeout limit");
  }
  if (normalized.maxOutputBytes < 1_024 || normalized.maxOutputBytes > 4_194_304) {
    throw new Error("Invalid verifier output limit");
  }
  if (!/^\d+(?:\.\d+)?[bkmg]$/i.test(normalized.tmpfsSize)) {
    throw new Error("Invalid verifier tmpfs size");
  }
  return normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

export function verifierContainerName(targetId: string, checkId: string, suffix: string): string {
  const safeTarget = targetId.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 32);
  const safeCheck = checkId.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 24);
  const safeSuffix = suffix.replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
  return "shepherd-verify-" + safeTarget + "-" + safeCheck + "-" + safeSuffix;
}

export function buildVerifierContainerArgs(input: {
  options: NormalizedVerifierOptions;
  planePath: string;
  targetId: string;
  check: ResolvedVerificationCheck;
  containerName: string;
}): string[] {
  if (input.planePath.includes(",") || /[\r\n\0]/.test(input.planePath)) {
    throw new Error("Plane path cannot be represented as a safe container mount");
  }
  const relativeCwd = input.check.profile.cwd === "." ? "" : "/" + input.check.profile.cwd;
  return [
    "run",
    "--rm",
    "--init",
    "--name",
    input.containerName,
    "--label",
    "io.codejam.shepherd=independent-verifier",
    "--label",
    "io.codejam.verification-target=" + input.targetId,
    "--label",
    "io.codejam.verifier-owner=" + input.options.ownerId,
    "--network",
    "none",
    "--read-only",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--cpus",
    String(input.options.cpuLimit),
    "--memory",
    input.options.memoryLimit,
    "--pids-limit",
    String(input.options.pidsLimit),
    "--user",
    input.options.containerUser,
    "--mount",
    "type=bind,src=" + input.planePath + ",dst=/workspace,readonly",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=" + input.options.tmpfsSize,
    "--workdir",
    "/workspace" + relativeCwd,
    "--entrypoint",
    "/usr/bin/env",
    input.options.containerImage,
    "-i",
    "HOME=/tmp",
    "TMPDIR=/tmp",
    "NO_COLOR=1",
    "CI=1",
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    input.check.profile.command,
    ...input.check.profile.args,
  ];
}

function redactOutput(value: string, sensitiveValues: readonly string[], maxBytes: number): string {
  let output = value;
  for (const sensitive of sensitiveValues) output = output.split(sensitive).join("[REDACTED]");
  output = output
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}\b/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
  const bytes = Buffer.from(output, "utf8");
  if (bytes.byteLength <= maxBytes) return output;
  const marker = "\n[OUTPUT TRUNCATED]";
  const markerBytes = Buffer.byteLength(marker, "utf8");
  let prefix = bytes.subarray(0, Math.max(0, maxBytes - markerBytes)).toString("utf8");
  while (Buffer.byteLength(prefix, "utf8") + markerBytes > maxBytes) {
    prefix = prefix.slice(0, -1);
  }
  return prefix + marker;
}

export class ContainerVerifier {
  private readonly options: NormalizedVerifierOptions;
  private readonly executor: VerifierContainerExecutor;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly activeTargets = new Map<string, ActiveVerificationTarget>();
  private canonicalPlanesRoot: string | null = null;

  constructor(
    private readonly registry: TrustedCheckRegistry,
    options: ContainerVerifierOptions,
  ) {
    this.options = normalizeOptions(options);
    this.executor = options.executor ?? new DockerVerifierExecutor();
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  private async assertManagedPlane(planePath: string): Promise<string> {
    this.canonicalPlanesRoot ??= await realpath(this.options.planesRoot);
    const canonicalPlane = await realpath(path.resolve(planePath));
    if (!isInside(this.canonicalPlanesRoot, canonicalPlane)) {
      throw new Error("Verification Plane escapes the managed root");
    }
    return canonicalPlane;
  }

  async verify(request: VerificationRequest): Promise<VerificationEvidence> {
    if (!SAFE_IDENTIFIER.test(request.targetId)) throw new Error("Invalid verification target ID");
    if (request.checks.length === 0 || request.checks.length > 32) {
      throw new Error("Verification requires between 1 and 32 checks");
    }
    if (!request.checks.some((check) => check.mandatory)) {
      throw new Error("Verification requires at least one mandatory check");
    }
    const ids = new Set<string>();
    for (const check of request.checks) {
      if (!SAFE_IDENTIFIER.test(check.id) || ids.has(check.id)) {
        throw new Error("Verification check IDs must be unique safe identifiers");
      }
      ids.add(check.id);
    }
    if (this.activeTargets.has(request.targetId)) {
      throw new Error("Verification target already has an active request");
    }
    const activeTarget: ActiveVerificationTarget = {
      cancelled: false,
      cancellation: null,
    };
    this.activeTargets.set(request.targetId, activeTarget);
    try {
    const changedFiles = [...new Set(request.changedFiles.map(assertSafeProjectPath))].sort();
    const planePath = await this.assertManagedPlane(request.planePath);
    const started = this.now();
    const results: VerificationCheckResult[] = [];

    for (const check of request.checks) {
      if (activeTarget.cancelled) {
        results.push({
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
          error: "Verification was cancelled",
        });
        continue;
      }
      let resolved: ResolvedVerificationCheck;
      try {
        resolved = this.registry.resolve(check);
      } catch (error) {
        results.push({
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
          error: error instanceof Error ? error.message : "Unknown verification profile",
        });
        continue;
      }
      const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
      const name = verifierContainerName(request.targetId, check.id, suffix);
      const timeoutMs = Math.max(100, Math.min(check.timeoutMs, this.options.maxTimeoutMs));
      const args = buildVerifierContainerArgs({
        options: this.options,
        planePath,
        targetId: request.targetId,
        check: resolved,
        containerName: name,
      });
      let execution: VerifierContainerResult;
      try {
        execution = await this.executor.run({
          key: request.targetId,
          engine: this.options.containerEngine,
          args,
          containerName: name,
          timeoutMs,
          maxOutputBytes: this.options.maxOutputBytes,
        });
      } catch (error) {
        execution = {
          exitCode: null,
          stdout: "",
          stderr: "",
          durationMs: 0,
          timedOut: false,
          outputExceeded: false,
          cancelled: false,
          startError: error instanceof Error ? error.message : "Verifier executor failed",
        };
      }
      const infrastructureError =
        execution.startError !== null ||
        execution.outputExceeded ||
        execution.cancelled ||
        execution.exitCode === null ||
        execution.exitCode === 125 ||
        execution.exitCode === 126 ||
        execution.exitCode === 127;
      const passed = !execution.timedOut && !infrastructureError && execution.exitCode === 0;
      const status: VerificationCheckResult["status"] = execution.timedOut
        ? "timed_out"
        : infrastructureError
          ? "infrastructure_error"
          : passed
            ? "passed"
            : "failed";
      const error = execution.timedOut
        ? "Verification timed out after " + timeoutMs + " ms"
        : execution.outputExceeded
          ? "Verification output exceeded the bounded limit"
          : execution.cancelled
            ? "Verification was cancelled"
            : execution.startError
              ? redactOutput(execution.startError, this.options.sensitiveValues, 2_048)
              : infrastructureError
                ? "Verification container failed to execute the trusted profile"
                : passed
                  ? null
                  : "Trusted verification check exited non-zero";
      results.push({
        id: check.id,
        name: check.name,
        profileId: check.profileId,
        mandatory: check.mandatory,
        status,
        passed,
        exitCode: execution.exitCode,
        durationMs: execution.durationMs,
        stdout: redactOutput(execution.stdout, [...this.options.sensitiveValues, planePath], this.options.maxOutputBytes),
        stderr: redactOutput(execution.stderr, [...this.options.sensitiveValues, planePath], this.options.maxOutputBytes),
        error,
      });
    }

    const completed = this.now();
    const mandatory = results.filter((result) => result.mandatory);
    const optional = results.filter((result) => !result.mandatory);
    const mandatoryPassed = mandatory.filter((result) => result.passed).length;
    const optionalPassed = optional.filter((result) => result.passed).length;
    const passed = mandatoryPassed === mandatory.length;
    return {
      id: this.idFactory(),
      targetType: request.targetType,
      targetId: request.targetId,
      runner: "independent",
      passed,
      checks: results,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
      changedFiles,
      summary:
        mandatoryPassed +
        "/" +
        mandatory.length +
        " mandatory checks passed; " +
        optionalPassed +
        "/" +
        optional.length +
        " optional checks passed",
    };
    } finally {
      if (activeTarget.cancellation) {
        await activeTarget.cancellation.catch(() => false);
      }
      if (this.activeTargets.get(request.targetId) === activeTarget) {
        this.activeTargets.delete(request.targetId);
      }
    }
  }

  async cancel(targetId: string): Promise<boolean> {
    if (!SAFE_IDENTIFIER.test(targetId)) throw new Error("Invalid verification target ID");
    const activeTarget = this.activeTargets.get(targetId);
    if (!activeTarget) return false;
    activeTarget.cancelled = true;
    activeTarget.cancellation ??= this.executor.cancel(targetId);
    await activeTarget.cancellation;
    return true;
  }

  /** Removes only verifier containers owned by this stable server identity. */
  async reconcileInterrupted(): Promise<void> {
    if (!this.executor.cleanupOwned) return;
    await this.executor.cleanupOwned({
      engine: this.options.containerEngine,
      ownerId: this.options.ownerId,
    });
  }
}
