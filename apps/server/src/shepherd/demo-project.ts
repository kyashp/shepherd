import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { writeAuthCollisionFixture } from "./auth-fixture.js";
import { assertFullObjectId, assertSafeGitBranch } from "./git-client.js";

const ROOT_SENTINEL = ".shepherd-demo-root.json";
const SAFE_PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u;

interface ManagedRootSentinel {
  schemaVersion: 1;
  marker: "shepherd-managed-demo-root";
  rootPath: string;
  nonce: string;
}

interface ManagedProjectMetadata {
  schemaVersion: 1;
  marker: "shepherd-managed-demo-project";
  projectId: string;
  repositoryPath: string;
  planesRoot: string;
  protectedBranch: string;
  allowClientReadableCredential: boolean;
}

export interface InitializeAuthDemoProjectOptions {
  managedRoot: string;
  projectId?: string;
  protectedBranch?: string;
  allowClientReadableCredential?: boolean;
}

export interface ManagedAuthDemoProject {
  projectId: string;
  repositoryPath: string;
  planesRoot: string;
  protectedBranch: string;
  headCommit: string;
  /** Immutable root fixture commit used only by the guarded demo reset. */
  initialCommit: string;
  allowClientReadableCredential: boolean;
  created: boolean;
}

export interface ManagedProjectIdentity {
  managedRoot: string;
  projectId: string;
  repositoryPath: string;
  planesRoot: string;
  protectedBranch: string;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function gitEnvironment(): NodeJS.ProcessEnv {
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

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  const safeArgs = [
    "--no-pager",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "credential.helper=",
    "-c",
    "commit.gpgSign=false",
    ...args,
  ];
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      safeArgs,
      {
        cwd,
        env: gitEnvironment(),
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 1_048_576,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout.trim());
          return;
        }
        reject(
          new Error("Managed demo Git initialization failed", {
            cause: new Error(stderr.slice(-8_192)),
          }),
        );
      },
    );
  });
}

