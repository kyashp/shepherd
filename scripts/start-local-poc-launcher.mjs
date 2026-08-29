#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const startScript = path.join(scriptDirectory, "start-local-poc.sh");

export function launchLocalPoc(command = startScript, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, LOCAL_POC_DOTENV_LOADED: "1" },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(signal ? `Local PoC stopped with ${signal}` : `Local PoC exited with ${code}`));
    });
  });
}

async function launchIfExecutedDirectly() {
  if (!process.argv[1]) {
    return;
  }

  let executedDirectly;
  try {
    const [entryPath, launcherPath] = await Promise.all([
      realpath(path.resolve(process.argv[1])),
      realpath(fileURLToPath(import.meta.url)),
    ]);
    executedDirectly = entryPath === launcherPath;
  } catch {
    console.error("Unable to resolve the local PoC launcher entry.");
    process.exitCode = 1;
    return;
  }

  if (!executedDirectly) {
    return;
  }

  try {
    await launchLocalPoc();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1]) {
  void launchIfExecutedDirectly();
}
