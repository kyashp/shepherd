import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const FULL_OBJECT_ID = /^[0-9a-f]{40,64}$/i;
const SAFE_REF_CHARACTERS = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

export interface GitClientOptions {
  gitBinary?: string;
  worktreeRoot?: string;
  /** The only branch this client may update through the promotion CAS. */
  protectedBranch?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Narrow fault seam used by integration tests for post-CAS recovery. */
  promotionFaults?: {
    beforeWorktreeSynchronization?: () => void | Promise<void>;
    afterWorktreeSynchronizationFailure?: () => void | Promise<void>;
  };
  /** Narrow fault seam used only to verify conflict-cleanup precedence. */
  mergeFaults?: {
    beforeConflictEnumeration?: () => void | Promise<void>;
    beforeAbort?: () => void | Promise<void>;
    beforePostAbortInspection?: () => void | Promise<void>;
  };
}

export interface GitWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  prunable: boolean;
}

export interface ProtectedWorktreeInspection {
  branch: string;
  branchHead: string;
  checkedOutBranch: string | null;
  worktreeHead: string;
  indexMatchesHead: boolean;
  clean: boolean;
  synchronized: boolean;
}

interface GitExecutionOptions {
  cwd?: string;
  allowedExitCodes?: readonly number[];
  timeoutMs?: number;
}

interface GitExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitCommandError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly outputExceeded: boolean;

  constructor(input: {
    operation: string;
    exitCode: number | null;
    stderr: string;
    timedOut: boolean;
    outputExceeded: boolean;
  }) {
    const reason = input.timedOut
      ? "timed out"
      : input.outputExceeded
        ? "exceeded the output limit"
        : input.exitCode === null
          ? "could not start"
          : "exited with code " + input.exitCode;
    super("Git " + input.operation + " " + reason);
    this.name = "GitCommandError";
    this.exitCode = input.exitCode;
    this.stderr = input.stderr;
    this.timedOut = input.timedOut;
    this.outputExceeded = input.outputExceeded;
  }
}

/** A merge conflict whose cleanup could not be proved safe and complete. */
export class GitMergeCleanupError extends Error {
  constructor() {
    super("Git merge conflict cleanup could not be verified");
    this.name = "GitMergeCleanupError";
  }
}

export class ProtectedHeadMovedError extends Error {
  constructor(
    readonly expectedHead: string,
    readonly actualHead: string,
  ) {
    super(
      "Protected branch moved: expected " +
        expectedHead.slice(0, 12) +
        ", found " +
        actualHead.slice(0, 12),
    );
    this.name = "ProtectedHeadMovedError";
  }
}

export class NonFastForwardPromotionError extends Error {
  constructor() {
    super("Candidate is not a fast-forward descendant of the expected head");
    this.name = "NonFastForwardPromotionError";
  }
}

export class DirtyProtectedWorktreeError extends Error {
  constructor(readonly changedFiles: string[]) {
    super("Protected worktree is not clean");
    this.name = "DirtyProtectedWorktreeError";
  }
}

export class ProtectedGitMutationError extends Error {
  constructor(readonly operation: string) {
    super("Git " + operation + " is forbidden in the protected repository worktree");
    this.name = "ProtectedGitMutationError";
  }
}

export class ProtectedWorktreeSynchronizationError extends Error {
  constructor(
    readonly expectedHead: string,
    readonly candidateHead: string,
    readonly worktreeRestored: boolean,
    options?: ErrorOptions,
  ) {
    super(
      worktreeRestored
        ? "Protected worktree synchronization failed; the protected ref and worktree were restored"
        : "Protected worktree synchronization failed; the protected ref was restored but the worktree was not",
      options,
    );
    this.name = "ProtectedWorktreeSynchronizationError";
  }
}

