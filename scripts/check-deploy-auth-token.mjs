#!/usr/bin/env node
// Resolves APP_AUTH_TOKEN exactly as Docker Compose will deliver it to the
// container, then applies the same rule as apps/server/src/config.ts.
//
// The value is read back through Compose rather than parsed here on purpose. A
// second parser diverges from compose-go's dotenv handling of `export`, leading
// whitespace, quoting, escape sequences, multi-line values and ${VAR}
// interpolation, and every divergence is a chance either to approve a token the
// container never receives or to reject one it would have accepted.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function classify(value) {
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length === 0) return "empty";
  if (!/^[A-Za-z0-9._~-]+$/u.test(token)) return "shape";
  if (token.length < 24 || /^replace-/iu.test(token)) return "weak";
  return "ok";
}

export async function resolveComposeAuthToken(envFile, composeFile = "docker-compose.yml") {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "docker",
      ["compose", "--env-file", envFile, "--file", composeFile, "config", "--format", "json"],
      { env: { ...process.env, LAUNCHPAD_ENV_FILE: envFile }, maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch {
    return { status: "unreadable", value: undefined };
  }
  try {
    const config = JSON.parse(stdout);
    const service = Object.values(config.services ?? {})[0] ?? {};
    const value = (service.environment ?? {}).APP_AUTH_TOKEN;
    return { status: classify(value), value };
  } catch {
    return { status: "unreadable", value: undefined };
  }
}

const MESSAGES = {
  empty: (f) => [
    `APP_AUTH_TOKEN resolves to an empty value for ${f}.`,
    "This profile publishes the Agent execution API on every interface.",
  ],
  shape: (f) => [`APP_AUTH_TOKEN in ${f} must use URL-safe characters only.`],
  weak: (f) => [`APP_AUTH_TOKEN in ${f} must be 24+ non-placeholder characters.`],
  unreadable: (f) => [`Could not resolve APP_AUTH_TOKEN through docker compose for ${f}.`],
};

// Comparing `import.meta.url` against "file://" + a raw path is not sound: a space,
// `#` or any non-ASCII character percent-encodes in the URL, and on macOS the
// filesystem reports names in NFD while an argument is typically NFC — so even a
// correctly built file URL can compare unequal. Either way the guard silently
// becomes a no-op that exits 0 and lets an unauthenticated deploy through.
// Resolving both sides through the filesystem removes encoding and normalization
// from the comparison entirely.
const invokedPath = process.argv[1];
const thisFile = await realpath(import.meta.filename).catch(() => null);
const invokedFile = invokedPath
  ? await realpath(invokedPath).catch(() => null)
  : null;
if (thisFile !== null && thisFile === invokedFile) {
  const envFile = process.argv[2];
  if (!envFile) {
    process.stderr.write("usage: check-deploy-auth-token.mjs <env-file>\n");
    process.exit(2);
  }
  const { status } = await resolveComposeAuthToken(envFile);
  if (status !== "ok") {
    for (const line of MESSAGES[status](envFile)) process.stderr.write(line + "\n");
    process.exit(1);
  }
}
