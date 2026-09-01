import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import {
  isArkConfigured,
  writeShepherdCodexConfig,
  type AppConfig,
} from "../config.js";
import { ContainerCodexRunner } from "../container-codex-runner.js";
import { RunCancelledError, RuntimeExecutionError } from "../errors.js";
import type {
  EphemeralContainerRunner,
  RunUsage,
  RunnerResult,
} from "../types.js";
import {
  type ShepherdExecutionRequest,
  type ShepherdExecutionResult,
  type ShepherdExecutor,
} from "./executor.js";
import { MAX_SHEPHERD_PROMPT_BYTES } from "./prompt.js";

const PRIVATE_HOME_PREFIX = "launchpad-shepherd-codex-";
const PRIVATE_HOME_PATTERN = /^launchpad-shepherd-codex-[a-zA-Z0-9]{6}$/u;
const PREFLIGHT_WORKSPACE_PREFIX = ".shepherd-runtime-preflight-";
const PREFLIGHT_WORKSPACE_PATTERN =
  /^\.shepherd-runtime-preflight-[a-zA-Z0-9]{6}$/u;
const PRIVATE_ROOT_SENTINEL = ".shepherd-codex-home-root";
const PRIVATE_ROOT_SENTINEL_CONTENT = "shepherd-codex-home-root-v1\n";
const MAX_EXECUTION_ID_BYTES = 512;
const ownerPattern =
  /^verifier\.[a-zA-Z0-9_.-]{1,48}\.[a-f0-9]{32}$/u;

type FilesystemStage =
  | "sentinel_validation"
  | "sentinel_adoption"
  | "private_root_preparation"
  | "private_home_reconciliation"
  | "preflight_workspace_reconciliation"
  | "preflight_setup"
  | "execution_setup";
type FilesystemReason =
  | "operation_failed"
  | "cleanup_failed"
  | "validation_failed"
  | "adoption_changed";

class BoundedFilesystemError extends Error {
  constructor(
    stage: FilesystemStage,
    reason: FilesystemReason,
  ) {
    super(`Shepherd filesystem operation failed (stage=${stage} reason=${reason})`);
    this.name = "BoundedFilesystemError";
  }
}

function boundedFilesystemError(
  error: unknown,
  stage: FilesystemStage,
  reason: FilesystemReason = "operation_failed",
): BoundedFilesystemError {
  return error instanceof BoundedFilesystemError
    ? error
    : new BoundedFilesystemError(stage, reason);
}

async function boundedFilesystemOperation<T>(
  stage: FilesystemStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw boundedFilesystemError(error, stage);
  }
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeRuntimeError(error: unknown): Error {
  if (error instanceof RunCancelledError) return new RunCancelledError();
  return new RuntimeExecutionError(
    error instanceof RuntimeExecutionError ? error.kind : "execution",
    error instanceof RuntimeExecutionError ? error.timeoutMs : undefined,
  );
}

function pathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  const relative = path.relative(normalizedLeft, normalizedRight);
  const reverse = path.relative(normalizedRight, normalizedLeft);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative)) ||
    (!reverse.startsWith("..") && !path.isAbsolute(reverse))
  );
}

function isStrictChild(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function assertDedicatedRoot(
  root: string,
  other: string,
  otherLabel: string,
): void {
  if (pathsOverlap(root, other)) {
    throw new Error(
      "Shepherd private CODEX_HOME root overlaps " + otherLabel,
    );
  }
}

function assertBoundedIdentifier(value: string, label: string): void {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    Buffer.byteLength(value, "utf8") > MAX_EXECUTION_ID_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(label + " is invalid");
  }
}

function validateRequest(request: ShepherdExecutionRequest): string {
  assertBoundedIdentifier(request.executionId, "Shepherd execution identity");
  if (!path.isAbsolute(request.workspacePath)) {
    throw new Error("Live Shepherd execution requires an absolute workspace path");
  }
  if (!request.prompt || request.prompt.trim().length === 0) {
    throw new Error("Live Shepherd execution requires a fully built prompt");
  }
  if (Buffer.byteLength(request.prompt, "utf8") > MAX_SHEPHERD_PROMPT_BYTES) {
    throw new Error("Live Shepherd prompt exceeds the configured byte ceiling");
  }
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1_000) {
    throw new Error("Live Shepherd timeout must be at least 1000 ms");
  }
  return request.prompt;
}

