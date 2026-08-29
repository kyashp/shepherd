import { z } from "zod";
import type {
  ContractResultManifest,
  ExpectedArtifact,
  SemanticClaim,
  ShepherdFailureCode,
} from "./domain.js";
import {
  isAlwaysProtectedPath,
  normalizeRepoPath,
  RESULT_MANIFEST_PATH,
} from "./authority.js";

export const MAX_RESULT_MANIFEST_BYTES = 64 * 1024;

const boundedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

const evidenceReferenceSchema = z.strictObject({
  path: boundedText(1, 512),
  description: boundedText(1, 1_000),
  line: z.number().int().positive().max(10_000_000).optional(),
});

const manifestArtifactSchema = z.strictObject({
  path: boundedText(1, 512),
  kind: z.enum(["changed", "produced"]),
  description: boundedText(1, 1_000),
});

const manifestClaimSchema = z.strictObject({
  key: boundedText(1, 128),
  value: boundedText(1, 256),
  scope: boundedText(1, 128),
  mode: z.literal("exclusive"),
  evidence: z.array(evidenceReferenceSchema).min(1).max(32),
});

const agentDeclaredTestSchema = z.strictObject({
  name: boundedText(1, 200),
  passed: z.boolean(),
  summary: boundedText(1, 2_000),
});

export const contractResultManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  contractId: boundedText(1, 128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u),
  summary: boundedText(1, 2_000),
  artifacts: z.array(manifestArtifactSchema).max(128),
  semanticClaims: z.array(manifestClaimSchema).max(32),
  agentDeclaredTests: z.array(agentDeclaredTestSchema).max(64),
  notes: z.string().trim().max(4_000),
});

const KEY_ALIASES = new Map<string, string>([
  ["authentication.transport", "auth.transport"],
  ["authentication.method", "auth.transport"],
  ["auth.method", "auth.transport"],
  ["auth.transport", "auth.transport"],
]);

const VALUE_ALIASES = new Map<string, string>([
  ["bearer", "bearer-jwt"],
  ["bearer-jwt", "bearer-jwt"],
  ["bearer-token", "bearer-jwt"],
  ["json-web-token", "bearer-jwt"],
  ["jwt", "bearer-jwt"],
  ["cookie-session", "http-only-session-cookie"],
  ["http-only-cookie", "http-only-session-cookie"],
  ["http-only-session-cookie", "http-only-session-cookie"],
  ["httponly-cookie", "http-only-session-cookie"],
  ["httponly-session-cookie", "http-only-session-cookie"],
  ["session-cookie", "http-only-session-cookie"],
]);

function normalizeDottedIdentifier(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, ".")
    .replace(/\.{2,}/gu, ".")
    .replace(/^\.|\.$/gu, "");
}

/** Canonicalize a semantic key before declared-key checks or collision use. */
export function normalizeClaimKey(value: string): string {
  const normalized = normalizeDottedIdentifier(value);
  return KEY_ALIASES.get(normalized) ?? normalized;
}

/** Canonicalize a semantic scope without granting it any authority meaning. */
export function normalizeClaimScope(value: string): string {
  return normalizeDottedIdentifier(value);
}

/** Canonicalize a claim value, including the demo-critical authentication aliases. */
export function normalizeClaimValue(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s_]+/gu, "-")
    .replace(/-{2,}/gu, "-");
  return VALUE_ALIASES.get(normalized) ?? normalized;
}

export type ManifestIssueCode =
  | "payload_too_large"
  | "invalid_json"
  | "schema_invalid"
  | "contract_id_mismatch"
  | "invalid_artifact_path"
  | "missing_artifact"
  | "missing_required_artifact"
  | "artifact_not_changed"
  | "invalid_claim"
  | "duplicate_claim"
  | "undeclared_claim_key"
  | "undeclared_claim_scope"
  | "invalid_evidence_path"
  | "missing_evidence"
  | "irrelevant_evidence"
  | "missing_declared_claim_key";

export interface ManifestIssue {
  code: ManifestIssueCode;
  path: string;
  message: string;
}

export interface ManifestIngestionContext {
  expectedContractId: string;
  missionId: string;
  declaredClaimKeys: readonly string[];
  /** When supplied, claim scopes must match the Contract's canonical semantic scopes. */
  declaredSemanticScopes?: readonly string[];
  /** Concrete repo-relative paths known to exist in the Plane. */
  existingPaths: readonly string[];
  /** Concrete repo-relative paths from the trusted Git diff. */
  changedPaths: readonly string[];
  /** Contract-owned output requirements; required items must exist and be declared. */
  expectedArtifacts?: readonly ExpectedArtifact[];
  /** Optional unchanged paths intentionally supplied as relevant context. */
  relevantEvidencePaths?: readonly string[];
  createdAt: string;
  claimId?: (claimIndex: number) => string;
  maxBytes?: number;
}

type ManifestFailureCode = Extract<
  ShepherdFailureCode,
  | "malformed_manifest"
  | "invalid_semantic_evidence"
  | "omitted_declared_claim_key"
