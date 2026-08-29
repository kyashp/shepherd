import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { JsonStore } from "../store.js";
import { COOKIE_TRANSPORT } from "./auth-fixture.js";
import type { VerificationEvidence } from "./domain.js";
import { DeterministicFixtureExecutor } from "./executor.js";
import {
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_PROFILE_ID,
  ShepherdService,
} from "./service.js";
import {
  ContainerVerifier,
  TrustedCheckRegistry,
  type ContainerVerifierOptions,
  type VerificationRequest,
} from "./verifier.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(
  new URL("../../../../", import.meta.url),
);
const testRoot = path.join(repositoryRoot, ".tmp", "shepherd-tests");
const rootSentinel = path.join(testRoot, ".service-container-test-root");
const rootSentinelValue = "shepherd service container tests only\n";
const caseSentinelValue = "shepherd service container case\n";
const containerEngine = "docker";
const runtimeImage = "volc-agent-runtime:local";
const containerUser =
  typeof process.getuid === "function" && typeof process.getgid === "function"
    ? `${process.getuid()}:${process.getgid()}`
    : "1000:1000";
const cleanupCases: string[] = [];

function isStrictlyInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function ensureTestRoot(): Promise<void> {
  await mkdir(testRoot, { recursive: true });
  const canonical = await realpath(testRoot);
  if (canonical !== testRoot) {
    throw new Error("Service container test root resolves through a symlink");
  }
  try {
    await writeFile(rootSentinel, rootSentinelValue, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if ((await readFile(rootSentinel, "utf8")) !== rootSentinelValue) {
    throw new Error("Service container test root sentinel mismatch");
  }
}

async function createCaseRoot(): Promise<string> {
  await ensureTestRoot();
  const caseRoot = path.join(
    testRoot,
    `service-container-${crypto.randomUUID()}`,
  );
  await mkdir(caseRoot);
  await writeFile(
    path.join(caseRoot, ".case-sentinel"),
    caseSentinelValue,
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  cleanupCases.push(caseRoot);
  return caseRoot;
}

async function safelyRemoveCase(caseRoot: string): Promise<void> {
  const rootEntry = await lstat(testRoot);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
    throw new Error("Service container test root is not a trusted directory");
  }
  const caseEntry = await lstat(caseRoot);
  if (caseEntry.isSymbolicLink() || !caseEntry.isDirectory()) {
    throw new Error("Service container test case is not a trusted directory");
  }
  const canonicalRoot = await realpath(testRoot);
  const canonicalCase = await realpath(caseRoot);
  if (!isStrictlyInside(canonicalRoot, canonicalCase)) {
    throw new Error("Service container test cleanup escaped its sentinel root");
  }
  if (
    (await readFile(path.join(canonicalCase, ".case-sentinel"), "utf8")) !==
    caseSentinelValue
  ) {
    throw new Error("Service container test case sentinel mismatch");
  }
  await rm(canonicalCase, { recursive: true, force: true });
}

async function commandOutput(
  command: string,
  args: readonly string[],
  cwd = repositoryRoot,
): Promise<string> {
  const result = await execFileAsync(command, [...args], {
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
    timeout: 10_000,
    maxBuffer: 262_144,
  });
  return result.stdout.trim();
}

async function containerRuntimeAvailable(): Promise<boolean> {
  try {
    await commandOutput(containerEngine, ["version", "--format", "{{.Server.Version}}"]);
    await commandOutput(containerEngine, ["image", "inspect", runtimeImage]);
    return true;
  } catch {
    return false;
  }
}

interface RecordedVerification {
  request: VerificationRequest;
  evidence: VerificationEvidence;
}

class RecordingContainerVerifier extends ContainerVerifier {
  readonly records: RecordedVerification[] = [];

  constructor(registry: TrustedCheckRegistry, options: ContainerVerifierOptions) {
    super(registry, options);
  }

  override async verify(
    request: VerificationRequest,
  ): Promise<VerificationEvidence> {
    const evidence = await super.verify(request);
    this.records.push({
      request: {
        ...request,
        checks: request.checks.map((check) => ({ ...check })),
        changedFiles: [...request.changedFiles],
      },
      evidence,
    });
    return evidence;
  }
}

const hasContainerRuntime = await containerRuntimeAvailable();

beforeAll(async () => {
  await ensureTestRoot();
});

afterEach(async () => {
  while (cleanupCases.length > 0) {
    const caseRoot = cleanupCases.pop();
    if (caseRoot) await safelyRemoveCase(caseRoot);
  }
});

describe.skipIf(!hasContainerRuntime)(
  "Shepherd deterministic Mission with the real container verifier",
  () => {
    it(
      "verifies contracts and candidates, resolves the collision, and promotes only the cookie winner",
      async () => {
        const caseRoot = await createCaseRoot();
        const projectId = "auth-container-e2e";
        const managedRoot = path.join(caseRoot, "managed");
        const planesRoot = path.join(managedRoot, "planes", projectId);
        const repositoryPath = path.join(
          managedRoot,
          "repositories",
          projectId,
        );
        const registry = new TrustedCheckRegistry([
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
        const verifier = new RecordingContainerVerifier(registry, {
          planesRoot,
          containerEngine,
          containerImage: runtimeImage,
          containerUser,
          ownerId: "service-container-test",
          cpuLimit: 1,
          memoryLimit: "256m",
          pidsLimit: 64,
          maxTimeoutMs: 30_000,
          maxOutputBytes: 32_768,
        });
        const store = new JsonStore(path.join(caseRoot, "state.json"));
        await store.initialize();
        const service = new ShepherdService({
          store,
          managedRoot,
          agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
          verifier,
          executor: new DeterministicFixtureExecutor(),
        });

        const result = await service.runDeterministicDemo({ projectId });
        const detail = service.missionDetail(result.mission.id);
        expect(detail).not.toBeNull();
        if (!detail) throw new Error("Completed Mission detail is missing");

        expect(result.mission.state).toBe("completed");
        expect(result.selectedCandidate).toMatchObject({
          targetValue: COOKIE_TRANSPORT,
          executionState: "passed",
          selectionState: "selected",
          promotionState: "promoted",
        });
        expect(detail.contracts).toHaveLength(2);
        for (const contract of detail.contracts) {
          expect(contract.state).toBe("verified");
          expect(contract.verificationEvidence).toHaveLength(1);
          const evidence = contract.verificationEvidence[0];
          expect(evidence).toMatchObject({
            targetType: "contract",
            targetId: contract.id,
            runner: "independent",
            passed: true,
          });
          expect(evidence?.checks).toHaveLength(1);
          expect(evidence?.checks[0]).toMatchObject({
            status: "passed",
            passed: true,
            exitCode: 0,
          });
          expect(evidence?.checks[0]?.stdout).toContain("auth contract accepted");
        }

        expect(detail.candidates).toHaveLength(2);
        for (const candidate of detail.candidates) {
          const evidence = candidate.verificationEvidence;
          expect(evidence).not.toBeNull();
          expect(evidence).toMatchObject({
            targetType: "candidate",
            targetId: candidate.id,
            runner: "independent",
          });
          expect(evidence?.checks.map((check) => check.profileId)).toEqual([
            AUTH_FRONTEND_PROFILE_ID,
            AUTH_BACKEND_PROFILE_ID,
            AUTH_PROJECT_PROFILE_ID,
          ]);
          expect(evidence?.checks[0]?.stdout).toContain(
            "frontend auth contract accepted",
          );
          expect(evidence?.checks[1]?.stdout).toContain(
            "backend auth contract accepted",
          );
        }

        const promotionRecord = verifier.records.find(
          (record) => record.request.targetType === "promotion",
        );
        expect(promotionRecord?.request.targetId).toBe(
          result.selectedCandidate.id,
        );
        expect(promotionRecord?.evidence).toMatchObject({
          targetType: "promotion",
          runner: "independent",
          passed: true,
        });
        expect(
          promotionRecord?.evidence.checks.map((check) => check.profileId),
        ).toEqual([
          AUTH_FRONTEND_PROFILE_ID,
          AUTH_BACKEND_PROFILE_ID,
          AUTH_PROJECT_PROFILE_ID,
        ]);
        expect(promotionRecord?.evidence.checks[2]?.stdout).toContain(
          `project security invariant accepted: ${COOKIE_TRANSPORT}`,
        );
        expect(verifier.records.map((record) => record.request.targetType).sort()).toEqual(
          ["candidate", "candidate", "contract", "contract", "promotion"].sort(),
        );

        const integrationPlane = detail.planes.find(
          (plane) => plane.kind === "integration",
        );
        const resolutionPlanes = detail.planes.filter(
          (plane) => plane.kind === "resolution",
        );
        expect(integrationPlane?.headCommit).toBe(result.integrationCommit);
        expect(resolutionPlanes).toHaveLength(2);
        expect(
          resolutionPlanes.every(
            (plane) => plane.baseCommit === result.integrationCommit,
          ),
        ).toBe(true);

        const selectedPlane = resolutionPlanes.find(
          (plane) => plane.id === result.selectedCandidate.planeId,
        );
        expect(selectedPlane?.headCommit).toBe(result.promotedHead);
        expect(selectedPlane?.verificationEvidenceIds).toHaveLength(2);
        expect(new Set(selectedPlane?.verificationEvidenceIds).size).toBe(2);
        expect(detail.events.some((event) => event.type === "promotion_completed"))
          .toBe(true);
        expect(detail.project.protectedHeadCommit).toBe(selectedPlane?.headCommit);
        expect(await commandOutput("git", ["rev-parse", "HEAD"], repositoryPath))
          .toBe(selectedPlane?.headCommit);
        expect(
          await commandOutput(
            "git",
            ["rev-parse", `refs/heads/${detail.project.protectedBranch}`],
            repositoryPath,
          ),
        ).toBe(selectedPlane?.headCommit);

        for (const plane of detail.planes) {
          if (!plane.headCommit) continue;
          const trackedAtHead = await commandOutput(
            "git",
            ["ls-tree", "-r", "--name-only", plane.headCommit],
            repositoryPath,
          );
          expect(trackedAtHead.split("\n")).not.toContain(
            ".shepherd/result.json",
          );
          expect(trackedAtHead).not.toMatch(/(?:^|\n)\.shepherd(?:\/|$)/u);
        }

        const verificationTargetIds = new Set(
          verifier.records.map((record) => record.request.targetId),
        );
        for (const targetId of verificationTargetIds) {
          const remainingContainers = await commandOutput(containerEngine, [
            "ps",
            "-a",
            "--filter",
            "label=io.codejam.shepherd=independent-verifier",
            "--filter",
            `label=io.codejam.verification-target=${targetId}`,
            "--format",
            "{{.Names}}",
          ]);
          expect(remainingContainers).toBe("");
        }
      },
      120_000,
    );
  },
);
