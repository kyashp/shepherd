import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  isShepherdModelReviewConfigured,
  loadConfig,
  resolveVerifierOwnerId,
  VERIFIER_INSTALLATION_MARKER_FILE,
  VERIFIER_INSTALLATION_NONCE_FILE,
  writeShepherdCodexConfig,
} from "./config.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

async function temporaryDataDirectory(): Promise<string> {
  const root = path.resolve(process.cwd(), ".tmp", "verifier-owner-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "case-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

/** A coherent state-volume layout: every mounted root under one state root. */
const stateLayout = {
  CONTAINER_STATE_ROOT: "/app/state",
  CONTAINER_STATE_VOLUME: "launchpad-state",
  APP_DATA_DIR: "/app/state/data",
  AGENT_WORKSPACE_ROOT: "/app/state/workspaces",
  CODEX_HOME: "/app/state/codex-home",
  SHEPHERD_ROOT: "/app/state/data/shepherd",
  SHEPHERD_CODEX_HOME_ROOT: "/app/state/data/shepherd-codex-homes",
} as const;

describe("Shepherd configuration", () => {
  it("binds to loopback by default", () => {
    expect(loadConfig({}).host).toBe("127.0.0.1");
  });

  it("keeps host bind mounts when the state volume is unconfigured", () => {
    const config = loadConfig({});
    expect(config.containerStateRoot).toBeNull();
    expect(config.containerStateVolume).toBeNull();
  });

  it("requires the state root and volume together", () => {
    expect(() => loadConfig({ CONTAINER_STATE_ROOT: "/app/state" })).toThrow(
      /CONTAINER_STATE_ROOT and CONTAINER_STATE_VOLUME/u,
    );
    expect(() => loadConfig({ CONTAINER_STATE_VOLUME: "launchpad-state" })).toThrow(
      /CONTAINER_STATE_ROOT and CONTAINER_STATE_VOLUME/u,
    );
  });

  it("rejects unsafe state roots and volume names", () => {
    for (const root of ["state", "/", "/app/state,evil", "/app/state/../state"]) {
      expect(() =>
        loadConfig({ ...stateLayout, CONTAINER_STATE_ROOT: root }),
      ).toThrow(/CONTAINER_STATE_ROOT must be an absolute canonical path/u);
    }
    for (const volume of ["bad,name", "-leading", "a".repeat(65), "has space"]) {
      expect(() =>
        loadConfig({ ...stateLayout, CONTAINER_STATE_VOLUME: volume }),
      ).toThrow(/CONTAINER_STATE_VOLUME must be a valid container volume name/u);
    }
  });

  it("requires every mounted root inside the state root", () => {
    expect(() =>
      loadConfig({
        CONTAINER_STATE_ROOT: "/app/state",
        CONTAINER_STATE_VOLUME: "launchpad-state",
      }),
    ).toThrow(/must be inside CONTAINER_STATE_ROOT/u);
    // A sibling that merely shares a prefix is not inside the root.
    expect(() =>
      loadConfig({ ...stateLayout, CONTAINER_STATE_ROOT: "/app/state-evil" }),
    ).toThrow(/must be inside CONTAINER_STATE_ROOT/u);
    expect(() =>
      loadConfig({ ...stateLayout, AGENT_WORKSPACE_ROOT: "/elsewhere/workspaces" }),
    ).toThrow(/AGENT_WORKSPACE_ROOT must be inside CONTAINER_STATE_ROOT/u);
  });

  it("resolves a coherent state layout", () => {
    const config = loadConfig({ ...stateLayout });
    expect(config.containerStateRoot).toBe("/app/state");
    expect(config.containerStateVolume).toBe("launchpad-state");
    expect(config.shepherdRoot).toBe("/app/state/data/shepherd");
  });

  it("starts on any bind without a token and still carries one when configured", () => {
    // The token is optional everywhere: an empty token disables the bearer check,
    // so no bind requires configuration before the server will start.
    for (const environment of ["development", "test", "production"] as const) {
      for (const host of ["0.0.0.0", "192.0.2.10", "127.0.0.1", "::"]) {
        const config = loadConfig({ HOST: host, NODE_ENV: environment });
        expect(config.host).toBe(host);
        expect(config.authToken).toBe("");
      }
    }

    // A short or previously rejected placeholder value is now carried verbatim
    // rather than refused, and any configured token is still enforced downstream.
    expect(
      loadConfig({
        HOST: "0.0.0.0",
        NODE_ENV: "production",
        APP_AUTH_TOKEN: "replace-with-a-long-token-value",
      }).authToken,
    ).toBe("replace-with-a-long-token-value");
    expect(
      loadConfig({ HOST: "0.0.0.0", APP_AUTH_TOKEN: "short" }).authToken,
    ).toBe("short");
  });

  it("still rejects a token that cannot be sent as a bearer credential", () => {
    expect(() => loadConfig({ APP_AUTH_TOKEN: "has spaces and/slashes" })).toThrow(
      /URL-safe/u,
    );
    expect(() => loadConfig({ APP_AUTH_TOKEN: "a".repeat(129) })).toThrow();
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

  it("uses the Runtime image when the verifier image is empty", () => {
    const config = loadConfig({
      CONTAINER_RUNTIME_IMAGE: "runtime-image:test",
      SHEPHERD_VERIFIER_IMAGE: "",
    });

    expect(config.shepherdVerifierImage).toBe("runtime-image:test");
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

  it("resolves Shepherd live mode only for a configured container Runtime", () => {
    expect(loadConfig({ NODE_ENV: "test" }).shepherdExecutionMode).toBe(
      "deterministic",
    );
    expect(
      loadConfig({
        NODE_ENV: "test",
        RUNTIME_PROVIDER: "container",
        ARK_API_KEY: "test-key",
        ARK_MODEL: "ep-agent",
      }).shepherdExecutionMode,
    ).toBe("live");
    expect(
      loadConfig({
        NODE_ENV: "test",
        RUNTIME_PROVIDER: "container",
        ARK_API_KEY: "test-key",
        ARK_MODEL: "ep-agent",
        SHEPHERD_EXECUTION_MODE: "deterministic",
      }).shepherdExecutionMode,
    ).toBe("deterministic");
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        ARK_API_KEY: "test-key",
        ARK_MODEL: "ep-agent",
        SHEPHERD_EXECUTION_MODE: "live",
      }),
    ).toThrow("RUNTIME_PROVIDER=container");
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        RUNTIME_PROVIDER: "container",
        SHEPHERD_EXECUTION_MODE: "live",
      }),
    ).toThrow("ARK_API_KEY and ARK_MODEL");
  });

  it("writes a private live config with the Agent model and a key-free shell", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const privateHome = path.join(dataDirectory, "private-codex-home");
    const secret = "ARK_SECRET_MUST_NOT_BE_WRITTEN";
    const config = loadConfig({
      NODE_ENV: "test",
      APP_DATA_DIR: dataDirectory,
      RUNTIME_PROVIDER: "container",
      ARK_API_KEY: secret,
      ARK_MODEL: "agent-model",
      SHEPHERD_MODEL: "planner-model",
    });

    await writeShepherdCodexConfig(config, privateHome);
    const contents = await readFile(path.join(privateHome, "config.toml"), "utf8");
    expect(contents).toContain('model = "agent-model"');
    expect(contents).not.toContain("planner-model");
    expect(contents).not.toContain(secret);
    expect(contents).toContain('[shell_environment_policy]');
    expect(contents).toContain('inherit = "none"');
    expect(contents).toContain('TMPDIR = "/tmp"');
    expect(contents).toContain('NO_COLOR = "1"');
    expect((await stat(privateHome)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(privateHome, "config.toml"))).mode & 0o777).toBe(
      0o600,
    );
  });

  it("rejects ambiguous boolean and unsafe concurrency values", () => {
    expect(() =>
      loadConfig({ SHEPHERD_DEMO_MODE: "yes" }),
    ).toThrow();
    expect(() =>
      loadConfig({ SHEPHERD_MAX_PARALLEL_PLANES: "0" }),
    ).toThrow();
  });

  it("persists one stable verifier owner across restarts and concurrent startup", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: dataDirectory });

    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => resolveVerifierOwnerId(config)),
    );
    const afterRestart = await resolveVerifierOwnerId(
      loadConfig({ NODE_ENV: "test", APP_DATA_DIR: dataDirectory }),
    );

    expect(new Set(concurrent)).toEqual(new Set([afterRestart]));
    expect(afterRestart).toMatch(/^verifier\.default\.[a-f0-9]{32}$/u);
  });

  it("separates installations with distinct app-data roots and default Runtime IDs", async () => {
    const leftDirectory = await temporaryDataDirectory();
    const rightDirectory = await temporaryDataDirectory();

    const [leftOwner, rightOwner] = await Promise.all([
      resolveVerifierOwnerId(
        loadConfig({ NODE_ENV: "test", APP_DATA_DIR: leftDirectory }),
      ),
      resolveVerifierOwnerId(
        loadConfig({ NODE_ENV: "test", APP_DATA_DIR: rightDirectory }),
      ),
    ]);

    expect(leftOwner).not.toBe(rightOwner);
    expect(leftOwner).toMatch(/^verifier\.default\.[a-f0-9]{32}$/u);
    expect(rightOwner).toMatch(/^verifier\.default\.[a-f0-9]{32}$/u);
  });

  it("combines the persisted nonce with the configured Runtime identity", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const alphaOwner = await resolveVerifierOwnerId(
      loadConfig({
        NODE_ENV: "test",
        APP_DATA_DIR: dataDirectory,
        RUNTIME_INSTANCE_ID: "alpha",
      }),
    );
    const betaOwner = await resolveVerifierOwnerId(
      loadConfig({
        NODE_ENV: "test",
        APP_DATA_DIR: dataDirectory,
        RUNTIME_INSTANCE_ID: "beta",
      }),
    );

    expect(alphaOwner).toMatch(/^verifier\.alpha\.[a-f0-9]{32}$/u);
    expect(betaOwner).toMatch(/^verifier\.beta\.[a-f0-9]{32}$/u);
    expect(alphaOwner.split(".").at(-1)).toBe(betaOwner.split(".").at(-1));
  });

  it("fails closed instead of replacing an invalid persisted nonce", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await writeFile(
      path.join(dataDirectory, VERIFIER_INSTALLATION_NONCE_FILE),
      "not-a-valid-installation-nonce\n",
      { encoding: "utf8", mode: 0o600 },
    );

    await expect(
      resolveVerifierOwnerId(
        loadConfig({ NODE_ENV: "test", APP_DATA_DIR: dataDirectory }),
      ),
    ).rejects.toThrow(/persisted verifier installation nonce/iu);
  });

  it("rejects a FIFO installation nonce without blocking startup", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await execFileAsync("mkfifo", [
      path.join(dataDirectory, VERIFIER_INSTALLATION_NONCE_FILE),
    ]);

    await expect(
      resolveVerifierOwnerId(
        loadConfig({ NODE_ENV: "test", APP_DATA_DIR: dataDirectory }),
      ),
    ).rejects.toThrow(/persisted verifier installation nonce/iu);
  });

  it("rejects a FIFO installation marker without blocking startup", async () => {
    const dataDirectory = await temporaryDataDirectory();
    await execFileAsync("mkfifo", [
      path.join(dataDirectory, VERIFIER_INSTALLATION_MARKER_FILE),
    ]);

    await expect(
      resolveVerifierOwnerId(
        loadConfig({ NODE_ENV: "test", APP_DATA_DIR: dataDirectory }),
      ),
    ).rejects.toThrow(/verifier installation marker/iu);
  });

  it("fails closed if an existing installation loses its verifier nonce", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: dataDirectory });
    await resolveVerifierOwnerId(config);
    await writeFile(path.join(dataDirectory, "launchpad.json"), "{}\n", "utf8");
    await unlink(path.join(dataDirectory, VERIFIER_INSTALLATION_NONCE_FILE));

    await expect(resolveVerifierOwnerId(config)).rejects.toThrow(
      "Persisted verifier installation nonce is missing",
    );
  });

  it("bootstraps an upgraded database once, then records established ownership", async () => {
    const dataDirectory = await temporaryDataDirectory();
    const config = loadConfig({ NODE_ENV: "test", APP_DATA_DIR: dataDirectory });
    await writeFile(path.join(dataDirectory, "launchpad.json"), "{}\n", "utf8");

    await expect(resolveVerifierOwnerId(config)).resolves.toMatch(
      /^verifier\.default\.[a-f0-9]{32}$/u,
    );
    expect(
      await readFile(
        path.join(dataDirectory, VERIFIER_INSTALLATION_MARKER_FILE),
        "utf8",
      ),
    ).toBe("v1\n");
  });
});

