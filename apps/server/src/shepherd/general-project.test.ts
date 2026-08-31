import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginGeneralProjectCreation,
  beginGeneralProjectDeletion,
  beginGeneralProjectPolicyUpdate,
  completeGeneralProjectDeletion,
  initializeGeneralAgentProject,
  reconcileGeneralProjectCreations,
  reconcileGeneralProjectDeletions,
  reconcileGeneralProjectPolicyUpdates,
  recordGeneralProjectPolicyUpdate,
} from "./demo-project.js";
import {
  UnsafeExecutionWorkspaceError,
  synchronizeVerifiedArtifacts,
} from "./plane-manager.js";

const execute = promisify(execFile);
const roots: string[] = [];

async function runFixtureGit(
  repositoryPath: string,
  args: readonly string[],
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      ["-C", repositoryPath, ...args],
      {
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: "/nonexistent",
          LANG: "C",
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 1_048_576,
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    );
  });
}

async function assertFixtureRepositoryIdentity(repositoryPath: string): Promise<void> {
  const expected = await realpath(repositoryPath);
  const actual = path.resolve(
    await runFixtureGit(repositoryPath, ["rev-parse", "--show-toplevel"]),
  );
  if (actual !== expected) {
    throw new Error("Fixture Git command escaped its selected repository");
  }
}

