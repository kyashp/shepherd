import { describe, expect, it } from "vitest";
import { CodexRunner } from "./codex-runner.js";
import { ContainerCodexRunner } from "./container-codex-runner.js";
import { loadConfig } from "./config.js";
import { createRunner } from "./runner-factory.js";

describe("runner factory", () => {
  it("selects only the configured Runtime boundary", () => {
    expect(createRunner(loadConfig({ NODE_ENV: "test" }))).toBeInstanceOf(CodexRunner);
    expect(createRunner(loadConfig({
      NODE_ENV: "test",
      RUNTIME_PROVIDER: "container",
    }))).toBeInstanceOf(ContainerCodexRunner);
  });
});
