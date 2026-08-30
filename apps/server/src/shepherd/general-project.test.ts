import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginGeneralProjectCreation,
  beginGeneralProjectPolicyUpdate,
  initializeGeneralAgentProject,
  reconcileGeneralProjectCreations,
  reconcileGeneralProjectPolicyUpdates,
  recordGeneralProjectPolicyUpdate,
} from "./demo-project.js";
import {
  UnsafeExecutionWorkspaceError,
  synchronizeVerifiedArtifacts,
} from "./plane-manager.js";

const execute = promisify(execFile);
const roots: string[] = [];

async function caseRoot(): Promise<string> {
  const root = await mkdtemp(path.join(process.cwd(), ".tmp-general-project-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
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
      await writeFile(policyPath, '{"interrupted":true}\n');
      if (staged) {
        await execute("git", ["add", "--", "policy.json"], {
          cwd: project.repositoryPath,
        });
      }
      await reconcileGeneralProjectPolicyUpdates(
        managedRoot,
        new Map([[projectId, project.headCommit]]),
      );
      expect(await readFile(policyPath, "utf8")).toBe(originalPolicy);
      expect(
        (await execute("git", ["status", "--porcelain=v1"], {
          cwd: project.repositoryPath,
        })).stdout,
      ).toBe("");
    },
  );
});
