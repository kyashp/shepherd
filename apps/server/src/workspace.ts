import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename } from "node:fs/promises";
import path from "node:path";
import type { Agent } from "./types.js";

const SAFE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export class WorkspaceManager {
  private readonly root: string;
  private initialized = false;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  workspacePath(agentId: string): string {
    if (!SAFE_AGENT_ID.test(agentId)) {
      throw new Error("Agent ID cannot identify a managed workspace");
    }
    return path.join(this.root, agentId);
  }

  async initialize(): Promise<void> {
    await this.ensureDirectory(this.root, "Agent workspace root");
    if ((await realpath(this.root)) !== this.root) {
      throw new Error("Agent workspace root identity changed through a symlink");
    }
    const deletedRoot = path.join(this.root, ".deleted");
    await this.ensureDirectory(deletedRoot, "Agent archive root");
    if ((await realpath(deletedRoot)) !== deletedRoot) {
      throw new Error("Agent archive root identity changed through a symlink");
    }
    this.initialized = true;
  }

  async create(agent: Agent): Promise<void> {
    this.assertWorkspaceIdentity(agent);
    await mkdir(agent.workspacePath, { recursive: false, mode: 0o700 });
    await this.assertManagedWorkspace(agent);
    await this.writeInstructions(agent);
    await this.writeManagedFile(
      path.join(agent.workspacePath, ".gitignore"),
      [".codex/", "node_modules/", "dist/", ".env", "*.log", ""].join("\n"),
      true,
    );
    await this.writeManagedFile(
      path.join(agent.workspacePath, "README.md"),
      [
        "# " + agent.name + " workspace",
        "",
        "Files created or edited by the Agent live here.",
        "The platform-generated AGENTS.md contains the current Agent instructions.",
        "",
      ].join("\n"),
      true,
    );
  }

  async writeInstructions(agent: Agent): Promise<void> {
    await this.assertManagedWorkspace(agent);
    const content = [
      "# Platform-managed Agent instructions",
      "",
      "You are the coding Agent named " + agent.name + ".",
      agent.description ? "Purpose: " + agent.description : "",
      "",
      "## Instructions",
      "",
      agent.instructions ||
        "Help the user complete coding tasks in this workspace. Explain material results concisely.",
      "",
      "## Workspace rules",
      "",
      "- Work only inside this workspace unless the user explicitly requests otherwise.",
      "- Preserve existing user files and avoid destructive operations.",
      "- Build and test changes when practical.",
      "- Never print environment variables or credentials.",
      "",
      "This file is regenerated when the Agent configuration is updated.",
      "",
    ]
      .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
      .join("\n");
    await this.writeManagedFile(path.join(agent.workspacePath, "AGENTS.md"), content);
  }

  async archive(agent: Agent): Promise<string> {
    await this.assertManagedWorkspace(agent);
    const deletedRoot = path.join(this.root, ".deleted");
    await this.assertDirectoryIdentity(deletedRoot, "Agent archive root");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(deletedRoot, agent.id + "-" + timestamp);
    await rename(agent.workspacePath, destination);
    return destination;
  }

  async assertManagedWorkspace(agent: Agent): Promise<void> {
    this.assertWorkspaceIdentity(agent);
    await this.assertDirectoryIdentity(agent.workspacePath, "Agent workspace");
  }

  private assertWorkspaceIdentity(agent: Agent): void {
    if (!this.initialized) {
      throw new Error("Agent workspace manager is not initialized");
    }
    const expected = this.workspacePath(agent.id);
    if (agent.workspacePath !== expected) {
      throw new Error("Agent workspace does not match its server-owned identity");
    }
  }

  private async ensureDirectory(directory: string, label: string): Promise<void> {
    try {
      const entry = await lstat(directory);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`${label} cannot be a symlink or non-directory`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const created = await lstat(directory);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error(`${label} cannot be a symlink or non-directory`);
      }
    }
  }

  private async assertDirectoryIdentity(directory: string, label: string): Promise<void> {
    const entry = await lstat(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`${label} cannot be a symlink or non-directory`);
    }
    if ((await realpath(directory)) !== directory) {
      throw new Error(`${label} identity changed through a symlink`);
    }
  }

  private async writeManagedFile(
    filePath: string,
    content: string,
    exclusive = false,
  ): Promise<void> {
    const flags = exclusive
      ? constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW
      : constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_TRUNC |
        constants.O_NOFOLLOW;
    const handle = await open(filePath, flags, 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
