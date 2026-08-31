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
export const AUTH_FRONTEND_CONTEXT_PATH =
  "context/frontend-auth-conventions.json" as const;
export const AUTH_BACKEND_CONTEXT_PATH =
  "context/backend-auth-conventions.json" as const;
export const AUTH_ARTIFACT_INTERFACE_DESCRIPTION =
  'JSON object with exactly two properties: "transport" (one of "bearer-jwt" or "http-only-session-cookie") and "clientReadableCredential" (boolean). The boolean must be true for "bearer-jwt" and false for "http-only-session-cookie". Infer the transport from the assigned role scoped context and repository conventions. Use this required artifact path as the auth.transport semantic claim evidence path.' as const;

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
    "# Northstar Customer Support Portal",
    "",
    "Northstar is a production-style customer support portal with an independently",
    "owned browser application and horizontally scaled support API.",
    "",
    "The repository is deliberately dependency-free for the recorded PoC, while",
    "preserving the ownership, deployment, contract, and test boundaries of a",
    "real service. Trusted release checks live in checks/.",
    "",
  ].join("\n"),
  "package.json":
    JSON.stringify(
      {
        name: "northstar-customer-support-portal",
        private: true,
        version: "1.0.0",
        scripts: {
          test: "node --test apps/web/test/*.test.cjs apps/server/test/*.test.cjs tests/integration/*.test.cjs",
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
  [AUTH_FRONTEND_CONTEXT_PATH]:
    JSON.stringify(
      {
        application: "Northstar Customer Support Portal",
        ownedSurface: "apps/web/**",
        surface: "browser-client",
        requestConvention: "include ambient browser credentials",
        credentialVisibility: "credential material must not be readable by client JavaScript",
        existingImplementation: "apps/web/src/http/support-api-client.cjs",
        existingTests: "apps/web/test/support-api-client.test.cjs",
        artifactInterface: {
          path: "src/frontend/auth.json",
          exactProperties: ["transport", "clientReadableCredential"],
          transportValues: [BEARER_TRANSPORT, COOKIE_TRANSPORT],
          clientReadableCredentialType: "boolean",
          clientReadableCredentialByTransport: {
            [BEARER_TRANSPORT]: true,
            [COOKIE_TRANSPORT]: false,
          },
        },
      },
      null,
      2,
    ) + "\n",
  [AUTH_BACKEND_CONTEXT_PATH]:
    JSON.stringify(
      {
        application: "Northstar Customer Support Portal",
        ownedSurface: "apps/server/**",
        surface: "stateless-api",
        deploymentConvention: "requests may land on any horizontally scaled instance",
        credentialIngress: "signed request-carried claims arrive in the Authorization header",
        existingImplementation: "apps/server/src/http/auth-boundary.cjs",
        existingTests: "apps/server/test/auth-boundary.test.cjs",
        artifactInterface: {
          path: "src/backend/auth.json",
          exactProperties: ["transport", "clientReadableCredential"],
          transportValues: [BEARER_TRANSPORT, COOKIE_TRANSPORT],
          clientReadableCredentialType: "boolean",
          clientReadableCredentialByTransport: {
            [BEARER_TRANSPORT]: true,
            [COOKIE_TRANSPORT]: false,
          },
        },
      },
      null,
      2,
    ) + "\n",
  "docs/architecture/authentication.md": [
    "# Authentication boundary",
    "",
    "The Customer Support Portal is split between two independently deployed surfaces:",
    "",
    "- `apps/web` owns browser navigation and calls the support API with ambient credentials.",
    "- `apps/server` runs on interchangeable instances behind the support API load balancer.",
    "- `packages/contracts` owns the shared session endpoint and public response shape.",
    "",
    "Each owning team must preserve its local security and deployment conventions. Cross-surface",
    "compatibility is a release invariant and must be verified after independently valid changes",
    "are integrated.",
    "",
  ].join("\n"),
  "packages/contracts/src/session-contract.cjs": [
    "'use strict';",
    "",
    "const SESSION_ENDPOINT = '/api/session';",
    "const AUTHENTICATED_SESSION_FIELDS = Object.freeze(['userId', 'displayName', 'expiresAt']);",
    "",
    "module.exports = { SESSION_ENDPOINT, AUTHENTICATED_SESSION_FIELDS };",
    "",
  ].join("\n"),
  "apps/web/src/http/support-api-client.cjs": [
    "'use strict';",
    "",
    "const { SESSION_ENDPOINT } = require('../../../../packages/contracts/src/session-contract.cjs');",
    "",
    "function authenticatedRequest(path = SESSION_ENDPOINT) {",
    "  return {",
    "    path,",
    "    method: 'GET',",
    "    credentials: 'include',",
    "    headers: { Accept: 'application/json' },",
    "  };",
    "}",
    "",
    "module.exports = { authenticatedRequest };",
    "",
  ].join("\n"),
  "apps/web/test/support-api-client.test.cjs": [
    "'use strict';",
    "const assert = require('node:assert/strict');",
    "const test = require('node:test');",
    "const { authenticatedRequest } = require('../src/http/support-api-client.cjs');",
    "",
    "test('browser requests use ambient credentials without exposing a token header', () => {",
    "  const request = authenticatedRequest();",
    "  assert.equal(request.credentials, 'include');",
    "  assert.equal(request.path, '/api/session');",
    "  assert.equal(request.headers.Authorization, undefined);",
    "});",
    "",
  ].join("\n"),
  "apps/server/src/runtime/deployment.cjs": [
    "'use strict';",
    "",
    "module.exports = Object.freeze({",
    "  topology: 'horizontally-scaled',",
    "  requestAffinity: false,",
    "  instanceLocalSessionState: false,",
    "});",
    "",
  ].join("\n"),
  "apps/server/src/http/auth-boundary.cjs": [
    "'use strict';",
    "",
    "function requestCredential(request) {",
    "  const authorization = request?.headers?.authorization;",
    "  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;",
    "  return authorization.slice('Bearer '.length);",
    "}",
    "",
    "module.exports = { requestCredential };",
    "",
  ].join("\n"),
  "apps/server/test/auth-boundary.test.cjs": [
    "'use strict';",
    "const assert = require('node:assert/strict');",
    "const test = require('node:test');",
    "const deployment = require('../src/runtime/deployment.cjs');",
    "const { requestCredential } = require('../src/http/auth-boundary.cjs');",
    "",
    "test('support API instances remain stateless and accept request-carried credentials', () => {",
    "  assert.equal(deployment.requestAffinity, false);",
    "  assert.equal(deployment.instanceLocalSessionState, false);",
    "  assert.equal(requestCredential({ headers: { authorization: 'Bearer signed-claims' } }), 'signed-claims');",
    "});",
    "",
  ].join("\n"),
  "tests/integration/repository-shape.test.cjs": [
    "'use strict';",
    "const assert = require('node:assert/strict');",
    "const test = require('node:test');",
    "const { SESSION_ENDPOINT } = require('../../packages/contracts/src/session-contract.cjs');",
    "const { authenticatedRequest } = require('../../apps/web/src/http/support-api-client.cjs');",
    "",
    "test('both independently owned surfaces share the public session endpoint', () => {",
    "  assert.equal(SESSION_ENDPOINT, '/api/session');",
    "  assert.equal(authenticatedRequest().path, SESSION_ENDPOINT);",
    "});",
    "",
  ].join("\n"),
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

export function authTransportForRoleContext(
  role: "Frontend" | "Backend",
): AuthTransport {
  return role === "Frontend" ? COOKIE_TRANSPORT : BEARER_TRANSPORT;
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
