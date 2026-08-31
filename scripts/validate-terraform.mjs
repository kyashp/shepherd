#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TERRAFORM_IMAGE = "hashicorp/terraform:1.9.8";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const sourceModule = path.join(repositoryRoot, "deploy", "volcengine");
const tempRoot = path.join(repositoryRoot, ".tmp");

const terraformArguments = [
  ["fmt", "-check", "-recursive", "."],
  ["init", "-backend=false", "-input=false"],
  ["validate", "-no-color"],
];

export function buildTerraformValidationPlan({ mode, moduleDirectory, uid, gid }) {
  if (mode === "local") {
    return terraformArguments.map((args) => ({
      command: "terraform",
      args,
      cwd: moduleDirectory,
    }));
  }
  if (mode === "docker") {
    const user = `${uid ?? 1000}:${gid ?? 1000}`;
    return terraformArguments.map((args) => ({
      command: "docker",
      args: [
        "run", "--rm",
        "--user", user,
        "--volume", `${moduleDirectory}:/workspace`,
        "--workdir", "/workspace",
        TERRAFORM_IMAGE,
        ...args,
      ],
      cwd: undefined,
    }));
  }
  throw new Error(`Unsupported Terraform validation mode: ${mode}`);
}

async function commandSucceeds(command, args) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.once("error", () => resolve(false));
    child.once("exit", (code, signal) => resolve(signal === null && code === 0));
  });
}

function secretFreeEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    "ARK_API_KEY",
    "ARK_MODEL",
    "ARK_BASE_URL",
    "APP_AUTH_TOKEN",
    "TF_VAR_ark_api_key",
    "TF_VAR_ark_model",
    "TF_VAR_ark_base_url",
    "TF_VAR_app_auth_token",
  ]) {
    delete environment[name];
  }
  return environment;
}

async function runStep({ command, args, cwd }) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: secretFreeEnvironment(),
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) reject(new Error(`${command} stopped with ${signal}`));
      else resolve(exitCode ?? 1);
    });
  });
  if (code !== 0) throw new Error(`${command} Terraform validation step failed`);
}

async function main() {
  await mkdir(tempRoot, { recursive: true, mode: 0o700 });
  const validationRoot = await mkdtemp(path.join(tempRoot, "terraform-validation-"));
  const moduleDirectory = path.join(validationRoot, "module");
  try {
    await cp(sourceModule, moduleDirectory, { recursive: true });
    const mode = await commandSucceeds("terraform", ["version"])
      ? "local"
      : await commandSucceeds("docker", ["version"])
        ? "docker"
        : null;
    if (!mode) throw new Error("Terraform validation requires Terraform or Docker");
    const plan = buildTerraformValidationPlan({
      mode,
      moduleDirectory,
      uid: typeof process.getuid === "function" ? process.getuid() : 1000,
      gid: typeof process.getgid === "function" ? process.getgid() : 1000,
    });
    for (const step of plan) await runStep(step);
    console.log(`Terraform validation passed with ${mode}.`);
  } finally {
    await rm(validationRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
