import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadConfig,
  resolveVerifierOwnerId,
  type AppConfig,
} from "../config.js";
import {
  ContainerCodexRunner,
  SHEPHERD_RUNTIME_KIND_LABEL,
  SHEPHERD_RUNTIME_MARKER_LABEL,
  SHEPHERD_RUNTIME_OWNER_LABEL,
} from "../container-codex-runner.js";
import { JsonStore } from "../store.js";
import type {
  EphemeralContainerRunner,
  RunnerRequest,
  RunnerResult,
} from "../types.js";
import { BEARER_TRANSPORT, COOKIE_TRANSPORT } from "./auth-fixture.js";
import { CodexShepherdExecutor } from "./codex-executor.js";
import type { ShepherdMissionDetail } from "./service.js";
import {
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_PROFILE_ID,
  ShepherdService,
} from "./service.js";
import { ContainerVerifier, TrustedCheckRegistry } from "./verifier.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const liveRoot = path.join(repositoryRoot, ".tmp", "shepherd-live-gate");
const liveRootSentinel = path.join(liveRoot, ".live-gate-root");
const liveRootSentinelValue = "shepherd live Runtime gate only\n";
const liveEnabled = process.env.SHEPHERD_LIVE_TEST === "true";
const liveSequences = process.env.SHEPHERD_LIVE_MISSION_COUNT === "1"
  ? ([1] as const)
  : ([1, 2] as const);

interface RecordedLiveRequest {
  executionId: string;
  workspacePath: string;
  codexHome: string;
  prompt: string;
  threadId: null;
}

class RecordingEphemeralRunner implements EphemeralContainerRunner {
  readonly runtimeKind = "container" as const;
  readonly requests: RecordedLiveRequest[] = [];
  readonly threadIds: string[] = [];

  constructor(private readonly inner: ContainerCodexRunner) {}

  async run(request: RunnerRequest): Promise<RunnerResult> {
    if (request.mode !== "fresh-ephemeral") {
      throw new Error("Live Shepherd gate attempted a resumable Runtime request");
    }
    this.requests.push({
      executionId: request.agentId,
      workspacePath: request.workspacePath,
      codexHome: request.codexHome,
      prompt: request.prompt,
      threadId: request.threadId,
    });
    const result = await this.inner.run(request);
    if (!result.threadId) {
      throw new Error("Live Shepherd gate received no Runtime session ID");
    }
    this.threadIds.push(result.threadId);
    return result;
  }

  async cancel(agentId: string): Promise<boolean> {
    return await this.inner.cancel(agentId);
  }

  async isAvailable(): Promise<boolean> {
    return await this.inner.isAvailable();
  }

  async isEphemeralAvailable(
    workspacePath: string,
    codexHome: string,
  ) {
    return await this.inner.isEphemeralAvailable(workspacePath, codexHome);
  }

  async reconcileInterrupted(): Promise<number> {
    return await this.inner.reconcileInterrupted();
  }
}