export class ProtectedRefRollbackError extends Error {
  constructor(
    readonly expectedHead: string,
    readonly candidateHead: string,
    readonly actualHead: string | null,
    options?: ErrorOptions,
  ) {
    super("Protected ref rollback failed after worktree synchronization failure", options);
    this.name = "ProtectedRefRollbackError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

export function assertSafeGitBranch(branch: string): string {
  const value = branch.startsWith("refs/heads/")
    ? branch.slice("refs/heads/".length)
    : branch;
  if (
    !SAFE_REF_CHARACTERS.test(value) ||
    value.startsWith("-") ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.endsWith("/") ||
    value.endsWith(".lock") ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error("Unsafe Git branch name");
  }
  return value;
}

export function assertFullObjectId(objectId: string): string {
  if (!FULL_OBJECT_ID.test(objectId)) throw new Error("Expected a full Git object ID");
  return objectId.toLowerCase();
}

export function assertSafeProjectPath(projectPath: string): string {
  if (
    projectPath.length === 0 ||
    projectPath.length > 1_024 ||
    /[\u0000-\u001f\u007f]/u.test(projectPath) ||
    path.posix.isAbsolute(projectPath) ||
    path.win32.isAbsolute(projectPath)
  ) {
    throw new Error("Unsafe project-relative path");
  }
  const segments = projectPath.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Unsafe project-relative path");
  }
  return segments.join("/");
}

function assertRevision(revision: string): string {
  if (revision === "HEAD" || FULL_OBJECT_ID.test(revision)) return revision;
  return assertSafeGitBranch(revision);
}

/**
 * Narrow argv-only Git boundary. It never invokes a shell, inherits credentials,
 * enables hooks, or accepts an unvalidated ref/path.
 */
export class GitClient {
  readonly repositoryPath: string;
  readonly worktreeRoot: string | null;
  readonly protectedBranch: string;
  private readonly gitBinary: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly promotionFaults: NonNullable<GitClientOptions["promotionFaults"]>;
  private readonly mergeFaults: NonNullable<GitClientOptions["mergeFaults"]>;
  private initialization: Promise<void> | null = null;
  private canonicalRepositoryPath: string | null = null;
  private canonicalWorktreeRoot: string | null = null;

