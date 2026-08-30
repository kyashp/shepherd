#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const safeName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const safeTarget = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u;
const allowedChecks = new Set([
  "checks/frontend.cjs",
  "checks/backend.cjs",
  "checks/project-security.cjs",
  "checks/general-contract.cjs",
]);
const stateRoot = path.join(process.env.HOME ?? "", ".fake-container-engine");
const containerRoot = path.join(stateRoot, "containers");
const occurrenceRoot = path.join(stateRoot, "occurrences");
const gateRoot = path.join(stateRoot, "gates");
const ledgerPath = path.join(stateRoot, "ledger.jsonl");

function fail(message = "unsupported operation") {
  process.stderr.write(`fake-container-engine: ${message}\n`);
  process.exit(2);
}

function ensureState() {
  if (!process.env.HOME || !path.isAbsolute(process.env.HOME)) fail("HOME must be absolute");
  mkdirSync(containerRoot, { recursive: true, mode: 0o700 });
  mkdirSync(occurrenceRoot, { recursive: true, mode: 0o700 });
  mkdirSync(gateRoot, { recursive: true, mode: 0o700 });
}

function record(operation, details = {}) {
  ensureState();
  const line = JSON.stringify({ operation, timestamp: new Date().toISOString(), ...details });
  if (Buffer.byteLength(line, "utf8") > 4_096) fail("ledger entry exceeded bound");
  appendFileSync(ledgerPath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
}

function containerFile(name) {
  if (!safeName.test(name)) fail("unsafe container name");
  return path.join(containerRoot, `${name}.json`);
}

function take(args, expected) {
  if (args.shift() !== expected) fail(`expected ${expected}`);
}

function takeValue(args, flag) {
  take(args, flag);
  const value = args.shift();
  if (value === undefined || value.includes("\0") || /[\r\n]/u.test(value)) fail(`invalid ${flag}`);
  return value;
}

function nextOccurrence(target, check) {
  const directory = path.join(occurrenceRoot, target, check.replaceAll("/", "_"));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (let value = 1; value <= 8; value += 1) {
    try {
      const descriptor = openSync(path.join(directory, String(value)), "wx", 0o600);
      closeSync(descriptor);
      return value;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  fail("verification occurrence exceeded bound");
}

function parseCreate(input) {
  const args = [...input];
  take(args, "create");
  take(args, "--init");
  const name = takeValue(args, "--name");
  take(args, "--label");
  take(args, "io.codejam.shepherd=independent-verifier");
  take(args, "--label");
  const targetLabel = args.shift() ?? "";
  const targetPrefix = "io.codejam.verification-target=";
  if (!targetLabel.startsWith(targetPrefix)) fail("invalid verification target label");
  const target = targetLabel.slice(targetPrefix.length);
  if (!safeTarget.test(target)) fail("unsafe verification target");
  take(args, "--label");
  const ownerLabel = args.shift() ?? "";
  if (!/^io\.codejam\.verifier-owner=[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u.test(ownerLabel)) fail("invalid verifier owner label");
  take(args, "--network");
  take(args, "none");
  take(args, "--read-only");
  take(args, "--security-opt");
  take(args, "no-new-privileges");
  take(args, "--cap-drop");
  take(args, "ALL");
  const cpus = takeValue(args, "--cpus");
  if (!/^\d+(?:\.\d+)?$/u.test(cpus) || Number(cpus) <= 0 || Number(cpus) > 16) fail("invalid CPU bound");
  const memory = takeValue(args, "--memory");
  if (!/^\d+(?:[kmgt]i?b?)?$/iu.test(memory)) fail("invalid memory bound");
  const pids = takeValue(args, "--pids-limit");
  if (!/^\d+$/u.test(pids) || Number(pids) < 1 || Number(pids) > 4_096) fail("invalid PID bound");
  const user = takeValue(args, "--user");
  if (!/^\d+(?::\d+)?$/u.test(user) || user === "0" || user.startsWith("0:")) fail("verifier must be non-root");
  const mount = takeValue(args, "--mount");
  const match = /^type=bind,src=([^,]+),dst=\/workspace,readonly$/u.exec(mount);
  if (!match || !path.isAbsolute(match[1])) fail("invalid readonly workspace mount");
  const source = path.resolve(match[1]);
  const tmpfs = takeValue(args, "--tmpfs");
  if (!/^\/tmp:rw,noexec,nosuid,nodev,size=\d+(?:[kmgt]i?b?)?$/iu.test(tmpfs)) fail("invalid tmpfs");
  const workdir = takeValue(args, "--workdir");
  if (workdir !== "/workspace" && !/^\/workspace\/[A-Za-z0-9._/-]+$/u.test(workdir)) fail("invalid workdir");
  take(args, "--entrypoint");
  take(args, "/usr/bin/env");
  if (args.shift() !== "fixture.invalid/shepherd:deterministic") fail("unexpected verifier image");
  take(args, "-i");
  for (const variable of ["HOME=/tmp", "TMPDIR=/tmp", "NO_COLOR=1", "CI=1", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"]) take(args, variable);
  take(args, "node");
  const check = args.shift();
  if (!check || !allowedChecks.has(check)) fail("untrusted verification command");
  if (args.length !== 0) fail("unexpected verification arguments");
  const relativeWorkdir = workdir.slice("/workspace".length).replace(/^\//u, "");
  const cwd = relativeWorkdir ? path.join(source, relativeWorkdir) : source;
  const relative = path.relative(source, cwd);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("workdir escaped mount");
  return { name, target, source, cwd, check, occurrence: nextOccurrence(target, check) };
}

function gateFor(metadata) {
  const allGatesEnabled = existsSync(path.join(gateRoot, "enabled"));
  const candidateGateEnabled = allGatesEnabled || existsSync(path.join(gateRoot, "candidates-enabled"));
  if (!allGatesEnabled && !candidateGateEnabled) return null;
  if (allGatesEnabled && metadata.target.startsWith("contract-")) return "contracts";
  if (candidateGateEnabled && metadata.target.startsWith("candidate-") && metadata.check === "checks/frontend.cjs") {
    return metadata.occurrence === 1 ? "candidates" : metadata.occurrence === 2 ? "promotion" : null;
  }
  return null;
}

async function waitForGate(gate) {
  if (!gate) return;
  const release = path.join(gateRoot, `${gate}.release`);
  const deadline = Date.now() + 20_000;
  while (!existsSync(release)) {
    if (Date.now() >= deadline) fail(`gate ${gate} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function create() {
  ensureState();
  const metadata = parseCreate(argv);
  try {
    writeFileSync(containerFile(metadata.name), JSON.stringify(metadata), { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") fail("container already exists");
    throw error;
  }
  record("create", { name: metadata.name, target: metadata.target, check: metadata.check, occurrence: metadata.occurrence, network: "none", readOnly: true });
}

async function start() {
  if (argv.length !== 3 || argv[0] !== "start" || argv[1] !== "--attach") fail();
  const name = argv[2];
  const metadata = JSON.parse(readFileSync(containerFile(name), "utf8"));
  const gate = gateFor(metadata);
  record("start", { name, target: metadata.target, check: metadata.check, occurrence: metadata.occurrence, gate });
  await waitForGate(gate);
  const sandboxHome = path.join(stateRoot, "sandbox-home");
  const sandboxTmp = path.join(stateRoot, "sandbox-tmp");
  mkdirSync(sandboxHome, { recursive: true, mode: 0o700 });
  mkdirSync(sandboxTmp, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [metadata.check], {
    cwd: metadata.cwd,
    env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C", HOME: sandboxHome, TMPDIR: sandboxTmp, NO_COLOR: "1", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let outputBytes = 0;
  const limit = 65_536;
  const forward = (stream, destination) => stream.on("data", (chunk) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > limit) child.kill("SIGKILL");
    else destination.write(chunk);
  });
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);
  const code = await new Promise((resolve) => {
    child.once("error", () => resolve(127));
    child.once("close", (value) => resolve(value ?? 127));
  });
  record("complete", { name, target: metadata.target, check: metadata.check, occurrence: metadata.occurrence, code, outputExceeded: outputBytes > limit });
  process.exit(outputBytes > limit ? 125 : code);
}

function remove() {
  if (argv.length !== 3 || argv[0] !== "rm" || argv[1] !== "--force") fail();
  const name = argv[2];
  rmSync(containerFile(name), { force: true });
  record("remove", { name });
}

function listOwned() {
  if (argv[0] !== "ps" || argv.length !== 7 || !argv.includes("--all") || !argv.includes("--quiet") || argv.filter((value) => value === "--filter").length !== 2 || !argv.some((value) => value === "label=io.codejam.shepherd=independent-verifier") || !argv.some((value) => /^label=io\.codejam\.verifier-owner=[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u.test(value))) fail();
  record("ps");
}

try {
  if (argv[0] === "create") await create();
  else if (argv[0] === "start") await start();
  else if (argv[0] === "rm") remove();
  else if (argv[0] === "ps") listOwned();
  else fail();
} catch {
  process.stderr.write("fake-container-engine: fixture failure\n");
  process.exitCode = 2;
}
