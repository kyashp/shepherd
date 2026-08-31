import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classify, resolveComposeAuthToken } from "./check-deploy-auth-token.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

async function envFile(body) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ecs-auth-"));
  temporaryDirectories.push(root);
  const file = path.join(root, ".env.production");
  await writeFile(file, "ARK_API_KEY=k\nARK_MODEL=m\n" + body, "utf8");
  return file;
}

// The rule must match apps/server/src/config.ts, or a deploy is approved here and
// then rejected at container start.
test("classify applies the server's own token rule", () => {
  assert.equal(classify(undefined), "empty");
  assert.equal(classify(""), "empty");
  assert.equal(classify("   "), "empty");
  assert.equal(classify("\r"), "empty");
  assert.equal(classify("has spaces and/slashes are not url safe"), "shape");
  assert.equal(classify("short"), "weak");
  assert.equal(classify("replace-me-with-a-real-token"), "weak");
  assert.equal(classify("REPLACE-ME-WITH-A-REAL-TOKEN-UPPER"), "weak");
  assert.equal(classify("abcdefghijklmnopqrstuvw"), "weak", "23 characters is below the floor");
  assert.equal(classify("abcdefghijklmnopqrstuvwx"), "ok", "24 characters is the floor");
  assert.equal(classify("an-actually-valid-deploy-token-value"), "ok");
});

const composeAvailable = (await resolveComposeAuthToken(
  path.join(repositoryRoot, ".env.example"),
  path.join(repositoryRoot, "docker-compose.yml"),
)).status !== "unreadable";

// These shapes all defeat a shell parse of the environment file while Compose
// resolves them to an empty or unusable value. Resolving through Compose is the
// only way the check and the container agree.
test("Compose resolution rejects every shape a shell parse would approve", {
  skip: composeAvailable ? false : "docker compose unavailable",
}, async () => {
  const cases = [
    ["a later `export` line blanking the value", "APP_AUTH_TOKEN=a-genuine-looking-token-value\nexport APP_AUTH_TOKEN=\n"],
    ["a later indented line blanking the value", "APP_AUTH_TOKEN=a-genuine-looking-token-value\n  APP_AUTH_TOKEN=\n"],
    ["a quoted run of spaces", 'APP_AUTH_TOKEN="                      "\n'],
    ["an undefined interpolation", "APP_AUTH_TOKEN=${UNDEFINED_LONG_VARIABLE_NAME_PAD}\n"],
    ["a trailing comment padding the line length", "APP_AUTH_TOKEN= # padding-past-24-chars-here\n"],
    ["a CRLF empty value", "APP_AUTH_TOKEN=\r\n"],
  ];
  for (const [name, body] of cases) {
    const { status } = await resolveComposeAuthToken(
      await envFile(body),
      path.join(repositoryRoot, "docker-compose.yml"),
    );
    assert.notEqual(status, "ok", `expected ${name} to be refused`);
  }
});

test("Compose resolution strips quotes before applying the floor", {
  skip: composeAvailable ? false : "docker compose unavailable",
}, async () => {
  const quoted = await resolveComposeAuthToken(
    await envFile('APP_AUTH_TOKEN="abcdefghijklmnopqrstuvw"\n'),
    path.join(repositoryRoot, "docker-compose.yml"),
  );
  // A shell parse counts the quotes and sees 25 characters; Compose delivers 23.
  assert.equal(quoted.status, "weak");

  const placeholder = await resolveComposeAuthToken(
    await envFile('APP_AUTH_TOKEN="replace-me-with-a-real-token"\n'),
    path.join(repositoryRoot, "docker-compose.yml"),
  );
  assert.equal(placeholder.status, "weak");
});

test("Compose resolution accepts a genuine token", {
  skip: composeAvailable ? false : "docker compose unavailable",
}, async () => {
  const { status } = await resolveComposeAuthToken(
    await envFile("APP_AUTH_TOKEN=an-actually-valid-deploy-token-value\n"),
    path.join(repositoryRoot, "docker-compose.yml"),
  );
  assert.equal(status, "ok");
});