async function assertRegularFileIfPresent(candidate: string): Promise<boolean> {
  try {
    const entry = await lstat(candidate);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error("Managed metadata path is not a regular file");
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readTrustedRegularFile(
  candidate: string,
  description: string,
): Promise<string> {
  const before = await lstat(candidate);
  if (before.isSymbolicLink() || !before.isFile() || before.size > 65_536) {
    throw new Error(`${description} must be a bounded regular file`);
  }
  const handle = await open(
    candidate,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat();
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new Error(`${description} identity changed`);
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function ensureContainedDirectory(
  root: string,
  candidate: string,
): Promise<{ canonical: string; existed: boolean }> {
  const resolved = path.resolve(candidate);
  if (!isInside(root, resolved)) {
    throw new Error("Managed directory escaped its sentinel root");
  }
  let existed = true;
  try {
    const entry = await lstat(resolved);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error("Managed directory cannot be a symlink or non-directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    existed = false;
    await mkdir(resolved);
  }
  const canonical = await realpath(resolved);
  if (canonical !== resolved || !isInside(root, canonical)) {
    throw new Error("Managed directory identity escapes its sentinel root");
  }
  return { canonical, existed };
}

function parseRootSentinel(raw: string): ManagedRootSentinel {
  const value = JSON.parse(raw) as Partial<ManagedRootSentinel>;
  if (
    value.schemaVersion !== 1 ||
    value.marker !== "shepherd-managed-demo-root" ||
    typeof value.rootPath !== "string" ||
    typeof value.nonce !== "string" ||
    value.nonce.length < 16
  ) {
    throw new Error("Managed demo root sentinel is malformed");
  }
  return value as ManagedRootSentinel;
}

/**
 * Establishes a sentinel-bound root for the managed fixture. A missing root or
 * an existing empty directory may be initialized; a non-empty unsentinelled
 * directory is never adopted.
 */
export async function initializeShepherdManagedRoot(
  managedRoot: string,
): Promise<string> {
  const resolved = path.resolve(managedRoot);
  if (resolved === path.parse(resolved).root) {
    throw new Error("The filesystem root cannot be used as a Shepherd managed root");
  }
  let existed = true;
  try {
    const entry = await lstat(resolved);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error("Managed demo root must be a real directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    existed = false;
    await mkdir(resolved, { recursive: true });
  }
  const canonical = await realpath(resolved);
  if (canonical !== resolved) {
    throw new Error("Managed demo root identity changed");
  }
  const sentinelPath = path.join(canonical, ROOT_SENTINEL);
  if (!(await assertRegularFileIfPresent(sentinelPath))) {
    if (existed && (await readdir(canonical)).length > 0) {
      throw new Error("Refusing to adopt a non-empty unsentinelled managed root");
    }
    const sentinel: ManagedRootSentinel = {
      schemaVersion: 1,
      marker: "shepherd-managed-demo-root",
      rootPath: canonical,
      nonce: randomUUID(),
    };
    try {
      await writeFile(sentinelPath, JSON.stringify(sentinel, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const sentinel = parseRootSentinel(
    await readTrustedRegularFile(sentinelPath, "Managed demo root sentinel"),
  );
  if (sentinel.rootPath !== canonical) {
    throw new Error("Managed demo root identity does not match its sentinel");
  }
  return canonical;
}

/** Proves that an empty database cannot silently orphan/adopt managed project state. */
export async function assertNoManagedProjectState(managedRoot: string): Promise<void> {
  const resolved = path.resolve(managedRoot);
  let rootEntry;
  try {
    rootEntry = await lstat(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
    throw new Error("Empty Shepherd state requires a real managed root");
  }
  if ((await realpath(resolved)) !== resolved) {
    throw new Error("Empty Shepherd state managed root identity changed");
  }
  const allowedDirectories = new Set([
    "repositories",
    "planes",
    "projects",
    "agent-workspaces",
  ]);
  for (const name of await readdir(resolved)) {
    const candidate = path.join(resolved, name);
    if (name === ROOT_SENTINEL) {
      const sentinel = parseRootSentinel(
        await readTrustedRegularFile(candidate, "Managed demo root sentinel"),
      );
      if (sentinel.rootPath !== resolved) {
        throw new Error("Managed demo root identity does not match its sentinel");
      }
      continue;
    }
    if (!allowedDirectories.has(name)) {
      throw new Error("Empty Shepherd state found an unknown managed-root entry");
    }
    const entry = await lstat(candidate);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error("Empty Shepherd state found an unsafe managed container");
    }
    if ((await realpath(candidate)) !== candidate || (await readdir(candidate)).length > 0) {
      throw new Error("Empty Shepherd state found persisted managed project artifacts");
    }
  }
}

/** Validates an existing root without creating or adopting any sentinel. */
export async function validateShepherdManagedRoot(
  managedRoot: string,
): Promise<string> {
  const resolved = path.resolve(managedRoot);
  const entry = await lstat(resolved);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("Managed demo root must be a real directory");
  }
  const canonical = await realpath(resolved);
  if (canonical !== resolved) {
    throw new Error("Managed demo root identity changed");
  }
  const sentinelPath = path.join(canonical, ROOT_SENTINEL);
  if (!(await assertRegularFileIfPresent(sentinelPath))) {
    throw new Error("Managed demo root sentinel is missing");
  }
  const sentinel = parseRootSentinel(
    await readTrustedRegularFile(sentinelPath, "Managed demo root sentinel"),
  );
  if (sentinel.rootPath !== canonical) {
    throw new Error("Managed demo root identity does not match its sentinel");
  }
  return canonical;
}

function parseProjectMetadata(raw: string): ManagedProjectMetadata {
  const value = JSON.parse(raw) as Partial<ManagedProjectMetadata>;
  if (
    value.schemaVersion !== 1 ||
    value.marker !== "shepherd-managed-demo-project" ||
    typeof value.projectId !== "string" ||
    typeof value.repositoryPath !== "string" ||
    typeof value.planesRoot !== "string" ||
    typeof value.protectedBranch !== "string" ||
    typeof value.allowClientReadableCredential !== "boolean"
  ) {
    throw new Error("Managed demo project metadata is malformed");
  }
  return value as ManagedProjectMetadata;
}

async function validateExistingProjectIdentity(
  root: string,
  metadata: ManagedProjectMetadata,
  expected: ManagedProjectMetadata,
): Promise<void> {
  if (
    metadata.projectId !== expected.projectId ||
    metadata.repositoryPath !== expected.repositoryPath ||
    metadata.planesRoot !== expected.planesRoot ||
    metadata.protectedBranch !== expected.protectedBranch ||
    metadata.allowClientReadableCredential !==
      expected.allowClientReadableCredential
  ) {
    throw new Error("Managed demo project configuration does not match its metadata");
  }
  if (
    !isInside(root, metadata.repositoryPath) ||
    !isInside(root, metadata.planesRoot)
  ) {
    throw new Error("Managed demo project metadata escapes its sentinel root");
  }
  const repository = await realpath(metadata.repositoryPath);
  const planes = await realpath(metadata.planesRoot);
  if (
    repository !== metadata.repositoryPath ||
    planes !== metadata.planesRoot ||
    !isInside(root, repository) ||
    !isInside(root, planes)
  ) {
    throw new Error("Managed demo repository identity changed");
  }
  const gitDirectory = await lstat(path.join(repository, ".git"));
  if (gitDirectory.isSymbolicLink() || !gitDirectory.isDirectory()) {
    throw new Error("Managed demo Git directory is not trusted");
  }
  const policyPath = path.join(repository, "policy.json");
  const policyEntry = await lstat(policyPath);
  if (policyEntry.isSymbolicLink() || !policyEntry.isFile()) {
    throw new Error("Managed demo policy is not a regular file");
  }
  const policy = JSON.parse(
    await readTrustedRegularFile(policyPath, "Managed demo policy"),
  ) as { allowClientReadableCredential?: unknown };
  if (
    policy.allowClientReadableCredential !==
    metadata.allowClientReadableCredential
  ) {
    throw new Error("Managed demo policy differs from its trusted metadata");
  }
}

async function validateExistingProject(
  root: string,
  metadata: ManagedProjectMetadata,
  expected: ManagedProjectMetadata,
): Promise<string> {
  await validateExistingProjectIdentity(root, metadata, expected);
  return assertFullObjectId(
    await runGit(metadata.repositoryPath, [
      "rev-parse",
      "--verify",
      "refs/heads/" + metadata.protectedBranch + "^{commit}",
    ]),
  );
}

async function initialFixtureCommit(
  repositoryPath: string,
  protectedBranch: string,
): Promise<string> {
  const roots = (
    await runGit(repositoryPath, [
      "rev-list",
      "--max-parents=0",
      "--reverse",
      "refs/heads/" + assertSafeGitBranch(protectedBranch),
    ])
  )
    .split(/\r?\n/u)
    .filter(Boolean);
  if (roots.length !== 1 || !roots[0]) {
    throw new Error("Managed auth demo must have exactly one initial fixture commit");
  }
  return assertFullObjectId(roots[0]);
}

/**
 * Resolves the only repository identity recovery may pass to Git. Persisted
 * path text is treated solely as a value to compare with sentinel-backed,
 * server-derived paths; it never selects the Git working directory.
 */
export async function resolveManagedProjectIdentity(options: {
  managedRoot: string;
  projectId: string;
  protectedBranch: string;
  persistedRepositoryPath: string;
}): Promise<ManagedProjectIdentity> {
  const root = await validateShepherdManagedRoot(options.managedRoot);
  if (!SAFE_PROJECT_ID.test(options.projectId)) {
    throw new Error("Unsafe managed demo project ID");
  }
  const protectedBranch = assertSafeGitBranch(options.protectedBranch);
  const repositoryPath = path.join(root, "repositories", options.projectId);
  const planesRoot = path.join(root, "planes", options.projectId);
  if (options.persistedRepositoryPath !== repositoryPath) {
    throw new Error("Persisted repository path does not match managed identity");
  }
  const metadataDirectory = path.join(root, "projects");
  const metadataDirectoryEntry = await lstat(metadataDirectory);
  if (
    !metadataDirectoryEntry.isDirectory() ||
    metadataDirectoryEntry.isSymbolicLink() ||
    (await realpath(metadataDirectory)) !== metadataDirectory
  ) {
    throw new Error("Managed project metadata directory identity changed");
  }
  const metadataPath = path.join(metadataDirectory, options.projectId + ".json");
  if (!(await assertRegularFileIfPresent(metadataPath))) {
    throw new Error("Managed demo project metadata is missing");
  }
  const metadata = parseProjectMetadata(
    await readTrustedRegularFile(metadataPath, "Managed project metadata"),
  );
  await validateExistingProjectIdentity(root, metadata, {
    ...metadata,
    projectId: options.projectId,
    repositoryPath,
    planesRoot,
    protectedBranch,
  });
  return {
    managedRoot: root,
    projectId: options.projectId,
    repositoryPath,
    planesRoot,
    protectedBranch,
  };
}

/** Safely creates or re-opens the dependency-free authentication fixture. */
export async function initializeAuthDemoProject(
  options: InitializeAuthDemoProjectOptions,
): Promise<ManagedAuthDemoProject> {
  const root = await initializeShepherdManagedRoot(options.managedRoot);
  const projectId = options.projectId ?? "auth-demo";
  if (!SAFE_PROJECT_ID.test(projectId)) {
    throw new Error("Unsafe managed demo project ID");
  }
  const protectedBranch = assertSafeGitBranch(options.protectedBranch ?? "main");
  const allowClientReadableCredential =
    options.allowClientReadableCredential ?? false;
  const repositoryPath = path.join(root, "repositories", projectId);
  const planesRoot = path.join(root, "planes", projectId);
  const metadataDirectory = path.join(root, "projects");
  const metadataPath = path.join(metadataDirectory, projectId + ".json");
  for (const target of [repositoryPath, planesRoot, metadataPath]) {
    if (!isInside(root, target)) {
      throw new Error("Managed demo path escaped its sentinel root");
    }
  }
  const expectedMetadata: ManagedProjectMetadata = {
    schemaVersion: 1,
    marker: "shepherd-managed-demo-project",
    projectId,
    repositoryPath,
    planesRoot,
    protectedBranch,
    allowClientReadableCredential,
  };

  await ensureContainedDirectory(root, path.join(root, "repositories"));
  await ensureContainedDirectory(root, path.join(root, "planes"));
  await ensureContainedDirectory(root, metadataDirectory);

  if (await assertRegularFileIfPresent(metadataPath)) {
    const metadata = parseProjectMetadata(
      await readTrustedRegularFile(metadataPath, "Managed project metadata"),
    );
    await ensureContainedDirectory(root, repositoryPath);
    await ensureContainedDirectory(root, planesRoot);
    const headCommit = await validateExistingProject(
      root,
      metadata,
      expectedMetadata,
    );
    const initialCommit = await initialFixtureCommit(
      repositoryPath,
      protectedBranch,
    );
    return { ...expectedMetadata, headCommit, initialCommit, created: false };
  }

  const repository = await ensureContainedDirectory(root, repositoryPath);
  await ensureContainedDirectory(root, planesRoot);
  if (repository.existed) {
    const entries = await readdir(repositoryPath);
    if (entries.length > 0) {
      throw new Error(
        "Refusing to adopt a non-empty demo repository without trusted metadata",
      );
    }
  }
  await writeAuthCollisionFixture(repositoryPath, {
    allowClientReadableCredential,
  });
  await runGit(repositoryPath, ["init", "--initial-branch=" + protectedBranch, "."]);
  await runGit(repositoryPath, ["add", "--all", "--", "."]);
  await runGit(repositoryPath, [
    "commit",
    "--no-gpg-sign",
    "--no-verify",
    "-m",
    "Initialize Shepherd authentication fixture",
  ]);
  const headCommit = assertFullObjectId(
    await runGit(repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]),
  );
  const initialCommit = headCommit;
  await writeFile(metadataPath, JSON.stringify(expectedMetadata, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  return { ...expectedMetadata, headCommit, initialCommit, created: true };
}

/** Opens an existing sentinel-bound auth demo without accepting path input. */
export async function openAuthDemoProject(options: {
  managedRoot: string;
  projectId?: string;
}): Promise<ManagedAuthDemoProject> {
  const root = await validateShepherdManagedRoot(options.managedRoot);
  const projectId = options.projectId ?? "auth-demo";
  if (!SAFE_PROJECT_ID.test(projectId)) {
    throw new Error("Unsafe managed demo project ID");
  }
  const metadataPath = path.join(root, "projects", projectId + ".json");
  if (!(await assertRegularFileIfPresent(metadataPath))) {
    throw new Error("Managed demo project metadata is missing");
  }
  const metadata = parseProjectMetadata(
    await readTrustedRegularFile(metadataPath, "Managed project metadata"),
  );
  const headCommit = await validateExistingProject(root, metadata, metadata);
  const initialCommit = await initialFixtureCommit(
    metadata.repositoryPath,
    metadata.protectedBranch,
  );
  return {
    projectId: metadata.projectId,
    repositoryPath: metadata.repositoryPath,
    planesRoot: metadata.planesRoot,
    protectedBranch: metadata.protectedBranch,
    headCommit,
    initialCommit,
    allowClientReadableCredential: metadata.allowClientReadableCredential,
    created: false,
  };
}

/**
 * Restores only the fixed sentinel-backed auth demo repository. Callers must
 * first remove registered Shepherd Plane worktrees through PlaneManager.
 */
export async function resetAuthDemoProject(options: {
  managedRoot: string;
  projectId?: string;
}): Promise<ManagedAuthDemoProject> {
  const project = await openAuthDemoProject(options);
  const symbolicBranch = await runGit(project.repositoryPath, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  if (symbolicBranch !== project.protectedBranch) {
    throw new Error("Managed auth demo reset requires its protected branch checkout");
  }

  const branchOutput = await runGit(project.repositoryPath, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/shepherd/",
  ]);
  const branches = branchOutput.split(/\r?\n/u).filter(Boolean).sort();
  for (const branch of branches) {
    const safeBranch = assertSafeGitBranch(branch);
    if (!safeBranch.startsWith("shepherd/")) {
      throw new Error("Managed auth demo reset encountered an unguarded branch");
    }
    await runGit(project.repositoryPath, ["branch", "-D", safeBranch]);
  }
  await runGit(project.repositoryPath, ["reset", "--hard", project.initialCommit]);
  await runGit(project.repositoryPath, ["clean", "-ffdx", "--"]);
  const headCommit = assertFullObjectId(
    await runGit(project.repositoryPath, ["rev-parse", "--verify", "HEAD^{commit}"]),
  );
  if (headCommit !== project.initialCommit) {
    throw new Error("Managed auth demo reset did not restore its initial fixture commit");
  }
  return { ...project, headCommit };
}
