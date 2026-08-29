import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VerificationEvidence } from "./domain.js";

export const AUTH_COLLISION_FIXTURE_ID = "auth-transport-v1" as const;
export const AUTH_CLAIM_KEY = "auth.transport" as const;
export const BEARER_TRANSPORT = "bearer-jwt" as const;
export const COOKIE_TRANSPORT = "http-only-session-cookie" as const;
export const AUTH_FACT_PREFIX = "shepherd-fact auth.transport=" as const;
export const AUTH_FRONTEND_CHECK_ID = "frontend-contract" as const;
export const AUTH_FRONTEND_PROFILE_ID = "auth-frontend" as const;
export const AUTH_BACKEND_CHECK_ID = "backend-contract" as const;
export const AUTH_BACKEND_PROFILE_ID = "auth-backend" as const;
export const AUTH_PROJECT_CHECK_ID = "project-security" as const;
export const AUTH_PROJECT_PROFILE_ID = "auth-project-security" as const;

export type AuthTransport =
  | typeof BEARER_TRANSPORT
  | typeof COOKIE_TRANSPORT;

export interface AuthFixtureOptions {
  allowClientReadableCredential?: boolean;
}

const fixtureFiles = (
  allowClientReadableCredential: boolean,
): Record<string, string> => ({
  "README.md": [
    "# Shepherd authentication collision fixture",
    "",
    "This dependency-free repository demonstrates a semantic conflict that",
    "does not produce a textual Git conflict. Trusted checks live in checks/.",
    "",
  ].join("\n"),
  "package.json":
    JSON.stringify(
      {
        name: "shepherd-auth-collision-fixture",
        private: true,
        version: "1.0.0",
        scripts: {
          "check:frontend": "node checks/frontend.cjs",
          "check:backend": "node checks/backend.cjs",
          "check:project": "node checks/project-security.cjs",
        },
      },
      null,
      2,
    ) + "\n",
  "policy.json":
    JSON.stringify({ allowClientReadableCredential }, null, 2) + "\n",
  "src/.gitkeep": "",
  "checks/frontend.cjs": [
    "const assert = require('node:assert/strict');",
    "const fs = require('node:fs');",
    "const value = JSON.parse(fs.readFileSync('src/frontend/auth.json', 'utf8'));",
    "assert.ok(['bearer-jwt', 'http-only-session-cookie'].includes(value.transport));",
    "assert.equal(typeof value.clientReadableCredential, 'boolean');",
    `console.log('${AUTH_FACT_PREFIX}' + value.transport);`,
    "console.log('frontend auth contract accepted');",
    "",
  ].join("\n"),
  "checks/backend.cjs": [
    "const assert = require('node:assert/strict');",
    "const fs = require('node:fs');",
    "const value = JSON.parse(fs.readFileSync('src/backend/auth.json', 'utf8'));",
    "assert.ok(['bearer-jwt', 'http-only-session-cookie'].includes(value.transport));",
    "assert.equal(typeof value.clientReadableCredential, 'boolean');",
    `console.log('${AUTH_FACT_PREFIX}' + value.transport);`,
    "console.log('backend auth contract accepted');",
    "",
  ].join("\n"),
  "checks/project-security.cjs": [
    "const assert = require('node:assert/strict');",
    "const fs = require('node:fs');",
    "const frontend = JSON.parse(fs.readFileSync('src/frontend/auth.json', 'utf8'));",
    "const backend = JSON.parse(fs.readFileSync('src/backend/auth.json', 'utf8'));",
    "const policy = JSON.parse(fs.readFileSync('policy.json', 'utf8'));",
    "assert.equal(frontend.transport, backend.transport, 'auth transport must be reconciled');",
    "assert.equal(frontend.clientReadableCredential, backend.clientReadableCredential);",
    "assert.equal(frontend.clientReadableCredential, policy.allowClientReadableCredential, 'credential exposure violates project policy');",
    "console.log('project security invariant accepted: ' + frontend.transport);",
    "",
  ].join("\n"),
});

/** Writes only the fixed, trusted fixture layout beneath a server-owned root. */
export async function writeAuthCollisionFixture(
  repositoryPath: string,
  options: AuthFixtureOptions = {},
): Promise<void> {
  const files = fixtureFiles(options.allowClientReadableCredential ?? false);
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(repositoryPath, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content, "utf8");
  }
}

export function clientReadableForTransport(transport: AuthTransport): boolean {
  return transport === BEARER_TRANSPORT;
}

/**
 * Read a machine fact emitted by a trusted fixture check. Agent-authored
 * manifest text is never used as the source for this value.
 */
export function verifiedAuthTransportFact(
  evidence: VerificationEvidence,
): AuthTransport | null {
  const facts = new Set<AuthTransport>();
  for (const check of evidence.checks) {
    if (!check.passed) continue;
    for (const line of check.stdout.split(/\r?\n/u)) {
      if (!line.startsWith(AUTH_FACT_PREFIX)) continue;
      const value = line.slice(AUTH_FACT_PREFIX.length);
      if (value === BEARER_TRANSPORT || value === COOKIE_TRANSPORT) {
        facts.add(value);
      }
    }
  }
  return facts.size === 1 ? [...facts][0] ?? null : null;
}
