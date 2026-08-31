import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  liveGateVitestArgs,
  repositoryRoot,
} from "./run-live-vitest.mjs";

const execFileAsync = promisify(execFile);
const script = path.join(repositoryRoot, "scripts", "run-live-vitest.mjs");

test("live gate arguments pin Vitest to one server-root test file", () => {
  assert.deepEqual(liveGateVitestArgs("model-review", "list"), [
    "list",
    "--root", "apps/server",
    "--config", "vitest.config.ts",
    "src/shepherd/live-model-review.integration.test.ts",
  ]);
  assert.deepEqual(liveGateVitestArgs("runtime", "list"), [
    "list",
    "--root", "apps/server",
    "--config", "vitest.config.ts",
    "src/shepherd/live-runtime.integration.test.ts",
  ]);
});

for (const kind of ["model-review", "runtime"]) {
  test(`${kind} discovery lists exactly one current-tree test`, async () => {
    const result = await execFileAsync(process.execPath, [script, kind, "list"], {
      cwd: repositoryRoot,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: process.env.HOME ?? "/nonexistent",
        LANG: "C",
        LC_ALL: "C",
      },
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 262_144,
    });
    const listed = result.stdout.split(/\r?\n/u).filter((line) => line.includes("live-"));
    assert.equal(listed.length, 1, result.stdout);
    assert.match(listed[0], new RegExp(`^src/shepherd/live-${kind}`, "u"));
    assert.doesNotMatch(result.stdout, /\.tmp\/worktrees/u);
  });
}
