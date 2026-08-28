import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DeterministicFixtureExecutor } from "./executor.js";

describe("DeterministicFixtureExecutor", () => {
  it("writes real contract evidence and the exact manifest channel", async () => {
    const root = await mkdtemp(path.join(process.env.TMPDIR ?? ".tmp", "executor-"));
    const executor = new DeterministicFixtureExecutor();

    const result = await executor.run({
      executionId: "contract-1",
      workspacePath: root,
      operation: { kind: "frontend_contract", contractId: "contract-1" },
    });

    expect(result.changedFiles).toContain("src/frontend/auth.json");
    const manifest = JSON.parse(
      await readFile(path.join(root, ".shepherd/result.json"), "utf8"),
    ) as { contractId: string; semanticClaims: Array<{ value: string }> };
    expect(manifest.contractId).toBe("contract-1");
    expect(manifest.semanticClaims[0]?.value).toBe("bearer-jwt");
  });

  it("reconciles both independently changed artifacts without a winner hint", async () => {
    const root = await mkdtemp(path.join(process.env.TMPDIR ?? ".tmp", "executor-"));
    const executor = new DeterministicFixtureExecutor();

    await executor.run({
      executionId: "candidate-1",
      workspacePath: root,
      operation: {
        kind: "resolution_candidate",
        candidateId: "candidate-1",
        targetTransport: "http-only-session-cookie",
      },
    });

    const frontend = await readFile(
      path.join(root, "src/frontend/auth.json"),
      "utf8",
    );
    const backend = await readFile(
      path.join(root, "src/backend/auth.json"),
      "utf8",
    );
    expect(frontend).toBe(backend);
    expect(frontend).toContain("http-only-session-cookie");
  });
});