const execFileAsync = promisify(execFile);

// The module-level tests above import the checker directly, so they cannot see
// whether its CLI entry point actually runs. It is guarded by a main-module
// comparison, and that guard is where a silent no-op hides.
test("the checker CLI refuses an empty token from a directory whose name needs escaping", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "ecs-cli-"));
  temporaryDirectories.push(parent);
  // A space, a hash and a non-ASCII character all percent-encode in a file URL.
  const awkward = path.join(parent, "My Deploy Repo #1 \u00e9");
  await mkdir(path.join(awkward, "scripts"), { recursive: true });
  const { readFile, copyFile } = await import("node:fs/promises");
  for (const name of ["check-deploy-auth-token.mjs"]) {
    await copyFile(path.join(repositoryRoot, "scripts", name), path.join(awkward, "scripts", name));
  }
  await writeFile(
    path.join(awkward, "docker-compose.yml"),
    await readFile(path.join(repositoryRoot, "docker-compose.yml"), "utf8"),
  );
  const envFile = path.join(awkward, ".env.production");
  await writeFile(envFile, "ARK_API_KEY=k\nARK_MODEL=m\nAPP_AUTH_TOKEN=\n", "utf8");

  let code = 0;
  let stderr = "";
  try {
    await execFileAsync(process.execPath, [path.join(awkward, "scripts", "check-deploy-auth-token.mjs"), envFile], { cwd: awkward });
  } catch (error) {
    code = error.code ?? 1;
    stderr = String(error.stderr ?? "");
  }
  assert.notEqual(code, 0, "the CLI must refuse, not silently succeed");
  assert.match(stderr, /APP_AUTH_TOKEN/u);
});

// The documented quickstart is `docker compose up --build` against this file, with
// APP_AUTH_TOKEN empty by default. If the port publishes on every interface, that
// quickstart exposes prompt-driven command execution unauthenticated.
test("the base compose profile publishes on loopback by default", {
  skip: composeAvailable ? false : "docker compose unavailable",
}, async () => {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "--env-file", path.join(repositoryRoot, ".env.example"),
     "--file", path.join(repositoryRoot, "docker-compose.yml"), "config", "--format", "json"],
    // The compose file declares `env_file: ${LAUNCHPAD_ENV_FILE:-.env}`, and a clean
    // checkout has no `.env`. Point it at the shipped example so this asserts the
    // shipped defaults rather than whatever the developer happens to have locally.
    { cwd: repositoryRoot,
      env: { ...process.env, LAUNCHPAD_ENV_FILE: path.join(repositoryRoot, ".env.example") },
      maxBuffer: 16 * 1024 * 1024 },
  );
  const service = JSON.parse(stdout).services.launchpad;
  for (const published of service.ports ?? []) {
    assert.equal(published.host_ip, "127.0.0.1",
      `published port ${published.target} must default to loopback, got ${published.host_ip ?? "<all interfaces>"}`);
  }
  assert.ok((service.ports ?? []).length > 0, "expected a published port to assert on");
});

// The sibling profile already does this; the base one must not be the soft path.
test("an operator can still opt in to a public bind", {
  skip: composeAvailable ? false : "docker compose unavailable",
}, async () => {
  const { stdout } = await execFileAsync(
    "docker",
    ["compose", "--env-file", path.join(repositoryRoot, ".env.example"),
     "--file", path.join(repositoryRoot, "docker-compose.yml"), "config", "--format", "json"],
    { cwd: repositoryRoot,
      env: { ...process.env, PUBLIC_BIND_ADDR: "0.0.0.0",
             LAUNCHPAD_ENV_FILE: path.join(repositoryRoot, ".env.example") },
      maxBuffer: 16 * 1024 * 1024 },
  );
  const service = JSON.parse(stdout).services.launchpad;
  assert.equal((service.ports ?? [])[0]?.host_ip, "0.0.0.0");
});
