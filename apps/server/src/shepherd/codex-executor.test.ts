import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, toPublicMissionDetail } from "../app.js";
import type { AgentService } from "../agent-service.js";
import { loadConfig, type AppConfig } from "../config.js";
import { RunCancelledError, RuntimeExecutionError } from "../errors.js";
import { JsonStore } from "../store.js";
import type {
  EphemeralContainerRunner,
  EphemeralPreflightResult,
  RunnerRequest,
  RunnerResult,
} from "../types.js";
import { isFreshEphemeralRunnerRequest } from "../types.js";
import { CodexShepherdExecutor } from "./codex-executor.js";
import {
  DeterministicFixtureExecutor,
  type ShepherdExecutionRequest,
  type ShepherdExecutor,
} from "./executor.js";
import { ShepherdService } from "./service.js";
import { HostTrustedFixtureVerifier } from "./test-fixtures/host-trusted-verifier.js";

const OWNER = "verifier.test.0123456789abcdef0123456789abcdef";
const temporaryRoots: string[] = [];
const cleanupFault = vi.hoisted(() => ({
  target: null as string | null,
  targets: new Set<string>(),
  error: null as Error | null,
}));
const sentinelFault = vi.hoisted(() => ({
  openTarget: null as string | null,
  closeTarget: null as string | null,
  writeTarget: null as string | null,
  unlinkTarget: null as string | null,
  readTarget: null as string | null,
  statTarget: null as string | null,
  syncTarget: null as string | null,
  syncSkip: 0,
  truncateTarget: null as string | null,
  truncateCalls: 0,
  appendOnReaddirTarget: null as string | null,
  appendOnReaddirSkip: 0,
  error: null as Error | null,
}));
const operationFault = vi.hoisted(() => ({
  kind: null as
    | "chmod"
    | "lstat"
    | "mkdir"
    | "mkdtemp"
    | "readdir"
    | "realpath"
    | "writeFile"
    | null,
  target: null as string | null,
  targetIncludes: null as string | null,
  skip: 0,
  error: null as Error | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const shouldFail = (kind: NonNullable<typeof operationFault.kind>, target: unknown) => {
    if (operationFault.kind !== kind) return false;
    const candidate = String(target);
    if (
      operationFault.target !== candidate &&
      !(operationFault.targetIncludes && candidate.includes(operationFault.targetIncludes))
    ) return false;
    if (operationFault.skip > 0) {
      operationFault.skip -= 1;
      return false;
    }
    return true;
  };
  return {
    ...actual,
    chmod: async (...args: Parameters<typeof actual.chmod>) => {
      if (shouldFail("chmod", args[0])) {
        throw operationFault.error;
      }
      return await actual.chmod(...args);
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (shouldFail("lstat", args[0])) {
        throw operationFault.error;
      }
      return await actual.lstat(...args);
    },
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      if (shouldFail("mkdir", args[0])) throw operationFault.error;
      return await actual.mkdir(...args);
    },
    mkdtemp: async (...args: Parameters<typeof actual.mkdtemp>) => {
      if (shouldFail("mkdtemp", args[0])) throw operationFault.error;
      return await actual.mkdtemp(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const targetPath = String(args[0]);
      if (sentinelFault.openTarget === targetPath) throw sentinelFault.error;
      const handle = await actual.open(...args);
      return new Proxy(handle, {
        get(target, property) {
          if (property === "close") {
            return async () => {
              await target.close();
              if (sentinelFault.closeTarget === targetPath) {
                throw sentinelFault.error;
              }
            };
          }
          if (property === "stat") {
            return async (...statArgs: Parameters<typeof target.stat>) => {
              if (sentinelFault.statTarget === targetPath) throw sentinelFault.error;
              return await target.stat(...statArgs);
            };
          }
          if (property === "sync") {
            return async () => {
              if (sentinelFault.syncTarget === targetPath) {
                if (sentinelFault.syncSkip > 0) sentinelFault.syncSkip -= 1;
                else throw sentinelFault.error;
              }
              return await target.sync();
            };
          }
          if (property === "truncate") {
            return async (...truncateArgs: Parameters<typeof target.truncate>) => {
              sentinelFault.truncateCalls += 1;
              if (
                sentinelFault.truncateTarget === "*" ||
                sentinelFault.truncateTarget === targetPath
              ) throw sentinelFault.error;
              return await target.truncate(...truncateArgs);
            };
          }
          if (property === "writeFile") {
            return async (...writeArgs: Parameters<typeof target.writeFile>) => {
              if (sentinelFault.writeTarget === targetPath) {
                throw sentinelFault.error;
              }
              return await target.writeFile(...writeArgs);
            };
          }
          if (property === "readFile") {
            return async (...readArgs: Parameters<typeof target.readFile>) => {
              if (sentinelFault.readTarget === targetPath) {
                throw sentinelFault.error;
              }
              return await target.readFile(...readArgs);
            };
          }
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (
        cleanupFault.target === args[0] ||
        (typeof args[0] === "string" && cleanupFault.targets.has(args[0]))
      ) throw cleanupFault.error;
      return actual.rm(...args);
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      if (shouldFail("readdir", args[0])) {
        throw operationFault.error;
      }
      const entries = await actual.readdir(...args);
      if (sentinelFault.appendOnReaddirTarget === String(args[0])) {
        if (sentinelFault.appendOnReaddirSkip > 0) {
          sentinelFault.appendOnReaddirSkip -= 1;
        } else if (entries.every((entry) => typeof entry === "string")) {
          return [...entries, "concurrent-entry"] as typeof entries;
        }
      }
      return entries;
    },
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      if (shouldFail("realpath", args[0])) throw operationFault.error;
      return await actual.realpath(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (sentinelFault.unlinkTarget === String(args[0])) {
        throw sentinelFault.error;
      }
      return await actual.unlink(...args);
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (shouldFail("writeFile", args[0])) throw operationFault.error;
      return await actual.writeFile(...args);
    },
  };
});

interface TestEnvironment {
  root: string;
  config: AppConfig;
  workspace: string;
}

async function environment(
  overrides: NodeJS.ProcessEnv | ((root: string) => NodeJS.ProcessEnv) = {},
): Promise<TestEnvironment> {
  const temporaryParent = path.resolve(process.cwd(), ".tmp", "codex-executor");
  await mkdir(temporaryParent, { recursive: true });
  const root = await mkdtemp(path.join(temporaryParent, "case-"));
  temporaryRoots.push(root);
  const dataDirectory = path.join(root, "data");
  const workspace = path.join(root, "execution-workspace");
  const shepherdRoot = path.join(dataDirectory, "shepherd");
  const codexHome = path.join(root, "shared-codex-home");
  const workspaceRoot = path.join(root, "agent-workspaces");
  await Promise.all([
    mkdir(dataDirectory, { recursive: true }),
    mkdir(workspace, { recursive: true }),
    mkdir(shepherdRoot, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
  ]);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: dataDirectory,
    SHEPHERD_ROOT: shepherdRoot,
    CODEX_HOME: codexHome,
    AGENT_WORKSPACE_ROOT: workspaceRoot,
    RUNTIME_PROVIDER: "container",
    ARK_API_KEY: "ARK_SECRET_NOT_FOR_PROMPTS_OR_FILES",
    ARK_MODEL: "agent-model",
    SHEPHERD_MODEL: "planner-model",
    CODEX_SANDBOX_MODE: "workspace-write",
    ...(typeof overrides === "function" ? overrides(root) : overrides),
  });
  return { root, config, workspace };
}

function executionRequest(
  workspacePath: string,
  executionId = "plane-execution-1",
): ShepherdExecutionRequest {
  return {
    executionId,
    workspacePath,
    operation: { kind: "frontend_contract", contractId: "contract-1" },
    prompt: '{"kind":"contract","objective":"implement"}',
    timeoutMs: 4_321,
  };
}

class FakeContainerRunner implements EphemeralContainerRunner {
  readonly runtimeKind = "container" as const;
  readonly requests: RunnerRequest[] = [];
  readonly privateHomes: string[] = [];
  readonly configFiles: string[] = [];
  sessionIds = ["thread-1"];
  reconcileCount = 0;
  preflightCount = 0;
  preflightAvailable = true;
  preflightResult: boolean | EphemeralPreflightResult | null = null;
  preflightHomes: string[] = [];
  preflightWorkspaces: string[] = [];
  runError: Error | null = null;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(request: RunnerRequest): Promise<RunnerResult> {
    if (!isFreshEphemeralRunnerRequest(request)) {
      throw new Error("Expected a fresh ephemeral request");
    }
    this.requests.push(request);
    this.privateHomes.push(request.codexHome);
    expect((await stat(request.codexHome)).mode & 0o777).toBe(0o700);
    this.configFiles.push(
      await readFile(path.join(request.codexHome, "config.toml"), "utf8"),
    );
    if (this.runError) throw this.runError;
    return {
      output: "Completed isolated work.",
      threadId: this.sessionIds.shift() ?? null,
      usage: { inputTokens: 20, cachedInputTokens: 5, outputTokens: 3 },
    };
  }

  async cancel(): Promise<boolean> {
    return false;
  }

  async reconcileInterrupted(): Promise<number> {
    return this.reconcileCount;
  }

  async isEphemeralAvailable(
    workspacePath: string,
    codexHome: string,
  ): Promise<boolean | EphemeralPreflightResult> {
    this.preflightCount += 1;
    this.preflightWorkspaces.push(workspacePath);
    this.preflightHomes.push(codexHome);
    expect((await stat(codexHome)).mode & 0o777).toBe(0o700);
    expect((await stat(workspacePath)).mode & 0o777).toBe(0o700);
    return this.preflightResult ?? this.preflightAvailable;
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  cleanupFault.target = null;
  cleanupFault.targets.clear();
  cleanupFault.error = null;
  sentinelFault.openTarget = null;
  sentinelFault.closeTarget = null;
  sentinelFault.writeTarget = null;
  sentinelFault.unlinkTarget = null;
  sentinelFault.readTarget = null;
  sentinelFault.statTarget = null;
  sentinelFault.syncTarget = null;
  sentinelFault.syncSkip = 0;
  sentinelFault.truncateTarget = null;
  sentinelFault.truncateCalls = 0;
  sentinelFault.appendOnReaddirTarget = null;
  sentinelFault.appendOnReaddirSkip = 0;
  sentinelFault.error = null;
  operationFault.kind = null;
  operationFault.target = null;
  operationFault.targetIncludes = null;
  operationFault.skip = 0;
  operationFault.error = null;
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

/**
 * Builds a state-volume layout whose five mount roots are lexically inside
 * `CONTAINER_STATE_ROOT`, so `loadConfig` accepts them, while the state root itself
 * is a symlink. Only the executor's canonicality assertions can catch that.
 * `escape` optionally redirects one root outside the state root through a symlink.
 */
async function stateVolumeEnvironment(options: {
  symlinkStateRoot?: boolean;
  escape?: "data" | "shepherd";
}): Promise<TestEnvironment> {
  const temporaryParent = path.resolve(process.cwd(), ".tmp", "codex-executor");
  await mkdir(temporaryParent, { recursive: true });
  const root = await mkdtemp(path.join(temporaryParent, "state-"));
  temporaryRoots.push(root);
  const real = path.join(root, "real-state");
  // When the state root is not itself a symlink it is the real directory, so the
  // canonicality assertion passes and a later guard is the one under test.
  const link = options.symlinkStateRoot ? path.join(root, "linked-state") : real;
  const outside = path.join(root, "outside");
  const relative = {
    data: path.join("data"),
    shepherd: path.join("data", "shepherd"),
    privateHomes: path.join("data", "shepherd-codex-homes"),
    sharedHome: path.join("shared-codex-home"),
    workspaces: path.join("agent-workspaces"),
    workspace: path.join("execution-workspace"),
  };
  await Promise.all(
    Object.values(relative).map((entry) =>
      mkdir(path.join(real, entry), { recursive: true }),
    ),
  );
  if (options.escape) {
    // `data` carries the private CODEX_HOME root with it, so the private root stays
    // a strict child of the canonical data root and only the state-root assertion
    // can catch it. `shepherd` leaves the private root inside and escapes alone.
    const target =
      options.escape === "data" ? relative.data : relative.shepherd;
    await rm(path.join(real, target), { recursive: true, force: true });
    await mkdir(path.join(outside, options.escape, "shepherd"), { recursive: true });
    await mkdir(path.join(outside, options.escape, "shepherd-codex-homes"), {
      recursive: true,
    });
    await symlink(path.join(outside, options.escape), path.join(real, target));
  }
  if (options.symlinkStateRoot) await symlink(real, link);
  const config = loadConfig({
    NODE_ENV: "test",
    RUNTIME_PROVIDER: "container",
    ARK_API_KEY: "ARK_SECRET_NOT_FOR_PROMPTS_OR_FILES",
    ARK_MODEL: "agent-model",
    SHEPHERD_MODEL: "planner-model",
    CODEX_SANDBOX_MODE: "workspace-write",
    CONTAINER_STATE_ROOT: link,
    CONTAINER_STATE_VOLUME: "launchpad-state",
    APP_DATA_DIR: path.join(link, relative.data),
    SHEPHERD_ROOT: path.join(link, relative.shepherd),
    SHEPHERD_CODEX_HOME_ROOT: path.join(link, relative.privateHomes),
    CODEX_HOME: path.join(link, relative.sharedHome),
    AGENT_WORKSPACE_ROOT: path.join(link, relative.workspaces),
  });
  return { root, config, workspace: path.join(link, relative.workspace) };
}

describe("CodexShepherdExecutor", () => {
  it("fails closed when the execution workspace is not canonical under the state volume", async () => {
    // The Runtime derives each volume subpath lexically from the absolute path, so
    // a workspace reached through a symlink would mount a different directory.
    const test = await environment((root) => ({
      CONTAINER_STATE_ROOT: root,
      CONTAINER_STATE_VOLUME: "launchpad-state",
    }));
    const alias = path.join(test.root, "alias-workspace");
    await symlink(test.workspace, alias);
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    await expect(executor.run(executionRequest(alias))).rejects.toThrow(
      "Execution workspace must be canonical under CONTAINER_STATE_ROOT",
    );
  });

  it("fails closed when CONTAINER_STATE_ROOT itself is reached through a symlink", async () => {
    // Every volume subpath is derived lexically from CONTAINER_STATE_ROOT. A root
    // that is lexically canonical but resolves elsewhere would mount a different
    // directory under a name the operator believes is confined, so the mismatch
    // must be refused rather than trusted.
    const test = await stateVolumeEnvironment({ symlinkStateRoot: true });
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    await expect(executor.run(executionRequest(test.workspace))).rejects.toThrow(
      "CONTAINER_STATE_ROOT must be a canonical directory",
    );
  });

  it("fails closed when the private CODEX_HOME root resolves outside the state root", async () => {
    // Lexically the root is inside CONTAINER_STATE_ROOT, so loadConfig accepts it.
    // Only the canonical check catches a symlink that leaves the volume, which
    // would otherwise mount host state the volume was introduced to replace.
    const test = await stateVolumeEnvironment({ escape: "data" });
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    // Asserted in full: the managed-root guard below emits a message sharing the
    // "escaped CONTAINER_STATE_ROOT" suffix, so a loose match would still pass
    // with this guard deleted.
    await expect(executor.run(executionRequest(test.workspace))).rejects.toThrow(
      "Canonical Shepherd private CODEX_HOME root escaped CONTAINER_STATE_ROOT",
    );
  });

  it("fails closed when the managed Shepherd root resolves outside the state root", async () => {
    const test = await stateVolumeEnvironment({ escape: "shepherd" });
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    await expect(executor.run(executionRequest(test.workspace))).rejects.toThrow(
      "Canonical managed Shepherd root escaped CONTAINER_STATE_ROOT",
    );
  });

  it("passes an unchanged runner request when the state volume is unconfigured", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    await executor.run(executionRequest(test.workspace));

    expect(test.config.containerStateRoot).toBeNull();
    expect(runner.requests[0]).toMatchObject({
      mode: "fresh-ephemeral",
      workspacePath: test.workspace,
    });
  });

  it("creates a fresh private home, uses the Agent model, and cleans every run", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    runner.sessionIds = ["thread-1", "thread-2"];
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    const first = await executor.run(executionRequest(test.workspace));
    const second = await executor.run(
      executionRequest(test.workspace, "plane-execution-2"),
    );

    expect(executor.kind).toBe("codex_ephemeral");
    expect(first.runtimeSessionId).toBe("thread-1");
    expect(second.runtimeSessionId).toBe("thread-2");
    expect(first.usage).toEqual({
      inputTokens: 20,
      cachedInputTokens: 5,
      outputTokens: 3,
    });
    expect(new Set(runner.privateHomes).size).toBe(2);
    for (const privateHome of runner.privateHomes) {
      expect(privateHome.startsWith(test.config.shepherdCodexHomeRoot + path.sep)).toBe(
        true,
      );
      await expect(stat(privateHome)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(runner.requests).toEqual([
      expect.objectContaining({
        mode: "fresh-ephemeral",
        threadId: null,
        timeoutMs: 4_321,
        prompt: executionRequest(test.workspace).prompt,
      }),
      expect.objectContaining({
        mode: "fresh-ephemeral",
        threadId: null,
      }),
    ]);
    expect(runner.configFiles[0]).toContain('model = "agent-model"');
    expect(runner.configFiles[0]).not.toContain("planner-model");
    expect(runner.configFiles[0]).not.toContain(
      "ARK_SECRET_NOT_FOR_PROMPTS_OR_FILES",
    );
    expect(runner.configFiles[0]).toContain('inherit = "none"');
    expect(await readdir(test.config.shepherdCodexHomeRoot)).toEqual([
      ".shepherd-codex-home-root",
    ]);
    expect((await stat(test.config.shepherdCodexHomeRoot)).mode & 0o777).toBe(
      0o700,
    );
  });

  it("rejects missing or reused sessions and still removes private homes", async () => {
    const test = await environment();
    const missing = new FakeContainerRunner();
    missing.sessionIds = [];
    const missingExecutor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      missing,
    );
    await expect(
      missingExecutor.run(executionRequest(test.workspace)),
    ).rejects.toThrow("without a Runtime session ID");
    await expect(stat(missing.privateHomes[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const duplicate = new FakeContainerRunner();
    duplicate.sessionIds = ["same-thread", "same-thread"];
    const duplicateExecutor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      duplicate,
    );
    await duplicateExecutor.run(executionRequest(test.workspace, "plane-a"));
    await expect(
      duplicateExecutor.run(executionRequest(test.workspace, "plane-b")),
    ).rejects.toThrow("reused a Runtime session ID");
    await expect(stat(duplicate.privateHomes[1]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("cleans the private home when the Runtime fails", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    runner.runError = new Error("simulated Runtime failure");
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    await expect(executor.run(executionRequest(test.workspace))).rejects.toThrow(
      "Agent Runtime execution failed",
    );
    await expect(stat(runner.privateHomes[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not resolve cancellation until the Runtime execution is fully quiescent", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    let markRunEntered!: () => void;
    const runEntered = new Promise<void>((resolve) => {
      markRunEntered = resolve;
    });
    let releaseRun!: () => void;
    const runReleased = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    let markCancellationForwarded!: () => void;
    const cancellationForwarded = new Promise<void>((resolve) => {
      markCancellationForwarded = resolve;
    });
    runner.run = async (request) => {
      if (!isFreshEphemeralRunnerRequest(request)) {
        throw new Error("Expected a fresh ephemeral request");
      }
      runner.requests.push(request);
      runner.privateHomes.push(request.codexHome);
      markRunEntered();
      await runReleased;
      throw new RunCancelledError();
    };
    runner.cancel = async () => {
      markCancellationForwarded();
      return true;
    };
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);
    const run = executor.run(executionRequest(test.workspace));
    const runOutcome = run.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );

    await runEntered;
    let cancellationSettled = false;
    const cancellation = executor.cancel("plane-execution-1").finally(() => {
      cancellationSettled = true;
    });
    try {
      await cancellationForwarded;
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(cancellationSettled).toBe(false);
      await expect(executor.reconcileInterrupted()).rejects.toThrow(
        "Cannot reconcile Shepherd Runtime while executions are active",
      );

      releaseRun();
      await expect(cancellation).resolves.toBe(true);
      const outcome = await runOutcome;
      expect(outcome).toMatchObject({
        status: "rejected",
        reason: { name: "RunCancelledError", message: "Run cancelled" },
      });
      await expect(executor.reconcileInterrupted()).resolves.toBe(0);
      await expect(stat(runner.privateHomes[0]!)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      releaseRun();
      await Promise.allSettled([cancellation, run]);
    }
  });

  it.each([
    { primary: "success" as const, expectedKind: "execution" as const },
    { primary: "cancelled" as const, expectedKind: "cancelled" as const },
    { primary: "timeout" as const, expectedKind: "timeout" as const },
    { primary: "execution" as const, expectedKind: "execution" as const },
  ])("bounds execution-home cleanup after $primary", async ({ primary, expectedKind }) => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);
    const opaqueCanary = "OPAQUE_EXECUTION_HOME_CLEANUP_8675309";
    const privatePath = "/Users/private-user/Library/Containers/runtime.sock";
    const cleanupDiagnostic = `${opaqueCanary} ${test.config.arkApiKey} ${privatePath} EACCES`;
    const originalRun = runner.run.bind(runner);
    let faultInjected = false;
    runner.run = async (runnerRequest) => {
      if (!isFreshEphemeralRunnerRequest(runnerRequest)) {
        throw new Error("Expected a fresh ephemeral request");
      }
      if (!faultInjected) {
        faultInjected = true;
        cleanupFault.target = runnerRequest.codexHome;
        cleanupFault.error = new Error(cleanupDiagnostic);
        runner.runError =
          primary === "cancelled"
            ? new RunCancelledError()
            : primary === "timeout"
              ? new RuntimeExecutionError("timeout", 4_321)
              : primary === "execution"
                ? new RuntimeExecutionError("execution")
                : null;
      }
      return await originalRun(runnerRequest);
    };

    const failure = await executor
      .run(executionRequest(test.workspace))
      .catch((error: unknown) => error);
    if (expectedKind === "cancelled") {
      expect(failure).toBeInstanceOf(RunCancelledError);
      expect((failure as Error).message).toBe("Run cancelled");
    } else {
      expect(failure).toBeInstanceOf(RuntimeExecutionError);
      expect(failure).toMatchObject({ kind: expectedKind });
      expect((failure as Error).message).toBe(
        expectedKind === "timeout"
          ? "Agent Runtime exceeded the 4321 ms execution deadline"
          : "Agent Runtime execution failed",
      );
    }
    const exposed = [
      String(failure),
      (failure as Error).stack ?? "",
      inspect(failure, { depth: 5 }),
      inspect((failure as Error & { cause?: unknown }).cause, { depth: 5 }),
    ].join("\n");
    for (const canary of [opaqueCanary, test.config.arkApiKey, privatePath, "EACCES"]) {
      expect(exposed).not.toContain(canary);
    }
    await expect(executor.cancel("plane-execution-1")).resolves.toBe(false);
    await expect(stat(runner.privateHomes[0]!)).resolves.toBeDefined();

    cleanupFault.target = null;
    cleanupFault.error = null;
    runner.runError = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(1);
    await expect(stat(runner.privateHomes[0]!)).rejects.toMatchObject({ code: "ENOENT" });
    runner.sessionIds = ["thread-retry"];
    await expect(
      executor.run(executionRequest(test.workspace, `retry-${primary}`)),
    ).resolves.toMatchObject({ runtimeSessionId: "thread-retry" });
    await expect(stat(runner.privateHomes.at(-1)!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("replaces Runtime diagnostics with a fixed public execution failure", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    const commonPatternCanary = "SECONDARY_TOKEN_CANARY_778899";
    runner.runError = new Error(
      "docker stderr leaked " +
        test.config.arkApiKey +
        " api_key=" +
        commonPatternCanary +
        " " +
        "x".repeat(4_000),
    );
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    const failure = await executor
      .run(executionRequest(test.workspace))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toBeInstanceOf(RuntimeExecutionError);
    expect(failure).toMatchObject({ kind: "execution" });
    expect(failure).not.toBe(runner.runError);
    expect((failure as Error).message).toBe("Agent Runtime execution failed");
    expect(String(failure)).not.toContain(test.config.arkApiKey);
    expect(String(failure)).not.toContain(commonPatternCanary);
    expect((failure as Error).stack).not.toContain(commonPatternCanary);
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
    await expect(stat(runner.privateHomes[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves typed timeout identity while redacting the Runtime message", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    runner.runError = new RuntimeExecutionError(
      "timeout",
      4_321,
    );
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    const failure = await executor
      .run(executionRequest(test.workspace))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RuntimeExecutionError);
    expect(failure).toMatchObject({ kind: "timeout" });
    expect((failure as Error).message).toBe(
      "Agent Runtime exceeded the 4321 ms execution deadline",
    );
    expect((failure as Error).message).not.toContain(test.config.arkApiKey);
  });

  it("keeps Runtime secrets out of thrown and persisted service failures", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    const opaqueCanary = "OPAQUE_BENIGN_RUNTIME_DIAGNOSTIC_481516";
    const privatePath = "/Users/private-user/runtime/socket.sock";
    runner.runError = new Error(
      `${opaqueCanary} bearer ${test.config.arkApiKey} at ${privatePath}`,
    );
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);
    const storePath = path.join(test.root, "state.json");
    const store = new JsonStore(storePath, {
      sensitiveValues: [test.config.arkApiKey],
    });
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: test.config.shepherdRoot,
      agentWorkspaceRoot: test.config.workspaceRoot,
      executor,
      verifier: {
        async verify() {
          throw new Error("Verifier must not run after Runtime failure");
        },
        async reconcileInterrupted() {},
      },
      sensitiveValues: [test.config.arkApiKey],
    });
    await service.initialize();

    const failure = await service
      .runDeterministicDemo()
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Agent Runtime execution failed");
    const errorSurfaces = [
      String(failure),
      (failure as Error).stack ?? "",
      inspect(failure, { depth: 5 }),
      inspect((failure as Error & { cause?: unknown }).cause, { depth: 5 }),
    ].join("\n");
    const durableSurfaces = [
      await readFile(storePath, "utf8"),
      JSON.stringify(service.state()),
    ].join("\n");
    for (const canary of [opaqueCanary, test.config.arkApiKey, privatePath]) {
      expect(errorSurfaces).not.toContain(canary);
      expect(durableSurfaces).not.toContain(canary);
    }
    expect(durableSurfaces).toContain("Agent Runtime execution failed");
  });

  it("keeps execution-home cleanup diagnostics out of Contract durable/public state", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    runner.sessionIds = ["contract-thread-1", "contract-thread-2"];
    const originalRun = runner.run.bind(runner);
    const opaqueCanary = "OPAQUE_CONTRACT_HOME_CLEANUP_101010";
    const privatePath = "/Users/private-user/contract/codex-home";
    cleanupFault.error = new Error(
      `${opaqueCanary} ${test.config.arkApiKey} ${privatePath} EPERM`,
    );
    runner.run = async (runnerRequest) => {
      if (!isFreshEphemeralRunnerRequest(runnerRequest)) {
        throw new Error("Expected a fresh ephemeral request");
      }
      cleanupFault.targets.add(runnerRequest.codexHome);
      return await originalRun(runnerRequest);
    };
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);
    const storePath = path.join(test.root, "cleanup-contract-state.json");
    const store = new JsonStore(storePath, {
      sensitiveValues: [test.config.arkApiKey],
    });
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: test.config.shepherdRoot,
      agentWorkspaceRoot: test.config.workspaceRoot,
      executor,
      verifier: new HostTrustedFixtureVerifier(),
      sensitiveValues: [test.config.arkApiKey],
    });
    await service.initialize();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warningLog = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const failure = await service.runDeterministicDemo().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "RuntimeExecutionError",
      kind: "execution",
      message: "Agent Runtime execution failed",
    });
    const missionId = service.state().missions.at(-1)?.id;
    const detail = service.missionDetail(missionId ?? "missing");
    expect(detail?.mission).toMatchObject({
      state: "failed",
      failure: { code: "agent_runtime_error", message: "Agent Runtime execution failed" },
    });
    expect(detail?.contracts.some((contract) => contract.state === "execution_failed")).toBe(true);
    expect(detail?.planes.some((plane) => plane.error?.code === "agent_runtime_error")).toBe(true);
    expect(detail?.agents.some((agent) => agent.lastError === "Agent Runtime execution failed")).toBe(true);
    expect(detail?.events.some((event) => event.details.failureCode === "agent_runtime_error")).toBe(true);
    expect(detail?.candidates).toEqual([]);
    expect(detail?.events.some((event) => event.type === "promotion_started")).toBe(false);

    const reloaded = new JsonStore(storePath, { sensitiveValues: [test.config.arkApiKey] });
    await reloaded.initialize();
    const app = await createApp(test.config, {} as AgentService, service);
    const response = await app.inject({
      method: "GET",
      url: `/api/shepherd/missions/${missionId}`,
      ...(test.config.authToken
        ? { headers: { authorization: `Bearer ${test.config.authToken}` } }
        : {}),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
    const surfaces = [
      String(failure),
      (failure as Error).stack ?? "",
      inspect(failure, { depth: 5 }),
      JSON.stringify(detail),
      JSON.stringify(toPublicMissionDetail(detail!, [])),
      JSON.stringify(reloaded.snapshot()),
      await readFile(storePath, "utf8"),
      response.body,
      JSON.stringify(errorLog.mock.calls),
      JSON.stringify(warningLog.mock.calls),
    ].join("\n");
    for (const canary of [opaqueCanary, test.config.arkApiKey, privatePath, "EPERM"]) {
      expect(surfaces).not.toContain(canary);
    }
  }, 30_000);

  it("keeps execution-setup filesystem diagnostics out of Contract durable/public state", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);
    const storePath = path.join(test.root, "setup-contract-state.json");
    const store = new JsonStore(storePath, {
      sensitiveValues: [test.config.arkApiKey],
    });
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: test.config.shepherdRoot,
      agentWorkspaceRoot: test.config.workspaceRoot,
      executor,
      verifier: new HostTrustedFixtureVerifier(),
      sensitiveValues: [test.config.arkApiKey],
    });
    await service.initialize();
    const diagnostic =
      "TST16_SETUP_SECRET EACCES Darwin /Users/private/runtime/config.toml opaque-config-content";
    operationFault.kind = "writeFile";
    operationFault.targetIncludes = "config.toml";
    operationFault.error = new Error(diagnostic);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warningLog = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const failure = await service.runDeterministicDemo().catch((error: unknown) => error);
    const missionId = service.state().missions.at(-1)?.id;
    const detail = service.missionDetail(missionId ?? "missing");
    expect(detail?.mission.state).toBe("failed");
    expect(detail?.contracts.some((contract) => contract.state === "execution_failed")).toBe(true);
    expect(detail?.candidates).toEqual([]);
    expect(detail?.events.some((event) => event.type === "promotion_started")).toBe(false);

    const reloaded = new JsonStore(storePath, {
      sensitiveValues: [test.config.arkApiKey],
    });
    await reloaded.initialize();
    const app = await createApp(test.config, {} as AgentService, service);
    const response = await app.inject({
      method: "GET",
      url: `/api/shepherd/missions/${missionId}`,
      ...(test.config.authToken
        ? { headers: { authorization: `Bearer ${test.config.authToken}` } }
        : {}),
    });
    expect(response.statusCode).toBe(200);
    await app.close();
    const surfaces = [
      String(failure),
      (failure as Error).stack ?? "",
      inspect(failure, { depth: 8 }),
      inspect((failure as Error & { cause?: unknown }).cause, { depth: 8 }),
      JSON.stringify(detail),
      JSON.stringify(toPublicMissionDetail(detail!, [])),
      JSON.stringify(reloaded.snapshot()),
      await readFile(storePath, "utf8"),
      response.body,
      JSON.stringify(errorLog.mock.calls),
      JSON.stringify(warningLog.mock.calls),
    ].join("\n");
    for (const canary of [
      "TST16_SETUP_SECRET",
      "/Users/private/runtime/config.toml",
      "opaque-config-content",
      "EACCES",
    ]) {
      expect(surfaces).not.toContain(canary);
    }

    operationFault.kind = null;
    operationFault.targetIncludes = null;
    operationFault.error = null;
    await executor.reconcileInterrupted();
    await expect(
      executor.run(executionRequest(test.workspace, "setup-retry")),
    ).resolves.toMatchObject({ summary: "Completed isolated work." });
  }, 30_000);

  it("keeps candidate cleanup failures bounded and prevents promotion", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    runner.sessionIds = Array.from({ length: 8 }, (_, index) => `candidate-thread-${index}`);
    const originalRun = runner.run.bind(runner);
    const opaqueCanary = "OPAQUE_CANDIDATE_HOME_CLEANUP_202020";
    const privatePath = "/private/tmp/candidate/codex-home";
    cleanupFault.error = new Error(`${opaqueCanary} ${privatePath} EACCES`);
    runner.run = async (runnerRequest) => {
      if (!isFreshEphemeralRunnerRequest(runnerRequest)) {
        throw new Error("Expected a fresh ephemeral request");
      }
      cleanupFault.targets.add(runnerRequest.codexHome);
      return await originalRun(runnerRequest);
    };
    const liveExecutor = new CodexShepherdExecutor(test.config, OWNER, runner);
    // Candidate scheduling is concurrent; establish the shared root first so this
    // fixture isolates cleanup after the runner has received a private home.
    await expect(liveExecutor.preflight()).resolves.toBeUndefined();
    expect(runner.preflightCount).toBe(1);
    const fixtureExecutor = new DeterministicFixtureExecutor();
    const routedExecutor: ShepherdExecutor = {
      kind: "deterministic_fixture",
      run: async (request) =>
        request.operation.kind === "resolution_candidate"
          ? await liveExecutor.run(request)
          : await fixtureExecutor.run(request),
      cancel: async (executionId) =>
        (await liveExecutor.cancel(executionId)) ||
        (await fixtureExecutor.cancel(executionId)),
    };
    const storePath = path.join(test.root, "cleanup-candidate-state.json");
    const store = new JsonStore(storePath);
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: test.config.shepherdRoot,
      agentWorkspaceRoot: test.config.workspaceRoot,
      executor: routedExecutor,
      verifier: new HostTrustedFixtureVerifier(),
    });

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "Resolution requires attention: all_candidates_failed",
    );
    const mission = service.state().missions.at(-1);
    const detail = service.missionDetail(mission?.id ?? "missing");
    expect(detail?.mission).toMatchObject({
      state: "attention_required",
      attentionReason: "all_candidates_failed",
    });
    expect(
      detail?.candidates.every((candidate) =>
        candidate.executionState === "failed" &&
        candidate.promotionState === "not_started"
      ),
      JSON.stringify(detail?.candidates),
    ).toBe(true);
    expect(
      detail?.candidates.some(
        (candidate) =>
          candidate.failure?.message === "Agent Runtime execution failed",
      ),
    ).toBe(true);
    expect(detail?.events.some((event) => event.type === "promotion_started")).toBe(false);
    expect(detail?.project.protectedHeadCommit).toBe(mission?.baseCommit);
    const surfaces = [
      JSON.stringify(detail),
      JSON.stringify(toPublicMissionDetail(detail!, [])),
      await readFile(storePath, "utf8"),
    ].join("\n");
    for (const canary of [opaqueCanary, privatePath, "EACCES"]) {
      expect(surfaces).not.toContain(canary);
    }
  }, 30_000);

  it("keeps candidate setup filesystem failures bounded and prevents promotion", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    const liveExecutor = new CodexShepherdExecutor(test.config, OWNER, runner);
    const fixtureExecutor = new DeterministicFixtureExecutor();
    const routedExecutor: ShepherdExecutor = {
      kind: "deterministic_fixture",
      run: async (request) =>
        request.operation.kind === "resolution_candidate"
          ? await liveExecutor.run(request)
          : await fixtureExecutor.run(request),
      cancel: async (executionId) =>
        (await liveExecutor.cancel(executionId)) ||
        (await fixtureExecutor.cancel(executionId)),
    };
    const storePath = path.join(test.root, "setup-candidate-state.json");
    const store = new JsonStore(storePath);
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: test.config.shepherdRoot,
      agentWorkspaceRoot: test.config.workspaceRoot,
      executor: routedExecutor,
      verifier: new HostTrustedFixtureVerifier(),
    });
    const diagnostic =
      "TST16_CANDIDATE_SECRET EACCES Linux /private/tmp/candidate/config.toml";
    operationFault.kind = "writeFile";
    operationFault.targetIncludes = "config.toml";
    operationFault.error = new Error(diagnostic);

    await expect(service.runDeterministicDemo()).rejects.toThrow(
      "Resolution requires attention: all_candidates_failed",
    );
    const mission = service.state().missions.at(-1);
    const detail = service.missionDetail(mission?.id ?? "missing");
    expect(detail?.mission).toMatchObject({
      state: "attention_required",
      attentionReason: "all_candidates_failed",
    });
    expect(
      detail?.candidates.every(
        (candidate) =>
          candidate.executionState === "failed" &&
          candidate.promotionState === "not_started",
      ),
    ).toBe(true);
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
    for (const canary of [
      "TST16_CANDIDATE_SECRET",
      "/private/tmp/candidate/config.toml",
      "EACCES Linux",
    ]) {
      expect(surfaces).not.toContain(canary);
    }
  }, 30_000);

  it("preserves cancellation type without propagating a raw cancellation error", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    const rawCancellation = new RunCancelledError();
    rawCancellation.message = "cancelled with " + test.config.arkApiKey;
    runner.runError = rawCancellation;
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    const failure = await executor
      .run(executionRequest(test.workspace))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RunCancelledError);
    expect(failure).not.toBe(rawCancellation);
    expect((failure as Error).message).toBe("Run cancelled");
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("cancels an active Runtime and cleans its private home", async () => {
    const test = await environment();
    let rejectRun!: (error: Error) => void;
    let runReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      runReady = resolve;
    });
    const runner = new FakeContainerRunner();
    runner.run = async (request) => {
      if (!isFreshEphemeralRunnerRequest(request)) throw new Error("wrong mode");
      runner.privateHomes.push(request.codexHome);
      runReady();
      return await new Promise<RunnerResult>((_resolve, reject) => {
        rejectRun = reject;
      });
    };
    runner.cancel = async () => {
      rejectRun(new RunCancelledError());
      return true;
    };
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);
    const outcome = executor
      .run(executionRequest(test.workspace))
      .catch((error: unknown) => error);
    await ready;

    await expect(executor.cancel("plane-execution-1")).resolves.toBe(true);
    expect(await outcome).toBeInstanceOf(RunCancelledError);
    await expect(stat(runner.privateHomes[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("removes owner-scoped containers before crash-left private homes", async () => {
    const test = await environment();
    const order: string[] = [];
    const runner = new FakeContainerRunner();
    runner.reconcileCount = 2;
    runner.reconcileInterrupted = async () => {
      order.push("containers");
      return 2;
    };
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);
    await executor.run(executionRequest(test.workspace));
    const leftover = await mkdtemp(
      path.join(
        test.config.shepherdCodexHomeRoot,
        "launchpad-shepherd-codex-",
      ),
    );
    const leftoverPreflight = await mkdtemp(
      path.join(
        test.config.shepherdRoot,
        ".shepherd-runtime-preflight-",
      ),
    );
    expect(await stat(leftover)).toBeDefined();
    expect(await stat(leftoverPreflight)).toBeDefined();

    await expect(executor.reconcileInterrupted()).resolves.toBe(4);
    order.push("homes-checked");
    expect(order).toEqual(["containers", "homes-checked"]);
    await expect(stat(leftover)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(leftoverPreflight)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(test.config.shepherdRoot)).toEqual([]);
    expect(await readdir(test.config.shepherdCodexHomeRoot)).toEqual([
      ".shepherd-codex-home-root",
    ]);
    expect(runner.preflightCount).toBe(0);
  });

  it("bounds sentinel adoption open faults and permits exact retry", async () => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const diagnostic =
      "TST15_OPEN_SECRET EACCES Darwin /Users/private/runtime/sentinel";
    sentinelFault.openTarget = sentinelPath;
    sentinelFault.error = new Error(diagnostic);
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message:
        "Shepherd filesystem operation failed (stage=sentinel_adoption reason=operation_failed)",
    });
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
    const visible = [String(failure), (failure as Error).stack ?? "", inspect(failure, { depth: 5 })].join("\n");
    expect(visible).not.toContain(diagnostic);
    expect(visible).not.toContain("/Users/private/runtime/sentinel");
    expect(await readdir(test.config.shepherdCodexHomeRoot)).toEqual([]);

    sentinelFault.openTarget = null;
    sentinelFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(0);
    await expect(readFile(sentinelPath, "utf8")).resolves.toBe(
      "shepherd-codex-home-root-v1\n",
    );
  });

  it("bounds sentinel validation close faults without invalidating the sentinel", async () => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );
    await executor.reconcileInterrupted();
    const diagnostic =
      "TST15_CLOSE_SECRET EBADF Linux /private/tmp/runtime/sentinel";
    sentinelFault.closeTarget = sentinelPath;
    sentinelFault.error = new Error(diagnostic);

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message:
        "Shepherd filesystem operation failed (stage=sentinel_validation reason=cleanup_failed)",
    });
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(inspect(failure, { depth: 5 })).not.toContain(diagnostic);
    await expect(readFile(sentinelPath, "utf8")).resolves.toBe(
      "shepherd-codex-home-root-v1\n",
    );

    sentinelFault.closeTarget = null;
    sentinelFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(0);
  });

  it.each([
    { kind: "lstat" as const, existing: true, stage: "sentinel_validation" },
    { kind: "chmod" as const, existing: true, stage: "sentinel_validation" },
    { kind: "readdir" as const, existing: false, stage: "sentinel_adoption" },
    { kind: "chmod" as const, existing: false, stage: "sentinel_adoption" },
  ])("bounds sentinel pre-open $kind faults during $stage", async ({ kind, existing, stage }) => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );
    if (existing) await executor.reconcileInterrupted();
    const diagnostic =
      "TST15_PREOPEN_SECRET EACCES Darwin /Users/private/runtime/preopen";
    operationFault.kind = kind;
    operationFault.target = kind === "lstat" ? sentinelPath : test.config.shepherdCodexHomeRoot;
    operationFault.error = new Error(diagnostic);

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect((failure as Error).message).toBe(
      `Shepherd filesystem operation failed (stage=${stage} reason=operation_failed)`,
    );
    const visible = [String(failure), (failure as Error).stack ?? "", inspect(failure, { depth: 5 })].join("\n");
    expect(visible).not.toContain(diagnostic);
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();

    operationFault.kind = null;
    operationFault.target = null;
    operationFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(0);
    await expect(readFile(sentinelPath, "utf8")).resolves.toBe(
      "shepherd-codex-home-root-v1\n",
    );
  });

  it.each([
    { edge: "validation-stat" as const, existing: true, readdirSkip: 0 },
    { edge: "adoption-sync" as const, existing: false, readdirSkip: 0 },
    { edge: "pre-adoption-recheck" as const, existing: false, readdirSkip: 1 },
    { edge: "post-create-readdir" as const, existing: false, readdirSkip: 2 },
    { edge: "post-write-readdir" as const, existing: false, readdirSkip: 3 },
  ])("bounds sentinel $edge operational faults", async ({ edge, existing, readdirSkip }) => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );
    if (existing) await executor.reconcileInterrupted();
    const diagnostic =
      "TST16_SENTINEL_SECRET EIO Darwin /Users/private/runtime/sentinel";
    sentinelFault.error = new Error(diagnostic);
    if (edge === "validation-stat") sentinelFault.statTarget = sentinelPath;
    if (edge === "adoption-sync") sentinelFault.syncTarget = sentinelPath;
    if (edge.includes("readdir") || edge === "pre-adoption-recheck") {
      operationFault.kind = "readdir";
      operationFault.target = test.config.shepherdCodexHomeRoot;
      operationFault.skip = readdirSkip;
      operationFault.error = sentinelFault.error;
    }

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect((failure as Error).message).toMatch(
      /^Shepherd filesystem operation failed \(stage=sentinel_(?:validation|adoption) reason=operation_failed\)$/u,
    );
    const visible = [String(failure), (failure as Error).stack ?? "", inspect(failure, { depth: 8 })].join("\n");
    expect(visible).not.toContain(diagnostic);
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();

    sentinelFault.statTarget = null;
    sentinelFault.syncTarget = null;
    sentinelFault.error = null;
    operationFault.kind = null;
    operationFault.target = null;
    operationFault.skip = 0;
    operationFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(0);
  });

  it("bounds sentinel truncate failure after a concurrent adoption change", async () => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const diagnostic =
      "TST16_TRUNCATE_SECRET EIO Linux /private/tmp/runtime/sentinel";
    sentinelFault.appendOnReaddirTarget = test.config.shepherdCodexHomeRoot;
    sentinelFault.appendOnReaddirSkip = 3;
    sentinelFault.truncateTarget = "*";
    sentinelFault.error = new Error(diagnostic);
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect(sentinelFault.truncateCalls).toBe(1);
    expect((failure as Error).message).toBe(
      "Shepherd filesystem operation failed (stage=sentinel_adoption reason=operation_failed)",
    );
    expect(inspect(failure, { depth: 8 })).not.toContain(diagnostic);
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();

    sentinelFault.appendOnReaddirTarget = null;
    sentinelFault.truncateTarget = null;
    sentinelFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(0);
  });

  it("bounds the second sentinel sync failure after truncating a changed adoption", async () => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const diagnostic =
      "TST16_SECOND_SYNC_SECRET EIO Darwin /Users/private/runtime/sentinel";
    sentinelFault.appendOnReaddirTarget = test.config.shepherdCodexHomeRoot;
    sentinelFault.appendOnReaddirSkip = 3;
    sentinelFault.syncTarget = sentinelPath;
    sentinelFault.syncSkip = 1;
    sentinelFault.error = new Error(diagnostic);
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect((failure as Error).message).toBe(
      "Shepherd filesystem operation failed (stage=sentinel_adoption reason=operation_failed)",
    );
    expect(inspect(failure, { depth: 8 })).not.toContain(diagnostic);
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();

    sentinelFault.appendOnReaddirTarget = null;
    sentinelFault.syncTarget = null;
    sentinelFault.syncSkip = 0;
    sentinelFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(0);
  });

  it("preserves sentinel validation body failure across close failure", async () => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );
    await executor.reconcileInterrupted();
    const diagnostic =
      "TST15_VALIDATION_DOUBLE_SECRET EIO Linux /private/tmp/sentinel";
    sentinelFault.readTarget = sentinelPath;
    sentinelFault.closeTarget = sentinelPath;
    sentinelFault.error = new Error(diagnostic);

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect((failure as Error).message).toBe(
      "Shepherd filesystem operation failed (stage=sentinel_validation reason=operation_failed)",
    );
    expect(inspect(failure, { depth: 5 })).not.toContain(diagnostic);

    sentinelFault.readTarget = null;
    sentinelFault.closeTarget = null;
    sentinelFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(0);
  });

  it("fails closed on adoption close-only cleanup and retries the valid sentinel", async () => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const diagnostic =
      "TST15_ADOPTION_CLOSE_SECRET EBADF macOS /Users/private/adoption";
    sentinelFault.closeTarget = sentinelPath;
    sentinelFault.error = new Error(diagnostic);
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect((failure as Error).message).toBe(
      "Shepherd filesystem operation failed (stage=sentinel_adoption reason=cleanup_failed)",
    );
    expect(inspect(failure, { depth: 5 })).not.toContain(diagnostic);
    await expect(readFile(sentinelPath, "utf8")).resolves.toBe(
      "shepherd-codex-home-root-v1\n",
    );

    sentinelFault.closeTarget = null;
    sentinelFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(0);
  });

  it("preserves adoption primary failure across close and unlink double faults", async () => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const diagnostic =
      "TST15_DOUBLE_SECRET EIO macOS /Users/private/runtime/adoption";
    sentinelFault.writeTarget = sentinelPath;
    sentinelFault.closeTarget = sentinelPath;
    sentinelFault.unlinkTarget = sentinelPath;
    sentinelFault.error = new Error(diagnostic);
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message:
        "Shepherd filesystem operation failed (stage=sentinel_adoption reason=operation_failed)",
    });
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
    const visible = [String(failure), (failure as Error).stack ?? "", inspect(failure, { depth: 5 })].join("\n");
    expect(visible).not.toContain(diagnostic);
    await expect(stat(sentinelPath)).resolves.toBeDefined();

    sentinelFault.writeTarget = null;
    sentinelFault.closeTarget = null;
    const retryFailure = await executor
      .reconcileInterrupted()
      .catch((error: unknown) => error);
    expect((retryFailure as Error).message).toBe(
      "Shepherd filesystem operation failed (stage=sentinel_adoption reason=cleanup_failed)",
    );
    expect(inspect(retryFailure, { depth: 5 })).not.toContain(diagnostic);
    await expect(stat(sentinelPath)).resolves.toBeDefined();

    sentinelFault.unlinkTarget = null;
    sentinelFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(0);
    await expect(readFile(sentinelPath, "utf8")).resolves.toBe(
      "shepherd-codex-home-root-v1\n",
    );
  });

  it.each([
    {
      kind: "private-home" as const,
      stage: "private_home_reconciliation",
    },
    {
      kind: "preflight-workspace" as const,
      stage: "preflight_workspace_reconciliation",
    },
  ])("bounds interrupted $kind removal and retries the retained target", async ({ kind, stage }) => {
    const test = await environment();
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );
    await executor.reconcileInterrupted();
    const target = await mkdtemp(
      path.join(
        kind === "private-home"
          ? test.config.shepherdCodexHomeRoot
          : test.config.shepherdRoot,
        kind === "private-home"
          ? "launchpad-shepherd-codex-"
          : ".shepherd-runtime-preflight-",
      ),
    );
    const diagnostic =
      "TST15_RECONCILE_SECRET EPERM Linux /private/tmp/runtime/reconcile";
    cleanupFault.target = target;
    cleanupFault.error = new Error(diagnostic);

    const failure = await executor.reconcileInterrupted().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message: `Shepherd filesystem operation failed (stage=${stage} reason=cleanup_failed)`,
    });
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined();
    const visible = [String(failure), (failure as Error).stack ?? "", inspect(failure, { depth: 5 })].join("\n");
    expect(visible).not.toContain(diagnostic);
    await expect(stat(target)).resolves.toBeDefined();

    cleanupFault.target = null;
    cleanupFault.error = null;
    await expect(executor.reconcileInterrupted()).resolves.toBe(1);
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps sentinel filesystem diagnostics out of service startup and logs", async () => {
    const test = await environment();
    const sentinelPath = path.join(
      test.config.shepherdCodexHomeRoot,
      ".shepherd-codex-home-root",
    );
    const runner = new FakeContainerRunner();
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);
    await executor.reconcileInterrupted();
    const diagnostic =
      "TST15_STARTUP_SECRET EACCES Darwin /Users/private/runtime/startup";
    operationFault.kind = "lstat";
    operationFault.target = sentinelPath;
    operationFault.error = new Error(diagnostic);
    const storePath = path.join(test.root, "sentinel-startup-state.json");
    const store = new JsonStore(storePath, {
      sensitiveValues: [test.config.arkApiKey],
    });
    await store.initialize();
    const service = new ShepherdService({
      store,
      managedRoot: test.config.shepherdRoot,
      agentWorkspaceRoot: test.config.workspaceRoot,
      executor,
      verifier: new HostTrustedFixtureVerifier(),
      sensitiveValues: [test.config.arkApiKey],
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warningLog = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const failure = await service.initialize().catch((error: unknown) => error);
    expect((failure as Error).message).toBe(
      "Agent Runtime startup reconciliation failed",
    );
    const visible = [
      String(failure),
      (failure as Error).stack ?? "",
      inspect(failure, { depth: 8 }),
      inspect((failure as Error & { cause?: unknown }).cause, { depth: 8 }),
      JSON.stringify(errorLog.mock.calls),
      JSON.stringify(warningLog.mock.calls),
      await readFile(storePath, "utf8"),
    ].join("\n");
    expect(visible).not.toContain(diagnostic);
    expect(visible).not.toContain("/Users/private/runtime/startup");

    operationFault.kind = null;
    operationFault.target = null;
    operationFault.error = null;
    const retryService = new ShepherdService({
      store,
      managedRoot: test.config.shepherdRoot,
      agentWorkspaceRoot: test.config.workspaceRoot,
      executor,
      verifier: new HostTrustedFixtureVerifier(),
    });
    await expect(retryService.initialize()).resolves.toBeUndefined();
    expect(runner.preflightCount).toBe(1);
  }, 30_000);

  it.each([
    { phase: "root" as const, kind: "mkdir" as const, target: "private-root" as const, stage: "private_root_preparation" },
    { phase: "root" as const, kind: "lstat" as const, target: "private-root" as const, stage: "private_root_preparation" },
    { phase: "root" as const, kind: "realpath" as const, target: "data-root" as const, stage: "private_root_preparation" },
    { phase: "root" as const, kind: "realpath" as const, target: "private-root" as const, stage: "private_root_preparation" },
    { phase: "root" as const, kind: "realpath" as const, target: "shared-home" as const, stage: "private_root_preparation" },
    { phase: "root" as const, kind: "realpath" as const, target: "shepherd-root" as const, stage: "private_root_preparation" },
    { phase: "run" as const, kind: "realpath" as const, target: "workspace" as const, stage: "private_root_preparation" },
    { phase: "private-reconcile" as const, kind: "readdir" as const, target: "private-root" as const, stage: "private_home_reconciliation" },
    { phase: "private-reconcile" as const, kind: "lstat" as const, target: "candidate" as const, stage: "private_home_reconciliation" },
    { phase: "private-reconcile" as const, kind: "realpath" as const, target: "candidate" as const, stage: "private_home_reconciliation" },
    { phase: "preflight-reconcile" as const, kind: "realpath" as const, target: "shepherd-root-reconcile" as const, stage: "preflight_workspace_reconciliation" },
    { phase: "preflight-reconcile" as const, kind: "readdir" as const, target: "shepherd-root" as const, stage: "preflight_workspace_reconciliation" },
    { phase: "preflight-reconcile" as const, kind: "lstat" as const, target: "candidate" as const, stage: "preflight_workspace_reconciliation" },
    { phase: "preflight-reconcile" as const, kind: "realpath" as const, target: "candidate" as const, stage: "preflight_workspace_reconciliation" },
    { phase: "preflight" as const, kind: "mkdtemp" as const, target: "private-prefix" as const, stage: "preflight_setup" },
    { phase: "preflight" as const, kind: "chmod" as const, target: "private-prefix" as const, stage: "preflight_setup" },
    { phase: "preflight" as const, kind: "writeFile" as const, target: "config" as const, stage: "preflight_setup" },
    { phase: "preflight" as const, kind: "realpath" as const, target: "shepherd-root-second" as const, stage: "preflight_setup" },
    { phase: "preflight" as const, kind: "mkdtemp" as const, target: "preflight-prefix" as const, stage: "preflight_setup" },
    { phase: "preflight" as const, kind: "chmod" as const, target: "preflight-prefix" as const, stage: "preflight_setup" },
    { phase: "run" as const, kind: "mkdtemp" as const, target: "private-prefix" as const, stage: "execution_setup" },
    { phase: "run" as const, kind: "chmod" as const, target: "private-prefix" as const, stage: "execution_setup" },
    { phase: "run" as const, kind: "realpath" as const, target: "private-prefix" as const, stage: "execution_setup" },
    { phase: "run" as const, kind: "writeFile" as const, target: "config" as const, stage: "execution_setup" },
  ])("bounds $phase $kind failures at $stage and permits exact retry", async ({
    phase,
    kind,
    target,
    stage,
  }) => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);
    let retainedCandidate: string | null = null;

    if (phase !== "root") await executor.reconcileInterrupted();
    if (phase === "private-reconcile") {
      retainedCandidate = await mkdtemp(
        path.join(test.config.shepherdCodexHomeRoot, "launchpad-shepherd-codex-"),
      );
    } else if (phase === "preflight-reconcile") {
      retainedCandidate = await mkdtemp(
        path.join(test.config.shepherdRoot, ".shepherd-runtime-preflight-"),
      );
    }

    operationFault.kind = kind;
    operationFault.error = new Error(
      "TST16_SECRET EACCES Darwin /Users/private/runtime/config.toml opaque-config-content",
    );
    if (target === "private-root") operationFault.target = test.config.shepherdCodexHomeRoot;
    if (target === "data-root") operationFault.target = test.config.dataDirectory;
    if (target === "shared-home") operationFault.target = test.config.codexHome;
    if (target === "workspace") operationFault.target = test.workspace;
    if (
      target === "shepherd-root" ||
      target === "shepherd-root-second" ||
      target === "shepherd-root-reconcile"
    ) {
      operationFault.target = test.config.shepherdRoot;
    }
    if (target === "candidate") operationFault.target = retainedCandidate;
    if (target === "private-prefix") operationFault.targetIncludes = "launchpad-shepherd-codex-";
    if (target === "preflight-prefix") operationFault.targetIncludes = ".shepherd-runtime-preflight-";
    if (target === "config") operationFault.targetIncludes = "config.toml";
    if (
      target === "shepherd-root-second" ||
      target === "shepherd-root-reconcile"
    ) operationFault.skip = 1;

    const invoke = async (retry: boolean): Promise<unknown> => {
      if (phase === "preflight") return await executor.preflight();
      if (phase === "run") {
        return await executor.run(
          executionRequest(test.workspace, retry ? "plane-execution-retry" : "plane-execution-fault"),
        );
      }
      return await executor.reconcileInterrupted();
    };
    const failure = await invoke(false).catch((error: unknown) => error);
    expect((failure as Error).message).toBe(
      `Shepherd filesystem operation failed (stage=${stage} reason=operation_failed)`,
    );
    const visible = [
      String(failure),
      (failure as Error).stack ?? "",
      inspect(failure, { depth: 8 }),
      inspect((failure as Error & { cause?: unknown }).cause, { depth: 8 }),
    ].join("\n");
    expect(visible).not.toContain("TST16_SECRET");
    expect(visible).not.toContain("/Users/private/runtime/config.toml");
    expect(visible).not.toContain("opaque-config-content");

    if (retainedCandidate) await expect(stat(retainedCandidate)).resolves.toBeDefined();
    operationFault.kind = null;
    operationFault.target = null;
    operationFault.targetIncludes = null;
    operationFault.skip = 0;
    operationFault.error = null;
    await invoke(true);
    if (retainedCandidate) {
      await expect(stat(retainedCandidate)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(runner.requests.length).toBe(phase === "run" ? 1 : 0);
    expect(runner.preflightCount).toBe(phase === "preflight" ? 1 : 0);
  }, 30_000);

  it("freezes the executor-owned filesystem call inventory behind bounded stages", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "src/shepherd/codex-executor.ts"),
      "utf8",
    );
    const inventory: Record<string, RegExp> = {
      chmod: /\bchmod\s*\(/gu,
      lstat: /\blstat\s*\(/gu,
      mkdir: /\bmkdir\s*\(/gu,
      mkdtemp: /\bmkdtemp\s*\(/gu,
      open: /\bopen\s*\(/gu,
      readdir: /\breaddir\s*\(/gu,
      realpath: /\brealpath\s*\(/gu,
      rm: /\brm\s*\(/gu,
      unlink: /\bunlink\s*\(/gu,
      writeShepherdCodexConfig: /\bwriteShepherdCodexConfig\s*\(/gu,
      handleStat: /\bhandle\.stat\s*\(/gu,
      handleReadFile: /\bhandle\.readFile\s*\(/gu,
      handleWriteFile: /\bhandle\.writeFile\s*\(/gu,
      handleClose: /\bhandle\.close\s*\(/gu,
      handleSync: /\bhandle\.sync\s*\(/gu,
      handleTruncate: /\bhandle\.truncate\s*\(/gu,
    };
    expect(
      Object.fromEntries(
        Object.entries(inventory).map(([name, pattern]) => [
          name,
          source.match(pattern)?.length ?? 0,
        ]),
      ),
    ).toEqual({
      chmod: 5,
      lstat: 4,
      mkdir: 1,
      mkdtemp: 3,
      open: 2,
      readdir: 6,
      // 11 since the state-volume canonicality assertion on CONTAINER_STATE_ROOT.
      realpath: 11,
      rm: 4,
      unlink: 2,
      writeShepherdCodexConfig: 2,
      handleStat: 1,
      handleReadFile: 1,
      handleWriteFile: 1,
      handleClose: 2,
      handleSync: 2,
      handleTruncate: 1,
    });
    for (const stage of [
      "sentinel_validation",
      "sentinel_adoption",
      "private_root_preparation",
      "private_home_reconciliation",
      "preflight_workspace_reconciliation",
      "preflight_setup",
      "execution_setup",
    ]) {
      expect(source).toMatch(
        new RegExp(`boundedFilesystemOperation\\([\\s\\S]{0,100}"${stage}"`, "u"),
      );
    }
  });

  it("does not adopt or alter a nonempty unsentinelled private-home root", async () => {
    const test = await environment();
    const existingHome = path.join(
      test.config.shepherdCodexHomeRoot,
      "launchpad-shepherd-codex-ABC123",
    );
    const existingFile = path.join(existingHome, "unowned.txt");
    await mkdir(existingHome, { recursive: true });
    await writeFile(existingFile, "must remain untouched\n", "utf8");
    const executor = new CodexShepherdExecutor(
      test.config,
      OWNER,
      new FakeContainerRunner(),
    );

    await expect(executor.reconcileInterrupted()).rejects.toThrow(
      "unsentinelled root is not empty",
    );

    await expect(readFile(existingFile, "utf8")).resolves.toBe(
      "must remain untouched\n",
    );
    expect(await readdir(test.config.shepherdCodexHomeRoot)).toEqual([
      "launchpad-shepherd-codex-ABC123",
    ]);
  });

  it("runs one cached, no-model preflight and cleans its private mounts", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    await expect(executor.preflight()).resolves.toBeUndefined();
    await expect(executor.preflight()).resolves.toBeUndefined();

    expect(runner.preflightCount).toBe(1);
    expect(runner.preflightHomes[0]!.startsWith(
      test.config.shepherdCodexHomeRoot + path.sep,
    )).toBe(true);
    expect(runner.preflightWorkspaces[0]!.startsWith(
      test.config.shepherdRoot + path.sep,
    )).toBe(true);
    await expect(stat(runner.preflightHomes[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(runner.preflightWorkspaces[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails preflight closed, cleans mounts, and permits a bounded retry", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    runner.preflightAvailable = false;
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    await expect(executor.preflight()).rejects.toThrow(
      "Live Shepherd Runtime preflight failed",
    );
    await expect(stat(runner.preflightHomes[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(runner.preflightWorkspaces[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });

    runner.preflightAvailable = true;
    await expect(executor.preflight()).resolves.toBeUndefined();
    expect(runner.preflightCount).toBe(2);
  });

  it("surfaces only the bounded preflight stage and reason", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    runner.preflightResult = {
      available: false,
      stage: "container_start",
      reason: "sandbox_listen_denial_failed",
    };
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    await expect(executor.preflight()).rejects.toThrow(
      "Live Shepherd Runtime preflight failed (stage=container_start reason=sandbox_listen_denial_failed)",
    );
    await expect(stat(runner.preflightHomes[0]!)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(runner.preflightWorkspaces[0]!)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("redacts executor cleanup failures from every startup-visible Error surface", async () => {
    const test = await environment();
    const privateDiagnostic =
      "TST12_SECRET_CANARY EACCES Darwin /Users/private/runtime/preflight";
    class CleanupFailingRunner extends FakeContainerRunner {
      failCleanup = true;

      override async isEphemeralAvailable(
        workspacePath: string,
        codexHome: string,
      ): Promise<boolean | EphemeralPreflightResult> {
        const result = await super.isEphemeralAvailable(workspacePath, codexHome);
        if (this.failCleanup) {
          cleanupFault.target = workspacePath;
          cleanupFault.error = new Error(privateDiagnostic);
        }
        return result;
      }
    }
    const runner = new CleanupFailingRunner();
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    let rejection: unknown;
    try {
      await executor.preflight();
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(Error);
    const startupError = rejection as Error & { cause?: unknown };
    expect(startupError.message).toBe(
      "Live Shepherd Runtime preflight failed (stage=cleanup reason=cleanup_failed)",
    );
    expect(startupError.cause).toBeUndefined();
    const visibleSurfaces = [
      String(startupError),
      startupError.stack ?? "",
      inspect(startupError, { depth: 5 }),
      JSON.stringify(startupError),
      inspect(startupError.cause, { depth: 5 }),
    ].join("\n");
    expect(visibleSurfaces).not.toContain(privateDiagnostic);
    expect(visibleSurfaces).not.toContain("TST12_SECRET_CANARY");
    expect(visibleSurfaces).not.toContain("/Users/private/runtime/preflight");
    expect(visibleSurfaces).not.toContain("EACCES Darwin");
    await expect(stat(runner.preflightHomes[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });

    cleanupFault.target = null;
    cleanupFault.error = null;
    runner.failCleanup = false;
    await expect(executor.preflight()).resolves.toBeUndefined();
    expect(runner.preflightCount).toBe(2);
  });

  it("fails closed on unsafe live composition", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    expect(
      () =>
        new CodexShepherdExecutor(
          loadConfig({
            NODE_ENV: "test",
            APP_DATA_DIR: path.join(test.root, "unsafe-data"),
            CODEX_HOME: path.join(test.root, "unsafe-shared"),
            SHEPHERD_ROOT: path.join(test.root, "unsafe-shepherd"),
            RUNTIME_PROVIDER: "container",
            ARK_API_KEY: "test-key",
            ARK_MODEL: "agent-model",
            CODEX_SANDBOX_MODE: "danger-full-access",
          }),
          OWNER,
          runner,
        ),
    ).toThrow("CODEX_SANDBOX_MODE=workspace-write");
    expect(
      () => new CodexShepherdExecutor(test.config, "default", runner),
    ).toThrow("stable installation owner");
    expect(
      () =>
        new CodexShepherdExecutor(
          {
            ...test.config,
            codexHome: path.join(test.config.dataDirectory, "overlap"),
            shepherdCodexHomeRoot: path.join(
              test.config.dataDirectory,
              "overlap",
            ),
          },
          OWNER,
          runner,
        ),
    ).toThrow("shared Agent CODEX_HOME");
  });
});
