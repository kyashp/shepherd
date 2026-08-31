#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");

const liveFiles = Object.freeze({
  "model-review": "src/shepherd/live-model-review.integration.test.ts",
  runtime: "src/shepherd/live-runtime.integration.test.ts",
});

export function liveGateVitestArgs(kind, command = "run") {
  const liveFile = liveFiles[kind];
  if (!liveFile || !["list", "run"].includes(command)) {
    throw new Error("Usage: run-live-vitest.mjs <model-review|runtime> [list|run]");
  }
  return [
    command,
    "--root", "apps/server",
    "--config", "vitest.config.ts",
    liveFile,
    ...(command === "run"
      ? [
          "--no-file-parallelism",
          "--maxWorkers=1",
          "--bail=1",
          "--retry=0",
          "--testTimeout", kind === "runtime" ? "1800000" : "600000",
          "--hookTimeout", "120000",
        ]
      : []),
  ];
}

function vitestEntry() {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("vitest/package.json");
  return path.join(path.dirname(packagePath), "vitest.mjs");
}

export async function runLiveVitest(kind, command = "run") {
  const environment = {
    ...process.env,
    SHEPHERD_LIVE_TEST: "true",
    ...(kind === "model-review" ? { SHEPHERD_LIVE_MODEL_REVIEW: "true" } : {}),
  };
  const child = spawn(
    process.execPath,
    [vitestEntry(), ...liveGateVitestArgs(kind, command)],
    {
      cwd: repositoryRoot,
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Live ${kind} gate stopped with ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const code = await runLiveVitest(process.argv[2], process.argv[3] ?? "run");
    process.exitCode = code;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
