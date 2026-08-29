import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AcceptanceCheck,
  ResolutionCandidate,
  VerificationEvidence,
} from "./domain.js";
import {
  DirtyProtectedWorktreeError,
  GitClient,
  type GitClientOptions,
  NonFastForwardPromotionError,
  ProtectedGitMutationError,
  ProtectedRefRollbackError,
  ProtectedWorktreeSynchronizationError,
  assertSafeGitBranch,
} from "./git-client.js";
import {
  PlaneAuthorityViolationError,
  PlaneManager,
  UnsafeExecutionWorkspaceError,
} from "./plane-manager.js";
import { PromotionGate } from "./promotion-gate.js";

const execFileAsync = promisify(execFile);
const workspace = path.resolve(".");
const testRoot = path.join(workspace, ".tmp", "shepherd-tests");
const rootMarker = path.join(testRoot, ".integration-test-root");
const expectedRootMarker = "shepherd integration fixtures only\n";

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

async function fixtureGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1_048_576,
    env: {
      PATH: process.env.PATH,
      HOME: "/nonexistent",
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@local.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@local.invalid",
    },
  });
  return result.stdout.trim();
}

interface Fixture {
  casePath: string;
  repositoryPath: string;
  planesRoot: string;
  manager: PlaneManager;
  baseCommit: string;
}