function isStrictChild(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function entryExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function prepareLiveRoot(): Promise<void> {
  const expectedRelative = path.join(".tmp", "shepherd-live-gate");
  if (path.relative(repositoryRoot, liveRoot) !== expectedRelative) {
    throw new Error("Live gate root is not the exact repository-local target");
  }
  if (await entryExists(liveRoot)) {
    const metadata = await lstat(liveRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Live gate root is not a real directory");
    }
    if ((await readFile(liveRootSentinel, "utf8")) !== liveRootSentinelValue) {
      throw new Error("Live gate root sentinel mismatch");
    }
    const canonicalRoot = await realpath(liveRoot);
    if (!isStrictChild(repositoryRoot, canonicalRoot)) {
      throw new Error("Live gate cleanup target escaped the repository");
    }
    await rm(canonicalRoot, { recursive: true, force: true });
  }
  await mkdir(liveRoot, { recursive: true, mode: 0o700 });
  await writeFile(liveRootSentinel, liveRootSentinelValue, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function liveConfig(): AppConfig {
  const uid = typeof process.getuid === "function" ? process.getuid() : 1_000;
  const gid = typeof process.getgid === "function" ? process.getgid() : 1_000;
  if (uid === 0 || gid === 0) {
    throw new Error("Live Shepherd gate must run as a non-root host user");
  }
  return loadConfig({
    ...process.env,
    HOST: "127.0.0.1",
    APP_DATA_DIR: path.join(liveRoot, "data"),
    AGENT_WORKSPACE_ROOT: path.join(liveRoot, "agent-workspaces"),
    CODEX_HOME: path.join(liveRoot, "shared-codex-home"),
    SHEPHERD_ROOT: path.join(liveRoot, "managed"),
    SHEPHERD_CODEX_HOME_ROOT: path.join(
      liveRoot,
      "data",
      "shepherd-codex-homes",
    ),
    SHEPHERD_EXECUTION_MODE: "live",
    SHEPHERD_DEMO_MODE: "true",
    RUNTIME_PROVIDER: "container",
    RUNTIME_INSTANCE_ID: "shepherd-live-gate",
    CODEX_SANDBOX_MODE: "workspace-write",
    CODEX_TIMEOUT_MS: "600000",
    SHEPHERD_CONTRACT_TIMEOUT_MS: "600000",
    SHEPHERD_CANDIDATE_TIMEOUT_MS: "600000",
    SHEPHERD_VERIFICATION_TIMEOUT_MS: "120000",
    CONTAINER_CPU_LIMIT: "1",
    CONTAINER_MEMORY_LIMIT: "1g",
    CONTAINER_PIDS_LIMIT: "128",
    CONTAINER_USER: `${uid}:${gid}`,
    // This gate pins its own roots outside any state volume, so the state-volume
    // settings a `.env` may carry must not reach it through the spread above.
    CONTAINER_STATE_ROOT: undefined,
    CONTAINER_STATE_VOLUME: undefined,
    NODE_ENV: "test",
  });
}

function registry(): TrustedCheckRegistry {
  return new TrustedCheckRegistry([
    {
      id: AUTH_FRONTEND_PROFILE_ID,
      command: "node",
      args: ["checks/frontend.cjs"],
      cwd: ".",
    },
    {
      id: AUTH_BACKEND_PROFILE_ID,
      command: "node",
      args: ["checks/backend.cjs"],
      cwd: ".",
    },
    {
      id: AUTH_PROJECT_PROFILE_ID,
      command: "node",
      args: ["checks/project-security.cjs"],
      cwd: ".",
    },
  ]);
}

function runtimeEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
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

async function commandOutput(
  command: string,
  args: readonly string[],
  cwd = repositoryRoot,
): Promise<string> {
  const result = await execFileAsync(command, [...args], {
    cwd,
    env: runtimeEnvironment(),
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 262_144,
  });
  return result.stdout.trim();
}

async function ownedContainerIds(
  config: AppConfig,
  ownerId: string,
  kind: "runtime" | "verifier",
): Promise<string[]> {
  const filters =
    kind === "runtime"
      ? [
          `label=${SHEPHERD_RUNTIME_MARKER_LABEL}`,
          `label=${SHEPHERD_RUNTIME_KIND_LABEL}`,
          `label=${SHEPHERD_RUNTIME_OWNER_LABEL}=${ownerId}`,
        ]
      : [
          "label=io.codejam.shepherd=independent-verifier",
          `label=io.codejam.verifier-owner=${ownerId}`,
        ];
  const output = await commandOutput(
    config.containerEngine,
    ["ps", "--all", "--quiet", ...filters.flatMap((value) => ["--filter", value])],
  );
  return output ? output.split(/\r?\n/u).filter(Boolean) : [];
}

async function gitOutput(repositoryPath: string, args: readonly string[]) {
  return await commandOutput("git", args, repositoryPath);
}

async function commandBuffer(
  command: string,
  args: readonly string[],
  cwd: string,
  maxBytes: number,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd,
        env: runtimeEnvironment(),
        encoding: "buffer",
        timeout: 15_000,
        maxBuffer: maxBytes,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      },
    );
  });
}

async function reachableGitBlobs(repositoryPath: string): Promise<Buffer[]> {
  const objectLines = (
    await gitOutput(repositoryPath, ["rev-list", "--objects", "--all"])
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  if (objectLines.length > 1_024) {
    throw new Error("Live fixture repository exceeded its object scan ceiling");
  }
  const objectIds = [
    ...new Set(objectLines.map((line) => line.split(" ", 1)[0] ?? "")),
  ];
  if (objectIds.some((id) => !/^[a-f0-9]{40}$/u.test(id))) {
    throw new Error("Live fixture repository returned an invalid object ID");
  }
  const blobs: Buffer[] = [];
  for (const objectId of objectIds) {
    if ((await gitOutput(repositoryPath, ["cat-file", "-t", objectId])) !== "blob") {
      continue;
    }
    const size = Number(
      await gitOutput(repositoryPath, ["cat-file", "-s", objectId]),
    );
    if (!Number.isSafeInteger(size) || size < 0 || size > 1_048_576) {
      throw new Error("Live fixture Git blob exceeded its scan ceiling");
    }
    blobs.push(
      await commandBuffer(
        "git",
        ["cat-file", "blob", objectId],
        repositoryPath,
        Math.max(1_024, size + 1_024),
      ),
    );
  }
  return blobs;
}

async function managedWorktreeFiles(root: string): Promise<Buffer[]> {
  const files: Buffer[] = [];
  let visited = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git" && entry.isDirectory()) continue;
      visited += 1;
      if (visited > 2_000) {
        throw new Error("Live managed-tree scan exceeded its entry ceiling");
      }
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Live managed-tree scan encountered a symlink");
      }
      if (entry.isDirectory()) {
        await visit(target);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error("Live managed-tree scan encountered a special file");
      }
      const metadata = await lstat(target);
      if (metadata.size > 1_048_576) {
        throw new Error("Live managed-tree file exceeded its scan ceiling");
      }
      files.push(await readFile(target));
    }
  };
  await visit(root);
  return files;
}

