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
describe("server composition", () => {
  const sourcePath = path.resolve(process.cwd(), "src/index.ts");

  async function verifierOptions(): Promise<string> {
    const source = await readFile(sourcePath, "utf8");
    const start = source.indexOf("new ContainerVerifier(");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("});", start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("passes the resolved container state root to the independent verifier", async () => {
    expect(await verifierOptions()).toContain("stateRoot: config.containerStateRoot");
  });

  it("passes the resolved container state volume to the independent verifier", async () => {
    expect(await verifierOptions()).toContain(
      "stateVolume: config.containerStateVolume",
    );
  });
});