async function caseRoot(): Promise<string> {
  const root = await mkdtemp(path.join(process.cwd(), ".tmp-general-project-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("general Agent managed project", () => {
  it("seeds only safe workspace files and persists a static verification policy", async () => {
    const root = await caseRoot();
    const workspace = path.join(root, "workspace");
    await mkdir(path.join(workspace, "scripts"), { recursive: true });
    await mkdir(path.join(workspace, "node_modules", "ignored"), { recursive: true });
    await mkdir(path.join(workspace, ".codex"), { recursive: true });
    await writeFile(path.join(workspace, "scripts", "seed.txt"), "seed\n");
    await writeFile(path.join(workspace, ".env"), "PRIVATE=not-copied\n");
    await writeFile(path.join(workspace, "secret.pem"), "not-copied\n");
    await writeFile(path.join(workspace, "run.log"), "not-copied\n");
    await writeFile(path.join(workspace, "node_modules", "ignored", "index.js"), "ignored\n");
    await writeFile(path.join(workspace, ".codex", "session"), "ignored\n");

    const project = await initializeGeneralAgentProject({
      managedRoot: path.join(root, "managed"),
      projectId: "agent-11111111-1111-4111-8111-111111111111",
      agentWorkspacePath: workspace,
      expectedArtifacts: ["scripts/output.txt"],
      acceptanceSummary: 'the file contains "verified"',
      requiredContent: "verified",
    });
    expect(project.created).toBe(true);
    expect(await readFile(path.join(project.repositoryPath, "scripts", "seed.txt"), "utf8")).toBe("seed\n");
    for (const relative of [".env", "secret.pem", "run.log", "node_modules", ".codex"]) {
      await expect(access(path.join(project.repositoryPath, relative))).rejects.toThrow();
    }
    await expect(
      execute("node", ["checks/general-contract.cjs"], { cwd: project.repositoryPath }),
    ).rejects.toThrow();
    await writeFile(path.join(project.repositoryPath, "scripts", "output.txt"), "verified\n");
    await expect(
      execute("node", ["checks/general-contract.cjs"], { cwd: project.repositoryPath }),
    ).resolves.toMatchObject({ stdout: "verified general Contract artifacts\n" });

    await rm(path.join(project.repositoryPath, "scripts", "output.txt"));
    const reopened = await initializeGeneralAgentProject({
      managedRoot: path.join(root, "managed"),
      projectId: project.projectId,
      agentWorkspacePath: workspace,
      expectedArtifacts: ["scripts/output.txt"],
      acceptanceSummary: 'the file contains "verified"',
      requiredContent: "verified",
    });
    expect(reopened.created).toBe(false);
    expect(reopened.headCommit).toBe(project.headCommit);
  });

  it("copies only declared verified artifacts back and rejects a symlinked destination", async () => {
    const root = await caseRoot();
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await mkdir(path.join(source, "src"), { recursive: true });
    await mkdir(path.join(destination, "src"), { recursive: true });
    await writeFile(path.join(source, "src", "result.ts"), "export const value = 1;\n");
    await writeFile(path.join(source, "src", "unrelated.ts"), "do not copy\n");
    await writeFile(path.join(destination, "src", "result.ts"), "old\n");
    await synchronizeVerifiedArtifacts(source, destination, ["src/result.ts"]);
    expect(await readFile(path.join(destination, "src", "result.ts"), "utf8")).toBe(
      "export const value = 1;\n",
    );
    await expect(readFile(path.join(destination, "src", "unrelated.ts"), "utf8")).rejects.toThrow();

    const hostile = path.join(root, "hostile");
    const outside = path.join(root, "outside");
    await mkdir(hostile);
    await mkdir(outside);
    await symlink(outside, path.join(hostile, "src"), "dir");
    await expect(
      synchronizeVerifiedArtifacts(source, hostile, ["src/result.ts"]),
    ).rejects.toThrow(UnsafeExecutionWorkspaceError);
  });

  it("keeps fixture Git staging inside the selected repository when selectors are poisoned", async () => {
    const root = await caseRoot();
    const managedRoot = path.join(root, "managed");
    const workspace = path.join(root, "workspace");
    const decoy = path.join(root, "decoy");
    await mkdir(workspace);
    await writeFile(path.join(workspace, "README.md"), "safe snapshot\n");
    const project = await initializeGeneralAgentProject({
      managedRoot,
      projectId: "agent-81111111-1111-4111-8111-111111111111",
      agentWorkspacePath: workspace,
      expectedArtifacts: ["README.md"],
      acceptanceSummary: "the file exists and is non-empty",
      requiredContent: null,
    });
    await mkdir(decoy);
    await runFixtureGit(decoy, ["init", "--initial-branch=main"]);
    await writeFile(path.join(decoy, "decoy.txt"), "decoy\n");
    await runFixtureGit(decoy, ["add", "--", "decoy.txt"]);
    await runFixtureGit(
      decoy,
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@local.invalid",
        "commit",
        "-m",
        "decoy",
      ],
    );
    const fixtureOwnedPath = "fixture-owned.txt";
    await writeFile(path.join(project.repositoryPath, fixtureOwnedPath), "fixture\n");

    vi.stubEnv("GIT_DIR", path.join(decoy, ".git"));
    vi.stubEnv("GIT_WORK_TREE", decoy);

    await assertFixtureRepositoryIdentity(project.repositoryPath);
    await runFixtureGit(project.repositoryPath, ["add", "--", fixtureOwnedPath]);
    expect(
      await runFixtureGit(project.repositoryPath, ["diff", "--cached", "--name-only"]),
    ).toContain(fixtureOwnedPath);
    expect(await runFixtureGit(decoy, ["status", "--porcelain=v1"])).toBe("");
  });

  it("removes only a journal-proven orphan after a pre-persistence interruption", async () => {
    const root = await caseRoot();
    const managedRoot = path.join(root, "managed");
    const workspace = path.join(root, "workspace");
    const projectId = "agent-21111111-1111-4111-8111-111111111111";
    await mkdir(workspace);
    await writeFile(path.join(workspace, "README.md"), "safe snapshot\n");
    const journalPath = await beginGeneralProjectCreation(managedRoot, projectId);
    const project = await initializeGeneralAgentProject({
      managedRoot,
      projectId,
      agentWorkspacePath: workspace,
      expectedArtifacts: ["scripts/output.txt"],
      acceptanceSummary: "the file exists and is non-empty",
      requiredContent: null,
    });
    await reconcileGeneralProjectCreations(managedRoot, new Set());
    for (const target of [
      journalPath,
      project.repositoryPath,
      project.planesRoot,
      path.join(managedRoot, "projects", projectId + ".json"),
    ]) {
      await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(access(path.join(managedRoot, ".shepherd-demo-root.json"))).resolves.toBeUndefined();
  });

  it("keeps a durable journaled project and clears only its completed journal", async () => {
    const root = await caseRoot();
    const managedRoot = path.join(root, "managed");
    const workspace = path.join(root, "workspace");
    const projectId = "agent-31111111-1111-4111-8111-111111111111";
    await mkdir(workspace);
    await writeFile(path.join(workspace, "README.md"), "safe snapshot\n");
    const journalPath = await beginGeneralProjectCreation(managedRoot, projectId);
    const project = await initializeGeneralAgentProject({
      managedRoot,
      projectId,
      agentWorkspacePath: workspace,
      expectedArtifacts: ["scripts/output.txt"],
      acceptanceSummary: "the file exists and is non-empty",
      requiredContent: null,
    });
    await reconcileGeneralProjectCreations(managedRoot, new Set([projectId]));
    await expect(access(journalPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(project.repositoryPath)).resolves.toBeUndefined();
    await expect(access(project.planesRoot)).resolves.toBeUndefined();
  });

  it("deletes only a journaled non-durable general project and preserves a durable one", async () => {
    const root = await caseRoot();
    const managedRoot = path.join(root, "managed");
    const workspace = path.join(root, "workspace");
    const projectId = "agent-71111111-1111-4111-8111-111111111111";
    await mkdir(workspace);
    await writeFile(path.join(workspace, "README.md"), "safe snapshot\n");
    const project = await initializeGeneralAgentProject({
      managedRoot,
      projectId,
      agentWorkspacePath: workspace,
      expectedArtifacts: ["README.md"],
      acceptanceSummary: "clarification is pending",
      requiredContent: null,
    });

    await beginGeneralProjectDeletion(managedRoot, projectId);
    await reconcileGeneralProjectDeletions(managedRoot, new Set([projectId]));
    await expect(access(project.repositoryPath)).resolves.toBeUndefined();
    await expect(access(project.planesRoot)).resolves.toBeUndefined();
    await expect(access(path.join(managedRoot, "projects", projectId + ".json")))
      .resolves.toBeUndefined();

    await beginGeneralProjectDeletion(managedRoot, projectId);
    await reconcileGeneralProjectDeletions(managedRoot, new Set());
    for (const target of [
      project.repositoryPath,
      project.planesRoot,
      path.join(managedRoot, "projects", projectId + ".json"),
    ]) {
      await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(
      completeGeneralProjectDeletion(managedRoot, projectId),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back an exact policy-only commit when its Project head was not persisted", async () => {
    const root = await caseRoot();
    const managedRoot = path.join(root, "managed");
    const workspace = path.join(root, "workspace");
    const projectId = "agent-41111111-1111-4111-8111-111111111111";
    await mkdir(workspace);
    await writeFile(path.join(workspace, "README.md"), "safe snapshot\n");
    const original = await initializeGeneralAgentProject({
      managedRoot,
      projectId,
      agentWorkspacePath: workspace,
      expectedArtifacts: ["scripts/first.txt"],
      acceptanceSummary: "the file exists and is non-empty",
      requiredContent: null,
    });
    await beginGeneralProjectPolicyUpdate(managedRoot, projectId, original.headCommit);
    const advanced = await initializeGeneralAgentProject({
      managedRoot,
      projectId,
      agentWorkspacePath: workspace,
      expectedArtifacts: ["scripts/second.txt"],
      acceptanceSummary: 'the file contains "ready"',
      requiredContent: "ready",
      expectedHead: original.headCommit,
    });
    expect(advanced.headCommit).not.toBe(original.headCommit);
    await recordGeneralProjectPolicyUpdate(
      managedRoot,
      projectId,
      original.headCommit,
      advanced.headCommit,
    );
    await reconcileGeneralProjectPolicyUpdates(
      managedRoot,
      new Map([[projectId, original.headCommit]]),
    );
    const reopened = await initializeGeneralAgentProject({
      managedRoot,
      projectId,
      agentWorkspacePath: workspace,
      expectedArtifacts: ["scripts/first.txt"],
      acceptanceSummary: "the file exists and is non-empty",
      requiredContent: null,
      expectedHead: original.headCommit,
    });
    expect(reopened.headCommit).toBe(original.headCommit);
  });

  it.each([false, true])(
    "cleans an interrupted %s policy write before its commit",
    async (staged) => {
      const root = await caseRoot();
      const managedRoot = path.join(root, "managed");
      const workspace = path.join(root, "workspace");
      const projectId = staged
        ? "agent-51111111-1111-4111-8111-111111111111"
        : "agent-61111111-1111-4111-8111-111111111111";
      await mkdir(workspace);
      await writeFile(path.join(workspace, "README.md"), "safe snapshot\n");
      const project = await initializeGeneralAgentProject({
        managedRoot,
        projectId,
        agentWorkspacePath: workspace,
        expectedArtifacts: ["scripts/first.txt"],
        acceptanceSummary: "the file exists and is non-empty",
        requiredContent: null,
      });
      const policyPath = path.join(project.repositoryPath, "policy.json");
      const originalPolicy = await readFile(policyPath, "utf8");
      await beginGeneralProjectPolicyUpdate(managedRoot, projectId, project.headCommit);
      await assertFixtureRepositoryIdentity(project.repositoryPath);
      await writeFile(policyPath, '{"interrupted":true}\n');
      if (staged) {
        await runFixtureGit(project.repositoryPath, ["add", "--", "policy.json"]);
      }
      await reconcileGeneralProjectPolicyUpdates(
        managedRoot,
        new Map([[projectId, project.headCommit]]),
      );
      expect(await readFile(policyPath, "utf8")).toBe(originalPolicy);
      expect(
        await runFixtureGit(project.repositoryPath, ["status", "--porcelain=v1"]),
      ).toBe("");
    },
  );
});
