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
