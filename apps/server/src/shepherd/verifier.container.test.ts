import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AcceptanceCheck } from "./domain.js";
import {
  ContainerVerifier,
  DockerVerifierExecutor,
  TrustedCheckRegistry,
  type VerifierContainerExecutor,
  type VerifierContainerInvocation,
  type VerifierContainerResult,
} from "./verifier.js";

const execFileAsync = promisify(execFile);
const workspace = path.resolve(".");
const testRoot = path.join(workspace, ".tmp", "shepherd-tests");
const rootMarker = path.join(testRoot, ".integration-test-root");
const expectedRootMarker = "shepherd integration fixtures only\n";
const runtimeImage = process.env.CONTAINER_RUNTIME_IMAGE ?? "volc-agent-runtime:local";
const containerEngine = process.env.CONTAINER_ENGINE ?? "docker";
const containerUser =
  typeof process.getuid === "function" && typeof process.getgid === "function"
    ? process.getuid() + ":" + process.getgid()
    : "1000:1000";

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

async function createPlaneFixture(): Promise<{
  casePath: string;
  planesRoot: string;
  planePath: string;
}> {
  const casePath = path.join(testRoot, "verifier-" + randomUUID());
  await mkdir(casePath);
  await writeFile(path.join(casePath, ".case-sentinel"), "shepherd-test-case\n", "utf8");
  const planesRoot = path.join(casePath, "planes");
  const planePath = path.join(planesRoot, "resolution-candidate");
  await mkdir(planePath, { recursive: true });
  await writeFile(path.join(planePath, "fixture.txt"), "verification fixture\n", "utf8");
  return { casePath, planesRoot, planePath };
}

async function destroyPlaneFixture(fixture: { casePath: string }): Promise<void> {
  const canonicalRoot = await realpath(testRoot);
  const canonicalCase = await realpath(fixture.casePath);
  if (!isInside(canonicalRoot, canonicalCase)) throw new Error("Verifier fixture cleanup escaped root");
  if ((await readFile(path.join(canonicalCase, ".case-sentinel"), "utf8")) !== "shepherd-test-case\n") {
    throw new Error("Verifier fixture sentinel mismatch");
  }
  await rm(canonicalCase, { recursive: true, force: true });
}

