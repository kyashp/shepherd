import { mkdtemp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  AUTH_BACKEND_CONTEXT_PATH,
  AUTH_FACT_PREFIX,
  AUTH_FRONTEND_CONTEXT_PATH,
  BEARER_TRANSPORT,
  clientReadableForTransport,
  COOKIE_TRANSPORT,
  verifiedAuthTransportFact,
  writeAuthCollisionFixture,
} from "./auth-fixture.js";
import type { VerificationEvidence } from "./domain.js";

const execFileAsync = promisify(execFile);

function evidence(stdout: string): VerificationEvidence {
  return {
    id: "evidence-1",
    targetType: "contract",
    targetId: "contract-1",
    runner: "independent",
    passed: true,
    checks: [
      {
        id: "check-1",
        name: "Trusted authentication fact",
        profileId: "auth-frontend",
        mandatory: true,
        status: "passed",
        passed: true,
        exitCode: 0,
        durationMs: 1,
        stdout,
        stderr: "",
        error: null,
      },
    ],
    startedAt: "2026-08-29T00:00:00.000Z",
    completedAt: "2026-08-29T00:00:00.001Z",
    durationMs: 1,
    changedFiles: ["src/frontend/auth.json"],
    summary: "passed",
  };
}

describe("authentication collision fixture", () => {
  it("writes a dependency-free default security policy", async () => {
    const root = await mkdtemp(path.join(process.env.TMPDIR ?? ".tmp", "auth-fixture-"));
    await writeAuthCollisionFixture(root);

    const policy = JSON.parse(
      await readFile(path.join(root, "policy.json"), "utf8"),
    ) as { allowClientReadableCredential: boolean };
    expect(policy.allowClientReadableCredential).toBe(false);
    expect(await readFile(path.join(root, "checks/project-security.cjs"), "utf8"))
      .toContain("credential exposure violates project policy");

    for (const contextPath of [AUTH_FRONTEND_CONTEXT_PATH, AUTH_BACKEND_CONTEXT_PATH]) {
      const context = JSON.parse(
        await readFile(path.join(root, contextPath), "utf8"),
      ) as {
        artifactInterface: {
          exactProperties: string[];
          transportValues: string[];
          clientReadableCredentialType: string;
          clientReadableCredentialByTransport: Record<string, boolean>;
        };
      };
      expect(context.artifactInterface).toMatchObject({
        exactProperties: ["transport", "clientReadableCredential"],
        transportValues: [BEARER_TRANSPORT, COOKIE_TRANSPORT],
        clientReadableCredentialType: "boolean",
        clientReadableCredentialByTransport: {
          [BEARER_TRANSPORT]: true,
          [COOKIE_TRANSPORT]: false,
        },
      });
    }

    expect(await readFile(path.join(root, "README.md"), "utf8"))
      .toContain("Northstar Customer Support Portal");
    expect(await readFile(
      path.join(root, "docs/architecture/authentication.md"),
      "utf8",
    )).toContain("independently deployed surfaces");
    const portalTests = await execFileAsync("node", [
      "--test",
      "apps/web/test/support-api-client.test.cjs",
      "apps/server/test/auth-boundary.test.cjs",
      "tests/integration/repository-shape.test.cjs",
    ], {
      cwd: root,
      encoding: "utf8",
    });
    expect(portalTests.stdout).toContain("pass 3");
  });

  it("flips the objective invariant without naming a winner", async () => {
    expect(clientReadableForTransport(BEARER_TRANSPORT)).toBe(true);
    expect(clientReadableForTransport(COOKIE_TRANSPORT)).toBe(false);
  });

  it("accepts one independently emitted semantic fact and rejects ambiguity", () => {
    expect(
      verifiedAuthTransportFact(
        evidence(`${AUTH_FACT_PREFIX}${BEARER_TRANSPORT}\n`),
      ),
    ).toBe(BEARER_TRANSPORT);
    expect(verifiedAuthTransportFact(evidence("agent claimed bearer\n"))).toBeNull();
    expect(
      verifiedAuthTransportFact(
        evidence(
          `${AUTH_FACT_PREFIX}${BEARER_TRANSPORT}\n${AUTH_FACT_PREFIX}${COOKIE_TRANSPORT}\n`,
        ),
      ),
    ).toBeNull();
  });
});