describe("Shepherd advisory model review configuration", () => {
  const configured = {
    ARK_API_KEY: "ark-key-value-123456",
    ARK_MODEL: "ep-agent-model",
  };

  it("is configured when SHEPHERD_MODEL falls back to a usable ARK_MODEL", () => {
    expect(isShepherdModelReviewConfigured(loadConfig(configured))).toBe(true);
  });

  it("is configured from a SHEPHERD_MODEL distinct from ARK_MODEL", () => {
    const config = loadConfig({ ...configured, SHEPHERD_MODEL: "ep-review-model" });
    expect(config.shepherdModel).not.toBe(config.arkModel);
    expect(isShepherdModelReviewConfigured(config)).toBe(true);
  });

  it("allows a reviewer-only loopback clone without mutating unsafe source hosting", () => {
    const sourceEnvironment: NodeJS.ProcessEnv = {
      HOST: "0.0.0.0",
      APP_AUTH_TOKEN: "short",
      ARK_API_KEY: "ark-key-value-123456",
      ARK_MODEL: "ep-agent-model",
      SHEPHERD_MODEL: "ep-review-model",
      ARK_BASE_URL: "https://ark.example.test/api/v3",
    };

    const reviewerEnvironment = {
      ...sourceEnvironment,
      HOST: "127.0.0.1",
    };
    const config = loadConfig(reviewerEnvironment);

    expect(sourceEnvironment.HOST).toBe("0.0.0.0");
    expect(sourceEnvironment.APP_AUTH_TOKEN).toBe("short");
    expect(config).toMatchObject({
      host: "127.0.0.1",
      arkApiKey: sourceEnvironment.ARK_API_KEY,
      arkModel: sourceEnvironment.ARK_MODEL,
      shepherdModel: sourceEnvironment.SHEPHERD_MODEL,
      arkBaseUrl: sourceEnvironment.ARK_BASE_URL,
    });
    expect(isShepherdModelReviewConfigured(config)).toBe(true);
  });

  it("is unconfigured without a usable Ark credential", () => {
    expect(isShepherdModelReviewConfigured(loadConfig({ ARK_MODEL: "ep-agent-model" }))).toBe(
      false,
    );
    expect(
      isShepherdModelReviewConfigured(
        loadConfig({ ...configured, ARK_API_KEY: "replace-with-your-api-key" }),
      ),
    ).toBe(false);
  });

  it("is unconfigured when the review model is still a placeholder", () => {
    expect(
      isShepherdModelReviewConfigured(
        loadConfig({ ...configured, SHEPHERD_MODEL: "replace-with-your-agent-model" }),
      ),
    ).toBe(false);
  });

  it.each([
    ["short API key", { ARK_API_KEY: "short" }],
    ["control character in API key", { ARK_API_KEY: "ark-key-value-\u0000-secret" }],
    ["invalid model identifier", { SHEPHERD_MODEL: "review model" }],
    ["insecure endpoint", { ARK_BASE_URL: "http://ark.example.test/api/v3" }],
    ["endpoint credentials", { ARK_BASE_URL: "https://user@ark.example.test/api/v3" }],
    ["endpoint query", { ARK_BASE_URL: "https://ark.example.test/api/v3?debug=1" }],
  ])("is unconfigured for an adapter-rejected %s", (_case, overrides) => {
    expect(
      isShepherdModelReviewConfigured(loadConfig({ ...configured, ...overrides })),
    ).toBe(false);
  });
});
