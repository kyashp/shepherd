import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `index.ts` is the only production construction of the container state volume:
 * it is where `config.containerStateRoot` and `config.containerStateVolume` reach
 * the independent verifier. Nothing else observes that wiring, so dropping either
 * option would silently return every candidate Plane to a host bind mount — the
 * exact arrangement the Agent sandbox cannot govern on an affected host, and the
 * failure would surface only as a verification infrastructure error at demo time.
 *
 * These assertions pin the composition text rather than its behavior, which is the
 * same approach the executor's filesystem-call inventory test takes. A stronger
 * end-to-end check is possible — the e2e harness boots the real `dist/index.js` —
 * and is tracked as follow-up rather than done here.
 */

/**
 * Returns the argument list of the named constructor call.
 *
 * The end anchor must be a close at column zero. Searching for the first `});`
 * anywhere overshoots the moment the call is reformatted into the expanded
 * argument style `},\n);`, silently widening the window to the next construction
 * and letting a missing option be satisfied by unrelated text.
 */
export function constructorArguments(source: string, expression: string): string {
  const start = source.indexOf(expression);
  if (start < 0) throw new Error("composition site not found: " + expression);
  const close = /^\);|^\}\);/mu.exec(source.slice(start));
  if (!close) throw new Error("unterminated composition site: " + expression);
  return (
    source
      .slice(start, start + close.index)
      // A commented-out option is not a wiring.
      .replace(/\/\/[^\n]*/gu, "")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
  );
}

describe("server composition", () => {
  const sourcePath = path.resolve(process.cwd(), "src/index.ts");

  async function verifierOptions(): Promise<string> {
    return constructorArguments(await readFile(sourcePath, "utf8"), "new ContainerVerifier(");
  }

  it("passes the resolved container state root to the independent verifier", async () => {
    expect(await verifierOptions()).toContain("stateRoot: config.containerStateRoot");
  });

  it("passes the resolved container state volume to the independent verifier", async () => {
    expect(await verifierOptions()).toContain(
      "stateVolume: config.containerStateVolume",
    );
  });

  describe("the window used to read that composition", () => {
    it("stops at the expanded-argument close instead of running into the next call", () => {
      // Reformatting the call must not widen the window far enough for a later
      // construction, or a comment, to satisfy the assertions above.
      const reformatted = [
        "const shepherdVerifier = new ContainerVerifier(shepherdChecks, {",
        "  planesRoot: shepherdPlanesRoot,",
        "  },",
        ");",
        "// stateRoot: config.containerStateRoot",
        "const shepherdService = new ShepherdService({",
        "  stateRoot: config.containerStateRoot,",
        "  stateVolume: config.containerStateVolume,",
        "});",
      ].join("\n");

      const window = constructorArguments(reformatted, "new ContainerVerifier(");

      expect(window).toContain("planesRoot: shepherdPlanesRoot");
      expect(window).not.toContain("stateRoot: config.containerStateRoot");
      expect(window).not.toContain("stateVolume: config.containerStateVolume");
    });

    it("ignores a commented-out option inside the call", () => {
      const commented = [
        "const shepherdVerifier = new ContainerVerifier(shepherdChecks, {",
        "  // stateRoot: config.containerStateRoot,",
        "  planesRoot: shepherdPlanesRoot,",
        "});",
      ].join("\n");

      expect(constructorArguments(commented, "new ContainerVerifier(")).not.toContain(
        "stateRoot: config.containerStateRoot",
      );
    });
  });
});
