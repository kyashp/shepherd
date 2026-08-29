import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import {
  buildContainerCreateArgs,
  buildContainerRunArgs,
  buildContainerStartArgs,
  buildEphemeralPreflightCreateArgs,
  ContainerCodexRunner,
  containerName,
  ephemeralContainerName,
  SHEPHERD_RUNTIME_KIND_LABEL,
  SHEPHERD_RUNTIME_MARKER_LABEL,
  SHEPHERD_RUNTIME_OWNER_LABEL,
  type ContainerCodexRunnerOptions,
} from "./container-codex-runner.js";
import { RunCancelledError, RuntimeExecutionError } from "./errors.js";
import type { FreshEphemeralRunnerRequest } from "./types.js";

const OWNER = "verifier.test.0123456789abcdef0123456789abcdef";
const CONTAINER_ID = "a".repeat(64);

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  private closed = false;

  finish(code: number): void {
    if (this.closed) return;
    this.closed = true;
    this.exitCode = code;
    this.emit("close", code, this.signalCode);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.closed) return false;
    this.signalCode = signal;
    queueMicrotask(() => this.finish(1));
    return true;
  }
}

function asChild(child: FakeChild): ChildProcess {
  return child as unknown as ChildProcess;
}

function config(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: "/tmp/app-data",
    ARK_API_KEY: "secret-that-must-not-appear-in-argv",
    ARK_MODEL: "ep-test",
    CODEX_HOME: "/tmp/shared-codex-home",
    RUNTIME_PROVIDER: "container",
    CONTAINER_ENGINE: "docker",
    CONTAINER_RUNTIME_IMAGE: "runtime:test",
    CONTAINER_USER: "501:20",
    RUNTIME_INSTANCE_ID: "test-instance",
    ...overrides,
  });
}

function request(
  overrides: Partial<FreshEphemeralRunnerRequest> = {},
): FreshEphemeralRunnerRequest {
  return {
    mode: "fresh-ephemeral",
    agentId: "plane-execution-1",
    workspacePath: "/tmp/execution-workspace",
    prompt: "structured prompt sent only on stdin",
    threadId: null,
    codexHome: "/tmp/app-data/shepherd-codex-homes/private-home",
    timeoutMs: 5_000,
    ...overrides,
  };
}

function events(threadIds: string[] = ["thread-1"]): string {
  return [
    ...threadIds.map((threadId) =>
      JSON.stringify({ type: "thread.started", thread_id: threadId }),
    ),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Done." },
    }),
    JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 4 },
    }),
  ].join("\n") + "\n";
}

