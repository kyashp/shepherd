import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PlaneSensitiveContentError,
  assertNoSensitiveContent,
} from "./sensitive-content.js";

const root = path.resolve(".tmp", "sensitive-content-tests");

describe("sensitive artifact scanning", () => {
  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("detects a configured secret split across bounded read chunks without disclosing it", async () => {
    const canary = "ark-chunk-boundary-canary-93715";
    const splitOffset = 64 * 1_024 - Math.floor(canary.length / 2);
    await writeFile(
      path.join(root, "artifact.bin"),
      Buffer.concat([
        Buffer.alloc(splitOffset, 0x61),
        Buffer.from(canary, "utf8"),
        Buffer.alloc(32, 0x62),
      ]),
    );

    const failure = await assertNoSensitiveContent(
      root,
      ["artifact.bin"],
      [canary],
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PlaneSensitiveContentError);
    expect((failure as PlaneSensitiveContentError).affectedPaths).toEqual([
      "artifact.bin",
    ]);
    expect((failure as Error).message).not.toContain(canary);
  });

  it("accepts clean files and deleted changed paths", async () => {
    await writeFile(path.join(root, "clean.txt"), "safe artifact\n", "utf8");
    await expect(
      assertNoSensitiveContent(
        root,
        ["clean.txt", "deleted.txt"],
        ["ark-clean-file-canary-49173"],
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses a changed symbolic link instead of following it", async () => {
    await writeFile(path.join(root, "target.txt"), "safe target\n", "utf8");
    await symlink("target.txt", path.join(root, "link.txt"));

    await expect(
      assertNoSensitiveContent(root, ["link.txt"], ["ark-link-canary-62841"]),
    ).rejects.toThrow("requires regular changed files");
  });
});
