import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { Plane, PlaneKind, ScopedAuthority } from "./domain.js";
import {
  decideAuthorityPath,
  isAlwaysProtectedPath,
  validateChangedPaths,
} from "./authority.js";
import {
  GitClient,
  GitCommandError,
  assertFullObjectId,
  assertSafeGitBranch,
  assertSafeProjectPath,
} from "./git-client.js";

const ROOT_SENTINEL = ".shepherd-plane-root.json";
const EXECUTION_ROOT = ".execution-workspaces";
const MATERIALIZATION_ROOT = ".trusted-materialization";
const VERIFICATION_ROOT = ".trusted-verification";
const SAFE_PLANE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_TREE_FILES = 50_000;
const MAX_TREE_BYTES = 1_073_741_824;
const MAX_FILE_BYTES = 268_435_456;

interface PlaneRootSentinel {
  schemaVersion: 1;
  marker: "shepherd-managed-plane-root";
  repositoryPath: string;
  planesRoot: string;
  nonce: string;
}

export interface PlaneManagerOptions {
  repositoryPath: string;
  planesRoot: string;
  protectedBranch?: string;
  git?: GitClient;
  now?: () => Date;
  /** Recovery validates persisted ownership and must never mint a new sentinel. */
  createRootSentinel?: boolean;
}

export interface CreatePlaneInput {
  id: string;
  projectId: string;
  missionId: string;
  kind: PlaneKind;
  contractId?: string | null;
  candidateId?: string | null;
  baseCommit: string;
  purpose: string;
  executionIdentity: string;
  authority: ScopedAuthority;
}

export interface MergePlaneResult {
  merged: boolean;
  plane: Plane;
  conflictFiles: string[];
}

export interface ExecutionWorkspace {
  readonly id: string;
  readonly planeId: string;
  readonly sourceCommit: string;
  readonly path: string;
}

export interface VerificationSnapshot {
  readonly commit: string;
  readonly path: string;
}

export class PlaneCreationError extends Error {
  constructor(
    readonly planeId: string,
    options?: ErrorOptions,
  ) {
    super("Failed to create managed Plane " + planeId, options);
    this.name = "PlaneCreationError";
  }
}

export class GitMergeConflictError extends Error {
  constructor(readonly conflictFiles: string[]) {
    super("Git merge conflict in " + conflictFiles.length + " file(s)");
    this.name = "GitMergeConflictError";
  }
}

export class PlaneAuthorityViolationError extends Error {
  constructor(
    readonly operation: "commit" | "merge" | "import",
    readonly deniedPaths: string[],
  ) {
    super(
      "Plane " +
        operation +
        " rejected " +
        deniedPaths.length +
        " path(s) outside the persisted authority envelope",
    );
    this.name = "PlaneAuthorityViolationError";
  }
}

export class UnsafeExecutionWorkspaceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnsafeExecutionWorkspaceError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

function assertPlaneId(planeId: string): string {
  if (!SAFE_PLANE_ID.test(planeId)) throw new Error("Unsafe Plane identifier");
  return planeId;
}

interface TreeCopyBudget {
  files: number;
  bytes: number;
}

interface TreeCopyOptions {
  allowResultManifest: boolean;
  skipRootGitMetadata: boolean;
  readOnly: boolean;
  includeFile?: (projectPath: string) => boolean;
  onFileCopied?: (projectPath: string) => void;
  replaceExisting?: boolean;
}

function isAllowedTreePath(
  projectPath: string,
  directory: boolean,
  allowResultManifest: boolean,
): boolean {
  if (
    allowResultManifest &&
    (directory
      ? projectPath === ".shepherd"
      : projectPath === ".shepherd/result.json")
  ) {
    return true;
  }
  return !isControlPlanePath(projectPath) && !isAlwaysProtectedPath(projectPath);
}

async function copyRegularFileSafely(
  source: string,
  destination: string,
  sourceStat: Awaited<ReturnType<typeof lstat>>,
  readOnly: boolean,
): Promise<void> {
  const sourceHandle = await open(source, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let destinationHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const openedStat = await sourceHandle.stat();
    if (
      !openedStat.isFile() ||
      openedStat.dev !== sourceStat.dev ||
      openedStat.ino !== sourceStat.ino ||
      openedStat.size !== sourceStat.size
    ) {
      throw new UnsafeExecutionWorkspaceError("Workspace file identity changed during import");
    }
    destinationHandle = await open(
      destination,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let sourceOffset = 0;
    let destinationOffset = 0;
    while (sourceOffset < openedStat.size) {
      const { bytesRead } = await sourceHandle.read(
        buffer,
        0,
        Math.min(buffer.length, openedStat.size - sourceOffset),
        sourceOffset,
      );
      if (bytesRead === 0) {
        throw new UnsafeExecutionWorkspaceError("Workspace file changed while it was copied");
      }
      sourceOffset += bytesRead;
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          destinationOffset,
        );
        if (result.bytesWritten === 0) throw new Error("Could not copy workspace file");
        written += result.bytesWritten;
        destinationOffset += result.bytesWritten;
      }
    }
    const finalOpenedStat = await sourceHandle.stat();
    const finalPathStat = await lstat(source);
    if (
      finalOpenedStat.dev !== openedStat.dev ||
      finalOpenedStat.ino !== openedStat.ino ||
      finalOpenedStat.size !== openedStat.size ||
      finalOpenedStat.mtimeMs !== openedStat.mtimeMs ||
      finalPathStat.dev !== openedStat.dev ||
      finalPathStat.ino !== openedStat.ino
    ) {
      throw new UnsafeExecutionWorkspaceError("Workspace file changed while it was copied");
    }
    await destinationHandle.sync();
  } finally {
    await destinationHandle?.close();
    await sourceHandle.close();
  }
  const executable = (Number(sourceStat.mode) & 0o111) !== 0;
  await chmod(
    destination,
    readOnly ? (executable ? 0o500 : 0o400) : executable ? 0o700 : 0o600,
  );
}