async function createFixture(options: Pick<GitClientOptions, "promotionFaults"> = {}): Promise<Fixture> {
  const casePath = path.join(testRoot, "case-" + randomUUID());
  if (!isInside(testRoot, casePath) || casePath === workspace) throw new Error("Unsafe test fixture path");
  await mkdir(casePath, { recursive: false });
  await writeFile(path.join(casePath, ".case-sentinel"), "shepherd-test-case\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  const repositoryPath = path.join(casePath, "repository");
  const planesRoot = path.join(casePath, "planes");
  await mkdir(repositoryPath);
  await mkdir(planesRoot);
  await fixtureGit(repositoryPath, ["init", "--initial-branch=main"]);
  await writeFile(path.join(repositoryPath, "README.md"), "# Managed fixture\n", "utf8");
  await writeFile(path.join(repositoryPath, "shared.txt"), "base\n", "utf8");
  await fixtureGit(repositoryPath, ["add", "--", "README.md", "shared.txt"]);
  await fixtureGit(repositoryPath, ["commit", "-m", "fixture base"]);
  const baseCommit = await fixtureGit(repositoryPath, ["rev-parse", "HEAD"]);
  const git = new GitClient(repositoryPath, {
    worktreeRoot: planesRoot,
    protectedBranch: "main",
    ...options,
  });
  const manager = new PlaneManager({
    repositoryPath,
    planesRoot,
    protectedBranch: "main",
    git,
  });
  await manager.initialize();
  return { casePath, repositoryPath, planesRoot, manager, baseCommit };
}

async function destroyFixture(fixture: Fixture): Promise<void> {
  const canonicalRoot = await realpath(testRoot);
  const canonicalCase = await realpath(fixture.casePath);
  if (!isInside(canonicalRoot, canonicalCase)) throw new Error("Fixture cleanup escaped its root");
  if ((await readFile(path.join(canonicalCase, ".case-sentinel"), "utf8")) !== "shepherd-test-case\n") {
    throw new Error("Fixture cleanup sentinel mismatch");
  }
  await rm(canonicalCase, { recursive: true, force: true });
}

const authority = {
  readable: ["**"],
  writable: ["**"],
  forbidden: [".git/**", ".shepherd/**"],
};

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

describe("GitClient and PlaneManager integration", () => {
  it("creates isolated Planes from one SHA, strips control metadata, integrates, and resets leaks", async () => {
    const fixture = await createFixture();
    try {
      const left = await fixture.manager.createPlane({
        id: "contract-left",
        projectId: "project",
        missionId: "mission",
        kind: "contract",
        contractId: "left",
        baseCommit: fixture.baseCommit,
        purpose: "left contract",
        executionIdentity: "exec-left",
        authority,
      });
      const right = await fixture.manager.createPlane({
        id: "contract-right",
        projectId: "project",
        missionId: "mission",
        kind: "contract",
        contractId: "right",
        baseCommit: fixture.baseCommit,
        purpose: "right contract",
        executionIdentity: "exec-right",
        authority,
      });
      expect(left.baseCommit).toBe(right.baseCommit);
      expect(left.worktreePath).not.toBe(right.worktreePath);

      await mkdir(path.join(left.worktreePath, ".shepherd"));
      await writeFile(path.join(left.worktreePath, "left.ts"), "export const left = true;\n", "utf8");
      await writeFile(path.join(left.worktreePath, ".shepherd", "result.json"), "{}\n", "utf8");
      // Even if an Agent commits the manifest itself, the trusted finalizer
      // rebuilds from the immutable base and excludes all control metadata.
      await fixtureGit(left.worktreePath, ["add", "--", "left.ts", ".shepherd/result.json"]);
      await fixtureGit(left.worktreePath, ["commit", "-m", "untrusted agent commit"]);
      const committedLeft = await fixture.manager.commitPlane(left, "Finalize left contract");
      expect(committedLeft.changedFiles).toEqual(["left.ts"]);
      await expect(
        fixtureGit(left.worktreePath, ["show", committedLeft.headCommit + ":.shepherd/result.json"]),
      ).rejects.toThrow();
      expect(await readFile(path.join(left.worktreePath, ".shepherd", "result.json"), "utf8")).toBe("{}\n");

      await writeFile(path.join(right.worktreePath, "right.ts"), "export const right = true;\n", "utf8");
      const committedRight = await fixture.manager.commitPlane(right, "Finalize right contract");
      expect(committedRight.changedFiles).toEqual(["right.ts"]);

      const integration = await fixture.manager.createIntegrationPlane({
        id: "integration",
        projectId: "project",
        missionId: "mission",
        baseCommit: fixture.baseCommit,
        purpose: "textual integration",
        executionIdentity: "exec-integration",
        authority,
      });
      const leftMerge = await fixture.manager.mergePlane(integration, committedLeft);
      expect(leftMerge.merged).toBe(true);
      const rightMerge = await fixture.manager.mergePlane(leftMerge.plane, committedRight);
      expect(rightMerge.merged).toBe(true);
      expect(rightMerge.plane.changedFiles).toEqual(["left.ts", "right.ts"]);

      const resolution = await fixture.manager.createResolutionPlane({
        id: "resolution-a",
        projectId: "project",
        missionId: "mission",
        candidateId: "candidate-a",
        baseCommit: rightMerge.plane.headCommit!,
        purpose: "resolve to A",
        executionIdentity: "exec-candidate-a",
        authority,
      });
      expect(resolution.baseCommit).toBe(rightMerge.plane.headCommit);
      const worktreesBeforeReset = await fixture.manager.git.listWorktrees();
      expect(worktreesBeforeReset).toHaveLength(5);
      const removed = await fixture.manager.resetManagedPlanes();
      expect(removed).toHaveLength(4);
      expect(await fixture.manager.git.listWorktrees()).toHaveLength(1);
    } finally {
      await destroyFixture(fixture);
    }
  }, 15_000);

  it("reports a real textual merge conflict and leaves the integration Plane clean", async () => {
    const fixture = await createFixture();
    try {
      const make = async (id: string, content: string) => {
        const plane = await fixture.manager.createPlane({
          id,
          projectId: "project",
          missionId: "mission",
          kind: "contract",
          contractId: id,
          baseCommit: fixture.baseCommit,
          purpose: id,
          executionIdentity: "exec-" + id,
          authority,
        });
        await writeFile(path.join(plane.worktreePath, "shared.txt"), content, "utf8");
        return await fixture.manager.commitPlane(plane, "Finalize " + id);
      };
      const left = await make("conflict-left", "left\n");
      const right = await make("conflict-right", "right\n");
      const integration = await fixture.manager.createIntegrationPlane({
        id: "conflict-integration",
        projectId: "project",
        missionId: "mission",
        baseCommit: fixture.baseCommit,
        purpose: "conflict",
        executionIdentity: "exec-integration",
        authority,
      });
      const first = await fixture.manager.mergePlane(integration, left);
      const second = await fixture.manager.mergePlane(first.plane, right);
      expect(second).toMatchObject({ merged: false, conflictFiles: ["shared.txt"] });
      expect(await fixture.manager.git.uncommittedFiles(integration.worktreePath)).toEqual([]);
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("rejects ref injection, boundary escapes, non-sentinel adoption, and sentinel tampering", async () => {
    const fixture = await createFixture();
    try {
      expect(() => assertSafeGitBranch("main;touch-pwned")).toThrow("Unsafe Git branch");
      await expect(
        fixture.manager.git.assertManagedDestination(path.join(fixture.casePath, "outside")),
      ).rejects.toThrow("escapes");

      const unsafeRoot = path.join(fixture.casePath, "nonempty-without-sentinel");
      await mkdir(unsafeRoot);
      await writeFile(path.join(unsafeRoot, "user-file"), "preserve\n", "utf8");
      await expect(
        new PlaneManager({
          repositoryPath: fixture.repositoryPath,
          planesRoot: unsafeRoot,
        }).initialize(),
      ).rejects.toThrow("Refusing to adopt");
      expect(await readFile(path.join(unsafeRoot, "user-file"), "utf8")).toBe("preserve\n");

      const plane = await fixture.manager.createPlane({
        id: "guarded",
        projectId: "project",
        missionId: "mission",
        kind: "contract",
        contractId: "guarded",
        baseCommit: fixture.baseCommit,
        purpose: "guard",
        executionIdentity: "exec-guarded",
        authority,
      });
      const sentinelPath = path.join(fixture.planesRoot, ".shepherd-plane-root.json");
      const originalSentinel = await readFile(sentinelPath, "utf8");
      await writeFile(sentinelPath, "{}\n", "utf8");
      await expect(fixture.manager.destroyPlane(plane)).rejects.toThrow("sentinel");
      expect((await stat(plane.worktreePath)).isDirectory()).toBe(true);
      await writeFile(sentinelPath, originalSentinel, "utf8");
      await fixture.manager.destroyPlane(plane);
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("disables repository hooks for trusted commits", async () => {
    const fixture = await createFixture();
    try {
      const hook = path.join(fixture.repositoryPath, ".git", "hooks", "pre-commit");
      await writeFile(hook, "#!/bin/sh\nexit 91\n", "utf8");
      await chmod(hook, 0o755);
      const plane = await fixture.manager.createPlane({
        id: "hooks-disabled",
        projectId: "project",
        missionId: "mission",
        kind: "contract",
        contractId: "hooks-disabled",
        baseCommit: fixture.baseCommit,
        purpose: "prove hooks disabled",
        executionIdentity: "exec-hook",
        authority,
      });
      await writeFile(path.join(plane.worktreePath, "safe.ts"), "export const safe = true;\n", "utf8");
      const committed = await fixture.manager.commitPlane(plane, "Trusted hook-free commit");
      expect(committed.headCommit).not.toBe(fixture.baseCommit);
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("structurally rejects every public protected-worktree/ref mutation bypass", async () => {
    const fixture = await createFixture();
    try {
      const source = await fixture.manager.createPlane({
        id: "bypass-source",
        projectId: "project",
        missionId: "mission",
        kind: "contract",
        contractId: "bypass-source",
        baseCommit: fixture.baseCommit,
        purpose: "source commit for bypass attempts",
        executionIdentity: "exec-bypass",
        authority,
      });
      await writeFile(path.join(source.worktreePath, "source.ts"), "export const source = true;\n", "utf8");
      const committed = await fixture.manager.commitPlane(source, "Finalize bypass source");
      const protectedHeadBefore = await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"]);
      const protectedReadmeBefore = await readFile(path.join(fixture.repositoryPath, "README.md"), "utf8");

      await expect(
        fixture.manager.git.stagePaths(fixture.repositoryPath, ["README.md"]),
      ).rejects.toBeInstanceOf(ProtectedGitMutationError);
      await expect(
        fixture.manager.git.rebuildCommit(
          fixture.repositoryPath,
          fixture.baseCommit,
          ["README.md"],
          "Attempt protected rebuild",
        ),
      ).rejects.toBeInstanceOf(ProtectedGitMutationError);
      await expect(
        fixture.manager.git.mergeCommit(
          fixture.repositoryPath,
          committed.headCommit!,
          "Attempt protected merge",
        ),
      ).rejects.toBeInstanceOf(ProtectedGitMutationError);
      await expect(fixture.manager.git.deleteBranch("main")).rejects.toBeInstanceOf(
        ProtectedGitMutationError,
      );
      await expect(
        fixture.manager.git.compareAndSwapFastForward(
          "not-the-protected-branch",
          fixture.baseCommit,
          committed.headCommit!,
        ),
      ).rejects.toBeInstanceOf(ProtectedGitMutationError);
      await expect(
        fixture.manager.git.addWorktree(
          path.join(fixture.planesRoot, "forbidden-main"),
          "main",
          fixture.baseCommit,
        ),
      ).rejects.toBeInstanceOf(ProtectedGitMutationError);

      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).toBe(
        protectedHeadBefore,
      );
      expect(await readFile(path.join(fixture.repositoryPath, "README.md"), "utf8")).toBe(
        protectedReadmeBefore,
      );
      expect(await fixtureGit(fixture.repositoryPath, ["diff", "--cached", "--name-only"])).toBe(
        "",
      );
      expect(await fixtureGit(fixture.repositoryPath, ["branch", "--show-current"])).toBe("main");
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("enforces persisted Plane authority for direct commit and merge callers", async () => {
    const fixture = await createFixture();
    try {
      const narrowAuthority = {
        readable: ["**"],
        writable: ["allowed/**"],
        forbidden: [".git/**", ".shepherd/**"],
      };
      const rejectedCommit = await fixture.manager.createPlane({
        id: "narrow-commit",
        projectId: "project",
        missionId: "mission",
        kind: "contract",
        contractId: "narrow-commit",
        baseCommit: fixture.baseCommit,
        purpose: "narrow authority commit",
        executionIdentity: "exec-narrow-commit",
        authority: narrowAuthority,
      });
      await writeFile(path.join(rejectedCommit.worktreePath, "outside.ts"), "outside scope\n", "utf8");
      await expect(
        fixture.manager.commitPlane(rejectedCommit, "Must reject outside scope"),
      ).rejects.toMatchObject<Partial<PlaneAuthorityViolationError>>({
        name: "PlaneAuthorityViolationError",
        operation: "commit",
        deniedPaths: ["outside.ts"],
      });
      expect(await fixture.manager.git.currentHead(rejectedCommit.worktreePath)).toBe(
        fixture.baseCommit,
      );

      const hostileSource = await fixture.manager.createPlane({
        id: "narrow-merge-source",
        projectId: "project",
        missionId: "mission",
        kind: "contract",
        contractId: "narrow-merge-source",
        baseCommit: fixture.baseCommit,
        purpose: "Agent-authored unauthorized commit",
        executionIdentity: "exec-narrow-merge",
        authority: narrowAuthority,
      });
      await writeFile(path.join(hostileSource.worktreePath, "outside-merge.ts"), "hostile\n", "utf8");
      await fixtureGit(hostileSource.worktreePath, ["add", "--", "outside-merge.ts"]);
      await fixtureGit(hostileSource.worktreePath, ["commit", "-m", "untrusted unauthorized commit"]);
      const hostileHead = await fixtureGit(hostileSource.worktreePath, ["rev-parse", "HEAD"]);
      const integration = await fixture.manager.createIntegrationPlane({
        id: "authority-integration",
        projectId: "project",
        missionId: "mission",
        baseCommit: fixture.baseCommit,
        purpose: "must reject unauthorized source",
        executionIdentity: "exec-authority-integration",
        authority,
      });
      await expect(
        fixture.manager.mergePlane(
          integration,
          { ...hostileSource, headCommit: hostileHead },
        ),
      ).rejects.toMatchObject<Partial<PlaneAuthorityViolationError>>({
        name: "PlaneAuthorityViolationError",
        operation: "merge",
        deniedPaths: ["outside-merge.ts"],
      });
      expect(await fixture.manager.git.currentHead(integration.worktreePath)).toBe(
        fixture.baseCommit,
      );
      await expect(
        readFile(path.join(integration.worktreePath, "outside-merge.ts"), "utf8"),
      ).rejects.toThrow();
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("exports a Git-free readable tree and imports only the validated actual diff", async () => {
    const fixture = await createFixture();
    try {
      const plane = await fixture.manager.createPlane({
        id: "execution-boundary",
        projectId: "project",
        missionId: "mission",
        kind: "contract",
        contractId: "execution-boundary",
        baseCommit: fixture.baseCommit,
        purpose: "exercise Git-free execution",
        executionIdentity: "exec-boundary",
        authority,
      });
      const execution = await fixture.manager.createExecutionWorkspace(plane);
      expect(execution.path).not.toBe(plane.worktreePath);
      expect(await readFile(path.join(execution.path, "README.md"), "utf8")).toContain(
        "Managed fixture",
      );
      await expect(access(path.join(execution.path, ".git"))).rejects.toThrow();

      await writeFile(path.join(execution.path, "generated.ts"), "export const safe = true;\n", "utf8");
      await mkdir(path.join(execution.path, ".shepherd"));
      await writeFile(
        path.join(execution.path, ".shepherd", "result.json"),
        "{}\n",
        "utf8",
      );
      expect(await fixture.manager.importExecutionWorkspace(plane, execution)).toEqual([
        ".shepherd/result.json",
        "generated.ts",
      ]);
      expect(await readFile(path.join(plane.worktreePath, "generated.ts"), "utf8")).toContain(
        "safe",
      );
      expect(await readFile(path.join(plane.worktreePath, ".shepherd", "result.json"), "utf8")).toBe(
        "{}\n",
      );
      await fixture.manager.destroyExecutionWorkspace(execution);
      await expect(access(execution.path)).rejects.toThrow();
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("filters unreadable inputs and rejects out-of-scope, linked, special, and Git metadata outputs", async () => {
    const fixture = await createFixture();
    try {
      const narrowAuthority = {
        readable: ["README.md"],
        writable: ["allowed/**"],
        forbidden: [".git/**", ".shepherd/**", "forbidden/**"],
      };
      const plane = await fixture.manager.createPlane({
        id: "hostile-execution",
        projectId: "project",
        missionId: "mission",
        kind: "contract",
        contractId: "hostile-execution",
        baseCommit: fixture.baseCommit,
        purpose: "reject hostile executor output",
        executionIdentity: "exec-hostile",
        authority: narrowAuthority,
      });
      const execution = await fixture.manager.createExecutionWorkspace(plane);
      expect(await readFile(path.join(execution.path, "README.md"), "utf8")).toContain(
        "Managed fixture",
      );
      await expect(access(path.join(execution.path, "shared.txt"))).rejects.toThrow();
      await expect(access(path.join(execution.path, ".git"))).rejects.toThrow();

      await writeFile(path.join(execution.path, "outside.ts"), "outside\n", "utf8");
      await expect(
        fixture.manager.importExecutionWorkspace(plane, execution),
      ).rejects.toMatchObject<Partial<PlaneAuthorityViolationError>>({
        name: "PlaneAuthorityViolationError",
        operation: "import",
        deniedPaths: ["outside.ts"],
      });
      expect(await fixture.manager.git.uncommittedFiles(plane.worktreePath)).toEqual([]);
      await rm(path.join(execution.path, "outside.ts"));

      const outsideCanary = path.join(fixture.casePath, "outside-canary");
      await writeFile(outsideCanary, "preserve\n", "utf8");
      await symlink(outsideCanary, path.join(execution.path, "allowed-link"));
      await expect(
        fixture.manager.importExecutionWorkspace(plane, execution),
      ).rejects.toBeInstanceOf(UnsafeExecutionWorkspaceError);
      expect(await readFile(outsideCanary, "utf8")).toBe("preserve\n");
      await rm(path.join(execution.path, "allowed-link"));

      const fifo = path.join(execution.path, "allowed-fifo");
      await execFileAsync("mkfifo", [fifo]);
      await expect(
        fixture.manager.importExecutionWorkspace(plane, execution),
      ).rejects.toBeInstanceOf(UnsafeExecutionWorkspaceError);
      await rm(fifo);

      await mkdir(path.join(execution.path, ".git"));
      await writeFile(path.join(execution.path, ".git", "config"), "hostile\n", "utf8");
      await expect(
        fixture.manager.importExecutionWorkspace(plane, execution),
      ).rejects.toBeInstanceOf(UnsafeExecutionWorkspaceError);
      expect(await fixture.manager.git.uncommittedFiles(plane.worktreePath)).toEqual([]);
      await fixture.manager.destroyExecutionWorkspace(execution);
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("materializes fresh read-only exact-commit verification snapshots and always cleans them", async () => {
    const fixture = await createFixture();
    try {
      const initial = await fixture.manager.createResolutionPlane({
        id: "snapshot-source",
        projectId: "project",
        missionId: "mission",
        candidateId: "snapshot-candidate",
        baseCommit: fixture.baseCommit,
        purpose: "verify immutable snapshot",
        executionIdentity: "exec-snapshot",
        authority,
      });
      await writeFile(path.join(initial.worktreePath, "candidate.ts"), "committed\n", "utf8");
      const plane = await fixture.manager.commitPlane(initial, "Finalize snapshot source");
      await writeFile(path.join(plane.worktreePath, "live-only.ts"), "uncommitted\n", "utf8");
      await mkdir(path.join(plane.worktreePath, ".shepherd"));

      const usedPaths: string[] = [];
      for (let index = 0; index < 2; index += 1) {
        let snapshotPath = "";
        await fixture.manager.withVerificationSnapshot(plane.headCommit!, async (snapshot) => {
          snapshotPath = snapshot.path;
          usedPaths.push(snapshot.path);
          expect(snapshot.commit).toBe(plane.headCommit);
          expect(snapshot.path).not.toBe(plane.worktreePath);
          expect(await readFile(path.join(snapshot.path, "candidate.ts"), "utf8")).toBe(
            "committed\n",
          );
          await expect(access(path.join(snapshot.path, "live-only.ts"))).rejects.toThrow();
          await expect(access(path.join(snapshot.path, ".git"))).rejects.toThrow();
          await expect(access(path.join(snapshot.path, ".shepherd"))).rejects.toThrow();
          expect((await stat(snapshot.path)).mode & 0o222).toBe(0);
        });
        await expect(access(snapshotPath)).rejects.toThrow();
      }
      await rm(path.join(plane.worktreePath, "live-only.ts"));
      let emptyMetadataSnapshot = "";
      await fixture.manager.withVerificationSnapshot(plane.headCommit!, async (snapshot) => {
        emptyMetadataSnapshot = snapshot.path;
        usedPaths.push(snapshot.path);
        await expect(access(path.join(snapshot.path, ".shepherd"))).rejects.toThrow();
        expect(await readFile(path.join(snapshot.path, "candidate.ts"), "utf8")).toBe(
          "committed\n",
        );
      });
      await expect(access(emptyMetadataSnapshot)).rejects.toThrow();
      expect(new Set(usedPaths).size).toBe(3);
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });
});

const mandatoryCheck: AcceptanceCheck = {
  id: "acceptance",
  name: "Acceptance",
  profileId: "fixture",
  mandatory: true,
  timeoutMs: 5_000,
};

function evidence(passed: boolean, targetId: string): VerificationEvidence {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    targetType: "promotion",
    targetId,
    runner: "independent",
    passed,
    checks: [
      {
        id: mandatoryCheck.id,
        name: mandatoryCheck.name,
        profileId: mandatoryCheck.profileId,
        mandatory: true,
        status: passed ? "passed" : "failed",
        passed,
        exitCode: passed ? 0 : 1,
        durationMs: 1,
        stdout: "",
        stderr: "",
        error: passed ? null : "failed",
      },
    ],
    startedAt: now,
    completedAt: now,
    durationMs: 1,
    changedFiles: ["candidate.ts"],
    summary: passed ? "passed" : "failed",
  };
}

async function createCandidate(fixture: Fixture) {
  const plane = await fixture.manager.createResolutionPlane({
    id: "promotion-plane",
    projectId: "project",
    missionId: "mission",
    candidateId: "candidate",
    baseCommit: fixture.baseCommit,
    purpose: "promotion candidate",
    executionIdentity: "exec-candidate",
    authority,
  });
  await writeFile(path.join(plane.worktreePath, "candidate.ts"), "export const winner = true;\n", "utf8");
  const committedPlane = await fixture.manager.commitPlane(plane, "Finalize winning candidate");
  const now = new Date().toISOString();
  const candidate: ResolutionCandidate = {
    id: "candidate",
    missionId: "mission",
    collisionId: "collision",
    strategy: "Use session cookies",
    targetKey: "auth-method",
    targetValue: "http-only-session-cookie",
    planeId: committedPlane.id,
    executionState: "passed",
    selectionState: "selected",
    promotionState: "not_started",
    verificationEvidence: null,
    promotionEvidence: null,
    changedFiles: committedPlane.changedFiles,
    diffSummary: committedPlane.diffSummary,
    result: "passed",
    retryCount: 0,
    failure: null,
    createdAt: now,
    updatedAt: now,
  };
  return { plane: committedPlane, candidate };
}

describe("PromotionGate integration", () => {
  it("re-verifies and atomically fast-forwards the unchanged protected head", async () => {
    const fixture = await createFixture();
    try {
      const { plane, candidate } = await createCandidate(fixture);
      let verificationPath = "";
      const verifier = {
        verify: vi.fn(async (request: { planePath: string }) => {
          verificationPath = request.planePath;
          expect(request.planePath).not.toBe(plane.worktreePath);
          expect(await readFile(path.join(request.planePath, "candidate.ts"), "utf8")).toContain(
            "winner",
          );
          await expect(access(path.join(request.planePath, ".git"))).rejects.toThrow();
          return evidence(true, candidate.id);
        }),
      };
      const authorityCheck = vi.fn(async () => ({ allowed: true, reason: null }));
      let reads = 0;
      const gate = new PromotionGate(
        fixture.manager.git,
        verifier,
        authorityCheck,
        fixture.manager,
      );
      const result = await gate.promote({
        candidate,
        plane,
        protectedBranch: "main",
        expectedHead: fixture.baseCommit,
        checks: [mandatoryCheck],
        loadPersistedSelectedCandidateId: async () => {
          reads += 1;
          return candidate.id;
        },
        persistPromotingEvidence: async () => {},
      });
      expect(result).toMatchObject({
        promoted: true,
        previousHead: fixture.baseCommit,
        promotedHead: plane.headCommit,
        changedFiles: ["candidate.ts"],
      });
      expect(reads).toBe(2);
      expect(authorityCheck).toHaveBeenCalledOnce();
      expect(verifier.verify).toHaveBeenCalledOnce();
      await expect(access(verificationPath)).rejects.toThrow();
      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).toBe(plane.headCommit);
      expect(await readFile(path.join(fixture.repositoryPath, "candidate.ts"), "utf8")).toContain("winner");
      expect((await stat(plane.worktreePath)).isDirectory()).toBe(true);
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("reports protected worktree synchronization recovery distinctly at the promotion gate", async () => {
    const fixture = await createFixture({
      promotionFaults: {
        beforeWorktreeSynchronization: () => {
          throw new Error("injected promotion synchronization failure");
        },
      },
    });
    try {
      const { plane, candidate } = await createCandidate(fixture);
      const gate = new PromotionGate(
        fixture.manager.git,
        { verify: async () => evidence(true, candidate.id) },
        async () => ({ allowed: true, reason: null }),
        fixture.manager,
      );
      expect(
        await gate.promote({
          candidate,
          plane,
          protectedBranch: "main",
          expectedHead: fixture.baseCommit,
          checks: [mandatoryCheck],
          loadPersistedSelectedCandidateId: async () => candidate.id,
          persistPromotingEvidence: async () => {},
        }),
      ).toMatchObject({
        promoted: false,
        reason: "protected_worktree_sync_failure",
        actualHead: fixture.baseCommit,
        verificationEvidence: { passed: true },
      });
      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).toBe(
        fixture.baseCommit,
      );
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("does not invoke the protected CAS when durable pre-CAS persistence fails", async () => {
    const fixture = await createFixture();
    try {
      const { plane, candidate } = await createCandidate(fixture);
      const cas = vi.spyOn(fixture.manager.git, "compareAndSwapFastForward");
      const gate = new PromotionGate(
        fixture.manager.git,
        { verify: async () => evidence(true, candidate.id) },
        async () => ({ allowed: true, reason: null }),
        fixture.manager,
      );
      const result = await gate.promote({
        candidate,
        plane,
        protectedBranch: "main",
        expectedHead: fixture.baseCommit,
        checks: [mandatoryCheck],
        loadPersistedSelectedCandidateId: async () => candidate.id,
        persistPromotingEvidence: async () => {
          throw new Error("injected persistence failure");
        },
      });
      expect(result).toMatchObject({
        promoted: false,
        reason: "promotion_infrastructure_error",
      });
      expect(cas).not.toHaveBeenCalled();
      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).toBe(
        fixture.baseCommit,
      );
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("refuses selection mismatch, authority denial, failed re-verification, and unfinalized code", async () => {
    const fixture = await createFixture();
    try {
      const { plane, candidate } = await createCandidate(fixture);
      const verifier = { verify: vi.fn(async () => evidence(true, candidate.id)) };
      const denied = new PromotionGate(fixture.manager.git, verifier, async () => ({
        allowed: false,
        reason: "outside scope",
      }), fixture.manager);
      expect(
        await denied.promote({
          candidate,
          plane,
          protectedBranch: "main",
          expectedHead: fixture.baseCommit,
          checks: [mandatoryCheck],
          loadPersistedSelectedCandidateId: async () => candidate.id,
        }),
      ).toMatchObject({ promoted: false, reason: "unauthorized_file_change" });
      expect(verifier.verify).not.toHaveBeenCalled();

      const failedVerification = new PromotionGate(
        fixture.manager.git,
        { verify: async () => evidence(false, candidate.id) },
        async () => ({ allowed: true, reason: null }),
        fixture.manager,
      );
      expect(
        await failedVerification.promote({
          candidate,
          plane,
          protectedBranch: "main",
          expectedHead: fixture.baseCommit,
          checks: [mandatoryCheck],
          loadPersistedSelectedCandidateId: async () => candidate.id,
        }),
      ).toMatchObject({ promoted: false, reason: "final_reverification_failure" });

      const selectionMismatch = new PromotionGate(
        fixture.manager.git,
        { verify: async () => evidence(true, candidate.id) },
        async () => ({ allowed: true, reason: null }),
        fixture.manager,
      );
      expect(
        await selectionMismatch.promote({
          candidate,
          plane,
          protectedBranch: "main",
          expectedHead: fixture.baseCommit,
          checks: [mandatoryCheck],
          loadPersistedSelectedCandidateId: async () => "other-candidate",
        }),
      ).toMatchObject({ promoted: false, reason: "selection_mismatch" });

      await writeFile(path.join(plane.worktreePath, "unfinalized.ts"), "unsafe\n", "utf8");
      expect(
        await selectionMismatch.promote({
          candidate,
          plane,
          protectedBranch: "main",
          expectedHead: fixture.baseCommit,
          checks: [mandatoryCheck],
          loadPersistedSelectedCandidateId: async () => candidate.id,
        }),
      ).toMatchObject({
        promoted: false,
        reason: "unfinalized_candidate",
        changedFiles: ["unfinalized.ts"],
      });
      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).toBe(fixture.baseCommit);
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("preserves evidence and refuses promotion when protected HEAD moves during verification", async () => {
    const fixture = await createFixture();
    try {
      const { plane, candidate } = await createCandidate(fixture);
      const gate = new PromotionGate(
        fixture.manager.git,
        {
          verify: async () => {
            await writeFile(path.join(fixture.repositoryPath, "external.txt"), "external move\n", "utf8");
            await fixtureGit(fixture.repositoryPath, ["add", "--", "external.txt"]);
            await fixtureGit(fixture.repositoryPath, ["commit", "-m", "external protected move"]);
            return evidence(true, candidate.id);
          },
        },
        async () => ({ allowed: true, reason: null }),
        fixture.manager,
      );
      const result = await gate.promote({
        candidate,
        plane,
        protectedBranch: "main",
        expectedHead: fixture.baseCommit,
        checks: [mandatoryCheck],
        loadPersistedSelectedCandidateId: async () => candidate.id,
        persistPromotingEvidence: async () => {},
      });
      expect(result).toMatchObject({
        promoted: false,
        reason: "protected_branch_moved",
        verificationEvidence: { passed: true },
      });
      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).not.toBe(plane.headCommit);
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("rejects non-fast-forward and dirty protected updates at the Git CAS boundary", async () => {
    const fixture = await createFixture();
    try {
      const { plane } = await createCandidate(fixture);
      await writeFile(path.join(fixture.repositoryPath, "main-only.txt"), "main\n", "utf8");
      await fixtureGit(fixture.repositoryPath, ["add", "--", "main-only.txt"]);
      await fixtureGit(fixture.repositoryPath, ["commit", "-m", "advance main"]);
      const advancedMain = await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"]);
      await expect(
        fixture.manager.git.compareAndSwapFastForward("main", advancedMain, plane.headCommit!),
      ).rejects.toBeInstanceOf(NonFastForwardPromotionError);

      const descendant = await fixture.manager.createResolutionPlane({
        id: "descendant",
        projectId: "project",
        missionId: "mission",
        candidateId: "descendant-candidate",
        baseCommit: advancedMain,
        purpose: "descendant",
        executionIdentity: "exec-descendant",
        authority,
      });
      await writeFile(path.join(descendant.worktreePath, "next.ts"), "next\n", "utf8");
      const finalized = await fixture.manager.commitPlane(descendant, "Finalize descendant");
      await writeFile(path.join(fixture.repositoryPath, "dirty.tmp"), "dirty\n", "utf8");
      await expect(
        fixture.manager.git.compareAndSwapFastForward("main", advancedMain, finalized.headCommit!),
      ).rejects.toBeInstanceOf(DirtyProtectedWorktreeError);
      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).toBe(advancedMain);
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it.each(["another branch", "detached HEAD"] as const)(
    "rejects promotion when the managed repository checkout is %s",
    async (checkout) => {
      const fixture = await createFixture();
      try {
        const { plane } = await createCandidate(fixture);
        if (checkout === "another branch") {
          await fixtureGit(fixture.repositoryPath, ["switch", "-c", "other"]);
        } else {
          await fixtureGit(fixture.repositoryPath, ["checkout", "--detach"]);
        }
        await expect(
          fixture.manager.git.compareAndSwapFastForward(
            "main",
            fixture.baseCommit,
            plane.headCommit!,
          ),
        ).rejects.toThrow(ProtectedGitMutationError);
        expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).toBe(
          fixture.baseCommit,
        );
        await fixture.manager.resetManagedPlanes();
      } finally {
        await destroyFixture(fixture);
      }
    },
  );

  it("rolls the protected ref and checked-out worktree back when synchronization fails", async () => {
    const fixture = await createFixture({
      promotionFaults: {
        beforeWorktreeSynchronization: () => {
          throw new Error("injected read-tree failure");
        },
      },
    });
    try {
      const { plane } = await createCandidate(fixture);
      await expect(
        fixture.manager.git.compareAndSwapFastForward(
          "main",
          fixture.baseCommit,
          plane.headCommit!,
        ),
      ).rejects.toMatchObject<Partial<ProtectedWorktreeSynchronizationError>>({
        name: "ProtectedWorktreeSynchronizationError",
        expectedHead: fixture.baseCommit,
        candidateHead: plane.headCommit,
        worktreeRestored: true,
      });
      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).toBe(
        fixture.baseCommit,
      );
      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "HEAD"])).toBe(
        fixture.baseCommit,
      );
      expect(await fixtureGit(fixture.repositoryPath, ["status", "--porcelain=v1"])).toBe("");
      await expect(access(path.join(fixture.repositoryPath, "candidate.ts"))).rejects.toThrow();
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });

  it("raises a distinct checked rollback failure when another writer moves the ref", async () => {
    let repositoryPath = "";
    let expectedCandidate = "";
    let concurrentHead = "";
    const fixture = await createFixture({
      promotionFaults: {
        beforeWorktreeSynchronization: () => {
          throw new Error("injected read-tree failure");
        },
        afterWorktreeSynchronizationFailure: async () => {
          await fixtureGit(repositoryPath, [
            "update-ref",
            "refs/heads/main",
            concurrentHead,
            expectedCandidate,
          ]);
        },
      },
    });
    repositoryPath = fixture.repositoryPath;
    try {
      const { plane } = await createCandidate(fixture);
      expectedCandidate = plane.headCommit!;
      const concurrent = await fixture.manager.createResolutionPlane({
        id: "concurrent-ref-writer",
        projectId: "project",
        missionId: "mission",
        candidateId: "concurrent-candidate",
        baseCommit: plane.headCommit!,
        purpose: "simulate a concurrent protected ref writer",
        executionIdentity: "exec-concurrent",
        authority,
      });
      await writeFile(path.join(concurrent.worktreePath, "concurrent.ts"), "concurrent\n", "utf8");
      const finalizedConcurrent = await fixture.manager.commitPlane(
        concurrent,
        "Finalize concurrent ref target",
      );
      concurrentHead = finalizedConcurrent.headCommit!;

      await expect(
        fixture.manager.git.compareAndSwapFastForward(
          "main",
          fixture.baseCommit,
          plane.headCommit!,
        ),
      ).rejects.toMatchObject<Partial<ProtectedRefRollbackError>>({
        name: "ProtectedRefRollbackError",
        expectedHead: fixture.baseCommit,
        candidateHead: plane.headCommit,
        actualHead: concurrentHead,
      });
      expect(await fixtureGit(fixture.repositoryPath, ["rev-parse", "main"])).toBe(
        concurrentHead,
      );
      expect(concurrentHead).not.toBe(plane.headCommit);
      await fixture.manager.resetManagedPlanes();
    } finally {
      await destroyFixture(fixture);
    }
  });
});
