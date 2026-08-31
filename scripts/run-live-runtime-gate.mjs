#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepositoryRoot = path.resolve(scriptDirectory, "..");
const forwardedCredentialNames = Object.freeze([
  "ARK_API_KEY",
  "ARK_MODEL",
  "ARK_BASE_URL",
  "SHEPHERD_MODEL",
  "APP_AUTH_TOKEN",
]);

function boundedSuffix(input) {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/u.test(input)) {
    throw new Error("Live Runtime gate suffix is invalid");
  }
  return input;
}

export function liveControllerRunArgs({
  containerName,
  controllerCommand = [],
  controllerImage,
  forwardCredentials = true,
  runtimeImage,
  volumeName,
}) {
  return [
    "run",
    "--name", containerName,
    "--user", "1000:1000",
    "--group-add", "0",
    "--mount", `type=volume,src=${volumeName},dst=/app/state`,
    "--mount", "type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock",
    ...(forwardCredentials
      ? forwardedCredentialNames.flatMap((name) => ["--env", name])
      : []),
    "--env", "SHEPHERD_LIVE_TEST=true",
    "--env", "SHEPHERD_LIVE_GATE_ROOT=/app/state/live-gate",
    "--env", "CONTAINER_STATE_ROOT=/app/state",
    "--env", `CONTAINER_STATE_VOLUME=${volumeName}`,
    "--env", `CONTAINER_RUNTIME_IMAGE=${runtimeImage}`,
    "--env", "CONTAINER_ENGINE=docker",
    "--env", "CONTAINER_USER=1000:1000",
    controllerImage,
    ...controllerCommand,
  ];
}

async function executeDocker(args, { ignoreFailure = false, quiet = false } = {}) {
  const child = spawn("docker", args, {
    env: process.env,
    stdio: quiet ? "ignore" : "inherit",
    windowsHide: true,
  });
  return await new Promise((resolve, reject) => {
    child.once("error", (error) => {
      if (ignoreFailure) resolve(1);
      else reject(error);
    });
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(0);
      else if (ignoreFailure) resolve(code ?? 1);
      else reject(new Error(signal ? `Docker stopped with ${signal}` : `Docker ${args[0]} failed`));
    });
  });
}

export async function runLiveRuntimeGate({
  environment = process.env,
  execute = executeDocker,
  mode = "run",
  repositoryRoot = defaultRepositoryRoot,
  suffix = `${process.pid}-${Date.now().toString(36)}`,
} = {}) {
  if (!["list", "run"].includes(mode) || environment.SHEPHERD_LIVE_TEST !== "true") {
    throw new Error("Live Runtime gate requires explicit opt-in");
  }
  if (
    mode === "run" &&
    !environment.ARK_API_KEY?.trim() ||
    mode === "run" && !environment.ARK_MODEL?.trim()
  ) {
    throw new Error("Live Runtime gate requires Ark configuration");
  }
  const safeSuffix = boundedSuffix(suffix);
  const containerName = `shepherd-live-controller-${safeSuffix}`;
  const volumeName = `shepherd-live-state-${safeSuffix}`;
  const controllerImage = `shepherd-live-controller:${safeSuffix}`;
  const runtimeImage = `shepherd-live-runtime:${safeSuffix}`;
  try {
    await execute(["version", "--format", "{{.Server.Version}}"]);
    await execute([
      "build", "--file", "Dockerfile", "--tag", runtimeImage, repositoryRoot,
    ]);
    await execute([
      "build", "--file", "Dockerfile.live-test", "--tag", controllerImage, repositoryRoot,
    ]);
    await execute(["volume", "create", volumeName]);
    await execute(liveControllerRunArgs({
      containerName,
      controllerCommand: mode === "list"
        ? ["node", "scripts/run-live-vitest.mjs", "runtime", "list"]
        : [],
      controllerImage,
      forwardCredentials: mode === "run",
      runtimeImage,
      volumeName,
    }));
  } finally {
    await execute(["rm", "--force", containerName], { ignoreFailure: true, quiet: true });
    await execute(["volume", "rm", "--force", volumeName], { ignoreFailure: true, quiet: true });
    await execute(
      ["image", "rm", "--force", controllerImage, runtimeImage],
      { ignoreFailure: true, quiet: true },
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runLiveRuntimeGate({ mode: process.argv[2] ?? "run" });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
