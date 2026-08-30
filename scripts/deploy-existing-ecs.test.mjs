import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