async function copyValidatedProjectTree(
  sourceRoot: string,
  destinationRoot: string,
  options: TreeCopyOptions,
): Promise<void> {
  const canonicalSourceRoot = await realpath(sourceRoot);
  const sourceRootStat = await lstat(sourceRoot);
  if (!sourceRootStat.isDirectory() || sourceRootStat.isSymbolicLink()) {
    throw new UnsafeExecutionWorkspaceError("Workspace root must be a real directory");
  }
  const budget: TreeCopyBudget = { files: 0, bytes: 0 };

  const copyDirectory = async (
    sourceDirectory: string,
    destinationDirectory: string,
    prefix: string,
  ): Promise<number> => {
    const canonicalDirectory = await realpath(sourceDirectory);
    if (
      canonicalDirectory !== canonicalSourceRoot &&
      !isInside(canonicalSourceRoot, canonicalDirectory)
    ) {
      throw new UnsafeExecutionWorkspaceError("Workspace directory escaped its root");
    }
    const beforeDirectory = await lstat(sourceDirectory);
    if (!beforeDirectory.isDirectory() || beforeDirectory.isSymbolicLink()) {
      throw new UnsafeExecutionWorkspaceError("Workspace contains a non-directory path component");
    }
    const entries = (await readdir(sourceDirectory)).sort();
    let copiedEntries = 0;
    for (const name of entries) {
      const projectPath = assertSafeProjectPath(prefix ? prefix + "/" + name : name);
      if (
        options.skipRootGitMetadata &&
        prefix === "" &&
        projectPath === ".git"
      ) {
        continue;
      }
      const sourcePath = path.join(sourceDirectory, name);
      const destinationPath = path.join(destinationDirectory, name);
      const entryStat = await lstat(sourcePath);
      if (
        options.skipRootGitMetadata &&
        !options.allowResultManifest &&
        prefix === "" &&
        projectPath === ".shepherd" &&
        entryStat.isDirectory() &&
        !entryStat.isSymbolicLink() &&
        (await readdir(sourcePath)).length === 0
      ) {
        continue;
      }
      if (entryStat.isSymbolicLink()) {
        throw new UnsafeExecutionWorkspaceError("Workspace contains a symbolic link: " + projectPath);
      }
      if (entryStat.isDirectory()) {
        if (!isAllowedTreePath(projectPath, true, options.allowResultManifest)) {
          throw new UnsafeExecutionWorkspaceError("Workspace contains protected metadata: " + projectPath);
        }
        if (options.replaceExisting) {
          try {
            const destinationStat = await lstat(destinationPath);
            if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
              await rm(destinationPath, { recursive: true, force: true });
              await mkdir(destinationPath, { mode: 0o700 });
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            await mkdir(destinationPath, { mode: 0o700 });
          }
        } else {
          await mkdir(destinationPath, { mode: 0o700 });
        }
        const copiedChildren = await copyDirectory(sourcePath, destinationPath, projectPath);
        if (copiedChildren === 0) {
          if (!options.replaceExisting) {
            await rm(destinationPath, { recursive: true, force: false });
          }
        } else {
          copiedEntries += copiedChildren;
          await chmod(destinationPath, options.readOnly ? 0o500 : 0o700);
        }
        continue;
      }
      if (!entryStat.isFile()) {
        throw new UnsafeExecutionWorkspaceError("Workspace contains a special file: " + projectPath);
      }
      if (!isAllowedTreePath(projectPath, false, options.allowResultManifest)) {
        throw new UnsafeExecutionWorkspaceError("Workspace contains protected metadata: " + projectPath);
      }
      if (options.includeFile && !options.includeFile(projectPath)) continue;
      budget.files += 1;
      budget.bytes += entryStat.size;
      if (
        budget.files > MAX_TREE_FILES ||
        budget.bytes > MAX_TREE_BYTES ||
        entryStat.size > MAX_FILE_BYTES
      ) {
        throw new UnsafeExecutionWorkspaceError("Workspace exceeds the trusted import limits");
      }
      if (options.replaceExisting) {
        await rm(destinationPath, { recursive: true, force: true });
      }
      await copyRegularFileSafely(sourcePath, destinationPath, entryStat, options.readOnly);
      options.onFileCopied?.(projectPath);
      copiedEntries += 1;
    }
    const afterDirectory = await lstat(sourceDirectory);
    if (
      afterDirectory.dev !== beforeDirectory.dev ||
      afterDirectory.ino !== beforeDirectory.ino ||
      afterDirectory.mtimeMs !== beforeDirectory.mtimeMs
    ) {
      throw new UnsafeExecutionWorkspaceError("Workspace directory changed while it was copied");
    }
    return copiedEntries;
  };

  await copyDirectory(sourceRoot, destinationRoot, "");
  await chmod(destinationRoot, options.readOnly ? 0o500 : 0o700);
}