function validateUsage(usage: RunUsage | null): RunUsage | null {
  if (!usage) return null;
  for (const value of [
    usage.inputTokens,
    usage.cachedInputTokens,
    usage.outputTokens,
  ]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error("Codex returned invalid token usage");
    }
  }
  return { ...usage };
}

function validateResult(result: RunnerResult, maximumBytes: number): {
  summary: string;
  runtimeSessionId: string;
  usage: RunUsage | null;
} {
  const summary = result.output.trim();
  if (!summary) throw new Error("Codex completed without a bounded summary");
  if (Buffer.byteLength(summary, "utf8") > maximumBytes) {
    throw new Error("Codex result exceeded CODEX_MAX_OUTPUT_BYTES");
  }
  if (!result.threadId) {
    throw new Error("Codex ephemeral run completed without a Runtime session ID");
  }
  assertBoundedIdentifier(result.threadId, "Codex Runtime session ID");
  return {
    summary,
    runtimeSessionId: result.threadId,
    usage: validateUsage(result.usage),
  };
}

/**
 * Adapts one trusted, Git-free Plane export to one isolated Codex container.
 * Session state is deliberately ephemeral and never shared with legacy Agents.
 */
export class CodexShepherdExecutor implements ShepherdExecutor {
  readonly kind = "codex_ephemeral" as const;

  private readonly activeExecutionIds = new Set<string>();
  private readonly cancellationRequests = new Set<string>();
  private readonly executionCompletions = new Map<string, Promise<void>>();
  private readonly resolveExecutionCompletions = new Map<string, () => void>();
  private readonly usedExecutionFingerprints = new Set<string>();
  private readonly usedSessionFingerprints = new Set<string>();
  private successfulPreflight: Promise<void> | null = null;
  private pendingSentinelCleanup: string | null = null;

  constructor(
    private readonly config: AppConfig,
    ownerId: string,
    private readonly runner: EphemeralContainerRunner = new ContainerCodexRunner(
      config,
      { shepherdOwnerId: ownerId },
    ),
  ) {
    if (config.runtimeProvider !== "container") {
      throw new Error("Live Shepherd execution is container-only");
    }
    if (!isArkConfigured(config)) {
      throw new Error("Live Shepherd execution requires configured Ark credentials");
    }
    if (config.codexSandboxMode !== "workspace-write") {
      throw new Error(
        "Live Shepherd execution requires CODEX_SANDBOX_MODE=workspace-write",
      );
    }
    if (!ownerPattern.test(ownerId)) {
      throw new Error("Live Shepherd execution requires a stable installation owner");
    }
    if (runner.runtimeKind !== "container") {
      throw new Error("Live Shepherd execution requires a container Runtime");
    }
    if (
      !isStrictChild(config.dataDirectory, config.shepherdCodexHomeRoot)
    ) {
      throw new Error(
        "Shepherd private CODEX_HOME root must be inside APP_DATA_DIR",
      );
    }
    assertDedicatedRoot(
      config.shepherdCodexHomeRoot,
      config.codexHome,
      "the shared Agent CODEX_HOME",
    );
    assertDedicatedRoot(
      config.shepherdCodexHomeRoot,
      config.shepherdRoot,
      "the managed Shepherd root",
    );
  }