>;

export type ManifestIngestionResult =
  | {
      ok: true;
      manifest: ContractResultManifest;
      claims: SemanticClaim[];
      issues: [];
    }
  | {
      ok: false;
      failureCode: ManifestFailureCode;
      manifest: ContractResultManifest | null;
      claims: SemanticClaim[];
      issues: ManifestIssue[];
    };

function malformed(issues: ManifestIssue[]): ManifestIngestionResult {
  return {
    ok: false,
    failureCode: "malformed_manifest",
    manifest: null,
    claims: [],
    issues,
  };
}

function parseJsonBounded(
  input: string | unknown,
  maxBytes: number,
): { ok: true; value: unknown } | { ok: false; issue: ManifestIssue } {
  let serialized: string;
  if (typeof input === "string") {
    serialized = input;
  } else {
    try {
      serialized = JSON.stringify(input);
    } catch {
      return {
        ok: false,
        issue: {
          code: "invalid_json",
          path: "$",
          message: "Result manifest is not JSON-serializable",
        },
      };
    }
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    return {
      ok: false,
      issue: {
        code: "payload_too_large",
        path: "$",
        message: `Result manifest exceeds the ${maxBytes}-byte limit`,
      },
    };
  }
  try {
    return { ok: true, value: JSON.parse(serialized) as unknown };
  } catch {
    return {
      ok: false,
      issue: {
        code: "invalid_json",
        path: "$",
        message: "Result manifest is not valid JSON",
      },
    };
  }
}

