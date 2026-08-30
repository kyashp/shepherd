import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { containerStateSubpath, type AppConfig } from "./config.js";
import {
  buildCodexArgs,
  parseCodexEventLine,
  requireEphemeralThreadId,
  resolveRunnerTimeoutMs,
  type ParsedEvents,
} from "./codex-runner.js";
import { RunCancelledError, RuntimeExecutionError } from "./errors.js";
import type {
  AgentRunner,
  EphemeralPreflightResult,
  RunnerRequest,
  RunnerResult,
} from "./types.js";
import { isFreshEphemeralRunnerRequest } from "./types.js";

const execFileAsync = promisify(execFile);

export const SHEPHERD_RUNTIME_MARKER_LABEL =
  "io.codejam.shepherd-runtime=codex-ephemeral-v1";
export const SHEPHERD_RUNTIME_KIND_LABEL =
  "io.codejam.execution-kind=shepherd-ephemeral";
export const SHEPHERD_RUNTIME_OWNER_LABEL = "io.codejam.owner-id";

const ownerPattern =
  /^verifier\.[a-zA-Z0-9_.-]{1,48}\.[a-f0-9]{32}$/u;
const containerIdPattern = /^[a-f0-9]{12,128}$/iu;
const PREFLIGHT_SUCCESS = "SHEPHERD_RUNTIME_PREFLIGHT_OK";
const EXPECTED_CODEX_VERSION = "codex-cli 0.111.0";

const preflightExitReasons = new Map<number, Extract<EphemeralPreflightResult, { available: false }>["reason"]>([
  [40, "non_root_required"],
  [41, "private_home_must_be_read_only"],
  [42, "codex_version_probe_failed"],
  [43, "sandbox_listen_denial_failed"],
  [44, "sandbox_listen_denial_failed"],
  [45, "sandbox_listen_denial_failed"],
  [46, "sandbox_connect_denial_failed"],
  [47, "sandbox_connect_denial_failed"],
  [48, "sandbox_connect_denial_failed"],
  [49, "sandbox_probe_failed"],
  [50, "credential_isolation_failed"],
]);

function boundedPreflightExitCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && Number.isSafeInteger(code) ? code : null;
}

type RuntimeSpawner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ["pipe" | "ignore", "pipe", "pipe"];
  },
) => ChildProcess;

export interface RuntimeExecResult {
  stdout: string | Buffer;
  stderr: string | Buffer;
}

type RuntimeExecFile = (
  command: string,
  args: string[],
  options: { timeout: number; env: NodeJS.ProcessEnv },
) => Promise<RuntimeExecResult>;

export interface ContainerCodexRunnerOptions {
  shepherdOwnerId?: string;
  spawn?: RuntimeSpawner;
  execFile?: RuntimeExecFile;
}

const defaultRuntimeSpawner: RuntimeSpawner = (command, args, options) =>
  spawn(command, args, options);
const defaultRuntimeExecFile: RuntimeExecFile = async (
  command,
  args,
  options,
) => await execFileAsync(command, args, options);

interface BaseActiveContainer {
  containerName: string;
  cancelled: boolean;
  timedOut: boolean;
  outputExceeded: boolean;
  completion: Promise<void>;
  complete(): void;
}

interface ActiveLegacyContainer extends BaseActiveContainer {
  kind: "legacy";
  child: ChildProcess;
  settled: Promise<void>;
  termination: Promise<void> | null;
}

interface ActiveEphemeralContainer extends BaseActiveContainer {
  kind: "ephemeral";
  child: ChildProcess | null;
  containerId: string | null;
  createAttempted: boolean;
  forceKillTimer: NodeJS.Timeout | null;
  termination: Promise<void> | null;
}

type ActiveContainer = ActiveLegacyContainer | ActiveEphemeralContainer;

function completionSignal(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

function childSettled(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once("close", () => resolve());
    child.once("error", () => resolve());
  });
}

