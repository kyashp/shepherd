#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const startScript = path.join(scriptDirectory, "start-local-poc.sh");

export function launchLocalPoc(command = startScript, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launchLocalPoc().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