function successfulRuntime(threadIds: string[] = ["thread-1"]): {
  options: ContainerCodexRunnerOptions;
  spawnCalls: Array<{ args: string[]; env: NodeJS.ProcessEnv }>;
  execCalls: string[][];
  stdin: string[];
} {
  const spawnCalls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
  const execCalls: string[][] = [];
  const stdin: string[] = [];
  let owned = false;
  const options: ContainerCodexRunnerOptions = {
    shepherdOwnerId: OWNER,
    spawn: (_command, args, processOptions) => {
      spawnCalls.push({ args, env: processOptions.env });
      const child = new FakeChild();
      if (args[0] === "create") {
        queueMicrotask(() => {
          owned = true;
          child.stdout.write(CONTAINER_ID + "\n");
          child.finish(0);
        });
      } else {
        child.stdin.setEncoding("utf8");
        child.stdin.on("data", (chunk: string) => stdin.push(chunk));
        child.stdin.on("end", () => {
          child.stdout.write(events(threadIds));
          child.finish(0);
        });
      }
      return asChild(child);
    },
    execFile: async (_command, args) => {
      execCalls.push(args);
      if (args[0] === "rm") owned = false;
      return {
        stdout: args[0] === "ps" && owned ? CONTAINER_ID + "\n" : "",
        stderr: "",
      };
    },
  };
  return { options, spawnCalls, execCalls, stdin };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Container Codex runner", () => {
  it("preserves the legacy Agent run/resume invocation", () => {
    const args = buildContainerRunArgs(
      {
        agentId: "agent/unsafe",
        workspacePath: "/tmp/agent-workspace",
        prompt: "continue",
        threadId: "thread-123",
      },
      config(),
    );
    expect(containerName("agent/unsafe", "test-instance")).toBe(
      "launchpad-test-instance-agent-unsafe",
    );
    expect(args[0]).toBe("run");
    expect(args.slice(-3)).toEqual(["resume", "thread-123", "continue"]);
    expect(args).toContain(
      "type=bind,src=/tmp/shared-codex-home,dst=/codex-home",
    );
    expect(args).not.toContain(SHEPHERD_RUNTIME_MARKER_LABEL);
  });

  it("builds create/start with exact owner labels and hardened writable surfaces", () => {
    const prompt = "prompt-must-not-be-in-argv";
    const fresh = request({ prompt });
    const args = buildContainerCreateArgs(fresh, config(), OWNER);
    expect(args.slice(0, 2)).toEqual(["create", "--interactive"]);
    expect(args).toContain("--rm");
    expect(args).toContain("--read-only");
    expect(args).toContain("/tmp:rw,nosuid,nodev,mode=1777");
    expect(args).toContain(SHEPHERD_RUNTIME_MARKER_LABEL);
    expect(args).toContain(SHEPHERD_RUNTIME_KIND_LABEL);
    expect(args).toContain(SHEPHERD_RUNTIME_OWNER_LABEL + "=" + OWNER);
    expect(args).toContain(
      "type=bind,src=/tmp/execution-workspace,dst=/workspace",
    );
    expect(args).toContain(
      "type=bind,src=/tmp/app-data/shepherd-codex-homes/private-home,dst=/codex-home",
    );
    expect(args.filter((value) => value.startsWith("type=bind"))).toHaveLength(2);
    expect(args).not.toContain("/tmp/shared-codex-home");
    expect(args).not.toContain("/tmp/app-data");
    expect(args).not.toContain(prompt);
    expect(args.slice(-9)).toEqual([
      "exec",
      "--ephemeral",
      "--json",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-C",
      "/workspace",
      "-",
    ]);
    expect(buildContainerStartArgs(CONTAINER_ID)).toEqual([
      "start",
      "--attach",
      "--interactive",
      CONTAINER_ID,
    ]);
    expect(ephemeralContainerName("same-prefix-a", "test-instance")).not.toBe(
      ephemeralContainerName("same-prefix-b", "test-instance"),
    );
  });

  it("rejects missing owners, unsafe mount syntax, and overlapping homes", () => {
    expect(() => buildContainerRunArgs(request(), config())).toThrow(
      "stable installation owner",
    );
    expect(() =>
      buildContainerCreateArgs(
        request({ workspacePath: "/tmp/workspace,other" }),
        config(),
        OWNER,
      ),
    ).toThrow("mount source is invalid");
    expect(() =>
      buildContainerCreateArgs(
        request({ codexHome: "/tmp/shared-codex-home/child" }),
        config(),
        OWNER,
      ),
    ).toThrow("shared Agent home");
  });

  it("builds a no-key preflight with the exact hardened sandbox shape", () => {
    const preflight = buildEphemeralPreflightCreateArgs(
      "/tmp/preflight-workspace",
      "/tmp/app-data/shepherd-codex-homes/preflight-home",
      config(),
      OWNER,
      "preflight-test",
    );
    expect(preflight.args[0]).toBe("create");
    expect(preflight.args).toContain("--read-only");
    expect(preflight.args).toContain("/tmp:rw,nosuid,nodev,mode=1777");
    expect(preflight.args).not.toContain("ARK_API_KEY");
    expect(preflight.args.at(-1)).toContain("codex --version");
    expect(preflight.args.at(-1)).toContain(
      "codex sandbox linux --full-auto",
    );
    expect(preflight.args.at(-1)).toContain(
      "/codex-home/.shepherd-sandbox-negative-probe",
    );
    expect(preflight.args.at(-1)).toContain("server.listen");
    expect(preflight.args.at(-1)).toContain("net.connect");
    expect(preflight.args.at(-1)).toContain("process.exit(46)");
    expect(preflight.args.at(-1)).toContain('error.code === "EPERM"');
    expect(preflight.args.at(-1)).toContain('error.code === "EACCES"');
    expect(preflight.args.at(-1)).toContain("trap cleanup EXIT HUP INT TERM");
    expect(preflight.args.at(-1)).toContain("SHEPHERD_RUNTIME_PREFLIGHT_OK");
  });

  it("creates first, starts by immutable ID, and sends the prompt only on stdin", async () => {
    const fake = successfulRuntime();
    const runner = new ContainerCodexRunner(config(), fake.options);
    const result = await runner.run(request());

    expect(fake.spawnCalls).toHaveLength(2);
    expect(fake.spawnCalls[0]?.args[0]).toBe("create");
    expect(fake.spawnCalls[0]?.env.ARK_API_KEY).toBe(
      "secret-that-must-not-appear-in-argv",
    );
    expect(fake.spawnCalls[1]?.args).toEqual(
      buildContainerStartArgs(CONTAINER_ID),
    );
    expect(fake.spawnCalls[1]?.env.ARK_API_KEY).toBeUndefined();
    expect(fake.spawnCalls.flatMap((call) => call.args)).not.toContain(
      request().prompt,
    );
    expect(fake.stdin.join("")).toBe(request().prompt);
    expect(result).toEqual({
      output: "Done.",
      threadId: "thread-1",
      usage: { inputTokens: 10, outputTokens: 4 },
    });
    expect(fake.execCalls.some((args) => args[0] === "rm")).toBe(true);
    expect(fake.execCalls.filter((args) => args[0] === "ps").at(-1)).toEqual(
      expect.arrayContaining([
        "label=" + SHEPHERD_RUNTIME_MARKER_LABEL,
        "label=" + SHEPHERD_RUNTIME_KIND_LABEL,
        "label=" + SHEPHERD_RUNTIME_OWNER_LABEL + "=" + OWNER,
      ]),
    );
  });

  it("never exposes parsed or stderr diagnostics from a failed Runtime", async () => {
    const opaqueCanary = "OPAQUE_BENIGN_STDERR_8675309";
    const secretCanary = "SECRET_RUNTIME_CANARY_112358";
    const privatePath = "/Users/private-user/.docker/run/docker.sock";
    let owned = false;
    const runner = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      spawn: (_command, args) => {
        const child = new FakeChild();
        if (args[0] === "create") {
          queueMicrotask(() => {
            owned = true;
            child.stdout.write(CONTAINER_ID + "\n");
            child.finish(0);
          });
        } else {
          child.stdin.setEncoding("utf8");
          child.stdin.on("data", () => undefined);
          child.stdin.on("error", () => undefined);
          child.stdin.on("end", () => {
            child.stdout.write(
              JSON.stringify({
                type: "error",
                message: `${opaqueCanary} ${privatePath}`,
              }) + "\n",
            );
            child.stderr.write(`${secretCanary}: operating system detail\n`);
            child.finish(17);
          });
        }
        return asChild(child);
      },
      execFile: async (_command, args) => {
        if (args[0] === "rm") owned = false;
        return { stdout: args[0] === "ps" && owned ? CONTAINER_ID + "\n" : "", stderr: "" };
      },
    });

    const failure = await runner.run(request()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RuntimeExecutionError);
    expect(failure).toMatchObject({
      kind: "execution",
      message: "Agent Runtime execution failed",
    });
    const exposed = [
      String(failure),
      (failure as Error).stack ?? "",
      inspect(failure, { depth: 5 }),
      inspect((failure as Error & { cause?: unknown }).cause, { depth: 5 }),
    ].join("\n");
    for (const canary of [opaqueCanary, secretCanary, privatePath]) {
      expect(exposed).not.toContain(canary);
    }
    const invalidTimeout = new RuntimeExecutionError(
      "timeout",
      `${opaqueCanary} 9000` as unknown as number,
    );
    expect(invalidTimeout).toMatchObject({
      timeoutMs: undefined,
      message: "Agent Runtime execution timed out",
    });
    expect(inspect(invalidTimeout, { depth: 5 })).not.toContain(opaqueCanary);
    const invalidKind = new RuntimeExecutionError(
      opaqueCanary as unknown as "execution",
      9_000,
    );
    expect(invalidKind).toMatchObject({
      kind: "execution",
      timeoutMs: undefined,
      message: "Agent Runtime execution failed",
    });
    expect(inspect(invalidKind, { depth: 5 })).not.toContain(opaqueCanary);
    expect(owned).toBe(false);
  });

  it("reconstructs create and spawn failures without raw diagnostics", async () => {
    const opaqueCanary = "OPAQUE_CREATE_CANARY_161803";
    const secretCanary = "SECRET_CREATE_CANARY_141421";
    const privatePath = "/Users/private-user/.docker/run/docker.sock";
    const exposed = async (runner: ContainerCodexRunner): Promise<string> => {
      const failure = await runner.run(request()).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        name: "RuntimeExecutionError",
        kind: "execution",
        message: "Agent Runtime execution failed",
      });
      return [
        String(failure),
        (failure as Error).stack ?? "",
        inspect(failure, { depth: 5 }),
        inspect((failure as Error & { cause?: unknown }).cause, { depth: 5 }),
      ].join("\n");
    };
    const createFailure = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      spawn: () => {
        const child = new FakeChild();
        queueMicrotask(() => {
          child.stderr.write(`${opaqueCanary} ${secretCanary} ${privatePath}`);
          child.finish(125);
        });
        return asChild(child);
      },
      execFile: async () => ({ stdout: "", stderr: "" }),
    });
    const spawnFailure = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      spawn: () => {
        throw new Error(`${opaqueCanary} ${secretCanary} ${privatePath}`);
      },
      execFile: async () => ({ stdout: "", stderr: "" }),
    });

    for (const surface of [await exposed(createFailure), await exposed(spawnFailure)]) {
      for (const canary of [opaqueCanary, secretCanary, privatePath]) {
        expect(surface).not.toContain(canary);
      }
    }
  });

  it("rejects missing and duplicate Runtime thread identities", async () => {
    const missing = successfulRuntime([]);
    await expect(
      new ContainerCodexRunner(config(), missing.options).run(request()),
    ).rejects.toThrow("Agent Runtime execution failed");

    const duplicate = successfulRuntime(["thread-1", "thread-1"]);
    await expect(
      new ContainerCodexRunner(config(), duplicate.options).run(
        request({ agentId: "plane-execution-2" }),
      ),
    ).rejects.toThrow("Agent Runtime execution failed");
  });

  it("cancels an attached fresh container and waits for owner-scoped cleanup", async () => {
    let owned = false;
    let startChild: FakeChild | null = null;
    let startReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      startReady = resolve;
    });
    const runner = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      spawn: (_command, args) => {
        const child = new FakeChild();
        if (args[0] === "create") {
          queueMicrotask(() => {
            owned = true;
            child.stdout.write(CONTAINER_ID + "\n");
            child.finish(0);
          });
        } else {
          startChild = child;
          startReady();
        }
        return asChild(child);
      },
      execFile: async (_command, args) => {
        if (args[0] === "rm") {
          owned = false;
          startChild?.finish(137);
        }
        return {
          stdout: args[0] === "ps" && owned ? CONTAINER_ID + "\n" : "",
          stderr: "",
        };
      },
    });
    const outcome = runner.run(request()).catch((error: unknown) => error);
    await ready;
    await expect(runner.cancel(request().agentId)).resolves.toBe(true);
    expect(await outcome).toBeInstanceOf(RunCancelledError);
    await expect(runner.cancel(request().agentId)).resolves.toBe(false);
  });

  it("enforces the per-request timeout and removes the created container", async () => {
    vi.useFakeTimers();
    let owned = false;
    let startChild: FakeChild | null = null;
    const runner = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      spawn: (_command, args) => {
        const child = new FakeChild();
        if (args[0] === "create") {
          queueMicrotask(() => {
            owned = true;
            child.stdout.write(CONTAINER_ID + "\n");
            child.finish(0);
          });
        } else {
          startChild = child;
        }
        return asChild(child);
      },
      execFile: async (_command, args) => {
        if (args[0] === "rm") {
          owned = false;
          startChild?.finish(137);
        }
        return {
          stdout: args[0] === "ps" && owned ? CONTAINER_ID + "\n" : "",
          stderr: "",
        };
      },
    });
    const outcome = runner
      .run(request({ timeoutMs: 1_000 }))
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    const failure = await outcome;
    expect(failure).toBeInstanceOf(RuntimeExecutionError);
    expect(failure).toMatchObject({ kind: "timeout" });
    expect((failure as Error).message).toContain("1000 ms execution deadline");
    expect(owned).toBe(false);
  });

  it("settles timeout cleanup failures without an unhandled rejection", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", recordUnhandled);
    let startChild: FakeChild | null = null;
    try {
      const runner = new ContainerCodexRunner(config(), {
        shepherdOwnerId: OWNER,
        spawn: (_command, args) => {
          const child = new FakeChild();
          if (args[0] === "create") {
            queueMicrotask(() => {
              child.stdout.write(CONTAINER_ID + "\n");
              child.finish(0);
            });
          } else {
            startChild = child;
          }
          return asChild(child);
        },
        execFile: async (_command, args) => {
          throw new Error(
            args[0] === "rm"
              ? "container removal unavailable"
              : "owner listing unavailable",
          );
        },
      });
      const outcome = runner
        .run(request({ timeoutMs: 1_000 }))
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(1_000);
      const failure = await outcome;
      await Promise.resolve();

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("Agent Runtime execution failed");
      expect(startChild).not.toBeNull();
      expect((startChild as FakeChild | null)?.signalCode).toBe("SIGTERM");
      expect(unhandled).toEqual([]);
      await expect(runner.cancel(request().agentId)).resolves.toBe(false);
    } finally {
      process.off("unhandledRejection", recordUnhandled);
    }
  });

  it("settles overflow cleanup failures without an unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", recordUnhandled);
    let startChild: FakeChild | null = null;
    try {
      const boundedConfig = config({ CODEX_MAX_OUTPUT_BYTES: "65536" });
      const runner = new ContainerCodexRunner(boundedConfig, {
        shepherdOwnerId: OWNER,
        spawn: (_command, args) => {
          const child = new FakeChild();
          if (args[0] === "create") {
            queueMicrotask(() => {
              child.stdout.write(CONTAINER_ID + "\n");
              child.finish(0);
            });
          } else {
            startChild = child;
            child.stdin.on("data", () => undefined);
            child.stdin.on("end", () => {
              child.stdout.write(Buffer.alloc(65_537, 120));
            });
          }
          return asChild(child);
        },
        execFile: async (_command, args) => {
          throw new Error(
            args[0] === "rm"
              ? "container removal unavailable"
              : "owner listing unavailable",
          );
        },
      });
      const failure = await runner.run(request()).catch((error: unknown) => error);
      await Promise.resolve();

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("Agent Runtime execution failed");
      expect((failure as Error).message.length).toBeLessThan(256);
      expect(startChild).not.toBeNull();
      expect((startChild as FakeChild | null)?.signalCode).toBe("SIGTERM");
      expect(unhandled).toEqual([]);
      await expect(runner.cancel(request().agentId)).resolves.toBe(false);
    } finally {
      process.off("unhandledRejection", recordUnhandled);
    }
  });

  it("reconciles only exact marker, kind, and installation-owner containers", async () => {
    let owned = true;
    const calls: string[][] = [];
    const runner = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      execFile: async (_command, args) => {
        calls.push(args);
        if (args[0] === "rm") owned = false;
        return {
          stdout: args[0] === "ps" && owned ? CONTAINER_ID + "\n" : "",
          stderr: "",
        };
      },
    });

    await expect(runner.reconcileInterrupted()).resolves.toBe(1);
    const listCall = calls.find((args) => args[0] === "ps");
    expect(listCall).toEqual(
      expect.arrayContaining([
        "label=" + SHEPHERD_RUNTIME_MARKER_LABEL,
        "label=" + SHEPHERD_RUNTIME_KIND_LABEL,
        "label=" + SHEPHERD_RUNTIME_OWNER_LABEL + "=" + OWNER,
      ]),
    );
    expect(calls.find((args) => args[0] === "rm")).toEqual([
      "rm",
      "--force",
      CONTAINER_ID,
    ]);
  });

  it("requires the in-image version and sandbox probe before reporting live availability", async () => {
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    const runner = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      execFile: async (_command, args, options) => {
        calls.push({ args, env: options.env });
        if (args[0] === "create") {
          return { stdout: CONTAINER_ID + "\n", stderr: "" };
        }
        if (args[0] === "start") {
          return {
            stdout:
              "codex-cli 0.111.0\nSHEPHERD_RUNTIME_PREFLIGHT_OK\n",
            stderr: "",
          };
        }
        return { stdout: "", stderr: "" };
      },
    });

    await expect(
      runner.isEphemeralAvailable(
        "/tmp/preflight-workspace",
        "/tmp/app-data/shepherd-codex-homes/preflight-home",
      ),
    ).resolves.toEqual({ available: true });
    expect(calls.find((call) => call.args[0] === "create")?.env.ARK_API_KEY).toBe(
      undefined,
    );
    expect(calls.some((call) => call.args[0] === "rm")).toBe(true);
    expect(calls.filter((call) => call.args[0] === "ps").at(-1)?.args).toEqual(
      expect.arrayContaining([
        "label=" + SHEPHERD_RUNTIME_MARKER_LABEL,
        "label=" + SHEPHERD_RUNTIME_KIND_LABEL,
        "label=" + SHEPHERD_RUNTIME_OWNER_LABEL + "=" + OWNER,
      ]),
    );

    const wrongVersion = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      execFile: async (_command, args) => ({
        stdout:
          args[0] === "create"
            ? CONTAINER_ID + "\n"
            : args[0] === "start"
              ? "codex-cli 0.112.0\nSHEPHERD_RUNTIME_PREFLIGHT_OK\n"
              : "",
        stderr: "",
      }),
    });
    await expect(
      wrongVersion.isEphemeralAvailable(
        "/tmp/preflight-workspace",
        "/tmp/app-data/shepherd-codex-homes/preflight-home",
      ),
    ).resolves.toEqual({
      available: false,
      stage: "output_validation",
      reason: "codex_version_mismatch",
    });
  });

  it.each([
    [40, "non_root_required"],
    [41, "private_home_must_be_read_only"],
    [42, "codex_version_probe_failed"],
    [43, "sandbox_listen_denial_failed"],
    [46, "sandbox_connect_denial_failed"],
    [49, "sandbox_probe_failed"],
    [1, "engine_error"],
  ] as const)("maps preflight exit %i to bounded reason %s", async (exitCode, reason) => {
    const privateDiagnostic = "OPS06_PRIVATE_DIAGNOSTIC_CANARY";
    const runner = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      execFile: async (_command, args) => {
        if (args[0] === "create") {
          return { stdout: CONTAINER_ID + "\n", stderr: "" };
        }
        if (args[0] === "start") {
          throw Object.assign(new Error(privateDiagnostic), { code: exitCode });
        }
        return { stdout: "", stderr: "" };
      },
    });

    const result = await runner.isEphemeralAvailable(
      "/tmp/preflight-workspace",
      "/tmp/app-data/shepherd-codex-homes/preflight-home",
    );
    expect(result).toEqual({
      available: false,
      stage: "container_start",
      reason,
    });
    expect(JSON.stringify(result)).not.toContain(privateDiagnostic);
  });

  it("fails closed with a bounded cleanup diagnostic", async () => {
    const runner = new ContainerCodexRunner(config(), {
      shepherdOwnerId: OWNER,
      execFile: async (_command, args) => {
        if (args[0] === "create") return { stdout: CONTAINER_ID + "\n", stderr: "" };
        if (args[0] === "start") {
          return { stdout: "codex-cli 0.111.0\nSHEPHERD_RUNTIME_PREFLIGHT_OK\n", stderr: "" };
        }
        if (args[0] === "ps") throw new Error("/private/cleanup command secret");
        return { stdout: "", stderr: "" };
      },
    });

    await expect(
      runner.isEphemeralAvailable(
        "/tmp/preflight-workspace",
        "/tmp/app-data/shepherd-codex-homes/preflight-home",
      ),
    ).resolves.toEqual({
      available: false,
      stage: "cleanup",
      reason: "cleanup_failed",
    });
  });
});
