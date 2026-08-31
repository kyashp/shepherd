#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createCoverageMap } = require("istanbul-lib-coverage");
const { createContext } = require("istanbul-lib-report");
const reports = require("istanbul-reports");
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

export function validateCoverageSummary(summary, threshold = 80) {
  for (const metric of ["statements", "branches", "functions", "lines"]) {
    const percentage = summary[metric]?.pct;
    if (!Number.isFinite(percentage) || percentage < threshold) {
      throw new Error(`${metric} coverage ${percentage}% is below ${threshold}%`);
    }
  }
}

async function productionWebFiles(directory) {
  const files = [];
  const visit = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (
        entry.isFile() &&
        /\.tsx?$/u.test(entry.name) &&
        !/\.test\.tsx?$/u.test(entry.name) &&
        entry.name !== "types.ts"
      ) {
        files.push(path.resolve(target));
      }
    }
  };
  await visit(directory);
  return files.sort();
}

export async function checkWebCoverage(root = repositoryRoot) {
  const coverageRoot = path.join(root, ".tmp", "coverage");
  const e2eDirectory = path.join(coverageRoot, "web-e2e");
  const combinedDirectory = path.join(coverageRoot, "web-combined");
  const map = createCoverageMap({});
  const e2eFiles = (await readdir(e2eDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (e2eFiles.length === 0) throw new Error("No Playwright coverage files were collected");
  for (const name of e2eFiles) {
    map.merge(JSON.parse(await readFile(path.join(e2eDirectory, name), "utf8")));
  }

  const expected = new Set(
    await productionWebFiles(path.join(root, "apps", "web", "src")),
  );
  map.filter((filename) => expected.has(path.resolve(filename)));
  const missing = [...expected].filter((filename) => !map.data[filename]);
  if (missing.length > 0) {
    throw new Error(`Web coverage omitted ${missing.length} production source files`);
  }

  const summary = map.getCoverageSummary().toJSON();
  await mkdir(combinedDirectory, { recursive: true });
  await writeFile(
    path.join(combinedDirectory, "coverage-final.json"),
    `${JSON.stringify(map.toJSON())}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const context = createContext({ dir: combinedDirectory, coverageMap: map });
  reports.create("text-summary").execute(context);
  reports.create("json-summary").execute(context);
  validateCoverageSummary(summary);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkWebCoverage();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
