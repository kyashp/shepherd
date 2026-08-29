import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("forwards Node-parsed dotenv values to the local PoC child without logging them", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ops-01-"));
  temporaryDirectories.push(temporaryDirectory);
  const scriptsDirectory = path.join(temporaryDirectory, "scripts");
  const arkKeySentinel = "ops-01-ark-key-sentinel";
  const arkModelSentinel = "ops-01-ark-model-sentinel";
  await mkdir(scriptsDirectory);
  await Promise.all([
    readFile(path.join(repositoryRoot, "package.json"), "utf8").then((contents) =>
      writeFile(path.join(temporaryDirectory, "package.json"), contents),
    ),
    readFile(path.join(repositoryRoot, "scripts", "start-local-poc-launcher.mjs"), "utf8").then(
      (contents) => writeFile(path.join(scriptsDirectory, "start-local-poc-launcher.mjs"), contents),
    ),
  ]);
  await writeFile(
    path.join(temporaryDirectory, ".env"),
    `ARK_API_KEY=${arkKeySentinel}\nARK_MODEL=${arkModelSentinel}\n`,
    "utf8",
  );
  const childPath = path.join(scriptsDirectory, "start-local-poc.sh");
  await writeFile(
    childPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `[[ \"${"${ARK_API_KEY:-}"}\" == \"${arkKeySentinel}\" ]] || exit 2`,
      `[[ \"${"${ARK_MODEL:-}"}\" == \"${arkModelSentinel}\" ]] || exit 3`,
      'printf "child-received-dotenv-values\\n"',
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(childPath, 0o755);

  const result = await run("npm", ["run", "poc"], {
    cwd: temporaryDirectory,
    env: { PATH: process.env.PATH ?? "" },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /child-received-dotenv-values/u);
  assert.doesNotMatch(result.stdout, new RegExp(arkKeySentinel, "u"));
  assert.doesNotMatch(result.stderr, new RegExp(arkKeySentinel, "u"));
  assert.doesNotMatch(result.stdout, new RegExp(arkModelSentinel, "u"));
  assert.doesNotMatch(result.stderr, new RegExp(arkModelSentinel, "u"));
});
