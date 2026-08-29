import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import type { ShepherdExecutionRequest } from "./executor.js";
import { ShepherdService } from "./service.js";

const OWNER = "verifier.test.0123456789abcdef0123456789abcdef";
const temporaryRoots: string[] = [];
const cleanupFault = vi.hoisted(() => ({
  target: null as string | null,
  error: null as Error | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (cleanupFault.target === args[0]) throw cleanupFault.error;
      return actual.rm(...args);
    },
  };
});

interface TestEnvironment {
  root: string;
  config: AppConfig;
  workspace: string;
}

async function environment(
  overrides: NodeJS.ProcessEnv = {},
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
    ...overrides,
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
  cleanupFault.target = null;
  cleanupFault.error = null;
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("CodexShepherdExecutor", () => {
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
      "simulated Runtime failure",
    );
    await expect(stat(runner.privateHomes[0]!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("redacts and bounds Runtime errors before they escape live execution", async () => {
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
    expect((failure as Error).message).not.toContain(test.config.arkApiKey);
    expect((failure as Error).message).not.toContain(commonPatternCanary);
    expect((failure as Error).message).toContain("[REDACTED]");
    expect((failure as Error).message.length).toBeLessThanOrEqual(1_000);
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
      "deadline exposed " + test.config.arkApiKey,
    );
    const executor = new CodexShepherdExecutor(test.config, OWNER, runner);

    const failure = await executor
      .run(executionRequest(test.workspace))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RuntimeExecutionError);
    expect(failure).toMatchObject({ kind: "timeout" });
    expect((failure as Error).message).toContain("[REDACTED]");
    expect((failure as Error).message).not.toContain(test.config.arkApiKey);
  });

  it("keeps Runtime secrets out of thrown and persisted service failures", async () => {
    const test = await environment();
    const runner = new FakeContainerRunner();
    runner.runError = new Error(
      "docker stderr leaked bearer " + test.config.arkApiKey,
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
    expect((failure as Error).message).not.toContain(test.config.arkApiKey);
    expect(await readFile(storePath, "utf8")).not.toContain(
      test.config.arkApiKey,
    );
    expect(JSON.stringify(service.state())).not.toContain(
      test.config.arkApiKey,
    );
  });

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
