import assert from "node:assert/strict";
import test from "node:test";
import {
  TERRAFORM_IMAGE,
  buildTerraformValidationPlan,
} from "./validate-terraform.mjs";

test("local Terraform validation runs format, isolated init, and validate", () => {
  assert.deepEqual(buildTerraformValidationPlan({
    mode: "local",
    moduleDirectory: "/tmp/shepherd-terraform",
  }), [
    { command: "terraform", args: ["fmt", "-check", "-recursive", "."], cwd: "/tmp/shepherd-terraform" },
    { command: "terraform", args: ["init", "-backend=false", "-input=false"], cwd: "/tmp/shepherd-terraform" },
    { command: "terraform", args: ["validate", "-no-color"], cwd: "/tmp/shepherd-terraform" },
  ]);
});

test("Docker fallback pins Terraform and mounts only the disposable module", () => {
  assert.equal(TERRAFORM_IMAGE, "hashicorp/terraform:1.9.8");
  const plan = buildTerraformValidationPlan({
    mode: "docker",
    moduleDirectory: "/tmp/shepherd-terraform",
    uid: 501,
    gid: 20,
  });
  assert.equal(plan.length, 3);
  for (const step of plan) {
    assert.equal(step.command, "docker");
    assert.deepEqual(step.args.slice(0, 10), [
      "run", "--rm", "--user", "501:20",
      "--volume", "/tmp/shepherd-terraform:/workspace",
      "--workdir", "/workspace", TERRAFORM_IMAGE,
      step.args[9],
    ]);
    assert.equal(step.cwd, undefined);
    assert.equal(step.args.some((argument) => argument.includes("ARK_API_KEY")), false);
  }
  assert.deepEqual(plan.map((step) => step.args.slice(9)), [
    ["fmt", "-check", "-recursive", "."],
    ["init", "-backend=false", "-input=false"],
    ["validate", "-no-color"],
  ]);
});

test("validation refuses unsupported execution modes", () => {
  assert.throws(
    () => buildTerraformValidationPlan({ mode: "remote", moduleDirectory: "/tmp/module" }),
    /Unsupported Terraform validation mode/u,
  );
});
