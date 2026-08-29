import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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

test("runs the local PoC child when invoked through a symlinked launcher path", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ops-05-"));
  temporaryDirectories.push(temporaryDirectory);
  const scriptsDirectory = path.join(temporaryDirectory, "scripts");
  const capturePath = path.join(temporaryDirectory, "child-ran");
  await mkdir(scriptsDirectory);
  await Promise.all([
    readFile(path.join(repositoryRoot, "scripts", "start-local-poc-launcher.mjs"), "utf8").then(
      (contents) => writeFile(path.join(scriptsDirectory, "start-local-poc-launcher.mjs"), contents),
    ),
    writeFile(
      path.join(scriptsDirectory, "start-local-poc.sh"),
      `#!/usr/bin/env bash\nprintf "child-ran\\n" > "$OPS_05_CAPTURE"\n`,
      "utf8",
    ),
  ]);
  await Promise.all([
    chmod(path.join(scriptsDirectory, "start-local-poc.sh"), 0o755),
    symlink(
      path.join(scriptsDirectory, "start-local-poc-launcher.mjs"),
      path.join(scriptsDirectory, "launcher-alias.mjs"),
    ),
  ]);

  const result = await run(process.execPath, [path.join(scriptsDirectory, "launcher-alias.mjs")], {
    cwd: temporaryDirectory,
    env: { OPS_05_CAPTURE: capturePath },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(await readFile(capturePath, "utf8"), "child-ran\n");
});

test("direct shell launch reads dotenv and localizes Docker-default data paths", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ops-02-"));
  temporaryDirectories.push(temporaryDirectory);
  const scriptsDirectory = path.join(temporaryDirectory, "scripts");
  const binDirectory = path.join(temporaryDirectory, "bin");
  const capturePath = path.join(temporaryDirectory, "startup-environment");
  const homeDirectory = path.join(temporaryDirectory, "home");
  const localStateRoot =
    process.platform === "darwin"
      ? path.join(homeDirectory, ".volc-agent-launchpad")
      : path.join(temporaryDirectory, ".local");
  const arkKeySentinel = "ops-02-ark-key-sentinel";
  const arkModelSentinel = "ops-02-ark-model-sentinel";
  await Promise.all([mkdir(scriptsDirectory), mkdir(binDirectory)]);
  await Promise.all([
    readFile(path.join(repositoryRoot, "scripts", "start-local-poc.sh"), "utf8").then(
      (contents) => writeFile(path.join(scriptsDirectory, "start-local-poc.sh"), contents),
    ),
    readFile(path.join(repositoryRoot, "scripts", "start-local-poc-launcher.mjs"), "utf8").then(
      (contents) => writeFile(path.join(scriptsDirectory, "start-local-poc-launcher.mjs"), contents),
    ),
  ]);
  await writeFile(
    path.join(temporaryDirectory, ".env"),
    [
      `ARK_API_KEY=${arkKeySentinel}`,
      `ARK_MODEL=${arkModelSentinel}`,
      "HOST=0.0.0.0",
      "APP_DATA_DIR=/app/data",
      "AGENT_WORKSPACE_ROOT=/app/workspaces",
      "CODEX_HOME=/app/codex-home",
      "SHEPHERD_ROOT=/app/data/shepherd",
      "SHEPHERD_CODEX_HOME_ROOT=/app/data/shepherd-codex-homes",
      "CONTAINER_ENGINE=docker",
      "",
    ].join("\n"),
    "utf8",
  );
  const fakeDockerPath = path.join(binDirectory, "docker");
  await writeFile(fakeDockerPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  const fakeNpmPath = path.join(binDirectory, "npm");
  await writeFile(
    fakeNpmPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ "${1:-}" == "start" ]]; then',
      "  {",
      '    printf "%s\\n" "${ARK_API_KEY:-}"',
      '    printf "%s\\n" "${ARK_MODEL:-}"',
      '    printf "%s\\n" "${APP_DATA_DIR:-}"',
      '    printf "%s\\n" "${AGENT_WORKSPACE_ROOT:-}"',
      '    printf "%s\\n" "${CODEX_HOME:-}"',
      '    printf "%s\\n" "${SHEPHERD_ROOT:-}"',
      '    printf "%s\\n" "${SHEPHERD_CODEX_HOME_ROOT:-}"',
      '    printf "%s\\n" "${HOST:-}"',
      '  } > "$OPS_02_CAPTURE"',
      "fi",
      "",
    ].join("\n"),
    "utf8",
  );
  await Promise.all([
    chmod(path.join(scriptsDirectory, "start-local-poc.sh"), 0o755),
    chmod(fakeDockerPath, 0o755),
    chmod(fakeNpmPath, 0o755),
  ]);

  const result = await run(path.join(scriptsDirectory, "start-local-poc.sh"), [], {
    cwd: temporaryDirectory,
    env: {
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: homeDirectory,
      OPS_02_CAPTURE: capturePath,
    },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.doesNotMatch(result.stdout, new RegExp(arkKeySentinel, "u"));
  assert.doesNotMatch(result.stderr, new RegExp(arkKeySentinel, "u"));
  assert.doesNotMatch(result.stdout, new RegExp(arkModelSentinel, "u"));
  assert.doesNotMatch(result.stderr, new RegExp(arkModelSentinel, "u"));
  assert.deepEqual((await readFile(capturePath, "utf8")).trim().split("\n"), [
    arkKeySentinel,
    arkModelSentinel,
    path.join(localStateRoot, "data"),
    path.join(localStateRoot, "workspaces"),
    path.join(localStateRoot, "codex-home"),
    path.join(localStateRoot, "data", "shepherd"),
    path.join(localStateRoot, "data", "shepherd-codex-homes"),
    "127.0.0.1",
  ]);

  const customPaths = [
    path.join(temporaryDirectory, "custom", "data"),
    path.join(temporaryDirectory, "custom", "workspaces"),
    path.join(temporaryDirectory, "custom", "codex-home"),
    path.join(temporaryDirectory, "custom", "shepherd"),
    path.join(temporaryDirectory, "custom", "shepherd-codex-homes"),
  ];
  await writeFile(
    path.join(temporaryDirectory, ".env"),
    [
      `ARK_API_KEY=${arkKeySentinel}`,
      `ARK_MODEL=${arkModelSentinel}`,
      "HOST=0.0.0.0",
      `APP_DATA_DIR=${customPaths[0]}`,
      `AGENT_WORKSPACE_ROOT=${customPaths[1]}`,
      `CODEX_HOME=${customPaths[2]}`,
      `SHEPHERD_ROOT=${customPaths[3]}`,
      `SHEPHERD_CODEX_HOME_ROOT=${customPaths[4]}`,
      "CONTAINER_ENGINE=docker",
      "",
    ].join("\n"),
    "utf8",
  );
  const customResult = await run(path.join(scriptsDirectory, "start-local-poc.sh"), [], {
    cwd: temporaryDirectory,
    env: {
      PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: homeDirectory,
      OPS_02_CAPTURE: capturePath,
    },
  });

  assert.equal(customResult.code, 0, customResult.stderr);
  assert.deepEqual(
    (await readFile(capturePath, "utf8")).trim().split("\n").slice(2, 7),
    customPaths,
  );

  for (const [configuredHost, expectedHost] of [
    ["", "127.0.0.1"],
    ["::", "127.0.0.1"],
    ["192.0.2.10", "192.0.2.10"],
  ]) {
    await writeFile(
      path.join(temporaryDirectory, ".env"),
      [
        `ARK_API_KEY=${arkKeySentinel}`,
        `ARK_MODEL=${arkModelSentinel}`,
        `HOST=${configuredHost}`,
        `APP_DATA_DIR=${customPaths[0]}`,
        `AGENT_WORKSPACE_ROOT=${customPaths[1]}`,
        `CODEX_HOME=${customPaths[2]}`,
        `SHEPHERD_ROOT=${customPaths[3]}`,
        `SHEPHERD_CODEX_HOME_ROOT=${customPaths[4]}`,
        "CONTAINER_ENGINE=docker",
        "",
      ].join("\n"),
      "utf8",
    );
    const hostResult = await run(path.join(scriptsDirectory, "start-local-poc.sh"), [], {
      cwd: temporaryDirectory,
      env: {
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
        HOME: homeDirectory,
        OPS_02_CAPTURE: capturePath,
      },
    });

    assert.equal(hostResult.code, 0, hostResult.stderr);
    assert.equal((await readFile(capturePath, "utf8")).trim().split("\n").at(-1), expectedHost);
  }
});