export function isControlPlanePath(projectPath: string): boolean {
  const safePath = assertSafeProjectPath(projectPath);
  return (
    safePath === ".git" ||
    safePath.startsWith(".git/") ||
    safePath === ".shepherd" ||
    safePath.startsWith(".shepherd/")
  );
}

/**
 * Owns Git-worktree-backed Planes under one sentinel-guarded root. All paths are
 * derived from trusted Plane IDs; callers never supply a worktree path.
 */
export class PlaneManager {
  readonly repositoryPath: string;
  readonly planesRoot: string;
  readonly git: GitClient;
  private readonly now: () => Date;
  private readonly createRootSentinel: boolean;
  private initialization: Promise<void> | null = null;
  private canonicalRepositoryPath: string | null = null;
  private canonicalPlanesRoot: string | null = null;
  private canonicalExecutionRoot: string | null = null;
  private canonicalMaterializationRoot: string | null = null;
  private canonicalVerificationRoot: string | null = null;
  private readonly activeExecutionWorkspaces = new Map<
    string,
    ExecutionWorkspace & {
      state: "ready" | "importing" | "imported";
      exportedFiles: readonly string[];
    }
  >();

  constructor(options: PlaneManagerOptions) {
    this.repositoryPath = path.resolve(options.repositoryPath);
    this.planesRoot = path.resolve(options.planesRoot);
    const protectedBranch = assertSafeGitBranch(
      options.protectedBranch ?? options.git?.protectedBranch ?? "main",
    );
    if (options.git && options.git.protectedBranch !== protectedBranch) {
      throw new Error("Injected Git client protected branch does not match Plane manager configuration");
    }
    this.git =
      options.git ??
      new GitClient(this.repositoryPath, {
        worktreeRoot: this.planesRoot,
        protectedBranch,
      });
    this.now = options.now ?? (() => new Date());
    this.createRootSentinel = options.createRootSentinel ?? true;
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
    if (this.createRootSentinel) {
      await mkdir(this.planesRoot, { recursive: true });
    } else {
      const entry = await lstat(this.planesRoot);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error("Managed Plane root must be a real directory");
      }
    }
    this.canonicalRepositoryPath = await realpath(this.repositoryPath);
    this.canonicalPlanesRoot = await realpath(this.planesRoot);
    if (
      this.canonicalRepositoryPath === this.canonicalPlanesRoot ||
      isInside(this.canonicalRepositoryPath, this.canonicalPlanesRoot) ||
      isInside(this.canonicalPlanesRoot, this.canonicalRepositoryPath)
    ) {
      throw new Error("Repository and Plane root must be disjoint managed directories");
    }

