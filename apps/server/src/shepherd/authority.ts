import type { ScopedAuthority } from "./domain.js";

/**
 * The sole Agent-written control-plane artifact. It may be ingested by trusted
 * code, but must never be staged, merged, or promoted.
 */
export const RESULT_MANIFEST_PATH = ".shepherd/result.json";

export type AuthorityAccess = "read" | "write";

export type AuthorityDecisionReason =
  | "allowed"
  | "result_manifest_ingestion_only"
  | "invalid_path"
  | "always_protected"
  | "explicitly_forbidden"
  | "outside_readable_scope"
  | "outside_writable_scope";

export interface AuthorityPathDecision {
  rawPath: string;
  path: string | null;
  access: AuthorityAccess;
  allowed: boolean;
  /** True only for `.shepherd/result.json`; callers must exclude it from Git. */
  ingestionOnly: boolean;
  reason: AuthorityDecisionReason;
}

export interface AuthorityIntersectionError {
  access: "readable" | "writable";
  pattern: string;
  reason: string;
}

export type AuthorityIntersectionResult =
  | { ok: true; authority: ScopedAuthority }
  | { ok: false; errors: AuthorityIntersectionError[] };

export interface ChangedPathValidation {
  allowed: boolean;
  integrablePaths: string[];
  manifestPaths: string[];
  denied: AuthorityPathDecision[];
  decisions: AuthorityPathDecision[];
}

export class AuthorityPathError extends Error {
  readonly code:
    | "empty_path"
    | "absolute_path"
    | "traversal"
    | "control_character"
    | "unsupported_glob"
    | "glob_in_concrete_path";

  constructor(
    code: AuthorityPathError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AuthorityPathError";
    this.code = code;
  }
}

function canonicalizeSeparators(value: string): string {
  return value.normalize("NFKC").trim().replaceAll("\\", "/");
}

function normalizePathLike(value: string, allowGlob: boolean): string {
  const canonical = canonicalizeSeparators(value);
  if (canonical.length === 0) {
    throw new AuthorityPathError("empty_path", "Repository path cannot be empty");
  }
  if (/^[a-zA-Z]:\//u.test(canonical) || canonical.startsWith("/")) {
    throw new AuthorityPathError(
      "absolute_path",
      "Host-absolute paths are not permitted",
    );
  }
  if (/\p{Cc}/u.test(canonical)) {
    throw new AuthorityPathError(
      "control_character",
      "Repository paths cannot contain control characters",
    );
  }

  const segments = canonical
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) {
    throw new AuthorityPathError("empty_path", "Repository path cannot be empty");
  }
  if (segments.includes("..")) {
    throw new AuthorityPathError(
      "traversal",
      "Repository paths cannot traverse outside the project",
    );
  }

  for (const segment of segments) {
    if (!allowGlob && /[*?\[\]{}]/u.test(segment)) {
      throw new AuthorityPathError(
        "glob_in_concrete_path",
        "Concrete repository paths cannot contain glob syntax",
      );
    }
    if (allowGlob) {
      if (/[[\]{}!]/u.test(segment)) {
        throw new AuthorityPathError(
          "unsupported_glob",
          "Only '*' and '?' glob tokens are supported",
        );
      }
      if (segment.includes("**") && segment !== "**") {
        throw new AuthorityPathError(
          "unsupported_glob",
          "Recursive '**' must occupy a complete path segment",
        );
      }
    }
  }

  return segments.join("/");
}

/** Normalize a concrete, repository-relative path or reject it fail-closed. */
export function normalizeRepoPath(value: string): string {
  return normalizePathLike(value, false);
}

