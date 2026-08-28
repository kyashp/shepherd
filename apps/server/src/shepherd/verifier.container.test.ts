import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AcceptanceCheck } from "./domain.js";
import {
  ContainerVerifier,
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
      const verifier = new ContainerVerifier(
        new TrustedCheckRegistry([{ id: "node-check", command: "node", args: [], cwd: "." }]),
        {
          planesRoot: fixture.planesRoot,
          containerEngine,
          containerImage: runtimeImage,
          containerUser,
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
