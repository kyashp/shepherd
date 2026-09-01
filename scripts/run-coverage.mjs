#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const coverageRoot = path.join(repositoryRoot, ".tmp", "coverage");
const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

async function run(command, args, environment = {}) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) reject(new Error(`${command} stopped with ${signal}`));
      else resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`${command} coverage step failed`);
}

async function cleanCoverageArtifacts() {
  if (path.relative(repositoryRoot, coverageRoot) !== path.join(".tmp", "coverage")) {
    throw new Error("Coverage output root escaped the repository");
  }
  await rm(coverageRoot, { recursive: true, force: true });
  await mkdir(coverageRoot, { recursive: true, mode: 0o700 });
}

async function main() {
  await cleanCoverageArtifacts();
  let instrumentedBuild = false;
  try {
    await run("npm", [
      "run", "test", "-w", "@launchpad/server", "--",
      "--coverage", "--reporter=dot", "--silent=passed-only",
    ], {
      SHEPHERD_REQUIRE_REAL_VERIFIER_CONTAINER_PROOF: "false",
      SHEPHERD_SKIP_REAL_VERIFIER_SECURITY_PROOF: "true",
    });
    await run("npm", [
      "run", "test", "-w", "@launchpad/server", "--",
      "src/shepherd/verifier.container.test.ts",
      "-t", "independent verifier real container",
      "--maxWorkers=1", "--reporter=dot", "--silent=passed-only",
    ], {
      SHEPHERD_REQUIRE_REAL_VERIFIER_CONTAINER_PROOF: "true",
      SHEPHERD_SKIP_REAL_VERIFIER_SECURITY_PROOF: "false",
    });
    await run("npm", ["run", "test", "-w", "@launchpad/web"]);
    await run("npm", ["run", "build", "-w", "@launchpad/web"], {
      VITE_COVERAGE: "true",
    });
    instrumentedBuild = true;
    await run(process.execPath, [
      playwrightCli,
      "test",
      "--config=playwright.config.ts",
      "--project=chromium-1280x800",
    ], {
      E2E_COVERAGE: "true",
      PLAYWRIGHT_BROWSERS_PATH:
        process.env.PLAYWRIGHT_BROWSERS_PATH ??
        path.join(repositoryRoot, ".tmp", "playwright-browsers"),
    });
    await run(process.execPath, [
      path.join(repositoryRoot, "scripts", "check-web-coverage.mjs"),
    ]);
  } finally {
    if (instrumentedBuild) {
      await run("npm", ["run", "build", "-w", "@launchpad/web"], {
        VITE_COVERAGE: "false",
      });
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
