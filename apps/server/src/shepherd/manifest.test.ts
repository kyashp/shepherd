import { describe, expect, it } from "vitest";
import type { ContractResultManifest } from "./domain.js";
import {
  ingestContractResultManifest,
  MAX_RESULT_MANIFEST_BYTES,
  normalizeClaimKey,
  normalizeClaimScope,
  normalizeClaimValue,
} from "./manifest.js";

const timestamp = "2026-08-29T12:00:00.000Z";

function manifest(
  overrides: Partial<ContractResultManifest> = {},
): ContractResultManifest {
  return {
    schemaVersion: 1,
    contractId: "contract-frontend",
    summary: "Implemented browser authentication transport.",
    artifacts: [
      {
        path: "./src//auth.ts",
        kind: "changed",
        description: "Authentication client implementation",
      },
    ],
    semanticClaims: [
      {
        key: " Authentication_Method ",
        value: " JWT ",
        scope: " Web Client ",
        mode: "exclusive",
        evidence: [
          {
            path: "src\\auth.ts",
            description: "Bearer token is attached to API calls",
            line: 12,
          },
        ],
      },
    ],
    agentDeclaredTests: [
      { name: "agent smoke", passed: false, summary: "Informational only" },
    ],
    notes: "No independent verification is claimed.",
    ...overrides,
  };
}

function context(
  overrides: Partial<Parameters<typeof ingestContractResultManifest>[1]> = {},
): Parameters<typeof ingestContractResultManifest>[1] {
  return {
    expectedContractId: "contract-frontend",
    missionId: "mission-1",
    declaredClaimKeys: ["auth.transport"],
    existingPaths: ["src/auth.ts", "README.md"],
    changedPaths: ["src/auth.ts", ".shepherd/result.json"],
    createdAt: timestamp,
    ...overrides,
  };
}

describe("claim canonicalization", () => {
  it.each([
    [" jwt ", "bearer-jwt"],
    ["BEARER", "bearer-jwt"],
    ["Bearer_JWT", "bearer-jwt"],
    ["json web token", "bearer-jwt"],
    ["HttpOnly Cookie", "http-only-session-cookie"],
    ["session_cookie", "http-only-session-cookie"],
  ])("normalizes claim value %s", (input, expected) => {
    expect(normalizeClaimValue(input)).toBe(expected);
  });

  it.each([
    ["auth.transport", "auth.transport"],
    ["Authentication Transport", "auth.transport"],
    ["auth_method", "auth.transport"],
    ["Authentication-Method", "auth.transport"],
  ])("normalizes claim key %s", (input, expected) => {
    expect(normalizeClaimKey(input)).toBe(expected);
  });

  it("normalizes scopes deterministically", () => {
    expect(normalizeClaimScope(" Web_Client / Primary ")).toBe(
      "web.client.primary",
    );
  });
});

