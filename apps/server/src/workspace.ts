import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { Agent } from "./types.js";

const SAFE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const ARCHIVE_DELETION_PREFIX = ".deleting-agent-";
const ARCHIVE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface WorkspaceArchiveDeletionJournal {
  schemaVersion: 1;
  marker: "agent-workspace-archive-deletion";
  agentId: string;
  archiveId: string;
}

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

  /** Records a durable intent without moving the workspace before database commit. */
  async beginArchiveDeletion(agent: Agent): Promise<void> {
    await this.assertManagedWorkspace(agent);
    const deletedRoot = path.join(this.root, ".deleted");
    await this.assertDirectoryIdentity(deletedRoot, "Agent archive root");
    const journal: WorkspaceArchiveDeletionJournal = {
      schemaVersion: 1,
      marker: "agent-workspace-archive-deletion",
      agentId: agent.id,
      archiveId: randomUUID(),
    };
    const journalPath = this.archiveDeletionJournalPath(agent.id);
    const handle = await open(
      journalPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(journal, null, 2) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await this.syncDirectory(deletedRoot);
  }

  async completeArchiveDeletion(agentId: string): Promise<void> {
    const journalPath = this.archiveDeletionJournalPath(agentId);
    const journal = await this.readArchiveDeletionJournal(journalPath);
    if (journal.agentId !== agentId) {
      throw new Error("Agent workspace deletion journal identity mismatch");
    }
    await this.reconcileArchiveDeletion(journalPath, journal, false);
  }

  /** Restores or completes interrupted deletion according to durable Agent state. */
  async reconcileArchiveDeletions(
    durableAgentIds: ReadonlySet<string>,
  ): Promise<void> {
    const deletedRoot = path.join(this.root, ".deleted");
    await this.assertDirectoryIdentity(deletedRoot, "Agent archive root");
    for (const name of (await readdir(deletedRoot)).sort()) {
      if (!name.startsWith(ARCHIVE_DELETION_PREFIX) || !name.endsWith(".json")) {
        continue;
      }
      const journalPath = path.join(deletedRoot, name);
      const journal = await this.readArchiveDeletionJournal(journalPath);
      if (journalPath !== this.archiveDeletionJournalPath(journal.agentId)) {
        throw new Error("Agent workspace deletion journal filename mismatch");
      }
      await this.reconcileArchiveDeletion(
        journalPath,
        journal,
        durableAgentIds.has(journal.agentId),
      );
    }
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

  private archiveDeletionJournalPath(agentId: string): string {
    if (!SAFE_AGENT_ID.test(agentId)) {
      throw new Error("Agent ID cannot identify a workspace deletion journal");
    }
    return path.join(this.root, ".deleted", `${ARCHIVE_DELETION_PREFIX}${agentId}.json`);
  }

  private archiveDeletionPath(journal: WorkspaceArchiveDeletionJournal): string {
    return path.join(
      this.root,
      ".deleted",
      `${journal.agentId}-${journal.archiveId}`,
    );
  }

  private async readArchiveDeletionJournal(
    journalPath: string,
  ): Promise<WorkspaceArchiveDeletionJournal> {
    const before = await lstat(journalPath);
    if (before.isSymbolicLink() || !before.isFile() || before.size > 4_096) {
      throw new Error("Agent workspace deletion journal must be a bounded regular file");
    }
    const handle = await open(
      journalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat();
      if (
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size
      ) {
        throw new Error("Agent workspace deletion journal identity changed");
      }
      const value = JSON.parse(
        await handle.readFile("utf8"),
      ) as Partial<WorkspaceArchiveDeletionJournal>;
      if (
        !value ||
        typeof value !== "object" ||
        value.schemaVersion !== 1 ||
        value.marker !== "agent-workspace-archive-deletion" ||
        typeof value.agentId !== "string" ||
        !SAFE_AGENT_ID.test(value.agentId) ||
        typeof value.archiveId !== "string" ||
        !ARCHIVE_ID.test(value.archiveId) ||
        Object.keys(value).length !== 4
      ) {
        throw new Error("Agent workspace deletion journal is malformed");
      }
      return value as WorkspaceArchiveDeletionJournal;
    } finally {
      await handle.close();
    }
  }

  private async reconcileArchiveDeletion(
    journalPath: string,
    journal: WorkspaceArchiveDeletionJournal,
    agentIsDurable: boolean,
  ): Promise<void> {
    await this.assertDirectoryIdentity(this.root, "Agent workspace root");
    const deletedRoot = path.join(this.root, ".deleted");
    await this.assertDirectoryIdentity(deletedRoot, "Agent archive root");
    const workspace = this.workspacePath(journal.agentId);
    const archive = this.archiveDeletionPath(journal);
    const workspaceExists = await this.isManagedDirectoryIfPresent(
      workspace,
      "Agent workspace",
    );
    const archiveExists = await this.isManagedDirectoryIfPresent(
      archive,
      "Agent archived workspace",
    );
    if (workspaceExists && archiveExists) {
      throw new Error("Agent workspace deletion has ambiguous source and archive state");
    }
    if (!workspaceExists && !archiveExists) {
      throw new Error("Agent workspace deletion lost both source and archive state");
    }
    if (agentIsDurable && archiveExists) {
      await rename(archive, workspace);
      await this.syncDirectory(this.root);
      await this.syncDirectory(deletedRoot);
    } else if (!agentIsDurable && workspaceExists) {
      await rename(workspace, archive);
      await this.syncDirectory(this.root);
      await this.syncDirectory(deletedRoot);
    }
    await unlink(journalPath);
    await this.syncDirectory(deletedRoot);
  }

  private async isManagedDirectoryIfPresent(
    directory: string,
    label: string,
  ): Promise<boolean> {
    try {
      await this.assertDirectoryIdentity(directory, label);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async syncDirectory(directory: string): Promise<void> {
    if (process.platform === "win32") return;
    const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
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