beforeAll(async () => {
  await mkdir(testRoot, { recursive: true });
  try {
    await writeFile(rootMarker, expectedRootMarker, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  expect(await readFile(rootMarker, "utf8")).toBe(expectedRootMarker);
});

afterAll(async () => {
  expect(await readFile(rootMarker, "utf8")).toBe(expectedRootMarker);
});

class RecordingExecutor implements VerifierContainerExecutor {
  readonly invocations: VerifierContainerInvocation[] = [];
  readonly cleanupRequests: Array<{ engine: string; ownerId: string }> = [];
  constructor(private readonly results: VerifierContainerResult[]) {}

  async run(invocation: VerifierContainerInvocation): Promise<VerifierContainerResult> {
    this.invocations.push(invocation);
    const result = this.results.shift();
    if (!result) throw new Error("No fake verifier result configured");
    return result;
  }

  async cancel(): Promise<boolean> {
    return false;
  }

  async cleanupOwned(input: { engine: string; ownerId: string }): Promise<string[]> {
    this.cleanupRequests.push(input);
    return ["0123456789ab"];
  }
}

class BlockingCancellationExecutor implements VerifierContainerExecutor {
  readonly invocations: VerifierContainerInvocation[] = [];
  readonly cancelledIds: string[] = [];
  private releaseFirst!: (value: VerifierContainerResult) => void;

  async run(invocation: VerifierContainerInvocation): Promise<VerifierContainerResult> {
    this.invocations.push(invocation);
    if (this.invocations.length === 1) {
      return await new Promise<VerifierContainerResult>((resolve) => {
        this.releaseFirst = resolve;
      });
    }
    return result();
  }

  async cancel(targetId: string): Promise<boolean> {
    this.cancelledIds.push(targetId);
    this.releaseFirst(
      result({
        exitCode: null,
        cancelled: true,
        startError: "Synthetic active verifier cancellation",
      }),
    );
    return true;
  }
}

function result(overrides: Partial<VerifierContainerResult> = {}): VerifierContainerResult {
  return {
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
    durationMs: 3,
    timedOut: false,
    outputExceeded: false,
    cancelled: false,
    startError: null,
    ...overrides,
  };
}

function check(input: Partial<AcceptanceCheck> = {}): AcceptanceCheck {
  return {
    id: "check",
    name: "Check",
    profileId: "node-check",
    mandatory: true,
    timeoutMs: 5_000,
    ...input,
  };
}

describe("independent verifier contract", () => {
  it("keeps target cancellation sticky across sequential checks and permits bounded ID reuse", async () => {
    const fixture = await createPlaneFixture();
    try {
      const executor = new BlockingCancellationExecutor();
      const verifier = new ContainerVerifier(
        new TrustedCheckRegistry([
          { id: "node-check", command: "node", args: [], cwd: "." },
        ]),
        {
          planesRoot: fixture.planesRoot,
          containerEngine,
          containerImage: runtimeImage,
          containerUser,
          ownerId: "sticky-cancel-owner",
          executor,
        },
      );
      const verification = verifier.verify({
        targetType: "contract",
        targetId: "sticky-target",
        planePath: fixture.planePath,
        checks: [check({ id: "first" }), check({ id: "second" })],
        changedFiles: [],
      });
      await vi.waitFor(() => expect(executor.invocations).toHaveLength(1));
      await expect(verifier.cancel("sticky-target")).resolves.toBe(true);
      const cancelled = await verification;
      expect(executor.cancelledIds).toEqual(["sticky-target"]);
      expect(executor.invocations).toHaveLength(1);
      expect(cancelled.passed).toBe(false);
      expect(cancelled.checks.map((item) => item.status)).toEqual([
        "infrastructure_error",
        "infrastructure_error",
      ]);
      expect(cancelled.checks[1]).toMatchObject({
        id: "second",
        error: "Verification was cancelled",
      });

      const reused = await verifier.verify({
        targetType: "contract",
        targetId: "sticky-target",
        planePath: fixture.planePath,
        checks: [check({ id: "reused" })],
        changedFiles: [],
      });
      expect(reused.passed).toBe(true);
      expect(executor.invocations).toHaveLength(2);
    } finally {
      await destroyPlaneFixture(fixture);
    }
  });

  it("keeps cancellation sticky across reserved container creation before start", async () => {
    const fixture = await createPlaneFixture();
    try {
      const enginePath = path.join(fixture.casePath, "fake-container-engine.mjs");
      const logPath = path.join(fixture.casePath, "engine.log");
      await writeFile(
        enginePath,
        `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n", "utf8");
if (args[0] === "create" || args[0] === "rm") setTimeout(() => process.exit(0), 150);
else process.exit(0);
`,
        "utf8",
      );
      await chmod(enginePath, 0o700);
      const executor = new DockerVerifierExecutor();
      const invocation: VerifierContainerInvocation = {
        key: "reserved-target",
        engine: enginePath,
        args: ["run", "--rm", "--name", "sticky-container", "runtime-image"],
        containerName: "sticky-container",
        timeoutMs: 1_000,
        maxOutputBytes: 1_024,
      };
      const running = executor.run(invocation);
      await vi.waitFor(async () =>
        expect(await readFile(logPath, "utf8")).toContain('["create"'),
      );
      await expect(executor.cancel("other-target")).resolves.toBe(false);
      await expect(executor.cancel("reserved-target")).resolves.toBe(true);
      await vi.waitFor(async () =>
        expect(await readFile(logPath, "utf8")).toContain('["rm"'),
      );
      await expect(executor.cancel("reserved-target")).resolves.toBe(true);
      await expect(running).resolves.toMatchObject({
        cancelled: true,
        exitCode: null,
      });
      const cancelledLog = await readFile(logPath, "utf8");
      expect(cancelledLog).not.toContain('["start"');

      await expect(executor.run(invocation)).resolves.toMatchObject({
        cancelled: false,
        exitCode: 0,
      });
      const reusedLog = await readFile(logPath, "utf8");
      expect(reusedLog.match(/^\["start"/gmu)).toHaveLength(1);
    } finally {
      await destroyPlaneFixture(fixture);
    }
  });

  it("uses only registry argv and builds a credential-free bounded container invocation", async () => {
    const fixture = await createPlaneFixture();
    try {
      const executor = new RecordingExecutor([result()]);
      const registry = new TrustedCheckRegistry([
        {
          id: "node-check",
          command: "node",
          args: ["--test", "tests/acceptance.test.js"],
          cwd: ".",
        },
      ]);
      const verifier = new ContainerVerifier(registry, {
        planesRoot: fixture.planesRoot,
        containerEngine,
        containerImage: runtimeImage,
        containerUser,
        ownerId: "test-verifier-owner",
        cpuLimit: 0.5,
        memoryLimit: "256m",
        pidsLimit: 64,
        maxOutputBytes: 8_192,
        maxTimeoutMs: 10_000,
        sensitiveValues: ["canary-secret-value"],
        executor,
        idFactory: () => "evidence-id",
      });
      const evidence = await verifier.verify({
        targetType: "candidate",
        targetId: "candidate-a",
        planePath: fixture.planePath,
        checks: [check()],
        changedFiles: ["fixture.txt"],
      });
      expect(evidence).toMatchObject({ id: "evidence-id", passed: true, changedFiles: ["fixture.txt"] });
      const invocation = executor.invocations[0]!;
      expect(invocation.engine).toBe(containerEngine);
      expect(invocation.timeoutMs).toBe(5_000);
      expect(invocation.args).toEqual(
        expect.arrayContaining([
          "io.codejam.verifier-owner=test-verifier-owner",
          "--network",
          "none",
          "--read-only",
          "--security-opt",
          "no-new-privileges",
          "--cap-drop",
          "ALL",
          "--cpus",
          "0.5",
          "--memory",
          "256m",
          "--pids-limit",
          "64",
          "--entrypoint",
          "/usr/bin/env",
          "-i",
          "node",
          "--test",
          "tests/acceptance.test.js",
        ]),
      );
      expect(invocation.args).toContain(
        "type=bind,src=" + (await realpath(fixture.planePath)) + ",dst=/workspace,readonly",
      );
      const serialized = JSON.stringify(invocation.args);
      expect(serialized).not.toContain("ARK_API_KEY");
      expect(serialized).not.toContain("canary-secret-value");
      expect(serialized).not.toContain("codex-home");
      expect(serialized).not.toContain("docker.sock");
      await verifier.reconcileInterrupted();
      expect(executor.cleanupRequests).toEqual([
        { engine: containerEngine, ownerId: "test-verifier-owner" },
      ]);
    } finally {
      await destroyPlaneFixture(fixture);
    }
  });

  it("mounts the candidate Plane read-only from the state volume", async () => {
    const fixture = await createPlaneFixture();
    try {
      const executor = new RecordingExecutor([result({})]);
      const stateRoot = await realpath(fixture.casePath);
      const verifier = new ContainerVerifier(
        new TrustedCheckRegistry([
          { id: "node-check", command: "node", args: ["-e", ""], cwd: "." },
        ]),
        {
          planesRoot: fixture.planesRoot,
          containerEngine,
          containerImage: runtimeImage,
          containerUser,
          ownerId: "state-volume-owner",
          stateRoot,
          stateVolume: "launchpad-state",
          executor,
          idFactory: () => "evidence-id",
        },
      );
      await verifier.verify({
        targetType: "candidate",
        targetId: "candidate-a",
        planePath: fixture.planePath,
        checks: [check()],
        changedFiles: ["fixture.txt"],
      });
      const args = executor.invocations[0]!.args;
      const subpath = path.relative(stateRoot, await realpath(fixture.planePath));
      expect(args).toContain(
        "type=volume,source=launchpad-state,target=/workspace,volume-subpath=" +
          subpath +
          ",volume-nocopy=true,readonly",
      );
      expect(args.filter((value) => value.startsWith("type=bind"))).toHaveLength(0);
    } finally {
      await destroyPlaneFixture(fixture);
    }
  });

  it("redacts outputs and maps timeout, output overflow, optional failure, and unknown profiles", async () => {
    const fixture = await createPlaneFixture();
    try {
      const executor = new RecordingExecutor([
        result({ stdout: "canary-secret-value api_key=visible Bearer abcdefghijklmnop\n" }),
        result({ exitCode: 1, stderr: "optional failed" }),
        result({ exitCode: null, timedOut: true, durationMs: 100 }),
        result({ exitCode: null, outputExceeded: true, stdout: "x".repeat(2_000) }),
      ]);
      const registry = new TrustedCheckRegistry([
        { id: "node-check", command: "node", args: ["-e", "process.exit(0)"], cwd: "." },
      ]);
      const verifier = new ContainerVerifier(registry, {
        planesRoot: fixture.planesRoot,
        containerEngine,
        containerImage: runtimeImage,
        containerUser,
        ownerId: "test-verifier-owner",
        maxOutputBytes: 1_024,
        sensitiveValues: ["canary-secret-value"],
        executor,
      });
      const evidence = await verifier.verify({
        targetType: "candidate",
        targetId: "candidate-b",
        planePath: fixture.planePath,
        checks: [
          check({ id: "pass" }),
          check({ id: "optional", mandatory: false }),
          check({ id: "timeout", timeoutMs: 100 }),
          check({ id: "overflow" }),
          check({ id: "missing", profileId: "not-registered" }),
        ],
        changedFiles: ["fixture.txt"],
      });
      expect(evidence.passed).toBe(false);
      expect(evidence.checks.map((item) => item.status)).toEqual([
        "passed",
        "failed",
        "timed_out",
        "infrastructure_error",
        "infrastructure_error",
      ]);
      expect(JSON.stringify(evidence)).not.toContain("canary-secret-value");
      expect(JSON.stringify(evidence)).not.toContain("api_key=visible");
      expect(JSON.stringify(evidence)).not.toContain("abcdefghijklmnop");
      expect(evidence.checks[3]!.stdout.length).toBeLessThanOrEqual(1_024);
      expect(evidence.checks[4]!.error).toContain("Unknown trusted verification profile");
    } finally {
      await destroyPlaneFixture(fixture);
    }
  });

  it("rejects arbitrary paths, duplicate IDs, optional-only specs, and unsafe registry definitions", async () => {
    const fixture = await createPlaneFixture();
    try {
      expect(
        () => new TrustedCheckRegistry([{ id: "unsafe", command: "sh -c", args: [], cwd: "." }]),
      ).toThrow("Invalid trusted verification command");
      expect(
        () =>
          new TrustedCheckRegistry([
            { id: "unsafe", command: "node", args: [], cwd: "../../outside" },
          ]),
      ).toThrow("Unsafe project-relative path");
      expect(
        () =>
          new ContainerVerifier(
            new TrustedCheckRegistry([
              { id: "node-check", command: "node", args: [], cwd: "." },
            ]),
            {
              planesRoot: fixture.planesRoot,
              containerEngine,
              containerImage: runtimeImage,
              containerUser,
              ownerId: "unsafe owner",
              executor: new RecordingExecutor([]),
            },
          ),
      ).toThrow("Invalid verifier owner ID");
      const verifier = new ContainerVerifier(
        new TrustedCheckRegistry([{ id: "node-check", command: "node", args: [], cwd: "." }]),
        {
          planesRoot: fixture.planesRoot,
          containerEngine,
          containerImage: runtimeImage,
          containerUser,
          ownerId: "test-verifier-owner",
          executor: new RecordingExecutor([]),
        },
      );
      await expect(
        verifier.verify({
          targetType: "candidate",
          targetId: "candidate",
          planePath: fixture.casePath,
          checks: [check()],
          changedFiles: [],
        }),
      ).rejects.toThrow("escapes");
      await expect(
        verifier.verify({
          targetType: "candidate",
          targetId: "candidate",
          planePath: fixture.planePath,
          checks: [check({ mandatory: false })],
          changedFiles: [],
        }),
      ).rejects.toThrow("mandatory");
      await expect(
        verifier.verify({
          targetType: "candidate",
          targetId: "candidate",
          planePath: fixture.planePath,
          checks: [check(), check()],
          changedFiles: [],
        }),
      ).rejects.toThrow("unique");
    } finally {
      await destroyPlaneFixture(fixture);
    }
  });
});

async function containerRuntimeAvailable(): Promise<boolean> {
  try {
    await execFileAsync(containerEngine, ["version"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64_000,
    });
    await execFileAsync(containerEngine, ["image", "inspect", runtimeImage], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64_000,
    });
    return true;
  } catch {
    return false;
  }
}

const hasContainerRuntime = await containerRuntimeAvailable();

describe.skipIf(!hasContainerRuntime)("independent verifier real container", () => {
  it("removes only interrupted containers owned by the restarted verifier", async () => {
    const fixture = await createPlaneFixture();
    const ownerId = "recovery-" + randomUUID().replaceAll("-", "").slice(0, 16);
    const containerName = "shepherd-orphan-" + randomUUID().replaceAll("-", "").slice(0, 12);
    const siblingName = "shepherd-sibling-" + randomUUID().replaceAll("-", "").slice(0, 12);
    try {
      await execFileAsync(
        containerEngine,
        [
          "create",
          "--name",
          containerName,
          "--label",
          "io.codejam.shepherd=independent-verifier",
          "--label",
          "io.codejam.verifier-owner=" + ownerId,
          runtimeImage,
          "node",
          "-e",
          "process.exit(0)",
        ],
        { encoding: "utf8", timeout: 8_000, maxBuffer: 64_000 },
      );
      await execFileAsync(
        containerEngine,
        [
          "create",
          "--name",
          siblingName,
          "--label",
          "io.codejam.shepherd=independent-verifier",
          "--label",
          "io.codejam.verifier-owner=" + ownerId + "-other",
          runtimeImage,
          "node",
          "-e",
          "process.exit(0)",
        ],
        { encoding: "utf8", timeout: 8_000, maxBuffer: 64_000 },
      );
      const verifier = new ContainerVerifier(
        new TrustedCheckRegistry([
          { id: "node-check", command: "node", args: [], cwd: "." },
        ]),
        {
          planesRoot: fixture.planesRoot,
          containerEngine,
          containerImage: runtimeImage,
          containerUser,
          ownerId,
        },
      );
      await verifier.reconcileInterrupted();
      const listed = await execFileAsync(
        containerEngine,
        [
          "ps",
          "--all",
          "--quiet",
          "--filter",
          "label=io.codejam.shepherd=independent-verifier",
          "--filter",
          "label=io.codejam.verifier-owner=" + ownerId,
        ],
        { encoding: "utf8", timeout: 5_000, maxBuffer: 64_000 },
      );
      expect(listed.stdout.trim()).toBe("");
      await expect(
        execFileAsync(containerEngine, ["container", "inspect", siblingName], {
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 64_000,
        }),
      ).resolves.toBeDefined();
    } finally {
      for (const name of [containerName, siblingName]) {
        await execFileAsync(containerEngine, ["rm", "--force", name], {
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 64_000,
        }).catch(() => undefined);
      }
      await destroyPlaneFixture(fixture);
    }
  }, 20_000);

  it("proves cleared secrets, no network, and a read-only candidate mount", async () => {
    const fixture = await createPlaneFixture();
    try {
      const registry = new TrustedCheckRegistry([
        {
          id: "environment-clean",
          command: "node",
          args: [
            "-e",
            "const allowed=new Set(['HOME','TMPDIR','NO_COLOR','CI','PATH']);const bad=Object.keys(process.env).filter(k=>!allowed.has(k));if(bad.length){console.error(bad.sort().join(','));process.exit(1)};if(process.env.ARK_API_KEY||process.env.CODEX_HOME){process.exit(2)};console.log('environment clean')",
          ],
          cwd: ".",
        },
        {
          id: "network-blocked",
          command: "node",
          args: [
            "-e",
            "fetch('http://1.1.1.1',{signal:AbortSignal.timeout(1000)}).then(()=>process.exit(1)).catch(()=>console.log('network blocked'))",
          ],
          cwd: ".",
        },
        {
          id: "workspace-readonly",
          command: "node",
          args: [
            "-e",
            "const fs=require('node:fs');try{fs.writeFileSync('/workspace/verifier-must-not-write','x');process.exit(1)}catch(e){if(!['EROFS','EACCES'].includes(e.code)){throw e};console.log('workspace readonly')} ",
          ],
          cwd: ".",
        },
      ]);
      const verifier = new ContainerVerifier(registry, {
        planesRoot: fixture.planesRoot,
        containerEngine,
        containerImage: runtimeImage,
        containerUser,
        ownerId: "real-verifier-boundary",
        cpuLimit: 0.5,
        memoryLimit: "256m",
        pidsLimit: 64,
        maxTimeoutMs: 5_000,
        maxOutputBytes: 16_384,
        sensitiveValues: [process.env.ARK_API_KEY ?? "not-configured"],
      });
      const checks: AcceptanceCheck[] = [
        check({ id: "env", profileId: "environment-clean" }),
        check({ id: "network", profileId: "network-blocked", timeoutMs: 2_000 }),
        check({ id: "readonly", profileId: "workspace-readonly" }),
      ];
      const verification = await verifier.verify({
        targetType: "candidate",
        targetId: "real-container",
        planePath: fixture.planePath,
        checks,
        changedFiles: ["fixture.txt"],
      });
      expect(verification.passed).toBe(true);
      expect(verification.checks.map((item) => item.status)).toEqual(["passed", "passed", "passed"]);
      expect(verification.checks.map((item) => item.stdout)).toEqual([
        expect.stringContaining("environment clean"),
        expect.stringContaining("network blocked"),
        expect.stringContaining("workspace readonly"),
      ]);
      await expect(readFile(path.join(fixture.planePath, "verifier-must-not-write"), "utf8")).rejects.toThrow();
    } finally {
      await destroyPlaneFixture(fixture);
    }
  }, 20_000);

  it("bounds real timeout/output and destroys both disposable containers", async () => {
    const fixture = await createPlaneFixture();
    try {
      const registry = new TrustedCheckRegistry([
        {
          id: "slow",
          command: "node",
          args: ["-e", "setTimeout(()=>process.exit(0),5000)"],
          cwd: ".",
        },
        {
          id: "loud",
          command: "node",
          args: ["-e", "process.stdout.write('x'.repeat(200000))"],
          cwd: ".",
        },
      ]);
      const verifier = new ContainerVerifier(registry, {
        planesRoot: fixture.planesRoot,
        containerEngine,
        containerImage: runtimeImage,
        containerUser,
        ownerId: "real-verifier-bounds",
        maxTimeoutMs: 2_000,
        maxOutputBytes: 2_048,
      });
      const verification = await verifier.verify({
        targetType: "candidate",
        targetId: "bounded-container",
        planePath: fixture.planePath,
        checks: [
          check({ id: "timeout", profileId: "slow", timeoutMs: 100 }),
          check({ id: "overflow", profileId: "loud" }),
        ],
        changedFiles: [],
      });
      expect(verification.passed).toBe(false);
      expect(verification.checks.map((item) => item.status)).toEqual([
        "timed_out",
        "infrastructure_error",
      ]);
      expect(Buffer.byteLength(verification.checks[1]!.stdout, "utf8")).toBeLessThanOrEqual(2_048);
      const listed = await execFileAsync(
        containerEngine,
        [
          "ps",
          "-a",
          "--filter",
          "label=io.codejam.shepherd=independent-verifier",
          "--filter",
          "label=io.codejam.verification-target=bounded-container",
          "--format",
          "{{.Names}}",
        ],
        { encoding: "utf8", timeout: 5_000, maxBuffer: 64_000 },
      );
      expect(listed.stdout.trim()).toBe("");
    } finally {
      await destroyPlaneFixture(fixture);
    }
  }, 20_000);
});
