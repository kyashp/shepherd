import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_FACT_PREFIX,
  BEARER_TRANSPORT,
  clientReadableForTransport,
  COOKIE_TRANSPORT,
  verifiedAuthTransportFact,
  writeAuthCollisionFixture,
} from "./auth-fixture.js";
import type { VerificationEvidence } from "./domain.js";

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
