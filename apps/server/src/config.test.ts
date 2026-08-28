import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("Shepherd configuration", () => {
  it("binds to loopback by default", () => {
    expect(loadConfig({}).host).toBe("127.0.0.1");
  });

  it("requires a strong non-placeholder token for every non-loopback bind", () => {
    for (const environment of ["development", "test", "production"] as const) {
      expect(() =>
        loadConfig({ HOST: "0.0.0.0", NODE_ENV: environment }),
      ).toThrow(/APP_AUTH_TOKEN/);
    }

    expect(() =>
      loadConfig({
        HOST: "192.0.2.10",
        NODE_ENV: "development",
        APP_AUTH_TOKEN: "replace-with-a-long-token-value",
      }),
    ).toThrow(/APP_AUTH_TOKEN/);

    expect(
      loadConfig({
        HOST: "0.0.0.0",
        NODE_ENV: "development",
        APP_AUTH_TOKEN: "test-token-0123456789-strong",
      }).host,
    ).toBe("0.0.0.0");
  });

  it("uses the Agent model for Shepherd when no override is configured", () => {
    const config = loadConfig({
      APP_DATA_DIR: ".tmp/config-data",
      ARK_MODEL: "agent-model",
    });

    expect(config.shepherdModel).toBe("agent-model");
    expect(config.shepherdRoot).toBe(
      path.resolve(".tmp/config-data", "shepherd"),
    );
  });

  it("accepts a distinct Shepherd model and explicit safe kernel settings", () => {
    const config = loadConfig({
      APP_DATA_DIR: ".tmp/config-data",
      ARK_MODEL: "agent-model",
      SHEPHERD_MODEL: "planner-model",
      SHEPHERD_DEMO_MODE: "true",
      SHEPHERD_AUTO_RESOLUTION: "false",
      SHEPHERD_DELETE_COMPLETED_PLANES: "true",
      SHEPHERD_MAX_PARALLEL_PLANES: "7",
      SHEPHERD_CONTRACT_TIMEOUT_MS: "1000",
      SHEPHERD_CANDIDATE_TIMEOUT_MS: "2000",
      SHEPHERD_VERIFICATION_TIMEOUT_MS: "3000",
    });

    expect(config.shepherdModel).toBe("planner-model");
    expect(config.shepherdDemoMode).toBe(true);
    expect(config.shepherdAutoResolution).toBe(false);
    expect(config.shepherdDeleteCompletedPlanes).toBe(true);
    expect(config.shepherdMaxParallelPlanes).toBe(7);
    expect(config.shepherdContractTimeoutMs).toBe(1000);
    expect(config.shepherdCandidateTimeoutMs).toBe(2000);
    expect(config.shepherdVerificationTimeoutMs).toBe(3000);
  });

  it("rejects ambiguous boolean and unsafe concurrency values", () => {
    expect(() =>
      loadConfig({ SHEPHERD_DEMO_MODE: "yes" }),
    ).toThrow();
    expect(() =>
      loadConfig({ SHEPHERD_MAX_PARALLEL_PLANES: "0" }),
    ).toThrow();
  });
});
