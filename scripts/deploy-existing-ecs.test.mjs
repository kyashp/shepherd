import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function run(script, environment, cwd) {
  return new Promise((resolve) => {
    const child = spawn("bash", [script], {
      cwd,
      env: { PATH: process.env.PATH ?? "", HOME: cwd, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Builds a throwaway repository whose `scripts/` holds the real deploy script and
 * whose PATH shadows `docker`, so reaching the engine at all is observable.
 */
async function fixture(envLines) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ecs-deploy-"));
  temporaryDirectories.push(root);
  const binDirectory = path.join(root, "bin");
  await Promise.all([mkdir(path.join(root, "scripts")), mkdir(binDirectory)]);
  const { readFile, writeFile: write, chmod } = await import("node:fs/promises");
  await write(
    path.join(root, "scripts", "deploy-existing-ecs.sh"),
    await readFile(path.join(repositoryRoot, "scripts", "deploy-existing-ecs.sh"), "utf8"),
  );
  const dockerLog = path.join(root, "docker-invocations");
  await write(
    path.join(binDirectory, "docker"),
    ["#!/usr/bin/env bash", `printf "%s\\n" "$*" >> "${dockerLog}"`, "exit 0", ""].join("\n"),
    "utf8",
  );
  await chmod(path.join(binDirectory, "docker"), 0o755);
  await write(path.join(root, ".env.production"), envLines.join("\n") + "\n", "utf8");
  return { root, binDirectory, dockerLog };
}

test("the existing-ECS deploy refuses an environment file with no APP_AUTH_TOKEN", async () => {
  // This profile publishes on every interface (docker-compose.yml binds
  // 0.0.0.0 with an unprefixed port), and the API it exposes performs
  // prompt-triggered command and file execution. The sibling Volcengine deploy
  // script already requires the token; this one must not be the soft path.
  const { root, binDirectory } = await fixture([
    "ARK_API_KEY=ecs-key",
    "ARK_MODEL=ecs-model",
    "APP_AUTH_TOKEN=",
  ]);

  const result = await run(
    path.join(root, "scripts", "deploy-existing-ecs.sh"),
    { PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}` },
    root,
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /APP_AUTH_TOKEN/u);
});

test("the existing-ECS deploy refuses before contacting the container engine", async () => {
  const { root, binDirectory, dockerLog } = await fixture([
    "ARK_API_KEY=ecs-key",
    "ARK_MODEL=ecs-model",
  ]);

  await run(
    path.join(root, "scripts", "deploy-existing-ecs.sh"),
    { PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}` },
    root,
  );

  // A credential check that runs after `docker compose up` would be decoration.
  const { access } = await import("node:fs/promises");
  await assert.rejects(access(dockerLog));
});

test("the existing-ECS deploy refuses a whitespace-only APP_AUTH_TOKEN", async () => {
  // Bash sees spaces as non-empty, but the server trims before validating, so the
  // value reaches the container as "" and the bearer hook short-circuits. A guard
  // that only tests for the empty string therefore lets the exact hole through.
  const { root, binDirectory, dockerLog } = await fixture([
    "ARK_API_KEY=ecs-key",
    "ARK_MODEL=ecs-model",
    "APP_AUTH_TOKEN=   ",
  ]);

  const result = await run(
    path.join(root, "scripts", "deploy-existing-ecs.sh"),
    { PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}` },
    root,
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /APP_AUTH_TOKEN/u);
  const { access } = await import("node:fs/promises");
  await assert.rejects(access(dockerLog));
});

test("the existing-ECS deploy refuses a CRLF environment file with an empty token", async () => {
  // `cp .env.example .env.production` then editing on a Windows host leaves CRLF,
  // so the captured value is a lone carriage return: non-empty to bash, empty to
  // the server.
  const root = await mkdtemp(path.join(os.tmpdir(), "ecs-deploy-crlf-"));
  temporaryDirectories.push(root);
  const binDirectory = path.join(root, "bin");
  const { readFile, chmod } = await import("node:fs/promises");
  await Promise.all([mkdir(path.join(root, "scripts")), mkdir(binDirectory)]);
  await writeFile(
    path.join(root, "scripts", "deploy-existing-ecs.sh"),
    await readFile(path.join(repositoryRoot, "scripts", "deploy-existing-ecs.sh"), "utf8"),
  );
  const dockerLog = path.join(root, "docker-invocations");
  await writeFile(
    path.join(binDirectory, "docker"),
    ["#!/usr/bin/env bash", `printf "%s\n" "$*" >> "${dockerLog}"`, "exit 0", ""].join("\n"),
    "utf8",
  );
  await chmod(path.join(binDirectory, "docker"), 0o755);
  await writeFile(
    path.join(root, ".env.production"),
    "ARK_API_KEY=ecs-key\r\nARK_MODEL=ecs-model\r\nAPP_AUTH_TOKEN=\r\n",
    "utf8",
  );

  const result = await run(
    path.join(root, "scripts", "deploy-existing-ecs.sh"),
    { PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}` },
    root,
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /APP_AUTH_TOKEN/u);
  const { access } = await import("node:fs/promises");
  await assert.rejects(access(dockerLog));
});

test("the existing-ECS deploy refuses a token the server itself would reject", async () => {
  // The script must apply the same floor as apps/server/src/config.ts and
  // deploy/volcengine/variables.tf, or it green-lights a deploy that then dies at
  // container start.
  for (const token of ["short", "replace-with-a-long-token-value"]) {
    const { root, binDirectory } = await fixture([
      "ARK_API_KEY=ecs-key",
      "ARK_MODEL=ecs-model",
      `APP_AUTH_TOKEN=${token}`,
    ]);

    const result = await run(
      path.join(root, "scripts", "deploy-existing-ecs.sh"),
      { PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}` },
      root,
    );

    assert.notEqual(result.code, 0, `expected ${token} to be refused`);
    assert.match(result.stderr, /APP_AUTH_TOKEN/u);
  }
});

test("the existing-ECS deploy accepts a configured APP_AUTH_TOKEN", async () => {
  const { root, binDirectory } = await fixture([
    "ARK_API_KEY=ecs-key",
    "ARK_MODEL=ecs-model",
    "APP_AUTH_TOKEN=an-explicitly-configured-deploy-token",
  ]);

  const result = await run(
    path.join(root, "scripts", "deploy-existing-ecs.sh"),
    { PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}` },
    root,
  );

  // It may still stop later for unrelated host reasons; it must not stop here.
  assert.doesNotMatch(result.stderr, /APP_AUTH_TOKEN/u);
});