describe("strict result-manifest ingestion", () => {
  it("normalizes a valid manifest and produces trusted claim records", () => {
    const result = ingestContractResultManifest(
      JSON.stringify(manifest()),
      context({ claimId: (index) => `claim-${index + 1}` }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.artifacts).toEqual([
      {
        path: "src/auth.ts",
        kind: "changed",
        description: "Authentication client implementation",
      },
    ]);
    expect(result.claims).toEqual([
      {
        id: "claim-1",
        missionId: "mission-1",
        contractId: "contract-frontend",
        key: "auth.transport",
        value: "bearer-jwt",
        scope: "web.client",
        mode: "exclusive",
        evidence: [
          {
            path: "src/auth.ts",
            description: "Bearer token is attached to API calls",
            line: 12,
          },
        ],
        valid: true,
        rejectionReason: null,
        createdAt: timestamp,
      },
    ]);
    expect(result.manifest.agentDeclaredTests[0]?.passed).toBe(false);
  });

  it("accepts unchanged evidence only when trusted context marks it relevant", () => {
    const input = manifest({
      semanticClaims: [
        {
          key: "auth.transport",
          value: "bearer",
          scope: "application",
          mode: "exclusive",
          evidence: [
            { path: "README.md", description: "Project-level security contract" },
          ],
        },
      ],
    });
    const rejected = ingestContractResultManifest(input, context());
    expect(rejected).toMatchObject({
      ok: false,
      failureCode: "invalid_semantic_evidence",
      issues: [{ code: "irrelevant_evidence" }],
    });

    const accepted = ingestContractResultManifest(
      input,
      context({ relevantEvidencePaths: ["README.md"] }),
    );
    expect(accepted.ok).toBe(true);
  });

  it.each([
    ["{not-json", "invalid_json"],
    [JSON.stringify({ schemaVersion: 1 }), "schema_invalid"],
  ])("rejects malformed payloads", (input, code) => {
    expect(ingestContractResultManifest(input, context())).toMatchObject({
      ok: false,
      failureCode: "malformed_manifest",
      manifest: null,
      claims: [],
      issues: expect.arrayContaining([expect.objectContaining({ code })]),
    });
  });

  it("rejects payloads before parsing when their UTF-8 size is over the bound", () => {
    const input = JSON.stringify({ value: "x".repeat(MAX_RESULT_MANIFEST_BYTES) });
    expect(ingestContractResultManifest(input, context())).toMatchObject({
      ok: false,
      failureCode: "malformed_manifest",
      issues: [{ code: "payload_too_large" }],
    });
  });

  it("supports a stricter caller-provided size bound", () => {
    expect(
      ingestContractResultManifest(manifest(), context({ maxBytes: 100 })),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "payload_too_large" }],
    });
  });

  it("rejects non-serializable object input", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(ingestContractResultManifest(cyclic, context())).toMatchObject({
      ok: false,
      issues: [{ code: "invalid_json" }],
    });
  });

  it("rejects unknown properties rather than silently stripping them", () => {
    expect(
      ingestContractResultManifest(
        { ...manifest(), untrustedControl: "skip-verification" },
        context(),
      ),
    ).toMatchObject({
      ok: false,
      failureCode: "malformed_manifest",
      issues: [{ code: "schema_invalid", path: "$" }],
    });
  });

  it("rejects a manifest for a different contract", () => {
    expect(
      ingestContractResultManifest(
        manifest({ contractId: "contract-backend" }),
        context(),
      ),
    ).toMatchObject({
      ok: false,
      failureCode: "malformed_manifest",
      issues: [{ code: "contract_id_mismatch", path: "$.contractId" }],
    });
  });

  it.each([
    ["../outside.ts"],
    ["/etc/passwd"],
    [".git/config"],
    [".shepherd/result.json"],
    ["config/.env"],
    ["certs/server.pem"],
  ])("rejects unsafe artifact path %s", (path) => {
    expect(
      ingestContractResultManifest(
        manifest({
          artifacts: [
            { path, kind: "changed", description: "unsafe declaration" },
          ],
        }),
        context(),
      ),
    ).toMatchObject({
      ok: false,
      failureCode: "malformed_manifest",
      issues: [{ code: "invalid_artifact_path" }],
    });
  });

  it("requires artifacts to exist and changed artifacts to be in the trusted diff", () => {
    expect(
      ingestContractResultManifest(
        manifest({
          artifacts: [
            {
              path: "src/missing.ts",
              kind: "changed",
              description: "not actually present",
            },
          ],
        }),
        context(),
      ),
    ).toMatchObject({
      ok: false,
      issues: [
        { code: "missing_artifact" },
        { code: "artifact_not_changed" },
      ],
    });

    expect(
      ingestContractResultManifest(
        manifest({
          artifacts: [
            {
              path: "README.md",
              kind: "changed",
              description: "exists but is unchanged",
            },
          ],
        }),
        context(),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "artifact_not_changed" }],
    });
  });

  it.each([
    ["../outside.ts", "invalid_evidence_path"],
    [".git/config", "invalid_evidence_path"],
    [".shepherd/result.json", "invalid_evidence_path"],
    ["config/.env.local", "invalid_evidence_path"],
    ["src/missing.ts", "missing_evidence"],
    ["README.md", "irrelevant_evidence"],
  ])("rejects invalid semantic evidence %s", (path, code) => {
    const result = ingestContractResultManifest(
      manifest({
        semanticClaims: [
          {
            key: "auth.transport",
            value: "jwt",
            scope: "web.client",
            mode: "exclusive",
            evidence: [{ path, description: "untrusted evidence" }],
          },
        ],
      }),
      context(),
    );
    expect(result).toMatchObject({
      ok: false,
      failureCode: "invalid_semantic_evidence",
      issues: expect.arrayContaining([expect.objectContaining({ code })]),
      claims: [
        expect.objectContaining({
          valid: false,
          rejectionReason: expect.stringContaining(code),
        }),
      ],
    });
  });

  it("moves a contract to the omitted-key failure path after alias normalization", () => {
    const result = ingestContractResultManifest(
      manifest({ semanticClaims: [] }),
      context({ declaredClaimKeys: [" Authentication_Transport "] }),
    );
    expect(result).toMatchObject({
      ok: false,
      failureCode: "omitted_declared_claim_key",
      issues: [
        {
          code: "missing_declared_claim_key",
          message: expect.stringContaining("auth.transport"),
        },
      ],
    });
  });

  it("rejects undeclared claims so they cannot enter collision detection", () => {
    const result = ingestContractResultManifest(
      manifest({
        semanticClaims: [
          manifest().semanticClaims[0]!,
          {
            key: "deployment.target",
            value: "production",
            scope: "application",
            mode: "exclusive",
            evidence: [
              { path: "src/auth.ts", description: "Invented extra control claim" },
            ],
          },
        ],
      }),
      context(),
    );
    expect(result).toMatchObject({
      ok: false,
      failureCode: "invalid_semantic_evidence",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "undeclared_claim_key" }),
      ]),
      claims: [
        expect.objectContaining({ key: "auth.transport", valid: true }),
        expect.objectContaining({ key: "deployment.target", valid: false }),
      ],
    });
  });

  it("rejects duplicate canonical claims even when spelling differs", () => {
    const baseClaim = manifest().semanticClaims[0]!;
    const result = ingestContractResultManifest(
      manifest({
        semanticClaims: [
          baseClaim,
          { ...baseClaim, key: "auth-transport", value: "session-cookie" },
        ],
      }),
      context(),
    );
    expect(result).toMatchObject({
      ok: false,
      failureCode: "invalid_semantic_evidence",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_claim" }),
      ]),
    });
  });

  it("ignores malformed trusted-context entries rather than matching them", () => {
    const result = ingestContractResultManifest(
      manifest(),
      context({
        existingPaths: ["../src/auth.ts"],
        changedPaths: ["../src/auth.ts"],
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "missing_artifact" }),
      ]),
    });
  });
});
