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
      timeoutMs: 1_000,
    });

    expect(executor.kind).toBe("deterministic_fixture");
    expect(result.runtimeSessionId).toBeNull();
    expect(result.usage).toBeNull();
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
      timeoutMs: 1_000,
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

  it("writes only the declared general artifacts and a claim-free manifest", async () => {
    const root = await mkdtemp(path.join(process.env.TMPDIR ?? ".tmp", "executor-"));
    const executor = new DeterministicFixtureExecutor();
    const result = await executor.run({
      executionId: "general-1",
      workspacePath: root,
      operation: {
        kind: "general_contract",
        contractId: "contract-general-1",
        artifactPaths: ["scripts/hello.txt"],
        requiredContent: "Hello from Shepherd",
      },
      timeoutMs: 1_000,
    });
    expect(result.changedFiles).toEqual([
      "scripts/hello.txt",
      ".shepherd/result.json",
    ]);
    expect(await readFile(path.join(root, "scripts/hello.txt"), "utf8")).toBe(
      "Hello from Shepherd\n",
    );
    const manifest = JSON.parse(
      await readFile(path.join(root, ".shepherd/result.json"), "utf8"),
    ) as { contractId: string; semanticClaims: unknown[] };
    expect(manifest).toMatchObject({
      contractId: "contract-general-1",
      semanticClaims: [],
    });
  });
});
