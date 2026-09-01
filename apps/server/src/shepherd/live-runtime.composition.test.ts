import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

function liveVerifierArguments(source: string): string {
  const expression = "new ContainerVerifier(registry(), {";
  const start = source.indexOf(expression);
  if (start < 0) throw new Error("live verifier composition site was not found");
  const close = /^\s*\}\);/mu.exec(source.slice(start));
  if (!close) throw new Error("live verifier composition site was not terminated");
  return source
    .slice(start, start + close.index)
    .replace(/\/\/[^\n]*/gu, "")
    .replace(/\/\*[\s\S]*?\*\//gu, "");
}

describe("live Runtime verifier composition", () => {
  it("addresses independent verification snapshots through the controller state volume", async () => {
    const source = await readFile(
      path.resolve(process.cwd(), "src/shepherd/live-runtime.integration.test.ts"),
      "utf8",
    );
    const options = liveVerifierArguments(source);

    expect(options).toContain("stateRoot: config.containerStateRoot");
    expect(options).toContain("stateVolume: config.containerStateVolume");
  });
});