function childExitCode(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export function containerName(agentId: string, instanceId = "default"): string {
  const safeInstance = instanceId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 32);
  const safeAgent = agentId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 48);
  return "launchpad-" + safeInstance + "-" + safeAgent;
}

export function ephemeralContainerName(
  executionId: string,
  instanceId = "default",
): string {
  const safeInstance = instanceId.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 32);
  const identityHash = createHash("sha256")
    .update(executionId)
    .digest("hex")
    .slice(0, 32);
  return "launchpad-" + safeInstance + "-shepherd-" + identityHash;
}

function nameForRequest(request: RunnerRequest, instanceId: string): string {
  return isFreshEphemeralRunnerRequest(request)
    ? ephemeralContainerName(request.agentId, instanceId)
    : containerName(request.agentId, instanceId);
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

function assertSafeMountSource(source: string, label: string): void {
  if (
    !path.isAbsolute(source) ||
    /[,\r\n\u0000]/u.test(source) ||
    path.resolve(source) !== source
  ) {
    throw new Error(label + " mount source is invalid");
  }
}

/**
 * Builds one `--mount` specification. Host bind mounts remain the default. When a
 * container state volume is configured, the same directory is addressed as a
 * subpath of that volume instead, because a host share cannot carry the Agent
 * sandbox's per-file access rights on every supported host. `volume-nocopy` is
 * mandatory: without it the engine copies the image's own directory metadata over
 * an empty subpath, silently replacing the non-root owner and denying every write
 * before the sandbox is even applied. A source outside the state root fails closed;
 * it never falls back to a bind mount.
 */
function mountSpecification(
  source: string,
  destination: string,
  config: AppConfig,
  label: string,
  options: readonly string[] = [],
): string {
  const suffix = options.map((option) => "," + option).join("");
  if (!config.containerStateRoot || !config.containerStateVolume) {
    return "type=bind,src=" + source + ",dst=" + destination + suffix;
  }
  const subpath = containerStateSubpath(config.containerStateRoot, source);
  if (subpath === null) {
    throw new Error(label + " mount source escapes CONTAINER_STATE_ROOT");
  }
  return (
    "type=volume,source=" +
    config.containerStateVolume +
    ",target=" +
    destination +
    ",volume-subpath=" +
    subpath +
    ",volume-nocopy=true" +
    suffix
  );
}

function requireOwner(ownerId: string | undefined): string {
  if (!ownerId || !ownerPattern.test(ownerId)) {
    throw new Error("Fresh Shepherd containers require a stable installation owner");
  }
  return ownerId;
}

function shellSingleQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function buildContainerRunArgs(
  request: RunnerRequest,
  config: AppConfig,
  options: Pick<ContainerCodexRunnerOptions, "shepherdOwnerId"> = {},
): string[] {
  const ephemeral = isFreshEphemeralRunnerRequest(request);
  assertSafeMountSource(request.workspacePath, "Workspace");
  if (ephemeral) {
    assertSafeMountSource(request.codexHome, "Ephemeral CODEX_HOME");
    if (pathsOverlap(request.codexHome, request.workspacePath)) {
      throw new Error("Ephemeral CODEX_HOME must be isolated from the workspace");
    }
    if (pathsOverlap(request.codexHome, config.codexHome)) {
      throw new Error("Ephemeral CODEX_HOME cannot reuse the shared Agent home");
    }
  }
  // The shared Agent home is mounted only on the legacy branch, so it was never
  // validated. It reaches the same `--mount` specification as every other source.
  if (!ephemeral) assertSafeMountSource(config.codexHome, "Shared Agent home");
  const ownerId = ephemeral ? requireOwner(options.shepherdOwnerId) : null;
  const name = nameForRequest(request, config.runtimeInstanceId);
  const engineName = config.containerEngine.split(/[\\/]/).at(-1)?.toLowerCase();
  return [
    "run",
    "--rm",
    "--init",
    "--name",
    name,
    "--label",
    "io.codejam.launchpad=agent-runtime",
    "--label",
    "io.codejam.agent-id=" + request.agentId,
    "--label",
    "io.codejam.instance-id=" + config.runtimeInstanceId,
    ...(ephemeral
      ? [
          "--label",
          SHEPHERD_RUNTIME_MARKER_LABEL,
          "--label",
          SHEPHERD_RUNTIME_KIND_LABEL,
          "--label",
          SHEPHERD_RUNTIME_OWNER_LABEL + "=" + ownerId,
        ]
      : []),
    ...(engineName === "podman" ? ["--userns", "keep-id"] : []),
    "--network",
    "bridge",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    ...(ephemeral
      ? ["--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,mode=1777"]
      : []),
    "--cpus",
    String(config.containerCpuLimit),
    "--memory",
    config.containerMemoryLimit,
    "--pids-limit",
    String(config.containerPidsLimit),
    "--user",
    config.containerUser,
    "--env",
    "ARK_API_KEY",
    "--env",
    "CODEX_HOME=/codex-home",
    "--env",
    "HOME=/tmp",
    "--env",
    "NO_COLOR=1",
    "--mount",
    mountSpecification(request.workspacePath, "/workspace", config, "Workspace"),
    "--mount",
    mountSpecification(
      ephemeral ? request.codexHome : config.codexHome,
      "/codex-home",
      config,
      ephemeral ? "Ephemeral CODEX_HOME" : "Shared Agent home",
    ),
    "--workdir",
    "/workspace",
    config.containerRuntimeImage,
    "codex",
    ...buildCodexArgs(request, config.codexSandboxMode, "/workspace"),
  ];
}

export function buildContainerCreateArgs(
  request: RunnerRequest,
  config: AppConfig,
  ownerId: string,
): string[] {
  if (!isFreshEphemeralRunnerRequest(request)) {
    throw new Error("Container create/start is reserved for fresh Shepherd turns");
  }
  const runArgs = buildContainerRunArgs(request, config, {
    shepherdOwnerId: ownerId,
  });
  return ["create", "--interactive", ...runArgs.slice(1)];
}

export function buildContainerStartArgs(containerId: string): string[] {
  if (!containerIdPattern.test(containerId)) {
    throw new Error("Container engine returned an invalid container ID");
  }
  return ["start", "--attach", "--interactive", containerId];
}

export function buildEphemeralPreflightCreateArgs(
  workspacePath: string,
  codexHome: string,
  config: AppConfig,
  ownerId: string,
  executionId = "preflight-" + randomUUID(),
): { args: string[]; containerName: string } {
  const request = {
    mode: "fresh-ephemeral" as const,
    agentId: executionId,
    workspacePath,
    prompt: "preflight",
    threadId: null,
    codexHome,
    timeoutMs: Math.min(config.codexTimeoutMs, 30_000),
  };
  const createArgs = buildContainerCreateArgs(request, config, ownerId);
  const withoutArkEnvironment: string[] = [];
  for (let index = 0; index < createArgs.length; index += 1) {
    if (
      createArgs[index] === "--env" &&
      createArgs[index + 1] === "ARK_API_KEY"
    ) {
      index += 1;
      continue;
    }
    withoutArkEnvironment.push(createArgs[index]!);
  }
  const imageIndex = withoutArkEnvironment.indexOf(config.containerRuntimeImage);
  if (imageIndex < 0) throw new Error("Runtime image disappeared from preflight");
  const workspaceProbe = "/workspace/.shepherd-sandbox-probe";
  const privateHomeProbe =
    "/codex-home/.shepherd-sandbox-negative-probe";
  const listenProbe = [
    'const net = require("node:net");',
    "const server = net.createServer();",
    "const denied = (error) => {",
    'if (error && (error.code === "EPERM" || error.code === "EACCES")) process.exit(0);',
    "process.exit(43);",
    "};",
    'server.once("error", denied);',
    "try {",
    'server.listen({ host: "127.0.0.1", port: 0 }, () => {',
    "server.close(() => process.exit(44));",
    "});",
    "} catch (error) { denied(error); }",
    "setTimeout(() => process.exit(45), 2000);",
  ].join(" ");
  const connectProbe = [
    'const net = require("node:net");',
    "const denied = (error) => {",
    'if (error && (error.code === "EPERM" || error.code === "EACCES")) process.exit(0);',
    "process.exit(46);",
    "};",
    "let socket;",
    "try {",
    'socket = net.connect({ host: "127.0.0.1", port: 9 });',
    'socket.once("error", denied);',
    'socket.once("connect", () => { socket.destroy(); process.exit(47); });',
    "} catch (error) { denied(error); }",
    "setTimeout(() => { socket?.destroy(); process.exit(48); }, 2000);",
  ].join(" ");
  const parentCanary = "SHEPHERD_PARENT_ENV_MUST_NOT_BE_READABLE";
  const sandboxProbe = [
    "set -eu",
    "workspace_probe=" + shellSingleQuote(workspaceProbe),
    ': > "$workspace_probe"',
    'test -f "$workspace_probe"',
    'rm -f "$workspace_probe"',
    "if sh -c " +
      shellSingleQuote(": > " + shellSingleQuote(privateHomeProbe)) +
      " 2>/dev/null; then exit 41; fi",
    "test ! -e " + shellSingleQuote(privateHomeProbe),
    'for candidate in /proc/[0-9]*/environ; do if { tr "\\0" "\\n" < "$candidate"; } 2>/dev/null | grep -Fqx ' +
      shellSingleQuote("SHEPHERD_PARENT_ENV_CANARY=" + parentCanary) +
      "; then exit 50; fi; done",
    "node -e " + shellSingleQuote(listenProbe),
    "node -e " + shellSingleQuote(connectProbe),
  ].join("; ");
  const script = [
    "set -eu",
    "cleanup() { rm -f " +
      shellSingleQuote(workspaceProbe) +
      " " +
      shellSingleQuote(privateHomeProbe) +
      "; }",
    "trap cleanup EXIT HUP INT TERM",
    'test "$(id -u)" -ne 0 || exit 40',
    "codex --version || exit 42",
    "set +e",
    "SHEPHERD_PARENT_ENV_CANARY=" +
      shellSingleQuote(parentCanary) +
      " codex sandbox linux --full-auto env -u SHEPHERD_PARENT_ENV_CANARY sh -c " +
      shellSingleQuote(sandboxProbe),
    "sandbox_status=$?",
    "set -e",
    'if test "$sandbox_status" -ne 0; then case "$sandbox_status" in 41|43|44|45|46|47|48|50) exit "$sandbox_status" ;; *) exit 49 ;; esac; fi',
    "cleanup",
    "trap - EXIT HUP INT TERM",
    "printf '%s\\n' " + PREFLIGHT_SUCCESS,
  ].join("; ");
  return {
    args: [
      ...withoutArkEnvironment.slice(0, imageIndex + 1),
      "sh",
      "-c",
      script,
    ],
    containerName: ephemeralContainerName(executionId, config.runtimeInstanceId),
  };
}

function outputText(value: string | Buffer): string {
  return typeof value === "string" ? value : value.toString("utf8");
}

export class ContainerCodexRunner implements AgentRunner {
  readonly runtimeKind = "container" as const;

  private readonly active = new Map<string, ActiveContainer>();
  private readonly spawnRuntime: RuntimeSpawner;
  private readonly execRuntime: RuntimeExecFile;
  private readonly shepherdOwnerId: string | undefined;

  constructor(
    private readonly config: AppConfig,
    options: ContainerCodexRunnerOptions = {},
  ) {
    this.spawnRuntime = options.spawn ?? defaultRuntimeSpawner;
    this.execRuntime = options.execFile ?? defaultRuntimeExecFile;
    this.shepherdOwnerId = options.shepherdOwnerId;
    if (this.shepherdOwnerId !== undefined) requireOwner(this.shepherdOwnerId);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.execRuntime(this.config.containerEngine, ["version"], {
        timeout: 5_000,
        env: this.childEnvironment(false),
      });
      await this.execRuntime(
        this.config.containerEngine,
        ["image", "inspect", this.config.containerRuntimeImage],
        { timeout: 5_000, env: this.childEnvironment(false) },
      );
      return true;
    } catch {
      return false;
    }
  }

  async reconcileInterrupted(): Promise<number> {
    requireOwner(this.shepherdOwnerId);
    const interrupted = await this.listOwnedContainerIds();
    if (interrupted.length === 0) return 0;
    await this.execRuntime(
      this.config.containerEngine,
      ["rm", "--force", ...interrupted],
      { timeout: 30_000, env: this.childEnvironment(false) },
    );
    const remaining = await this.listOwnedContainerIds();
    if (remaining.length > 0) {
      throw new Error("Unable to reconcile interrupted Shepherd containers");
    }
    return interrupted.length;
  }

  async isEphemeralAvailable(
    workspacePath: string,
    codexHome: string,
  ): Promise<EphemeralPreflightResult> {
    const ownerId = requireOwner(this.shepherdOwnerId);
    let containerId: string | null = null;
    const preflight = buildEphemeralPreflightCreateArgs(
      workspacePath,
      codexHome,
      this.config,
      ownerId,
    );
    let result: EphemeralPreflightResult = {
      available: false,
      stage: "container_create",
      reason: "engine_error",
    };
    try {
      const created = await this.execRuntime(
        this.config.containerEngine,
        preflight.args,
        { timeout: 30_000, env: this.childEnvironment(false) },
      );
      const createOutput = outputText(created.stdout).trim();
      if (!containerIdPattern.test(createOutput)) {
        result = {
          available: false,
          stage: "container_create",
          reason: "invalid_container_id",
        };
      } else {
        containerId = createOutput;
        try {
          const started = await this.execRuntime(
            this.config.containerEngine,
            buildContainerStartArgs(containerId),
            { timeout: 30_000, env: this.childEnvironment(false) },
          );
          const output = outputText(started.stdout);
          result = Buffer.byteLength(output, "utf8") > 65_536
            ? { available: false, stage: "output_validation", reason: "output_too_large" }
            : !output.split(/\r?\n/u).includes(EXPECTED_CODEX_VERSION)
              ? { available: false, stage: "output_validation", reason: "codex_version_mismatch" }
              : !output.includes(PREFLIGHT_SUCCESS)
                ? { available: false, stage: "output_validation", reason: "success_marker_missing" }
                : { available: true };
        } catch (error) {
          result = {
            available: false,
            stage: "container_start",
            reason: preflightExitReasons.get(boundedPreflightExitCode(error) ?? -1) ?? "engine_error",
          };
        }
      }
    } catch {
      result = { available: false, stage: "container_create", reason: "engine_error" };
    }
    try {
      if (containerId) {
        await this.execRuntime(
          this.config.containerEngine,
          ["rm", "--force", containerId],
          { timeout: 8_000, env: this.childEnvironment(false) },
        ).catch(() => undefined);
      }
      await this.removeOwnedContainerByName(preflight.containerName);
    } catch {
      result = { available: false, stage: "cleanup", reason: "cleanup_failed" };
    }
    return result;
  }

  async cancel(agentId: string): Promise<boolean> {
    const active = this.active.get(agentId);
    if (!active) return false;
    active.cancelled = true;
    try {
      if (active.kind === "legacy") {
        await this.removeLegacyContainer(active);
      } else if (active.containerId) {
        await this.removeEphemeralContainer(active);
      } else {
        active.child?.kill("SIGTERM");
      }
    } catch (error) {
      await active.completion;
      throw error;
    }
    await active.completion;
    return true;
  }

  async run(request: RunnerRequest): Promise<RunnerResult> {
    if (this.active.has(request.agentId)) {
      throw new Error("Agent already has an active Runtime container");
    }
    try {
      return await (isFreshEphemeralRunnerRequest(request)
        ? this.runEphemeral(request)
        : this.runLegacy(request));
    } catch (error) {
      if (error instanceof RunCancelledError) throw new RunCancelledError();
      if (error instanceof RuntimeExecutionError) {
        throw new RuntimeExecutionError(error.kind, error.timeoutMs);
      }
      throw new RuntimeExecutionError("execution");
    }
  }

  private async runLegacy(request: RunnerRequest): Promise<RunnerResult> {
    const child = this.spawnRuntime(
      this.config.containerEngine,
      buildContainerRunArgs(request, this.config),
      {
        cwd: request.workspacePath,
        env: this.childEnvironment(true),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (!child.stdout || !child.stderr) {
      child.kill("SIGKILL");
      throw new Error("Runtime process streams were not configured safely");
    }
    const completion = completionSignal();
    const active: ActiveLegacyContainer = {
      kind: "legacy",
      child,
      containerName: containerName(request.agentId, this.config.runtimeInstanceId),
      cancelled: false,
      timedOut: false,
      outputExceeded: false,
      settled: childSettled(child),
      termination: null,
      completion: completion.promise,
      complete: completion.resolve,
    };
    this.active.set(request.agentId, active);
    const timeoutMs = resolveRunnerTimeoutMs(request, this.config.codexTimeoutMs);
    const timeout = setTimeout(() => {
      active.timedOut = true;
      void this.removeLegacyContainer(active);
    }, timeoutMs);
    timeout.unref();
    try {
      return await this.collectCodexResult(child, request, active, false);
    } finally {
      clearTimeout(timeout);
      this.active.delete(request.agentId);
      active.complete();
    }
  }

  private async runEphemeral(
    request: Extract<RunnerRequest, { mode: "fresh-ephemeral" }>,
  ): Promise<RunnerResult> {
    const ownerId = requireOwner(this.shepherdOwnerId);
    const completion = completionSignal();
    const active: ActiveEphemeralContainer = {
      kind: "ephemeral",
      child: null,
      containerId: null,
      containerName: ephemeralContainerName(
        request.agentId,
        this.config.runtimeInstanceId,
      ),
      createAttempted: false,
      cancelled: false,
      timedOut: false,
      outputExceeded: false,
      forceKillTimer: null,
      termination: null,
      completion: completion.promise,
      complete: completion.resolve,
    };
    this.active.set(request.agentId, active);
    const timeoutMs = resolveRunnerTimeoutMs(request, this.config.codexTimeoutMs);
    const timeout = setTimeout(() => {
      active.timedOut = true;
      if (active.containerId) {
        void this.removeEphemeralContainer(active).catch(() => undefined);
      } else {
        active.child?.kill("SIGTERM");
      }
    }, timeoutMs);
    timeout.unref();
    try {
      active.createAttempted = true;
      active.containerId = await this.createEphemeralContainer(
        request,
        ownerId,
        active,
        timeoutMs,
      );
      if (active.cancelled) throw new RunCancelledError();
      if (active.timedOut) {
        throw new RuntimeExecutionError(
          "timeout",
          timeoutMs,
        );
      }
      const child = this.spawnRuntime(
        this.config.containerEngine,
        buildContainerStartArgs(active.containerId),
        {
          cwd: request.workspacePath,
          env: this.childEnvironment(false),
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      active.child = child;
      if (!child.stdin || !child.stdout || !child.stderr) {
        child.kill("SIGKILL");
        throw new Error("Runtime process streams were not configured safely");
      }
      child.stdin.on("error", () => undefined);
      child.stdin.end(request.prompt, "utf8");
      return await this.collectCodexResult(child, request, active, true);
    } finally {
      clearTimeout(timeout);
      if (active.forceKillTimer) clearTimeout(active.forceKillTimer);
      try {
        if (active.containerId) {
          await this.removeEphemeralContainer(active);
        } else if (active.createAttempted) {
          await this.removeOwnedContainerByName(active.containerName);
        }
      } finally {
        this.active.delete(request.agentId);
        active.complete();
      }
    }
  }

  private async createEphemeralContainer(
    request: Extract<RunnerRequest, { mode: "fresh-ephemeral" }>,
    ownerId: string,
    active: ActiveEphemeralContainer,
    timeoutMs: number,
  ): Promise<string> {
    const child = this.spawnRuntime(
      this.config.containerEngine,
      buildContainerCreateArgs(request, this.config, ownerId),
      {
        cwd: request.workspacePath,
        env: this.childEnvironment(true),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    active.child = child;
    if (!child.stdout || !child.stderr) {
      child.kill("SIGKILL");
      throw new Error("Runtime create streams were not configured safely");
    }
    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    const consume = (chunk: Buffer, target: "stdout" | "stderr") => {
      totalBytes += chunk.byteLength;
      if (totalBytes > this.config.codexMaxOutputBytes) {
        active.outputExceeded = true;
        child.kill("SIGTERM");
        return;
      }
      if (target === "stdout") {
        stdout += chunk.toString("utf8");
      } else {
        stderr += chunk.toString("utf8");
        if (stderr.length > 16_384) stderr = stderr.slice(-16_384);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
    const exitCode = await childExitCode(child);
    active.child = null;
    if (active.cancelled) throw new RunCancelledError();
    if (active.timedOut) {
      throw new RuntimeExecutionError(
        "timeout",
        timeoutMs,
      );
    }
    if (active.outputExceeded) {
      throw new Error("Container create output exceeded CODEX_MAX_OUTPUT_BYTES");
    }
    if (exitCode !== 0) {
      throw new Error(
        this.config.containerEngine +
          " create exited with code " +
          exitCode +
          ": " +
          (stderr.trim() || "No error detail"),
      );
    }
    const containerId = stdout.trim();
    if (!containerIdPattern.test(containerId)) {
      throw new Error("Container engine returned an invalid container ID");
    }
    return containerId;
  }

  private async collectCodexResult(
    child: ChildProcess,
    request: RunnerRequest,
    active: ActiveContainer,
    requireFreshThread: boolean,
  ): Promise<RunnerResult> {
    if (!child.stdout || !child.stderr) {
      throw new Error("Runtime process streams were not configured safely");
    }
    const parsed: ParsedEvents = {
      messages: [],
      threadId: request.threadId,
      usage: null,
      errors: [],
      threadIds: [],
    };
    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    const consume = (chunk: Buffer, target: "stdout" | "stderr") => {
      totalBytes += chunk.byteLength;
      if (totalBytes > this.config.codexMaxOutputBytes) {
        active.outputExceeded = true;
        if (active.kind === "ephemeral") {
          void this.removeEphemeralContainer(active).catch(() => undefined);
        } else {
          void this.removeLegacyContainer(active);
        }
        return;
      }
      if (target === "stdout") {
        stdout += chunk.toString("utf8");
        const lines = stdout.split(/\r?\n/u);
        stdout = lines.pop() ?? "";
        for (const line of lines) parseCodexEventLine(line, parsed);
      } else {
        stderr += chunk.toString("utf8");
        if (stderr.length > 16_384) stderr = stderr.slice(-16_384);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
    const exitCode = await childExitCode(child);
    if (stdout.trim()) parseCodexEventLine(stdout.trim(), parsed);
    if (active.cancelled) throw new RunCancelledError();
    if (active.timedOut) {
      const timeoutMs = resolveRunnerTimeoutMs(request, this.config.codexTimeoutMs);
      throw new RuntimeExecutionError(
        "timeout",
        timeoutMs,
      );
    }
    if (active.outputExceeded) {
      throw new RuntimeExecutionError("execution");
    }
    if (exitCode !== 0) {
      throw new RuntimeExecutionError("execution");
    }
    const threadId = requireFreshThread
      ? requireEphemeralThreadId(parsed)
      : parsed.threadId;
    const output = parsed.messages.at(-1)?.trim();
    if (!output) {
      throw new RuntimeExecutionError("execution");
    }
    return { output, threadId, usage: parsed.usage };
  }

  private removeLegacyContainer(active: ActiveLegacyContainer): Promise<void> {
    if (!active.termination) {
      active.termination = this.execRuntime(
        this.config.containerEngine,
        ["rm", "--force", active.containerName],
        { timeout: 8_000, env: this.childEnvironment(false) },
      )
        .then(() => undefined)
        .catch(() => {
          active.child.kill("SIGTERM");
          const forceKill = setTimeout(() => active.child.kill("SIGKILL"), 3_000);
          forceKill.unref();
        });
    }
    return active.termination;
  }

  private removeEphemeralContainer(active: ActiveEphemeralContainer): Promise<void> {
    if (!active.containerId) return Promise.resolve();
    if (!active.termination) {
      const containerId = active.containerId;
      active.termination = this.execRuntime(
        this.config.containerEngine,
        ["rm", "--force", containerId],
        { timeout: 8_000, env: this.childEnvironment(false) },
      )
        .catch(async () => {
          const remaining = await this.listOwnedContainerIds(active.containerName);
          if (remaining.length > 0) {
            throw new Error("Unable to remove Shepherd container");
          }
        })
        .then(async () => {
          const remaining = await this.listOwnedContainerIds(active.containerName);
          if (remaining.length > 0) {
            throw new Error("Shepherd container survived cleanup");
          }
        })
        .finally(() => this.forceSettleEphemeralAttach(active));
    }
    return active.termination;
  }

  private forceSettleEphemeralAttach(active: ActiveEphemeralContainer): void {
    const child = active.child;
    if (
      !child ||
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return;
    }
    child.kill("SIGTERM");
    if (active.forceKillTimer) return;
    active.forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 3_000);
    active.forceKillTimer.unref();
    const clearForceKill = () => {
      if (!active.forceKillTimer) return;
      clearTimeout(active.forceKillTimer);
      active.forceKillTimer = null;
    };
    child.once("close", clearForceKill);
    child.once("error", clearForceKill);
  }

  private async removeOwnedContainerByName(containerName: string): Promise<void> {
    const matching = await this.listOwnedContainerIds(containerName);
    if (matching.length === 0) return;
    await this.execRuntime(
      this.config.containerEngine,
      ["rm", "--force", ...matching],
      { timeout: 8_000, env: this.childEnvironment(false) },
    );
    if ((await this.listOwnedContainerIds(containerName)).length > 0) {
      throw new Error("Shepherd container survived owner-scoped cleanup");
    }
  }

  private async listOwnedContainerIds(containerName?: string): Promise<string[]> {
    const ownerId = requireOwner(this.shepherdOwnerId);
    const args = [
      "ps",
      "--all",
      "--quiet",
      "--filter",
      "label=" + SHEPHERD_RUNTIME_MARKER_LABEL,
      "--filter",
      "label=" + SHEPHERD_RUNTIME_KIND_LABEL,
      "--filter",
      "label=" + SHEPHERD_RUNTIME_OWNER_LABEL + "=" + ownerId,
      ...(containerName ? ["--filter", "name=^/" + containerName + "$"] : []),
    ];
    const result = await this.execRuntime(this.config.containerEngine, args, {
      timeout: 8_000,
      env: this.childEnvironment(false),
    });
    const output = outputText(result.stdout);
    if (Buffer.byteLength(output, "utf8") > this.config.codexMaxOutputBytes) {
      throw new Error("Container reconciliation output exceeded its byte ceiling");
    }
    const ids = output
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (ids.some((id) => !containerIdPattern.test(id))) {
      throw new Error("Container reconciliation returned an invalid ID");
    }
    return [...new Set(ids)];
  }

  private childEnvironment(includeArkKey: boolean): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = { NO_COLOR: "1" };
    if (includeArkKey) environment.ARK_API_KEY = this.config.arkApiKey;
    for (const name of [
      "PATH",
      "HOME",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "XDG_RUNTIME_DIR",
    ] as const) {
      if (process.env[name] !== undefined) environment[name] = process.env[name];
    }
    return environment;
  }
}
