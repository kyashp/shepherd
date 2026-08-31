import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkWebCoverage, validateCoverageSummary } from "./check-web-coverage.mjs";

test("coverage validation enforces every metric at 80 percent", () => {
  assert.doesNotThrow(() => validateCoverageSummary({
    statements: { pct: 80 },
    branches: { pct: 80 },
    functions: { pct: 80 },
    lines: { pct: 80 },
  }));
  assert.throws(() => validateCoverageSummary({
    statements: { pct: 95 },
    branches: { pct: 79.99 },
    functions: { pct: 95 },
    lines: { pct: 95 },
  }), /branches coverage 79.99% is below 80%/u);
});

test("web coverage is complete from browser maps without incompatible unit maps", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shepherd-web-coverage-"));
  const source = path.join(root, "apps", "web", "src", "example.ts");
  const output = path.join(root, ".tmp", "coverage", "web-e2e");
  await mkdir(path.dirname(source), { recursive: true });
  await mkdir(output, { recursive: true });
  await writeFile(source, "export const answer = 42;\n");
  await writeFile(path.join(output, "flow.json"), JSON.stringify({
    [source]: {
      path: source,
      statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 25 } } },
      fnMap: { 0: {
        name: "answer",
        decl: { start: { line: 1, column: 13 }, end: { line: 1, column: 19 } },
        loc: { start: { line: 1, column: 13 }, end: { line: 1, column: 25 } },
        line: 1,
      } },
      branchMap: { 0: {
        type: "binary-expr",
        line: 1,
        locations: [
          { start: { line: 1, column: 22 }, end: { line: 1, column: 23 } },
          { start: { line: 1, column: 23 }, end: { line: 1, column: 24 } },
        ],
      } },
      s: { 0: 1 },
      f: { 0: 1 },
      b: { 0: [1, 1] },
    },
  }));

  const summary = await checkWebCoverage(root);
  assert.equal(summary.statements.pct, 100);
  assert.equal(summary.lines.pct, 100);
});