/** Normalize a constrained repository-relative glob pattern. */
export function normalizeRepoPattern(value: string): string {
  return normalizePathLike(value, true);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function normalizeScopedAuthority(
  authority: Readonly<ScopedAuthority>,
): ScopedAuthority {
  return {
    readable: uniqueSorted(authority.readable.map(normalizeRepoPattern)),
    writable: uniqueSorted(authority.writable.map(normalizeRepoPattern)),
    forbidden: uniqueSorted(authority.forbidden.map(normalizeRepoPattern)),
  };
}

function segmentRegex(segment: string): RegExp {
  let source = "";
  for (const character of segment) {
    if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "u");
}

function matchPatternSegments(
  pattern: readonly string[],
  path: readonly string[],
  patternIndex: number,
  pathIndex: number,
  memo: Map<string, boolean>,
): boolean {
  const key = `${patternIndex}:${pathIndex}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  let matched: boolean;
  if (patternIndex === pattern.length) {
    matched = pathIndex === path.length;
  } else if (pattern[patternIndex] === "**") {
    matched =
      matchPatternSegments(pattern, path, patternIndex + 1, pathIndex, memo) ||
      (pathIndex < path.length &&
        matchPatternSegments(pattern, path, patternIndex, pathIndex + 1, memo));
  } else {
    matched =
      pathIndex < path.length &&
      segmentRegex(pattern[patternIndex] ?? "").test(path[pathIndex] ?? "") &&
      matchPatternSegments(pattern, path, patternIndex + 1, pathIndex + 1, memo);
  }
  memo.set(key, matched);
  return matched;
}

/** Match a normalized or raw constrained pattern against a concrete path. */
export function pathMatchesPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizeRepoPath(path);
  const normalizedPattern = normalizeRepoPattern(pattern);
  return matchPatternSegments(
    normalizedPattern.split("/"),
    normalizedPath.split("/"),
    0,
    0,
    new Map(),
  );
}

function hasGlob(segment: string): boolean {
  return segment.includes("*") || segment.includes("?");
}

function segmentPatternSubset(child: string, parent: string): boolean {
  if (child === parent || parent === "*") return true;
  if (!hasGlob(child)) return segmentRegex(parent).test(child);

  // This conservative proof covers common prefix/suffix authority presets. A
  // pattern we cannot prove is rejected rather than over-granted.
  const simple = (segment: string): { prefix: string; suffix: string } | null => {
    if (segment.includes("?") || (segment.match(/\*/gu)?.length ?? 0) > 1) {
      return null;
    }
    const star = segment.indexOf("*");
    if (star === -1) return { prefix: segment, suffix: "" };
    return { prefix: segment.slice(0, star), suffix: segment.slice(star + 1) };
  };
  const childShape = simple(child);
  const parentShape = simple(parent);
  if (!childShape || !parentShape) return false;
  return (
    childShape.prefix.startsWith(parentShape.prefix) &&
    childShape.suffix.endsWith(parentShape.suffix)
  );
}

function literalPrefixCovered(
  childSegments: readonly string[],
  parentPrefix: readonly string[],
): boolean {
  if (childSegments.length < parentPrefix.length) return false;
  return parentPrefix.every((parent, index) => {
    const child = childSegments[index];
    return child !== undefined && segmentPatternSubset(child, parent);
  });
}

/**
 * Conservatively prove that every path matched by `child` is also matched by
 * `parent`. Returning false means "not proven", never "definitely disjoint".
 */
export function isPatternSubset(child: string, parent: string): boolean {
  const normalizedChild = normalizeRepoPattern(child);
  const normalizedParent = normalizeRepoPattern(parent);
  if (normalizedChild === normalizedParent || normalizedParent === "**") {
    return true;
  }
  if (!hasGlob(normalizedChild)) {
    return pathMatchesPattern(normalizedChild, normalizedParent);
  }

  const childSegments = normalizedChild.split("/");
  const parentSegments = normalizedParent.split("/");
  const parentRecursive = parentSegments.indexOf("**");
  if (parentRecursive === parentSegments.length - 1) {
    return literalPrefixCovered(
      childSegments,
      parentSegments.slice(0, parentRecursive),
    );
  }
  if (parentRecursive === 0 && parentSegments.lastIndexOf("**") === 0) {
    const suffix = parentSegments.slice(1);
    if (childSegments.length < suffix.length) return false;
    return suffix.every((parentSegment, offset) => {
      const childSegment = childSegments[childSegments.length - suffix.length + offset];
      return (
        childSegment !== undefined &&
        childSegment !== "**" &&
        segmentPatternSubset(childSegment, parentSegment)
      );
    });
  }
  if (parentSegments.includes("**") || childSegments.includes("**")) {
    return false;
  }
  return (
    childSegments.length === parentSegments.length &&
    childSegments.every((childSegment, index) =>
      segmentPatternSubset(childSegment, parentSegments[index] ?? ""),
    )
  );
}

/**
 * Intersect a contract envelope with its owning Agent envelope. Broadening is
 * rejected; forbidden paths from either side are retained and override grants.
 */
export function intersectScopedAuthority(
  agentAuthority: Readonly<ScopedAuthority>,
  contractAuthority: Readonly<ScopedAuthority>,
): AuthorityIntersectionResult {
  const agent = normalizeScopedAuthority(agentAuthority);
  const contract = normalizeScopedAuthority(contractAuthority);
  const errors: AuthorityIntersectionError[] = [];

  for (const access of ["readable", "writable"] as const) {
    const parentPatterns = agent[access];
    for (const pattern of contract[access]) {
      if (!parentPatterns.some((parent) => isPatternSubset(pattern, parent))) {
        errors.push({
          access,
          pattern,
          reason: `Contract ${access} pattern is not contained by Agent authority`,
        });
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    authority: {
      readable: contract.readable,
      writable: contract.writable,
      forbidden: uniqueSorted([...agent.forbidden, ...contract.forbidden]),
    },
  };
}

const SECRET_BASENAMES = new Set([
  ".npmrc",
  ".pypirc",
  ".netrc",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_ed25519",
]);
const SECRET_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".jks"];

/** Built-in protections cannot be weakened by an authority preset. */
export function isAlwaysProtectedPath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  const segments = normalized.split("/");
  if (segments.includes(".git") || segments.includes(".shepherd")) return true;
  const basename = segments.at(-1)?.toLocaleLowerCase("en-US") ?? "";
  if (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    SECRET_BASENAMES.has(basename) ||
    SECRET_EXTENSIONS.some((extension) => basename.endsWith(extension))
  ) {
    return true;
  }
  return false;
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => pathMatchesPattern(path, pattern));
}

export function decideAuthorityPath(
  authorityInput: Readonly<ScopedAuthority>,
  rawPath: string,
  access: AuthorityAccess,
): AuthorityPathDecision {
  let path: string;
  try {
    path = normalizeRepoPath(rawPath);
  } catch {
    return {
      rawPath,
      path: null,
      access,
      allowed: false,
      ingestionOnly: false,
      reason: "invalid_path",
    };
  }

  // This exception is intentionally narrow and is checked before the blanket
  // `.shepherd/**` protection. It is never considered an integrable write.
  if (access === "write" && path === RESULT_MANIFEST_PATH) {
    return {
      rawPath,
      path,
      access,
      allowed: true,
      ingestionOnly: true,
      reason: "result_manifest_ingestion_only",
    };
  }

  if (isAlwaysProtectedPath(path)) {
    return {
      rawPath,
      path,
      access,
      allowed: false,
      ingestionOnly: false,
      reason: "always_protected",
    };
  }

  let authority: ScopedAuthority;
  try {
    authority = normalizeScopedAuthority(authorityInput);
  } catch {
    return {
      rawPath,
      path,
      access,
      allowed: false,
      ingestionOnly: false,
      reason: "invalid_path",
    };
  }
  if (matchesAny(path, authority.forbidden)) {
    return {
      rawPath,
      path,
      access,
      allowed: false,
      ingestionOnly: false,
      reason: "explicitly_forbidden",
    };
  }

  const grants = access === "read" ? authority.readable : authority.writable;
  const allowed = matchesAny(path, grants);
  return {
    rawPath,
    path,
    access,
    allowed,
    ingestionOnly: false,
    reason: allowed
      ? "allowed"
      : access === "read"
        ? "outside_readable_scope"
        : "outside_writable_scope",
  };
}

/** Apply write authority to the exact changed paths reported by Git. */
export function validateChangedPaths(
  changedPaths: readonly string[],
  authority: Readonly<ScopedAuthority>,
): ChangedPathValidation {
  const decisions = changedPaths.map((path) =>
    decideAuthorityPath(authority, path, "write"),
  );
  const integrablePaths = uniqueSorted(
    decisions.flatMap((decision) =>
      decision.allowed && !decision.ingestionOnly && decision.path
        ? [decision.path]
        : [],
    ),
  );
  const manifestPaths = uniqueSorted(
    decisions.flatMap((decision) =>
      decision.allowed && decision.ingestionOnly && decision.path
        ? [decision.path]
        : [],
    ),
  );
  const denied = decisions.filter((decision) => !decision.allowed);
  return {
    allowed: denied.length === 0,
    integrablePaths,
    manifestPaths,
    denied,
    decisions,
  };
}
