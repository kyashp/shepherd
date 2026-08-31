import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { assertSafeProjectPath } from "./git-client.js";

const MAX_CHANGED_FILES = 50_000;
const MAX_FILE_BYTES = 268_435_456;
const MAX_TOTAL_BYTES = 1_073_741_824;
const READ_BUFFER_BYTES = 64 * 1_024;

export class PlaneSensitiveContentError extends Error {
  constructor(readonly affectedPaths: string[]) {
    super(
      "Plane contains configured sensitive content in " +
        affectedPaths.length +
        " changed path(s)",
    );
    this.name = "PlaneSensitiveContentError";
  }
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

function sensitiveNeedles(values: readonly string[]): Buffer[] {
  return [...new Set(values)]
    .filter((value) => value.length >= 4)
    .map((value) => Buffer.from(value, "utf8"));
}

async function fileContainsNeedle(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
  needles: readonly Buffer[],
): Promise<boolean> {
  const maxNeedleBytes = Math.max(...needles.map((needle) => needle.byteLength));
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  let carry = Buffer.alloc(0);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, size - offset),
      offset,
    );
    if (bytesRead === 0) throw new Error("Changed file truncated during sensitive-content scan");
    offset += bytesRead;
    const chunk = buffer.subarray(0, bytesRead);
    const window = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
    if (needles.some((needle) => window.indexOf(needle) >= 0)) return true;
    const carryBytes = Math.min(maxNeedleBytes - 1, window.length);
    carry = carryBytes === 0
      ? Buffer.alloc(0)
      : Buffer.from(window.subarray(window.length - carryBytes));
  }
  return false;
}

/**
 * Scans only changed, regular project files without following links. The scan is
 * byte-exact and carries overlap between bounded reads so credentials split across
 * read chunks cannot evade detection.
 */
export async function assertNoSensitiveContent(
  root: string,
  projectPaths: readonly string[],
  sensitiveValues: readonly string[],
): Promise<void> {
  const needles = sensitiveNeedles(sensitiveValues);
  if (needles.length === 0) return;
  const paths = [...new Set(projectPaths.map(assertSafeProjectPath))].sort();
  if (paths.length > MAX_CHANGED_FILES) {
    throw new Error("Sensitive-content scan changed-file limit exceeded");
  }
  const canonicalRoot = await realpath(path.resolve(root));
  const affectedPaths: string[] = [];
  let totalBytes = 0;
  for (const projectPath of paths) {
    const target = path.join(canonicalRoot, projectPath);
    if (!isInside(canonicalRoot, target)) {
      throw new Error("Sensitive-content scan path escaped its managed root");
    }
    let pathStat: Awaited<ReturnType<typeof lstat>>;
    try {
      pathStat = await lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      throw new Error("Sensitive-content scan requires regular changed files");
    }
    if (pathStat.size > MAX_FILE_BYTES) {
      throw new Error("Sensitive-content scan file-size limit exceeded");
    }
    totalBytes += pathStat.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Sensitive-content scan total-size limit exceeded");
    }
    const handle = await open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const openedStat = await handle.stat();
      if (
        !openedStat.isFile() ||
        openedStat.dev !== pathStat.dev ||
        openedStat.ino !== pathStat.ino ||
        openedStat.size !== pathStat.size
      ) {
        throw new Error("Changed file identity changed during sensitive-content scan");
      }
      if (await fileContainsNeedle(handle, openedStat.size, needles)) {
        affectedPaths.push(projectPath);
      }
      const finalOpenedStat = await handle.stat();
      const finalPathStat = await lstat(target);
      if (
        finalOpenedStat.dev !== openedStat.dev ||
        finalOpenedStat.ino !== openedStat.ino ||
        finalOpenedStat.size !== openedStat.size ||
        finalOpenedStat.mtimeMs !== openedStat.mtimeMs ||
        finalPathStat.dev !== openedStat.dev ||
        finalPathStat.ino !== openedStat.ino
      ) {
        throw new Error("Changed file changed during sensitive-content scan");
      }
    } finally {
      await handle.close();
    }
  }
  if (affectedPaths.length > 0) {
    throw new PlaneSensitiveContentError(affectedPaths);
  }
}
