import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function executable(file, body) {
  await writeFile(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8");
  await chmod(file, 0o755);
}

async function deploymentFixture({ includeKey = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "shepherd-volcengine-deploy-"));
  temporaryDirectories.push(root);
  const bin = path.join(root, "bin");
  const log = path.join(root, "commands.log");
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(path.join(root, "deploy", "volcengine"), { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(
    path.join(root, "scripts", "deploy-volcengine.sh"),
    await readFile(path.join(repositoryRoot, "scripts", "deploy-volcengine.sh"), "utf8"),
  );
  await chmod(path.join(root, "scripts", "deploy-volcengine.sh"), 0o755);
  await writeFile(path.join(root, "deploy", "volcengine", "terraform.tfvars"), "region = \"fixture\"\n");
  await writeFile(
    path.join(root, ".env.production"),
    [
      "ARK_API_KEY=fixture-ark-secret-never-log",
      "ARK_MODEL=fixture-model",
      "APP_AUTH_TOKEN=fixture-auth-token-long-enough-2026",
      "PUBLIC_BIND_ADDR=0.0.0.0",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  const key = path.join(root, "fixture-key.pem");
  if (includeKey) await writeFile(key, "fixture private key placeholder\n", { mode: 0o600 });

  await executable(path.join(bin, "terraform"), `
if [[ -n "\${TF_VAR_ark_api_key:-}" || -n "\${TF_VAR_app_auth_token:-}" || -n "\${ARK_API_KEY:-}" || -n "\${APP_AUTH_TOKEN:-}" ]]; then
  echo "secret environment reached terraform" >&2
  exit 91
fi
printf 'terraform' >> "${log}"
printf ' <%s>' "$@" >> "${log}"
printf '\\n' >> "${log}"
if [[ "$*" == *"output -raw public_ip"* ]]; then printf '203.0.113.24'; fi
if [[ "$*" == *"output app_url"* ]]; then printf 'http://203.0.113.24\\n'; fi
  `);
  for (const command of ["ssh", "scp"]) {
    await executable(path.join(bin, command), `
printf '${command}' >> "${log}"
printf ' <%s>' "$@" >> "${log}"
printf '\\n' >> "${log}"
    `);
  }
  await executable(path.join(bin, "sleep"), ":");

  return { bin, key, log, root };
}

test("Terraform provisions infrastructure before secrets are delivered over SSH", async () => {
  const fixture = await deploymentFixture();
  const result = await execFileAsync("bash", ["scripts/deploy-volcengine.sh"], {
    cwd: fixture.root,
    env: {
      ...process.env,
      PATH: `${fixture.bin}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
      VOLCENGINE_ACCESS_KEY: "fixture-access-key",
      VOLCENGINE_SECRET_KEY: "fixture-secret-key",
      VOLCENGINE_SSH_PRIVATE_KEY: fixture.key,
      VOLCENGINE_SSH_USER: "ubuntu",
    },
  });
  const log = await readFile(fixture.log, "utf8");
  assert.match(log, /terraform <-chdir=deploy\/volcengine> <init>/u);
  assert.match(log, /terraform <-chdir=deploy\/volcengine> <apply>/u);
  assert.match(log, /scp .*<\.env\.production>.*<ubuntu@203\.0\.113\.24:\/tmp\/agent-launchpad\.env\.[0-9]+>/u);
  assert.match(log, /ssh .*cloud-init status --wait/u);
  assert.match(log, /ssh .*install .*0600.*deploy-existing-ecs\.sh/u);
  assert.equal(log.includes("fixture-ark-secret-never-log"), false);
  assert.equal(log.includes("fixture-auth-token-long-enough-2026"), false);
  assert.equal(result.stdout.includes("fixture-ark-secret-never-log"), false);
  assert.equal(result.stderr.includes("fixture-ark-secret-never-log"), false);
});

test("deployment refuses to provision without a readable SSH private key", async () => {
  const fixture = await deploymentFixture({ includeKey: false });
  await assert.rejects(
    execFileAsync("bash", ["scripts/deploy-volcengine.sh"], {
      cwd: fixture.root,
      env: {
        ...process.env,
        PATH: `${fixture.bin}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
        VOLCENGINE_ACCESS_KEY: "fixture-access-key",
        VOLCENGINE_SECRET_KEY: "fixture-secret-key",
        VOLCENGINE_SSH_PRIVATE_KEY: fixture.key,
      },
    }),
    (error) => {
      assert.match(String(error.stderr), /VOLCENGINE_SSH_PRIVATE_KEY/u);
      return true;
    },
  );
  await assert.rejects(readFile(fixture.log, "utf8"), { code: "ENOENT" });
});

test("Terraform and cloud-init sources contain no runtime credential variables", async () => {
  const files = [
    "deploy/volcengine/main.tf",
    "deploy/volcengine/variables.tf",
    "deploy/volcengine/cloud-init.yaml.tftpl",
  ];
  for (const file of files) {
    const source = await readFile(path.join(repositoryRoot, file), "utf8");
    assert.doesNotMatch(source, /ark_api_key|app_auth_token|runtime_env_b64|ARK_API_KEY|APP_AUTH_TOKEN/u);
  }
});
