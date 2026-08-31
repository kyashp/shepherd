import assert from "node:assert/strict";
import test from "node:test";
import {
  liveControllerRunArgs,
  runLiveRuntimeGate,
} from "./run-live-runtime-gate.mjs";

const canary = "live-runtime-secret-canary-827364";

test("controller invocation uses one named volume and forwards credentials by name only", () => {
  const args = liveControllerRunArgs({
    containerName: "shepherd-live-controller-test",
    controllerImage: "shepherd-live-controller:test",
    runtimeImage: "shepherd-live-runtime:test",
    volumeName: "shepherd-live-state-test",
  });
  assert.deepEqual(args.slice(0, 2), ["run", "--name"]);
  assert.ok(args.includes("--group-add"));
  assert.ok(args.includes("1000:1000"));
  assert.ok(args.includes("type=volume,src=shepherd-live-state-test,dst=/app/state"));
  assert.ok(args.includes("type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock"));
  for (const name of ["ARK_API_KEY", "ARK_MODEL", "ARK_BASE_URL", "SHEPHERD_MODEL", "APP_AUTH_TOKEN"]) {
    const index = args.findIndex((value, offset) => value === "--env" && args[offset + 1] === name);
    assert.notEqual(index, -1, `${name} is forwarded by environment name`);
  }
  assert.doesNotMatch(JSON.stringify(args), new RegExp(canary, "u"));
});

test("one failed live attempt still removes only its unique container, volume, and images", async () => {
  const calls = [];
  const execute = async (args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === "run") throw new Error("bounded live failure");
  };
  await assert.rejects(
    runLiveRuntimeGate({
      environment: {
        SHEPHERD_LIVE_TEST: "true",
        ARK_API_KEY: canary,
        ARK_MODEL: "ep-test",
      },
      execute,
      repositoryRoot: "/bounded/repository",
      suffix: "unit",
    }),
    /bounded live failure/u,
  );
  assert.equal(calls.filter(({ args }) => args[0] === "run").length, 1);
  assert.equal(calls.filter(({ args }) => args[0] === "volume" && args[1] === "create").length, 1);
  assert.equal(calls.filter(({ args }) => args[0] === "rm" && args[1] === "--force").length, 1);
  assert.equal(calls.filter(({ args }) => args[0] === "volume" && args[1] === "rm").length, 1);
  assert.equal(calls.filter(({ args }) => args[0] === "image" && args[1] === "rm").length, 1);
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(canary, "u"));
});

test("list mode validates the disposable controller without requiring or exporting credentials", async () => {
  const calls = [];
  await runLiveRuntimeGate({
    environment: { SHEPHERD_LIVE_TEST: "true" },
    execute: async (args, options = {}) => { calls.push({ args, options }); },
    mode: "list",
    repositoryRoot: "/bounded/repository",
    suffix: "preflight",
  });
  const run = calls.find(({ args }) => args[0] === "run")?.args;
  assert.deepEqual(run?.slice(-4), [
    "node",
    "scripts/run-live-vitest.mjs",
    "runtime",
    "list",
  ]);
  assert.equal(run?.some((value, index) => value === "--env" && forwardedSecretNames.has(run[index + 1])), false);
});

const forwardedSecretNames = new Set([
  "ARK_API_KEY",
  "ARK_MODEL",
  "ARK_BASE_URL",
  "SHEPHERD_MODEL",
  "APP_AUTH_TOKEN",
]);