  private async validatePrivateRootSentinel(
    sentinelPath: string,
  ): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(
        sentinelPath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      throw boundedFilesystemError(error, "sentinel_validation");
    }
    let failure: Error | null = null;
    try {
      const metadata = await handle.stat();
      if (
        !metadata.isFile() ||
        metadata.size !== Buffer.byteLength(PRIVATE_ROOT_SENTINEL_CONTENT)
      ) {
        throw new BoundedFilesystemError(
          "sentinel_validation",
          "validation_failed",
        );
      }
      if (
        (await handle.readFile({ encoding: "utf8" })) !==
        PRIVATE_ROOT_SENTINEL_CONTENT
      ) {
        throw new BoundedFilesystemError(
          "sentinel_validation",
          "validation_failed",
        );
      }
    } catch (error) {
      failure = boundedFilesystemError(error, "sentinel_validation");
    }
    try {
      await handle.close();
    } catch (error) {
      failure ??= boundedFilesystemError(
        error,
        "sentinel_validation",
        "cleanup_failed",
      );
    }
    if (failure) throw failure;
  }

  private async ensurePrivateRootSentinel(root: string): Promise<void> {
    const sentinelPath = path.join(root, PRIVATE_ROOT_SENTINEL);
    if (this.pendingSentinelCleanup === sentinelPath) {
      try {
        await unlink(sentinelPath);
        this.pendingSentinelCleanup = null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          this.pendingSentinelCleanup = null;
        } else {
          throw boundedFilesystemError(
            error,
            "sentinel_adoption",
            "cleanup_failed",
          );
        }
      }
    }
    try {
      await lstat(sentinelPath);
      await boundedFilesystemOperation("sentinel_validation", async () =>
        await chmod(root, 0o700),
      );
      await this.validatePrivateRootSentinel(sentinelPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw boundedFilesystemError(error, "sentinel_validation");
      }
    }

    if (
      (await boundedFilesystemOperation("sentinel_adoption", async () =>
        await readdir(root),
      )).length > 0
    ) {
      throw new Error("Shepherd private CODEX_HOME unsentinelled root is not empty");
    }
    await boundedFilesystemOperation("sentinel_adoption", async () =>
      await chmod(root, 0o700),
    );
    if (
      (await boundedFilesystemOperation("sentinel_adoption", async () =>
        await readdir(root),
      )).length > 0
    ) {
      throw new Error(
        "Shepherd private CODEX_HOME root changed during adoption",
      );
    }

    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(
        sentinelPath,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_RDWR |
          constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      throw boundedFilesystemError(error, "sentinel_adoption");
    }

    let finalized = false;
    let failure: Error | null = null;
    try {
      // Keep the exclusive sentinel empty (and therefore invalid) until the
      // directory still contains only the entry created by this adoption.
      const entriesAfterCreate = await boundedFilesystemOperation(
        "sentinel_adoption",
        async () => await readdir(root),
      );
      if (
        entriesAfterCreate.length !== 1 ||
        entriesAfterCreate[0] !== PRIVATE_ROOT_SENTINEL
      ) {
        throw new BoundedFilesystemError(
          "sentinel_adoption",
          "adoption_changed",
        );
      }
      await handle.writeFile(PRIVATE_ROOT_SENTINEL_CONTENT, {
        encoding: "utf8",
      });
      await handle.sync();
      const entriesAfterWrite = await boundedFilesystemOperation(
        "sentinel_adoption",
        async () => await readdir(root),
      );
      if (
        entriesAfterWrite.length !== 1 ||
        entriesAfterWrite[0] !== PRIVATE_ROOT_SENTINEL
      ) {
        await handle.truncate(0);
        await handle.sync();
        throw new BoundedFilesystemError(
          "sentinel_adoption",
          "adoption_changed",
        );
      }
      finalized = true;
    } catch (error) {
      failure = boundedFilesystemError(error, "sentinel_adoption");
    }
    try {
      await handle.close();
    } catch (error) {
      failure ??= boundedFilesystemError(
        error,
        "sentinel_adoption",
        "cleanup_failed",
      );
    }
    if (!finalized) {
      try {
        await unlink(sentinelPath);
      } catch (error) {
        this.pendingSentinelCleanup = sentinelPath;
        failure ??= boundedFilesystemError(
          error,
          "sentinel_adoption",
          "cleanup_failed",
        );
      }
    }
    if (failure) throw failure;
    await this.validatePrivateRootSentinel(sentinelPath);
  }

  private async preparePrivateHomeRoot(
    workspacePath?: string,
  ): Promise<string> {
    if (workspacePath) {
      assertDedicatedRoot(
        this.config.shepherdCodexHomeRoot,
        workspacePath,
        "the execution workspace",
      );
    }
    await boundedFilesystemOperation("private_root_preparation", async () =>
      await mkdir(this.config.shepherdCodexHomeRoot, {
        recursive: true,
        mode: 0o700,
      }),
    );
    const rootMetadata = await boundedFilesystemOperation(
      "private_root_preparation",
      async () => await lstat(this.config.shepherdCodexHomeRoot),
    );
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new Error("Shepherd private CODEX_HOME root is not a real directory");
    }
    await this.ensurePrivateRootSentinel(this.config.shepherdCodexHomeRoot);

    const [
      canonicalDataRoot,
      canonicalPrivateRoot,
      canonicalSharedHome,
      canonicalShepherdRoot,
    ] =
      await boundedFilesystemOperation("private_root_preparation", async () =>
        await Promise.all([
          realpath(this.config.dataDirectory),
          realpath(this.config.shepherdCodexHomeRoot),
          realpath(this.config.codexHome),
          realpath(this.config.shepherdRoot),
        ]),
      );
    if (!isStrictChild(canonicalDataRoot, canonicalPrivateRoot)) {
      throw new Error(
        "Canonical Shepherd private CODEX_HOME root escaped APP_DATA_DIR",
      );
    }
    assertDedicatedRoot(
      canonicalPrivateRoot,
      canonicalSharedHome,
      "the canonical shared Agent CODEX_HOME",
    );
    assertDedicatedRoot(
      canonicalPrivateRoot,
      canonicalShepherdRoot,
      "the canonical managed Shepherd root",
    );
    // In state-volume mode the Runtime addresses each source as a subpath of the
    // volume, derived lexically from the absolute path. That derivation is only
    // sound while the canonical path agrees with the lexical one, so assert it
    // here rather than letting a symlink silently mount a different directory.
    const stateRoot = this.config.containerStateRoot;
    if (stateRoot) {
      const canonicalStateRoot = await boundedFilesystemOperation(
        "private_root_preparation",
        async () => await realpath(stateRoot),
      );
      if (canonicalStateRoot !== stateRoot) {
        throw new Error("CONTAINER_STATE_ROOT must be a canonical directory");
      }
      if (!isStrictChild(stateRoot, canonicalPrivateRoot)) {
        throw new Error(
          "Canonical Shepherd private CODEX_HOME root escaped CONTAINER_STATE_ROOT",
        );
      }
      if (!isStrictChild(stateRoot, canonicalShepherdRoot)) {
        throw new Error(
          "Canonical managed Shepherd root escaped CONTAINER_STATE_ROOT",
        );
      }
    }
    if (workspacePath) {
      const canonicalWorkspace = await boundedFilesystemOperation(
        "private_root_preparation",
        async () => await realpath(workspacePath),
      );
      assertDedicatedRoot(
        canonicalPrivateRoot,
        canonicalWorkspace,
        "the canonical execution workspace",
      );
      if (stateRoot && canonicalWorkspace !== path.resolve(workspacePath)) {
        throw new Error(
          "Execution workspace must be canonical under CONTAINER_STATE_ROOT",
        );
      }
    }
    return canonicalPrivateRoot;
  }

  private async removeInterruptedPrivateHomes(root: string): Promise<number> {
    let removed = 0;
    const entries = await boundedFilesystemOperation(
      "private_home_reconciliation",
      async () => await readdir(root, { withFileTypes: true }),
    );
    for (const entry of entries) {
      if (entry.name === PRIVATE_ROOT_SENTINEL) continue;
      if (!PRIVATE_HOME_PATTERN.test(entry.name)) {
        throw new Error("Unexpected entry in Shepherd private CODEX_HOME root");
      }
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error("Interrupted Shepherd CODEX_HOME is not a real directory");
      }
      const candidate = path.join(root, entry.name);
      const [metadata, canonicalCandidate] = await boundedFilesystemOperation(
        "private_home_reconciliation",
        async () => await Promise.all([lstat(candidate), realpath(candidate)]),
      );
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        path.dirname(canonicalCandidate) !== root
      ) {
        throw new Error("Interrupted Shepherd CODEX_HOME escaped its root");
      }
      try {
        await rm(canonicalCandidate, { recursive: true, force: true });
      } catch (error) {
        throw boundedFilesystemError(
          error,
          "private_home_reconciliation",
          "cleanup_failed",
        );
      }
      removed += 1;
    }
    return removed;
  }

  private async removeInterruptedPreflightWorkspaces(): Promise<number> {
    const root = await boundedFilesystemOperation(
      "preflight_workspace_reconciliation",
      async () => await realpath(this.config.shepherdRoot),
    );
    let removed = 0;
    const entries = await boundedFilesystemOperation(
      "preflight_workspace_reconciliation",
      async () => await readdir(root, { withFileTypes: true }),
    );
    for (const entry of entries) {
      if (!PREFLIGHT_WORKSPACE_PATTERN.test(entry.name)) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error("Interrupted Shepherd preflight is not a real directory");
      }
      const candidate = path.join(root, entry.name);
      const [metadata, canonicalCandidate] = await boundedFilesystemOperation(
        "preflight_workspace_reconciliation",
        async () => await Promise.all([lstat(candidate), realpath(candidate)]),
      );
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        path.dirname(canonicalCandidate) !== root
      ) {
        throw new Error("Interrupted Shepherd preflight escaped its root");
      }
      try {
        await rm(canonicalCandidate, { recursive: true, force: true });
      } catch (error) {
        throw boundedFilesystemError(
          error,
          "preflight_workspace_reconciliation",
          "cleanup_failed",
        );
      }
      removed += 1;
    }
    return removed;
  }

  async reconcileInterrupted(): Promise<number> {
    if (this.activeExecutionIds.size > 0) {
      throw new Error("Cannot reconcile Shepherd Runtime while executions are active");
    }
    if (!this.runner.reconcileInterrupted) {
      throw new Error("Container Runtime does not support interrupted-run cleanup");
    }
    this.successfulPreflight = null;
    let removedContainers: number;
    try {
      removedContainers = await this.runner.reconcileInterrupted();
    } catch (error) {
      throw safeRuntimeError(error);
    }
    const privateRoot = await this.preparePrivateHomeRoot();
    const removedHomes = await this.removeInterruptedPrivateHomes(privateRoot);
    const removedPreflights =
      await this.removeInterruptedPreflightWorkspaces();
    return removedContainers + removedHomes + removedPreflights;
  }

  private async performPreflight(): Promise<void> {
    if (
      this.activeExecutionIds.size > 0 ||
      !this.runner.isEphemeralAvailable
    ) {
      throw new Error("Live Shepherd Runtime cannot run its startup preflight");
    }
    let privateHome: string | null = null;
    let workspace: string | null = null;
    let cleanupError: unknown = null;
    try {
      const privateRoot = await this.preparePrivateHomeRoot();
      privateHome = await boundedFilesystemOperation(
        "preflight_setup",
        async () => await mkdtemp(path.join(privateRoot, PRIVATE_HOME_PREFIX)),
      );
      await boundedFilesystemOperation("preflight_setup", async () =>
        await chmod(privateHome!, 0o700),
      );
      await boundedFilesystemOperation("preflight_setup", async () =>
        await writeShepherdCodexConfig(this.config, privateHome!),
      );

      const canonicalShepherdRoot = await boundedFilesystemOperation(
        "preflight_setup",
        async () => await realpath(this.config.shepherdRoot),
      );
      workspace = await boundedFilesystemOperation(
        "preflight_setup",
        async () =>
          await mkdtemp(
            path.join(canonicalShepherdRoot, PREFLIGHT_WORKSPACE_PREFIX),
          ),
      );
      await boundedFilesystemOperation("preflight_setup", async () =>
        await chmod(workspace!, 0o700),
      );
      let preflightResult: Awaited<ReturnType<NonNullable<typeof this.runner.isEphemeralAvailable>>>;
      try {
        preflightResult = await this.runner.isEphemeralAvailable(
          workspace,
          privateHome,
        );
      } catch (error) {
        throw safeRuntimeError(error);
      }
      if (preflightResult === false) {
        throw new Error(
          "Live Shepherd Runtime preflight failed (stage=runtime_probe reason=unavailable)",
        );
      }
      if (typeof preflightResult !== "boolean" && !preflightResult.available) {
        const diagnostic = `stage=${preflightResult.stage} reason=${preflightResult.reason}`;
        throw new Error(`Live Shepherd Runtime preflight failed (${diagnostic})`);
      }
    } finally {
      for (const target of [workspace, privateHome]) {
        if (!target) continue;
        try {
          await rm(target, { recursive: true, force: true });
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (cleanupError) {
        throw new Error(
          "Live Shepherd Runtime preflight failed (stage=cleanup reason=cleanup_failed)",
        );
      }
    }
  }

  async preflight(): Promise<void> {
    if (this.activeExecutionIds.size > 0) {
      throw new Error("Cannot preflight Shepherd Runtime while executions are active");
    }
    this.successfulPreflight ??= this.performPreflight().catch((error) => {
      this.successfulPreflight = null;
      throw error;
    });
    await this.successfulPreflight;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.preflight();
      return true;
    } catch {
      return false;
    }
  }

  async run(
    request: ShepherdExecutionRequest,
  ): Promise<ShepherdExecutionResult> {
    const prompt = validateRequest(request);
    const executionFingerprint = fingerprint(request.executionId);
    if (this.usedExecutionFingerprints.has(executionFingerprint)) {
      throw new Error("Shepherd execution identity was already used");
    }
    this.usedExecutionFingerprints.add(executionFingerprint);
    let resolveExecutionCompletion!: () => void;
    const executionCompletion = new Promise<void>((resolve) => {
      resolveExecutionCompletion = resolve;
    });
    this.executionCompletions.set(request.executionId, executionCompletion);
    this.resolveExecutionCompletions.set(
      request.executionId,
      resolveExecutionCompletion,
    );
    this.activeExecutionIds.add(request.executionId);

    let privateHome: string | null = null;
    let primaryFailed = false;
    try {
      const privateHomeRoot = await this.preparePrivateHomeRoot(
        request.workspacePath,
      );
      privateHome = await boundedFilesystemOperation(
        "execution_setup",
        async () =>
          await mkdtemp(path.join(privateHomeRoot, PRIVATE_HOME_PREFIX)),
      );
      await boundedFilesystemOperation("execution_setup", async () =>
        await chmod(privateHome!, 0o700),
      );
      privateHome = await boundedFilesystemOperation(
        "execution_setup",
        async () => await realpath(privateHome!),
      );
      if (path.dirname(privateHome) !== privateHomeRoot) {
        throw new Error("Ephemeral CODEX_HOME escaped its dedicated root");
      }
      if (this.cancellationRequests.has(request.executionId)) {
        throw new RunCancelledError();
      }
      await boundedFilesystemOperation("execution_setup", async () =>
        await writeShepherdCodexConfig(this.config, privateHome!),
      );
      if (this.cancellationRequests.has(request.executionId)) {
        throw new RunCancelledError();
      }

      let runnerResult: RunnerResult;
      try {
        runnerResult = await this.runner.run({
          mode: "fresh-ephemeral",
          agentId: request.executionId,
          workspacePath: request.workspacePath,
          prompt,
          threadId: null,
          codexHome: privateHome,
          timeoutMs: request.timeoutMs,
        });
      } catch (error) {
        throw safeRuntimeError(error);
      }
      if (this.cancellationRequests.has(request.executionId)) {
        throw new RunCancelledError();
      }
      const result = validateResult(
        runnerResult,
        this.config.codexMaxOutputBytes,
      );
      const sessionFingerprint = fingerprint(result.runtimeSessionId);
      if (this.usedSessionFingerprints.has(sessionFingerprint)) {
        throw new Error("Codex reused a Runtime session ID across Plane executions");
      }
      this.usedSessionFingerprints.add(sessionFingerprint);

      return {
        summary: result.summary,
        changedFiles: [],
        completedAt: new Date().toISOString(),
        runtimeSessionId: result.runtimeSessionId,
        usage: result.usage,
      };
    } catch (error) {
      primaryFailed = true;
      throw error;
    } finally {
      this.cancellationRequests.delete(request.executionId);
      try {
        if (privateHome) {
          try {
            await rm(privateHome, { recursive: true, force: true });
          } catch {
            if (!primaryFailed) {
              throw new RuntimeExecutionError("execution");
            }
          }
        }
      } finally {
        this.activeExecutionIds.delete(request.executionId);
        this.executionCompletions.delete(request.executionId);
        this.resolveExecutionCompletions.get(request.executionId)?.();
        this.resolveExecutionCompletions.delete(request.executionId);
      }
    }
  }

  async cancel(executionId: string): Promise<boolean> {
    const executionCompletion = this.executionCompletions.get(executionId);
    if (!this.activeExecutionIds.has(executionId) || !executionCompletion) {
      return false;
    }
    this.cancellationRequests.add(executionId);
    let cancellationFailure: Error | null = null;
    try {
      await this.runner.cancel(executionId);
    } catch (error) {
      cancellationFailure = safeRuntimeError(error);
    }
    await executionCompletion;
    if (cancellationFailure) throw cancellationFailure;
    return true;
  }
}