    const sentinelPath = path.join(this.canonicalPlanesRoot, ROOT_SENTINEL);
    let sentinelExists = true;
    try {
      await lstat(sentinelPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      sentinelExists = false;
    }

    if (!sentinelExists) {
      if (!this.createRootSentinel) {
        throw new Error("Managed Plane root sentinel is missing");
      }
      const entries = await readdir(this.canonicalPlanesRoot);
      if (entries.length > 0) {
        throw new Error("Refusing to adopt a non-empty Plane root without its sentinel");
      }
      const sentinel: PlaneRootSentinel = {
        schemaVersion: 1,
        marker: "shepherd-managed-plane-root",
        repositoryPath: this.canonicalRepositoryPath,
        planesRoot: this.canonicalPlanesRoot,
        nonce: randomUUID(),
      };
      await writeFile(sentinelPath, JSON.stringify(sentinel, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    }
    await this.assertRootSentinel();
    await this.git.initialize();
    this.canonicalExecutionRoot = await this.ensurePrivateSubroot(EXECUTION_ROOT);
    this.canonicalMaterializationRoot = await this.ensurePrivateSubroot(MATERIALIZATION_ROOT);
    this.canonicalVerificationRoot = await this.ensurePrivateSubroot(VERIFICATION_ROOT);
  }

  private async ensureInitialized(): Promise<void> {
    await this.initialize();
  }

  private async assertRootSentinel(): Promise<void> {
    if (!this.canonicalPlanesRoot || !this.canonicalRepositoryPath) {
      throw new Error("Plane manager is not initialized");
    }
    const canonicalRoot = await realpath(this.planesRoot);
    if (canonicalRoot !== this.canonicalPlanesRoot) {
      throw new Error("Plane root identity changed after initialization");
    }
    const sentinelPath = path.join(canonicalRoot, ROOT_SENTINEL);
    const sentinelEntry = await lstat(sentinelPath);
    if (
      sentinelEntry.isSymbolicLink() ||
      !sentinelEntry.isFile() ||
      sentinelEntry.size > 8_192
    ) {
      throw new Error("Managed Plane root sentinel must be a bounded regular file");
    }
    const sentinelHandle = await open(
      sentinelPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    let raw: string;
    try {
      const openedEntry = await sentinelHandle.stat();
      if (
        openedEntry.dev !== sentinelEntry.dev ||
        openedEntry.ino !== sentinelEntry.ino ||
        openedEntry.size !== sentinelEntry.size
      ) {
        throw new Error("Managed Plane root sentinel identity changed");
      }
      raw = await sentinelHandle.readFile("utf8");
    } finally {
      await sentinelHandle.close();
    }
    let sentinel: PlaneRootSentinel;
    try {
      sentinel = JSON.parse(raw) as PlaneRootSentinel;
    } catch {
      throw new Error("Managed Plane root sentinel is malformed");
    }
    if (
      sentinel.schemaVersion !== 1 ||
      sentinel.marker !== "shepherd-managed-plane-root" ||
      sentinel.repositoryPath !== this.canonicalRepositoryPath ||
      sentinel.planesRoot !== this.canonicalPlanesRoot ||
      typeof sentinel.nonce !== "string" ||
      sentinel.nonce.length < 16
    ) {
      throw new Error("Managed Plane root sentinel does not match this project");
    }
  }

  private async ensurePrivateSubroot(name: string): Promise<string> {
    if (!this.canonicalPlanesRoot) throw new Error("Plane root is not initialized");
    const subroot = path.join(this.canonicalPlanesRoot, name);
    try {
      await mkdir(subroot, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const subrootStat = await lstat(subroot);
    if (!subrootStat.isDirectory() || subrootStat.isSymbolicLink()) {
      throw new Error("Managed Plane subroot is not a real directory");
    }
    const canonical = await realpath(subroot);
    if (!isInside(this.canonicalPlanesRoot, canonical)) {
      throw new Error("Managed Plane subroot escaped its root");
    }
    await chmod(canonical, 0o700);
    return canonical;
  }

  private assertPrivateTarget(root: string | null, target: string): string {
    if (!root) throw new Error("Managed private root is not initialized");
    const resolved = path.resolve(target);
    if (!isInside(root, resolved) || path.dirname(resolved) !== root) {
      throw new Error("Managed private target escaped its root");
    }
    return resolved;
  }

  private async removePrivateTree(root: string | null, target: string): Promise<void> {
    const resolved = this.assertPrivateTarget(root, target);
    let targetStat: Awaited<ReturnType<typeof lstat>>;
    try {
      targetStat = await lstat(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
      throw new Error("Managed private cleanup target is not a real directory");
    }
    const canonical = await realpath(resolved);
    if (canonical !== resolved) throw new Error("Managed private cleanup target identity changed");

    const makeDeletable = async (directory: string): Promise<void> => {
      await chmod(directory, 0o700);
      for (const name of await readdir(directory)) {
        const entry = path.join(directory, name);
        const entryStat = await lstat(entry);
        if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
          const canonicalEntry = await realpath(entry);
          if (canonicalEntry !== entry || !isInside(resolved, canonicalEntry)) {
            throw new Error("Managed private cleanup encountered an escaping directory");
          }
          await makeDeletable(entry);
        } else if (!entryStat.isSymbolicLink()) {
          await chmod(entry, 0o600);
        }
      }
    };
    await makeDeletable(resolved);
    await rm(resolved, { recursive: true, force: false });
  }

  private async clearTrustedWorktree(directory: string): Promise<void> {
    const canonical = await realpath(directory);
    for (const name of await readdir(canonical)) {
      if (name === ".git") continue;
      const projectPath = assertSafeProjectPath(name);
      const target = path.join(canonical, projectPath);
      const relative = path.relative(canonical, target);
      if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
        throw new Error("Trusted worktree cleanup escaped its root");
      }
      await rm(target, { recursive: true, force: true });
    }
  }

  private async withDetachedMaterialization<T>(
    commit: string,
    use: (worktreePath: string) => Promise<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    if (!this.canonicalMaterializationRoot) {
      throw new Error("Trusted materialization root is not initialized");
    }
    const exactCommit = assertFullObjectId(commit);
    const materializationPath = this.assertPrivateTarget(
      this.canonicalMaterializationRoot,
      path.join(this.canonicalMaterializationRoot, "materialize-" + randomUUID()),
    );
    let registered = false;
    try {
      await this.git.addDetachedWorktree(materializationPath, exactCommit);
      registered = true;
      if ((await this.git.currentHead(materializationPath)) !== exactCommit) {
        throw new Error("Trusted materialization did not resolve to the exact commit");
      }
      return await use(materializationPath);
    } finally {
      if (registered) {
        await this.git.removeWorktree(materializationPath);
      } else {
        await this.removePrivateTree(this.canonicalMaterializationRoot, materializationPath);
      }
    }
  }

  private async cleanPlaneSourceAtCommit(commit: string): Promise<string | null> {
    if (!this.canonicalPlanesRoot) throw new Error("Plane root is not initialized");
    for (const worktree of await this.git.listWorktrees()) {
      if (
        worktree.head !== commit ||
        !worktree.branch?.startsWith("refs/heads/shepherd/")
      ) {
        continue;
      }
      try {
        const canonical = await realpath(worktree.path);
        if (!isInside(this.canonicalPlanesRoot, canonical)) continue;
        if (
          (await this.git.currentHead(canonical)) === commit &&
          (await this.git.uncommittedFiles(canonical)).length === 0
        ) {
          return canonical;
        }
      } catch {
        // A concurrently changing Plane is not a trustworthy snapshot source.
      }
    }
    return null;
  }

  private planePath(kind: PlaneKind, planeId: string): string {
    const id = assertPlaneId(planeId);
    return path.join(this.planesRoot, kind + "-" + id);
  }

  private planeBranch(kind: PlaneKind, planeId: string): string {
    return "shepherd/" + kind + "/" + assertPlaneId(planeId);
  }

  private assertPlaneRecord(plane: Plane): void {
    assertPlaneId(plane.id);
    const expectedPath = this.planePath(plane.kind, plane.id);
    const expectedBranch = this.planeBranch(plane.kind, plane.id);
    if (path.resolve(plane.worktreePath) !== expectedPath || plane.branch !== expectedBranch) {
      throw new Error("Persisted Plane does not match its managed path/branch identity");
    }
  }

  private async assertDestructiveTarget(target: string): Promise<string> {
    await this.ensureInitialized();
    await this.assertRootSentinel();
    if (!this.canonicalPlanesRoot) throw new Error("Plane root is not initialized");
    const resolved = path.resolve(target);
    if (!isInside(this.canonicalPlanesRoot, resolved)) {
      throw new Error("Refusing destructive operation outside the managed Plane root");
    }
    const canonical = await realpath(resolved);
    if (!isInside(this.canonicalPlanesRoot, canonical)) {
      throw new Error("Refusing destructive operation through an escaping symlink");
    }
    return canonical;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  async createPlane(input: CreatePlaneInput): Promise<Plane> {
    await this.ensureInitialized();
    const id = assertPlaneId(input.id);
    const worktreePath = this.planePath(input.kind, id);
    const branch = this.planeBranch(input.kind, id);
    const baseCommit = assertFullObjectId(input.baseCommit);
    const createdAt = this.timestamp();

    try {
      await this.git.assertManagedDestination(worktreePath);
      try {
        await lstat(worktreePath);
        throw new Error("Plane worktree destination already exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await this.git.addWorktree(worktreePath, branch, baseCommit);
      const headCommit = await this.git.currentHead(worktreePath);
      if (headCommit !== baseCommit) throw new Error("New Plane did not start at its requested base commit");
      return {
        id,
        projectId: input.projectId,
        missionId: input.missionId,
        kind: input.kind,
        contractId: input.contractId ?? null,
        candidateId: input.candidateId ?? null,
        branch,
        worktreePath,
        baseCommit,
        headCommit,
        purpose: input.purpose,
        executionIdentity: input.executionIdentity,
        authority: {
          readable: [...input.authority.readable],
          writable: [...input.authority.writable],
          forbidden: [...input.authority.forbidden],
        },
        state: "ready",
        changedFiles: [],
        diffSummary: "",
        verificationEvidenceIds: [],
        createdAt,
        updatedAt: createdAt,
        destroyedAt: null,
        error: null,
      };
    } catch (error) {
      await this.rollbackFailedCreation(worktreePath, branch);
      throw new PlaneCreationError(id, { cause: error });
    }
  }

  async createIntegrationPlane(input: Omit<CreatePlaneInput, "kind" | "contractId" | "candidateId">): Promise<Plane> {
    return await this.createPlane({
      ...input,
      kind: "integration",
      contractId: null,
      candidateId: null,
    });
  }

  async createResolutionPlane(
    input: Omit<CreatePlaneInput, "kind" | "contractId"> & { candidateId: string },
  ): Promise<Plane> {
    return await this.createPlane({
      ...input,
      kind: "resolution",
      contractId: null,
    });
  }

  private activeExecutionWorkspace(input: ExecutionWorkspace) {
    const active = this.activeExecutionWorkspaces.get(input.id);
    if (
      !active ||
      active.planeId !== input.planeId ||
      active.sourceCommit !== input.sourceCommit ||
      active.path !== input.path
    ) {
      throw new UnsafeExecutionWorkspaceError("Execution workspace handle is not active");
    }
    return active;
  }

  /**
   * Exports the Plane's persisted commit into a Git-free workspace. Only files
   * permitted by the Plane's read authority are copied; executors never receive
   * a Git worktree or any server-owned verification path.
   */
  async createExecutionWorkspace(plane: Plane): Promise<ExecutionWorkspace> {
    await this.ensureInitialized();
    this.assertPlaneRecord(plane);
    if (!this.canonicalExecutionRoot) throw new Error("Execution root is not initialized");
    if (!plane.headCommit) throw new Error("Plane has no persisted commit to export");
    const sourceCommit = assertFullObjectId(plane.headCommit);
    if ((await this.git.currentHead(plane.worktreePath)) !== sourceCommit) {
      throw new Error("Plane head moved before execution export");
    }
    if ((await this.git.uncommittedFiles(plane.worktreePath)).length > 0) {
      throw new Error("Plane must be clean before execution export");
    }

    const id = randomUUID();
    const workspacePath = this.assertPrivateTarget(
      this.canonicalExecutionRoot,
      path.join(this.canonicalExecutionRoot, "execution-" + id),
    );
    await mkdir(workspacePath, { mode: 0o700 });
    const exportedFiles: string[] = [];
    try {
      await copyValidatedProjectTree(plane.worktreePath, workspacePath, {
        allowResultManifest: false,
        skipRootGitMetadata: true,
        readOnly: false,
        includeFile: (projectPath) =>
          decideAuthorityPath(plane.authority, projectPath, "read").allowed,
        onFileCopied: (projectPath) => exportedFiles.push(projectPath),
      });
      if (
        (await this.git.currentHead(plane.worktreePath)) !== sourceCommit ||
        (await this.git.uncommittedFiles(plane.worktreePath)).length > 0
      ) {
        throw new Error("Plane changed while its execution workspace was exported");
      }
    } catch (error) {
      await this.removePrivateTree(this.canonicalExecutionRoot, workspacePath);
      throw error;
    }
    const active = {
      id,
      planeId: plane.id,
      sourceCommit,
      path: workspacePath,
      state: "ready" as const,
      exportedFiles: [...exportedFiles].sort(),
    };
    this.activeExecutionWorkspaces.set(id, active);
    return { id, planeId: plane.id, sourceCommit, path: workspacePath };
  }

  /**
   * Imports a stopped executor's complete Git-free tree through a trusted
   * staging worktree, derives the actual Git diff, then enforces write authority.
   */
  async importExecutionWorkspace(
    plane: Plane,
    workspace: ExecutionWorkspace,
  ): Promise<string[]> {
    await this.ensureInitialized();
    this.assertPlaneRecord(plane);
    const active = this.activeExecutionWorkspace(workspace);
    if (active.state !== "ready") {
      throw new UnsafeExecutionWorkspaceError("Execution workspace is not ready to import");
    }
    if (active.planeId !== plane.id || !plane.headCommit) {
      throw new UnsafeExecutionWorkspaceError("Execution workspace belongs to another Plane");
    }
    const sourceCommit = assertFullObjectId(plane.headCommit);
    if (sourceCommit !== active.sourceCommit) {
      throw new UnsafeExecutionWorkspaceError("Plane head changed after execution export");
    }
    if ((await this.git.currentHead(plane.worktreePath)) !== sourceCommit) {
      throw new UnsafeExecutionWorkspaceError("Plane head moved before execution import");
    }
    if ((await this.git.uncommittedFiles(plane.worktreePath)).length > 0) {
      throw new UnsafeExecutionWorkspaceError("Plane changed while the executor was running");
    }

    active.state = "importing";
    let planeTouched = false;
    try {
      const changedFiles = await this.withDetachedMaterialization(
        sourceCommit,
        async (stagingPath) => {
          for (const exportedPath of active.exportedFiles) {
            const safePath = assertSafeProjectPath(exportedPath);
            const target = path.join(stagingPath, safePath);
            const relative = path.relative(stagingPath, target);
            if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
              throw new UnsafeExecutionWorkspaceError("Exported path escaped staging");
            }
            await rm(target, { recursive: true, force: true });
          }
          await copyValidatedProjectTree(active.path, stagingPath, {
            allowResultManifest: true,
            skipRootGitMetadata: false,
            readOnly: false,
            replaceExisting: true,
          });
          const stagedChanges = await this.git.changedFilesSince(sourceCommit, stagingPath);
          const authority = validateChangedPaths(stagedChanges, plane.authority);
          if (!authority.allowed) {
            throw new PlaneAuthorityViolationError(
              "import",
              authority.denied
                .map((decision) => decision.path ?? decision.rawPath)
                .sort(),
            );
          }

          await this.clearTrustedWorktree(plane.worktreePath);
          planeTouched = true;
          await copyValidatedProjectTree(stagingPath, plane.worktreePath, {
            allowResultManifest: true,
            skipRootGitMetadata: true,
            readOnly: false,
          });
          const importedChanges = await this.git.changedFilesSince(
            sourceCommit,
            plane.worktreePath,
          );
          if (JSON.stringify(importedChanges) !== JSON.stringify(stagedChanges)) {
            throw new UnsafeExecutionWorkspaceError("Imported Plane diff changed during validation");
          }
          const importedAuthority = validateChangedPaths(importedChanges, plane.authority);
          if (!importedAuthority.allowed) {
            throw new PlaneAuthorityViolationError(
              "import",
              importedAuthority.denied
                .map((decision) => decision.path ?? decision.rawPath)
                .sort(),
            );
          }
          return importedChanges;
        },
      );
      active.state = "imported";
      return changedFiles;
    } catch (error) {
      active.state = "ready";
      if (planeTouched) {
        try {
          await this.git.restorePlaneWorktree(plane.worktreePath, sourceCommit);
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            "Execution import failed and the Plane could not be restored",
          );
        }
      }
      throw error;
    }
  }

  async destroyExecutionWorkspace(workspace: ExecutionWorkspace): Promise<void> {
    await this.ensureInitialized();
    const active = this.activeExecutionWorkspace(workspace);
    if (active.state === "importing") {
      throw new UnsafeExecutionWorkspaceError("Execution workspace import is still running");
    }
    await this.removePrivateTree(this.canonicalExecutionRoot, active.path);
    this.activeExecutionWorkspaces.delete(active.id);
  }

  /**
   * Gives trusted verification one fresh, Git-free, read-only tree for an exact
   * commit and removes it after the awaited callback settles.
   */
  async withVerificationSnapshot<T>(
    commit: string,
    use: (snapshot: VerificationSnapshot) => Promise<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    if (!this.canonicalVerificationRoot) {
      throw new Error("Trusted verification root is not initialized");
    }
    const exactCommit = assertFullObjectId(commit);
    const snapshotPath = this.assertPrivateTarget(
      this.canonicalVerificationRoot,
      path.join(this.canonicalVerificationRoot, "verify-" + randomUUID()),
    );
    await mkdir(snapshotPath, { mode: 0o700 });
    try {
      const cleanPlaneSource = await this.cleanPlaneSourceAtCommit(exactCommit);
      const copySnapshot = async (sourcePath: string) => {
        await copyValidatedProjectTree(sourcePath, snapshotPath, {
          allowResultManifest: false,
          skipRootGitMetadata: true,
          readOnly: true,
        });
      };
      if (cleanPlaneSource) {
        await copySnapshot(cleanPlaneSource);
        if (
          (await this.git.currentHead(cleanPlaneSource)) !== exactCommit ||
          (await this.git.uncommittedFiles(cleanPlaneSource)).length > 0
        ) {
          throw new Error("Plane changed while its verification snapshot was materialized");
        }
      } else {
        await this.withDetachedMaterialization(exactCommit, copySnapshot);
      }
      return await use({ commit: exactCommit, path: snapshotPath });
    } finally {
      await this.removePrivateTree(this.canonicalVerificationRoot, snapshotPath);
    }
  }

  private async rollbackFailedCreation(worktreePath: string, branch: string): Promise<void> {
    try {
      const listed = await this.git.listWorktrees();
      if (listed.some((item) => path.resolve(item.path) === path.resolve(worktreePath))) {
        await this.assertDestructiveTarget(worktreePath);
        await this.git.removeWorktree(worktreePath);
      } else {
        try {
          await this.assertDestructiveTarget(worktreePath);
          await rm(worktreePath, { recursive: true, force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    } catch {
      // Preserve the primary failure. A later reset detects a leaked worktree.
    }
    if (branch.startsWith("shepherd/")) {
      try {
        await this.git.deleteBranch(branch);
      } catch {
        // The branch may not have been created, or may still be attached to a leak.
      }
    }
  }

  async inspectPlane(plane: Plane): Promise<Plane> {
    await this.ensureInitialized();
    this.assertPlaneRecord(plane);
    const headCommit = await this.git.currentHead(plane.worktreePath);
    const changedFiles = await this.git.changedFilesSince(plane.baseCommit, plane.worktreePath);
    const committedSummary = await this.git.diffSummary(plane.baseCommit, headCommit, plane.worktreePath);
    const diffSummary =
      committedSummary ||
      (changedFiles.length > 0
        ? changedFiles.length + " changed file(s), not yet finalized"
        : "No changes");
    return {
      ...plane,
      headCommit,
      changedFiles,
      diffSummary,
      updatedAt: this.timestamp(),
    };
  }

  async stagePlane(plane: Plane, projectPaths: readonly string[]): Promise<void> {
    await this.ensureInitialized();
    this.assertPlaneRecord(plane);
    const paths = projectPaths.map(assertSafeProjectPath);
    if (paths.some(isControlPlanePath)) {
      throw new Error("Control-plane paths are never staged into a Plane branch");
    }
    await this.git.stagePaths(plane.worktreePath, paths);
  }

  /**
   * Rebuilds one trusted commit from the immutable Plane base. This strips any
   * Agent-authored commits and guarantees `.shepherd/**` is not integrated.
   */
  async commitPlane(plane: Plane, message: string): Promise<Plane> {
    await this.ensureInitialized();
    this.assertPlaneRecord(plane);
    const actualChanges = await this.git.changedFilesSince(plane.baseCommit, plane.worktreePath);
    const authority = validateChangedPaths(actualChanges, plane.authority);
    if (!authority.allowed) {
      throw new PlaneAuthorityViolationError(
        "commit",
        authority.denied.map((decision) => decision.path ?? decision.rawPath).sort(),
      );
    }
    const promotableChanges = authority.integrablePaths;
    const headCommit = await this.git.rebuildCommit(
      plane.worktreePath,
      plane.baseCommit,
      promotableChanges,
      message,
    );
    const changedFiles = await this.git.changedFilesBetween(
      plane.baseCommit,
      headCommit,
      plane.worktreePath,
    );
    if (changedFiles.some(isControlPlanePath)) {
      throw new Error("Trusted Plane commit contains control-plane metadata");
    }
    return {
      ...plane,
      headCommit,
      changedFiles,
      diffSummary: await this.git.diffSummary(plane.baseCommit, headCommit, plane.worktreePath),
      updatedAt: this.timestamp(),
    };
  }

  async mergePlane(integrationPlane: Plane, sourcePlane: Plane): Promise<MergePlaneResult> {
    await this.ensureInitialized();
    this.assertPlaneRecord(integrationPlane);
    this.assertPlaneRecord(sourcePlane);
    if (integrationPlane.kind !== "integration") throw new Error("Merge target must be an integration Plane");
    if (integrationPlane.missionId !== sourcePlane.missionId) {
      throw new Error("Cannot merge Planes from different Missions");
    }
    const sourceHead = await this.git.currentHead(sourcePlane.worktreePath);
    if (sourcePlane.headCommit && sourceHead !== sourcePlane.headCommit) {
      throw new Error("Source Plane head moved after it was persisted");
    }
    const sourceChanges = await this.git.changedFilesBetween(
      sourcePlane.baseCommit,
      sourceHead,
      sourcePlane.worktreePath,
    );
    const sourceAuthority = validateChangedPaths(sourceChanges, sourcePlane.authority);
    if (!sourceAuthority.allowed || sourceAuthority.manifestPaths.length > 0) {
      const deniedPaths = sourceAuthority.allowed
        ? sourceAuthority.manifestPaths
        : sourceAuthority.denied.map((decision) => decision.path ?? decision.rawPath);
      throw new PlaneAuthorityViolationError("merge", [...new Set(deniedPaths)].sort());
    }
    if (sourceChanges.some(isControlPlanePath)) {
      throw new Error("Source Plane contains protected control metadata");
    }
    const merged = await this.git.mergeCommit(
      integrationPlane.worktreePath,
      sourceHead,
      "Integrate Plane " + sourcePlane.id,
    );
    const updated = await this.inspectPlane({
      ...integrationPlane,
      headCommit: merged.headCommit,
    });
    return {
      merged: merged.conflictFiles.length === 0,
      plane: updated,
      conflictFiles: merged.conflictFiles,
    };
  }

  async destroyPlane(plane: Plane): Promise<Plane> {
    await this.ensureInitialized();
    this.assertPlaneRecord(plane);
    await this.assertDestructiveTarget(plane.worktreePath);
    const listed = await this.git.listWorktrees();
    const registered = listed.find(
      (item) => path.resolve(item.path) === path.resolve(plane.worktreePath),
    );
    if (!registered || registered.branch !== "refs/heads/" + plane.branch) {
      throw new Error("Plane worktree is not registered with its persisted branch");
    }
    await this.git.removeWorktree(plane.worktreePath);
    await this.git.deleteBranch(plane.branch);
    const destroyedAt = this.timestamp();
    return {
      ...plane,
      state: "destroyed",
      updatedAt: destroyedAt,
      destroyedAt,
    };
  }

  /** Removes leaked Shepherd worktrees not represented by an active Plane ID. */
  async cleanupLeakedWorktrees(activePlaneIds: ReadonlySet<string>): Promise<string[]> {
    await this.ensureInitialized();
    await this.assertRootSentinel();
    const removed: string[] = [];
    for (const worktree of await this.git.listWorktrees()) {
      if (!worktree.branch?.startsWith("refs/heads/shepherd/")) continue;
      const branch = worktree.branch.slice("refs/heads/".length);
      const planeId = branch.split("/").at(-1);
      if (!planeId || activePlaneIds.has(planeId)) continue;
      await this.assertDestructiveTarget(worktree.path);
      await this.git.removeWorktree(worktree.path);
      await this.git.deleteBranch(branch);
      removed.push(worktree.path);
    }
    await this.git.pruneWorktrees();
    return removed.sort();
  }

  /**
   * Removes only crash-left private execution, materialization, and verification
   * directories. Persisted Plane worktrees and branches are deliberately not
   * touched so interruption evidence remains inspectable.
   */
  async reconcileInterruptedArtifacts(): Promise<string[]> {
    await this.ensureInitialized();
    await this.assertRootSentinel();
    const roots = [
      { root: this.canonicalExecutionRoot, prefix: "execution-", kind: "execution" },
      {
        root: this.canonicalMaterializationRoot,
        prefix: "materialize-",
        kind: "materialization",
      },
      { root: this.canonicalVerificationRoot, prefix: "verify-", kind: "verification" },
    ] as const;
    const worktrees = await this.git.listWorktrees();
    const removed: string[] = [];
    for (const item of roots) {
      if (!item.root) throw new Error("Managed private root is not initialized");
      for (const name of await readdir(item.root)) {
        if (!name.startsWith(item.prefix) || name.length <= item.prefix.length) {
          throw new Error("Unexpected entry in managed private artifact root");
        }
        const target = this.assertPrivateTarget(item.root, path.join(item.root, name));
        const entry = await lstat(target);
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          throw new Error("Interrupted private artifact is not a real directory");
        }
        const registered = worktrees.some(
          (worktree) => path.resolve(worktree.path) === target,
        );
        if (registered) {
          if (item.kind !== "materialization") {
            throw new Error("Unexpected Git worktree in a non-Git private artifact root");
          }
          await this.git.removeWorktree(target);
        }
        await this.removePrivateTree(item.root, target);
        removed.push(item.kind + ":" + name);
      }
    }
    await this.git.pruneWorktrees();
    this.activeExecutionWorkspaces.clear();
    return removed.sort();
  }

  /** Dev/demo reset primitive. Sentinel and containment checks run per target. */
  async resetManagedPlanes(): Promise<string[]> {
    return await this.cleanupLeakedWorktrees(new Set<string>());
  }
}

export function isGitMergeFailure(error: unknown): error is GitCommandError | GitMergeConflictError {
  return error instanceof GitCommandError || error instanceof GitMergeConflictError;
}