async function assertNoPrivateExecutionLeaks(
  config: AppConfig,
  managedRoot: string,
  projectId: string,
  requests: readonly RecordedLiveRequest[],
): Promise<void> {
  expect(await readdir(config.shepherdCodexHomeRoot)).toEqual([
    ".shepherd-codex-home-root",
  ]);
  for (const request of requests) {
    expect(await entryExists(request.codexHome)).toBe(false);
  }
  const executionRoot = path.join(
    managedRoot,
    "planes",
    projectId,
    ".execution-workspaces",
  );
  expect(await readdir(executionRoot)).toEqual([]);
}

describe.skipIf(!liveEnabled)("Shepherd live Codex Runtime gate", () => {
  it(
    "completes bounded fresh Missions with isolated sessions and no secret or Runtime leaks",
    async () => {
      await prepareLiveRoot();
      const config = liveConfig();
      await Promise.all([
        mkdir(config.dataDirectory, { recursive: true, mode: 0o700 }),
        mkdir(config.workspaceRoot, { recursive: true, mode: 0o700 }),
        mkdir(config.codexHome, { recursive: true, mode: 0o700 }),
        mkdir(config.shepherdRoot, { recursive: true, mode: 0o700 }),
      ]);
      const ownerId = await resolveVerifierOwnerId(config);
      const containerRunner = new ContainerCodexRunner(config, {
        shepherdOwnerId: ownerId,
      });
      const runner = new RecordingEphemeralRunner(containerRunner);
      if (!(await runner.isAvailable())) {
        throw new Error(
          "Live Shepherd gate requires the configured container engine, image, and Codex sandbox preflight",
        );
      }
      const executor = new CodexShepherdExecutor(config, ownerId, runner);
      const verifiers: ContainerVerifier[] = [];
      const statePaths: string[] = [];
      const details: ShepherdMissionDetail[] = [];

      try {
        for (const sequence of liveSequences) {
          const caseRoot = path.join(liveRoot, `mission-${sequence}`);
          const managedRoot = path.join(caseRoot, "managed");
          const projectId = `auth-live-${sequence}`;
          const statePath = path.join(caseRoot, "state.json");
          await mkdir(caseRoot, { recursive: true, mode: 0o700 });
          const verifier = new ContainerVerifier(registry(), {
            planesRoot: path.join(managedRoot, "planes", projectId),
            containerEngine: config.containerEngine,
            containerImage: config.shepherdVerifierImage,
            containerUser: config.containerUser,
            ownerId,
            cpuLimit: config.containerCpuLimit,
            memoryLimit: config.containerMemoryLimit,
            pidsLimit: config.containerPidsLimit,
            maxTimeoutMs: config.shepherdVerificationTimeoutMs,
            maxOutputBytes: config.codexMaxOutputBytes,
            sensitiveValues: [config.arkApiKey, config.authToken],
          });
          verifiers.push(verifier);
          const store = new JsonStore(statePath, {
            sensitiveValues: [config.arkApiKey, config.authToken],
          });
          await store.initialize();
          const service = new ShepherdService({
            store,
            managedRoot,
            agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
            verifier,
            executor,
            sensitiveValues: [config.arkApiKey, config.authToken],
            contractTimeoutMs: config.shepherdContractTimeoutMs,
            candidateTimeoutMs: config.shepherdCandidateTimeoutMs,
          });
          await service.initialize();
          const result = await service.runDeterministicDemo({ projectId });
          const detail = service.missionDetail(result.mission.id);
          if (!detail) throw new Error("Live Mission detail was not persisted");
          details.push(detail);
          statePaths.push(statePath);

          expect(result.mission.state).toBe("completed");
          expect(result.selectedCandidate).toMatchObject({
            targetValue: COOKIE_TRANSPORT,
            executionState: "passed",
            selectionState: "selected",
            promotionState: "promoted",
          });
          expect(detail.contracts.map((contract) => contract.state)).toEqual([
            "verified",
            "verified",
          ]);
          expect(detail.collisions).toHaveLength(1);
          expect(detail.candidates).toHaveLength(2);
          expect(
            detail.candidates.find(
              (candidate) => candidate.targetValue === BEARER_TRANSPORT,
            ),
          ).toMatchObject({
            executionState: "failed",
            selectionState: "rejected",
            promotionState: "not_started",
            failure: {
              code: "failed_independent_acceptance",
              stage: "candidate_verification",
            },
            verificationEvidence: { passed: false },
          });
          expect(
            detail.candidates.find(
              (candidate) => candidate.targetValue === COOKIE_TRANSPORT,
            ),
          ).toMatchObject({
            executionState: "passed",
            selectionState: "selected",
            promotionState: "promoted",
            failure: null,
            verificationEvidence: { passed: true },
          });

          const executedPlanes = detail.planes.filter(
            (plane) => plane.kind === "contract" || plane.kind === "resolution",
          );
          expect(executedPlanes).toHaveLength(4);
          expect(
            executedPlanes.every((plane) =>
              /^[a-f0-9]{64}$/u.test(plane.runtimeSessionFingerprint ?? ""),
            ),
          ).toBe(true);
          expect(
            detail.planes.find((plane) => plane.kind === "integration")
              ?.runtimeSessionFingerprint,
          ).toBeNull();
          expect(
            detail.planes
              .filter((plane) => plane.kind === "resolution")
              .every((plane) => plane.baseCommit === result.integrationCommit),
          ).toBe(true);

          const repositoryPath = path.join(
            managedRoot,
            "repositories",
            projectId,
          );
          expect(await gitOutput(repositoryPath, ["rev-parse", "HEAD"])).toBe(
            result.promotedHead,
          );
          const tracked = await gitOutput(repositoryPath, [
            "ls-tree",
            "-r",
            "--name-only",
            result.promotedHead,
          ]);
          expect(
            tracked.split(/\r?\n/u).some((entry) => entry.startsWith(".shepherd/")),
          ).toBe(false);
          const scannedContent = [
            ...(await reachableGitBlobs(repositoryPath)),
            ...(await managedWorktreeFiles(managedRoot)),
          ];
          for (const secret of [config.arkApiKey, config.authToken].filter(
            (value) => value.length >= 4,
          )) {
            const secretBytes = Buffer.from(secret, "utf8");
            expect(
              scannedContent.some((content) => content.includes(secretBytes)),
            ).toBe(false);
          }
          const envelopeBytes = Buffer.from(
            "SHEPHERD_EXECUTION_ENVELOPE_V1",
            "utf8",
          );
          expect(
            scannedContent.some((content) => content.includes(envelopeBytes)),
          ).toBe(false);
          await assertNoPrivateExecutionLeaks(
            config,
            managedRoot,
            projectId,
            runner.requests.slice((sequence - 1) * 4, sequence * 4),
          );
        }

        const expectedExecutionCount = liveSequences.length * 4;
        expect(runner.requests).toHaveLength(expectedExecutionCount);
        expect(runner.threadIds).toHaveLength(expectedExecutionCount);
        expect(new Set(runner.threadIds).size).toBe(expectedExecutionCount);
        expect(new Set(runner.requests.map((request) => request.executionId)).size).toBe(
          expectedExecutionCount,
        );
        expect(new Set(runner.requests.map((request) => request.codexHome)).size).toBe(
          expectedExecutionCount,
        );
        expect(
          runner.requests.every(
            (request) =>
              request.threadId === null &&
              request.prompt.startsWith("SHEPHERD_EXECUTION_ENVELOPE_V1\n") &&
              !request.prompt.includes(config.arkApiKey),
          ),
        ).toBe(true);

        const fingerprints = details.flatMap((detail) =>
          detail.planes.flatMap((plane) =>
            plane.runtimeSessionFingerprint
              ? [plane.runtimeSessionFingerprint]
              : [],
          ),
        );
        expect(fingerprints).toHaveLength(expectedExecutionCount);
        expect(new Set(fingerprints).size).toBe(expectedExecutionCount);
        for (const [index, statePath] of statePaths.entries()) {
          const persisted = await readFile(statePath, "utf8");
          expect(persisted).not.toContain("SHEPHERD_EXECUTION_ENVELOPE_V1");
          for (const secret of [config.arkApiKey, config.authToken].filter(
            (value) => value.length >= 4,
          )) {
            expect(persisted.includes(secret)).toBe(false);
          }
          for (const threadId of runner.threadIds) {
            expect(persisted.includes(threadId)).toBe(false);
            expect(JSON.stringify(details[index]).includes(threadId)).toBe(false);
          }
        }
        expect(await ownedContainerIds(config, ownerId, "runtime")).toEqual([]);
        expect(await ownedContainerIds(config, ownerId, "verifier")).toEqual([]);
      } finally {
        await executor.reconcileInterrupted();
        for (const verifier of verifiers) await verifier.reconcileInterrupted();
      }
    },
    1_800_000,
  );
});