  constructor(repositoryPath: string, options: GitClientOptions = {}) {
    this.repositoryPath = path.resolve(repositoryPath);
    this.worktreeRoot = options.worktreeRoot ? path.resolve(options.worktreeRoot) : null;
    this.protectedBranch = assertSafeGitBranch(options.protectedBranch ?? "main");
    this.gitBinary = options.gitBinary ?? "git";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.promotionFaults = options.promotionFaults ?? {};
    this.mergeFaults = options.mergeFaults ?? {};
    if (this.timeoutMs < 100 || this.timeoutMs > 120_000) {
      throw new Error("Git timeout must be between 100 and 120000 ms");
    }
    if (this.maxOutputBytes < 4_096 || this.maxOutputBytes > 16_777_216) {
      throw new Error("Git output limit must be between 4096 and 16777216 bytes");
    }
  }

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeOnce().catch((error: unknown) => {
        this.initialization = null;
        throw error;
      });
    }
    await this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    this.canonicalRepositoryPath = await realpath(this.repositoryPath);
    if (this.worktreeRoot) this.canonicalWorktreeRoot = await realpath(this.worktreeRoot);
    const inside = await this.execute(["rev-parse", "--is-inside-work-tree"], {
      cwd: this.repositoryPath,
    });
    if (inside.stdout.trim() !== "true") throw new Error("Managed repository is not a Git worktree");
  }

  private async ensureInitialized(): Promise<void> {
    await this.initialize();
  }

  private async assertManagedDirectory(directory: string): Promise<string> {
    await this.ensureInitialized();
    const canonical = await realpath(path.resolve(directory));
    if (canonical === this.canonicalRepositoryPath) return canonical;
    if (!this.canonicalWorktreeRoot || !isInside(this.canonicalWorktreeRoot, canonical)) {
      throw new Error("Git working directory escapes the managed boundary");
    }
    return canonical;
  }

  async assertManagedDestination(destination: string): Promise<string> {
    await this.ensureInitialized();
    if (!this.canonicalWorktreeRoot) throw new Error("No managed worktree root is configured");
    const resolved = path.resolve(destination);
    if (!isInside(this.canonicalWorktreeRoot, resolved)) {
      throw new Error("Worktree destination escapes the managed boundary");
    }
    const canonicalParent = await realpath(path.dirname(resolved));
    if (
      canonicalParent !== this.canonicalWorktreeRoot &&
      !isInside(this.canonicalWorktreeRoot, canonicalParent)
    ) {
      throw new Error("Worktree destination parent escapes the managed boundary");
    }
    return resolved;
  }

  private childEnvironment(): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: "/nonexistent",
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GCM_INTERACTIVE: "never",
      GIT_EDITOR: "true",
      GIT_SEQUENCE_EDITOR: "true",
      GIT_AUTHOR_NAME: "Shepherd Control Plane",
      GIT_AUTHOR_EMAIL: "shepherd@local.invalid",
      GIT_COMMITTER_NAME: "Shepherd Control Plane",
      GIT_COMMITTER_EMAIL: "shepherd@local.invalid",
    };
  }

  private async execute(
    args: readonly string[],
    options: GitExecutionOptions = {},
  ): Promise<GitExecutionResult> {
    const cwd = options.cwd ? path.resolve(options.cwd) : this.repositoryPath;
    const allowedExitCodes = options.allowedExitCodes ?? [0];
    const operation = args[0] ?? "command";
    const safeArgs = [
      "--no-pager",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "credential.helper=",
      "-c",
      "commit.gpgSign=false",
      "-c",
      "protocol.file.allow=never",
      "-C",
      cwd,
      ...args,
    ];
    return await new Promise<GitExecutionResult>((resolve, reject) => {
      execFile(
        this.gitBinary,
        safeArgs,
        {
          cwd: this.repositoryPath,
          env: this.childEnvironment(),
          encoding: "utf8",
          timeout: options.timeoutMs ?? this.timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: this.maxOutputBytes,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const output = stdout;
          const errorOutput = stderr;
          if (!error) {
            resolve({ stdout: output, stderr: errorOutput, exitCode: 0 });
            return;
          }
          const candidate = error as NodeJS.ErrnoException & {
            code?: string | number;
            killed?: boolean;
            signal?: NodeJS.Signals;
          };
          const numericExitCode =
            typeof candidate.code === "number" ? candidate.code : candidate.code === "ENOENT" ? null : 1;
          if (numericExitCode !== null && allowedExitCodes.includes(numericExitCode)) {
            resolve({ stdout: output, stderr: errorOutput, exitCode: numericExitCode });
            return;
          }
          const outputExceeded = candidate.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          reject(
            new GitCommandError({
              operation,
              exitCode: numericExitCode,
              stderr: errorOutput.slice(-16_384),
              timedOut: Boolean(candidate.killed && candidate.signal === "SIGKILL") && !outputExceeded,
              outputExceeded,
            }),
          );
        },
      );
    });
  }

  private async inDirectory(
    directory: string,
    args: readonly string[],
    options: Omit<GitExecutionOptions, "cwd"> = {},
  ): Promise<GitExecutionResult> {
    const managedDirectory = await this.assertManagedDirectory(directory);
    return await this.execute(args, { ...options, cwd: managedDirectory });
  }

  private async inPlaneDirectory(
    directory: string,
    operation: string,
    args: readonly string[],
    options: Omit<GitExecutionOptions, "cwd"> = {},
  ): Promise<GitExecutionResult> {
    const managedDirectory = await this.assertPlaneMutationDirectory(directory, operation);
    return await this.execute(args, { ...options, cwd: managedDirectory });
  }

  private async assertPlaneMutationDirectory(
    directory: string,
    operation: string,
  ): Promise<string> {
    const managedDirectory = await this.assertManagedDirectory(directory);
    if (managedDirectory === this.canonicalRepositoryPath) {
      throw new ProtectedGitMutationError(operation);
    }
    return managedDirectory;
  }

  async resolveCommit(revision: string, directory = this.repositoryPath): Promise<string> {
    const safeRevision = assertRevision(revision);
    const result = await this.inDirectory(directory, [
      "rev-parse",
      "--verify",
      safeRevision + "^{commit}",
    ]);
    return assertFullObjectId(result.stdout.trim());
  }

  async currentHead(directory = this.repositoryPath): Promise<string> {
    return await this.resolveCommit("HEAD", directory);
  }

  async branchHead(branch: string): Promise<string> {
    const safeBranch = assertSafeGitBranch(branch);
    return await this.resolveCommit("refs/heads/" + safeBranch);
  }

  async listWorktrees(): Promise<GitWorktree[]> {
    await this.ensureInitialized();
    const result = await this.execute(["worktree", "list", "--porcelain", "-z"]);
    const records = result.stdout.split("\0\0").filter((record) => record.length > 0);
    return records.map((record) => {
      const fields = record.split("\0").filter((field) => field.length > 0);
      const worktreeField = fields.find((field) => field.startsWith("worktree "));
      if (!worktreeField) throw new Error("Git returned a malformed worktree record");
      const head = fields.find((field) => field.startsWith("HEAD "))?.slice(5) ?? null;
      const branch = fields.find((field) => field.startsWith("branch "))?.slice(7) ?? null;
      return {
        path: worktreeField.slice(9),
        head: head && FULL_OBJECT_ID.test(head) ? head.toLowerCase() : null,
        branch,
        detached: fields.includes("detached"),
        prunable: fields.some((field) => field.startsWith("prunable")),
      };
    });
  }

  async addWorktree(destination: string, branch: string, baseCommit: string): Promise<void> {
    await this.ensureInitialized();
    const safeDestination = await this.assertManagedDestination(destination);
    const safeBranch = assertSafeGitBranch(branch);
    if (safeBranch === this.protectedBranch) {
      throw new ProtectedGitMutationError("worktree creation for the protected branch");
    }
    const safeBase = assertFullObjectId(baseCommit);
    await this.execute(["worktree", "add", "-b", safeBranch, safeDestination, safeBase]);
  }

  /** Creates a server-owned detached worktree for trusted tree materialization. */
  async addDetachedWorktree(destination: string, commit: string): Promise<void> {
    await this.ensureInitialized();
    const safeDestination = await this.assertManagedDestination(destination);
    const safeCommit = assertFullObjectId(commit);
    await this.execute(["worktree", "add", "--detach", safeDestination, safeCommit]);
  }

  async removeWorktree(destination: string): Promise<void> {
    const canonical = await this.assertManagedDirectory(destination);
    if (canonical === this.canonicalRepositoryPath) {
      throw new Error("The protected repository cannot be removed as a Plane");
    }
    await this.execute(["worktree", "remove", "--force", canonical]);
  }

  async pruneWorktrees(): Promise<void> {
    await this.ensureInitialized();
    await this.execute(["worktree", "prune", "--expire", "now"]);
  }

  async deleteBranch(branch: string): Promise<void> {
    const safeBranch = assertSafeGitBranch(branch);
    if (safeBranch === this.protectedBranch) {
      throw new ProtectedGitMutationError("protected branch deletion");
    }
    await this.execute(["branch", "-D", safeBranch]);
  }

  async uncommittedFiles(directory: string): Promise<string[]> {
    const result = await this.inDirectory(directory, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      // Ignore rules are agent-controlled: a committed .gitignore made files
      // invisible here, so a Plane holding them was reported clean and they were
      // carried into verification snapshots and re-exported into later execution
      // workspaces without any authority check ever seeing them.
      "--ignored=matching",
    ]);
    const tokens = result.stdout.split("\0");
    const changed = new Set<string>();
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token) continue;
      if (token.length < 4 || token[2] !== " ") throw new Error("Malformed Git status output");
      const status = token.slice(0, 2);
      changed.add(assertSafeProjectPath(token.slice(3)));
      if (status.includes("R") || status.includes("C")) {
        const source = tokens[index + 1];
        if (!source) throw new Error("Malformed Git rename status output");
        changed.add(assertSafeProjectPath(source));
        index += 1;
      }
    }
    return [...changed].sort();
  }

  async changedFilesBetween(
    baseCommit: string,
    headCommit: string,
    directory: string,
  ): Promise<string[]> {
    const base = assertFullObjectId(baseCommit);
    const head = assertFullObjectId(headCommit);
    const result = await this.inDirectory(directory, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      base + ".." + head,
      "--",
    ]);
    return [...new Set(result.stdout.split("\0").filter(Boolean).map(assertSafeProjectPath))].sort();
  }

  async changedFilesSince(baseCommit: string, directory: string): Promise<string[]> {
    const base = assertFullObjectId(baseCommit);
    const result = await this.inDirectory(directory, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      base,
      "--",
    ]);
    const tracked = result.stdout.split("\0").filter(Boolean).map(assertSafeProjectPath);
    const others = await this.inDirectory(directory, [
      "ls-files",
      "--others",
      // Deliberately NOT --exclude-standard. Authority must be evaluated on every
      // path an Agent wrote, and an Agent can write the .gitignore that would
      // otherwise hide its own output from every check in the lifecycle.
      "-z",
      "--",
    ]);
    const untracked = others.stdout.split("\0").filter(Boolean).map(assertSafeProjectPath);
    return [...new Set([...tracked, ...untracked])].sort();
  }

  async diffSummary(baseCommit: string, headCommit: string, directory: string): Promise<string> {
    const base = assertFullObjectId(baseCommit);
    const head = assertFullObjectId(headCommit);
    const result = await this.inDirectory(directory, [
      "diff",
      "--stat",
      "--compact-summary",
      "--no-renames",
      base + ".." + head,
      "--",
    ]);
    return result.stdout.trim();
  }

  async stagePaths(directory: string, projectPaths: readonly string[]): Promise<void> {
    await this.assertPlaneMutationDirectory(directory, "staging");
    const safePaths = [...new Set(projectPaths.map(assertSafeProjectPath))].sort();
    for (let index = 0; index < safePaths.length; index += 128) {
      const batch = safePaths.slice(index, index + 128);
      if (batch.length > 0) {
        await this.inPlaneDirectory(directory, "staging", ["add", "-A", "--", ...batch]);
      }
    }
  }

  async rebuildCommit(
    directory: string,
    baseCommit: string,
    projectPaths: readonly string[],
    message: string,
  ): Promise<string> {
    const base = assertFullObjectId(baseCommit);
    if (message.trim().length === 0 || message.length > 512) throw new Error("Invalid commit message");
    await this.inPlaneDirectory(directory, "commit rebuilding", ["reset", "--mixed", base]);
    await this.stagePaths(directory, projectPaths);
    const staged = await this.inPlaneDirectory(
      directory,
      "commit rebuilding",
      ["diff", "--cached", "--name-only", "-z", "--"],
    );
    if (staged.stdout.length === 0) return await this.currentHead(directory);
    await this.inPlaneDirectory(
      directory,
      "commit authoring",
      ["commit", "--no-gpg-sign", "--no-verify", "-m", message],
    );
    return await this.currentHead(directory);
  }

  /** Restores only a managed Plane worktree to an exact trusted commit. */
  async restorePlaneWorktree(directory: string, commit: string): Promise<void> {
    const safeCommit = assertFullObjectId(commit);
    await this.inPlaneDirectory(directory, "Plane restoration", ["reset", "--hard", safeCommit]);
    await this.inPlaneDirectory(directory, "Plane restoration", ["clean", "-ffdx", "--"]);
  }

  async mergeCommit(
    directory: string,
    sourceCommit: string,
    message: string,
    expectedBranch: string,
    expectedHead: string,
  ): Promise<{ headCommit: string; conflictFiles: string[] }> {
    const source = assertFullObjectId(sourceCommit);
    const branch = assertSafeGitBranch(expectedBranch);
    const persistedHead = assertFullObjectId(expectedHead);
    if (message.trim().length === 0 || message.length > 512) throw new Error("Invalid merge message");
    let before: string;
    try {
      const mergeHead = await this.inDirectory(
        directory,
        ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
        { allowedExitCodes: [0, 1] },
      );
      const initialStatus = await this.inPlaneDirectory(
        directory,
        "merge inspection",
        ["status", "--porcelain=v1", "-z"],
      );
      const checkedOutBranch = await this.inDirectory(
        directory,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
        { allowedExitCodes: [0, 1] },
      );
      before = await this.currentHead(directory);
      if (
        mergeHead.exitCode !== 1 ||
        initialStatus.stdout.length > 0 ||
        checkedOutBranch.exitCode !== 0 ||
        checkedOutBranch.stdout.trim() !== branch ||
        before !== persistedHead
      ) {
        throw new GitMergeCleanupError();
      }
    } catch (error) {
      if (error instanceof GitMergeCleanupError || error instanceof ProtectedGitMutationError) {
        throw error;
      }
      throw new GitMergeCleanupError();
    }
    try {
      await this.inPlaneDirectory(directory, "merge authoring", [
        "merge",
        "--no-ff",
        "--no-commit",
        source,
      ]);
    } catch (error) {
      let conflictOutput: string | null = null;
      let cleanupFailed = false;
      try {
        await this.mergeFaults.beforeConflictEnumeration?.();
        const conflictsResult = await this.inDirectory(
          directory,
          ["diff", "--name-only", "-z", "--diff-filter=U", "--"],
          { allowedExitCodes: [0, 1] },
        );
        conflictOutput = conflictsResult.stdout;
      } catch {
        cleanupFailed = true;
      } finally {
        try {
          await this.mergeFaults.beforeAbort?.();
          await this.inPlaneDirectory(directory, "merge abort", ["merge", "--abort"]);
        } catch {
          cleanupFailed = true;
        }
      }
      let conflictFiles: string[] = [];
      try {
        await this.mergeFaults.beforePostAbortInspection?.();
        const mergeHead = await this.inDirectory(
          directory,
          ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"],
          { allowedExitCodes: [0, 1] },
        );
        const status = await this.inDirectory(directory, ["status", "--porcelain=v1", "-z"]);
        const head = await this.currentHead(directory);
        const checkedOutBranch = await this.inDirectory(
          directory,
          ["symbolic-ref", "--quiet", "--short", "HEAD"],
          { allowedExitCodes: [0, 1] },
        );
        if (
          mergeHead.exitCode !== 1 ||
          status.stdout.length > 0 ||
          head !== before ||
          checkedOutBranch.exitCode !== 0 ||
          checkedOutBranch.stdout.trim() !== branch
        ) {
          cleanupFailed = true;
        }
        if (conflictOutput !== null) {
          const rawFiles = conflictOutput.split("\0").filter(Boolean);
          if (rawFiles.length > 1_024) throw new Error("Conflict path limit exceeded");
          conflictFiles = rawFiles.map(assertSafeProjectPath).sort();
        }
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed) throw new GitMergeCleanupError();
      if (conflictFiles.length > 0) return { headCommit: before, conflictFiles };
      throw error;
    }
    const afterMerge = await this.currentHead(directory);
    if (afterMerge !== before) return { headCommit: afterMerge, conflictFiles: [] };
    const staged = await this.inDirectory(directory, ["diff", "--cached", "--name-only", "-z", "--"]);
    if (staged.stdout.length > 0) {
      await this.inPlaneDirectory(
        directory,
        "merge commit authoring",
        ["commit", "--no-gpg-sign", "--no-verify", "-m", message],
      );
    }
    return { headCommit: await this.currentHead(directory), conflictFiles: [] };
  }

  async isAncestor(ancestorCommit: string, descendantCommit: string): Promise<boolean> {
    const ancestor = assertFullObjectId(ancestorCommit);
    const descendant = assertFullObjectId(descendantCommit);
    const result = await this.execute(["merge-base", "--is-ancestor", ancestor, descendant], {
      allowedExitCodes: [0, 1],
    });
    return result.exitCode === 0;
  }

  /**
   * Corroborates the protected ref against the checked-out HEAD, index tree,
   * and worktree. `rev-parse HEAD` alone is insufficient after update-ref
   * because symbolic HEAD follows the new ref before `read-tree -u` finishes.
   */
  async inspectProtectedWorktree(
    protectedBranch: string,
  ): Promise<ProtectedWorktreeInspection> {
    await this.ensureInitialized();
    const branch = assertSafeGitBranch(protectedBranch);
    if (branch !== this.protectedBranch) {
      throw new ProtectedGitMutationError("inspection of an unconfigured branch");
    }
    const branchHead = await this.branchHead(branch);
    const symbolic = await this.execute(
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { allowedExitCodes: [0, 1] },
    );
    const checkedOutBranch =
      symbolic.exitCode === 0 ? symbolic.stdout.trim() : null;
    const worktreeHead = await this.currentHead(this.repositoryPath);
    const indexComparison = await this.execute(
      ["diff-index", "--cached", "--quiet", branchHead, "--"],
      { allowedExitCodes: [0, 1] },
    );
    const indexMatchesHead = indexComparison.exitCode === 0;
    const clean = (await this.uncommittedFiles(this.repositoryPath)).length === 0;
    return {
      branch,
      branchHead,
      checkedOutBranch,
      worktreeHead,
      indexMatchesHead,
      clean,
      synchronized:
        checkedOutBranch === branch &&
        worktreeHead === branchHead &&
        indexMatchesHead &&
        clean,
    };
  }

  /**
   * Atomically advances the protected ref only if it still equals expectedHead.
   * If that ref is checked out in the managed repository, the clean index and
   * worktree are synchronized after the compare-and-swap succeeds.
   */
  async compareAndSwapFastForward(
    protectedBranch: string,
    expectedHead: string,
    candidateHead: string,
  ): Promise<void> {
    await this.ensureInitialized();
    const branch = assertSafeGitBranch(protectedBranch);
    if (branch !== this.protectedBranch) {
      throw new ProtectedGitMutationError("promotion of an unconfigured branch");
    }
    const expected = assertFullObjectId(expectedHead);
    const candidate = assertFullObjectId(candidateHead);
    const actual = await this.branchHead(branch);
    if (actual !== expected) throw new ProtectedHeadMovedError(expected, actual);
    if (!(await this.isAncestor(expected, candidate))) throw new NonFastForwardPromotionError();

    const symbolic = await this.execute(["symbolic-ref", "--quiet", "--short", "HEAD"], {
      allowedExitCodes: [0, 1],
    });
    const checkedOutBranch = symbolic.exitCode === 0 ? symbolic.stdout.trim() : null;
    if (checkedOutBranch !== branch) {
      throw new ProtectedGitMutationError(
        "the managed repository must have the protected branch checked out for promotion",
      );
    }
    const dirty = await this.uncommittedFiles(this.repositoryPath);
    if (dirty.length > 0) throw new DirtyProtectedWorktreeError(dirty);

    try {
      await this.execute(["update-ref", "refs/heads/" + branch, candidate, expected]);
    } catch (error) {
      if (error instanceof GitCommandError) {
        const moved = await this.branchHead(branch);
        if (moved !== expected) throw new ProtectedHeadMovedError(expected, moved);
      }
      throw error;
    }

    const current = await this.branchHead(branch);
    if (current !== candidate) {
      throw new ProtectedRefRollbackError(expected, candidate, current, {
        cause: new ProtectedHeadMovedError(candidate, current),
      });
    }

    try {
      await this.promotionFaults.beforeWorktreeSynchronization?.();
      await this.execute(["read-tree", "--reset", "-u", candidate]);
    } catch (synchronizationError) {
      try {
        await this.promotionFaults.afterWorktreeSynchronizationFailure?.();
      } catch {
        // Fault observers cannot suppress the mandatory rollback attempt.
      }

      try {
        await this.execute(["update-ref", "refs/heads/" + branch, expected, candidate]);
        const rolledBackHead = await this.branchHead(branch);
        if (rolledBackHead !== expected) {
          throw new ProtectedHeadMovedError(expected, rolledBackHead);
        }
      } catch (rollbackError) {
        let actualHead: string | null = null;
        try {
          actualHead = await this.branchHead(branch);
        } catch {
          // The distinct error still reports that the rollback could not be proven.
        }
        throw new ProtectedRefRollbackError(expected, candidate, actualHead, {
          cause: rollbackError,
        });
      }

      let worktreeRestored = true;
      try {
        await this.execute(["read-tree", "--reset", "-u", expected]);
      } catch {
        worktreeRestored = false;
      }
      throw new ProtectedWorktreeSynchronizationError(
        expected,
        candidate,
        worktreeRestored,
        { cause: synchronizationError },
      );
    }
  }
}