function formatZodPath(path: PropertyKey[]): string {
  if (path.length === 0) return "$";
  return `$${path
    .map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`))
    .join("")}`;
}

function normalizedPathSet(paths: readonly string[]): Set<string> {
  const output = new Set<string>();
  for (const path of paths) {
    try {
      output.add(normalizeRepoPath(path));
    } catch {
      // Trusted context should already be normalized. Ignoring an invalid item
      // is fail-closed because no Agent reference can match it.
    }
  }
  return output;
}

function safeManifestPath(
  rawPath: string,
): { ok: true; path: string } | { ok: false } {
  try {
    const path = normalizeRepoPath(rawPath);
    if (path === RESULT_MANIFEST_PATH || isAlwaysProtectedPath(path)) {
      return { ok: false };
    }
    return { ok: true, path };
  } catch {
    return { ok: false };
  }
}

/**
 * Strictly ingest an untrusted Agent manifest using only trusted, precomputed
 * Plane facts. No filesystem access or Agent-declared test result can certify it.
 */
export function ingestContractResultManifest(
  input: string | unknown,
  context: ManifestIngestionContext,
): ManifestIngestionResult {
  const maxBytes =
    Number.isSafeInteger(context.maxBytes) && (context.maxBytes ?? 0) > 0
      ? (context.maxBytes as number)
      : MAX_RESULT_MANIFEST_BYTES;
  const json = parseJsonBounded(input, maxBytes);
  if (!json.ok) return malformed([json.issue]);

  const parsed = contractResultManifestSchema.safeParse(json.value);
  if (!parsed.success) {
    return malformed(
      parsed.error.issues.map((issue) => ({
        code: "schema_invalid" as const,
        path: formatZodPath(issue.path),
        message: issue.message,
      })),
    );
  }
  if (parsed.data.contractId !== context.expectedContractId) {
    return malformed([
      {
        code: "contract_id_mismatch",
        path: "$.contractId",
        message: "Manifest contract ID does not match its execution contract",
      },
    ]);
  }

  const issues: ManifestIssue[] = [];
  const existing = normalizedPathSet(context.existingPaths);
  const changed = normalizedPathSet(context.changedPaths);
  const relevant = normalizedPathSet(context.relevantEvidencePaths ?? []);

  const artifacts = parsed.data.artifacts.flatMap((artifact, index) => {
    const safe = safeManifestPath(artifact.path);
    if (!safe.ok) {
      issues.push({
        code: "invalid_artifact_path",
        path: `$.artifacts[${index}].path`,
        message: "Artifact path is unsafe or control-plane protected",
      });
      return [];
    }
    if (!existing.has(safe.path)) {
      issues.push({
        code: "missing_artifact",
        path: `$.artifacts[${index}].path`,
        message: "Declared artifact does not exist in the Plane",
      });
    }
    if (artifact.kind === "changed" && !changed.has(safe.path)) {
      issues.push({
        code: "artifact_not_changed",
        path: `$.artifacts[${index}].path`,
        message: "Changed artifact is absent from the trusted Git diff",
      });
    }
    return [{ ...artifact, path: safe.path }];
  });
  const declaredArtifactPaths = new Set(artifacts.map((artifact) => artifact.path));
  for (const expected of context.expectedArtifacts ?? []) {
    if (!expected.required) continue;
    let expectedPath: string;
    try {
      expectedPath = normalizeRepoPath(expected.path);
    } catch {
      issues.push({
        code: "missing_required_artifact",
        path: "$.artifacts",
        message: "A required Contract artifact has an invalid trusted path",
      });
      continue;
    }
    if (!declaredArtifactPaths.has(expectedPath)) {
      issues.push({
        code: "missing_required_artifact",
        path: "$.artifacts",
        message: `Manifest omitted required Contract artifact '${expectedPath}'`,
      });
    } else if (!existing.has(expectedPath)) {
      issues.push({
        code: "missing_required_artifact",
        path: "$.artifacts",
        message: `Required Contract artifact '${expectedPath}' does not exist in the Plane`,
      });
    }
  }
  if (issues.length > 0) return malformed(issues);

  const declaredKeys = new Set(
    context.declaredClaimKeys.map(normalizeClaimKey).filter((key) => key.length > 0),
  );
  const declaredScopes = new Set(
    (context.declaredSemanticScopes ?? [])
      .map(normalizeClaimScope)
      .filter((scope) => scope.length > 0),
  );
  const seenClaims = new Set<string>();
  const presentDeclaredKeys = new Set<string>();
  const claims: SemanticClaim[] = parsed.data.semanticClaims.map((claim, index) => {
    const claimIssues: string[] = [];
    const key = normalizeClaimKey(claim.key);
    const value = normalizeClaimValue(claim.value);
    const scope = normalizeClaimScope(claim.scope);
    if (!key || !value || !scope) {
      issues.push({
        code: "invalid_claim",
        path: `$.semanticClaims[${index}]`,
        message: "Claim key, value, and scope must remain non-empty after normalization",
      });
      claimIssues.push("invalid_claim");
    }
    const identity = `${key}\u0000${scope}`;
    if (seenClaims.has(identity)) {
      issues.push({
        code: "duplicate_claim",
        path: `$.semanticClaims[${index}]`,
        message: "Only one exclusive claim is allowed for each canonical key and scope",
      });
      claimIssues.push("duplicate_claim");
    }
    seenClaims.add(identity);

    if (!declaredKeys.has(key)) {
      issues.push({
        code: "undeclared_claim_key",
        path: `$.semanticClaims[${index}].key`,
        message: "Claim key was not predeclared by the execution contract",
      });
      claimIssues.push("undeclared_claim_key");
    } else {
      presentDeclaredKeys.add(key);
    }

    if (declaredScopes.size > 0 && !declaredScopes.has(scope)) {
      issues.push({
        code: "undeclared_claim_scope",
        path: `$.semanticClaims[${index}].scope`,
        message: "Claim scope was not predeclared by the execution contract",
      });
      claimIssues.push("undeclared_claim_scope");
    }

    const evidence = claim.evidence.flatMap((reference, evidenceIndex) => {
      const safe = safeManifestPath(reference.path);
      if (!safe.ok) {
        issues.push({
          code: "invalid_evidence_path",
          path: `$.semanticClaims[${index}].evidence[${evidenceIndex}].path`,
          message: "Evidence path is unsafe or control-plane protected",
        });
        claimIssues.push("invalid_evidence_path");
        return [];
      }
      if (!existing.has(safe.path)) {
        issues.push({
          code: "missing_evidence",
          path: `$.semanticClaims[${index}].evidence[${evidenceIndex}].path`,
          message: "Evidence path does not exist in the Plane",
        });
        claimIssues.push("missing_evidence");
      }
      if (!changed.has(safe.path) && !relevant.has(safe.path)) {
        issues.push({
          code: "irrelevant_evidence",
          path: `$.semanticClaims[${index}].evidence[${evidenceIndex}].path`,
          message: "Evidence is neither changed nor explicitly relevant to the contract",
        });
        claimIssues.push("irrelevant_evidence");
      }
      return [{ ...reference, path: safe.path }];
    });

    return {
      id: context.claimId?.(index) ?? `${context.expectedContractId}:claim:${index + 1}`,
      missionId: context.missionId,
      contractId: context.expectedContractId,
      key,
      value,
      scope,
      mode: claim.mode,
      evidence,
      valid: claimIssues.length === 0,
      rejectionReason:
        claimIssues.length === 0 ? null : [...new Set(claimIssues)].join(", "),
      createdAt: context.createdAt,
    };
  });

  for (const declaredKey of declaredKeys) {
    if (!presentDeclaredKeys.has(declaredKey)) {
      issues.push({
        code: "missing_declared_claim_key",
        path: "$.semanticClaims",
        message: `Manifest omitted declared semantic claim key '${declaredKey}'`,
      });
    }
  }

  const manifest: ContractResultManifest = {
    ...parsed.data,
    artifacts,
    semanticClaims: claims.map((claim) => ({
      key: claim.key,
      value: claim.value,
      scope: claim.scope,
      mode: claim.mode,
      evidence: claim.evidence,
    })),
  };
  if (issues.length === 0) return { ok: true, manifest, claims, issues: [] };

  const failureCode: ManifestFailureCode = issues.some(
    (issue) => issue.code === "missing_declared_claim_key",
  )
    ? "omitted_declared_claim_key"
    : "invalid_semantic_evidence";
  return { ok: false, failureCode, manifest, claims, issues };
}
