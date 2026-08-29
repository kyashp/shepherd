import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const VERIFIER_INSTALLATION_NONCE_FILE = ".verifier-installation-nonce";
export const VERIFIER_INSTALLATION_MARKER_FILE =
  ".verifier-installation-established";

const verifierInstallationNoncePattern = /^[a-f0-9]{32}$/u;
const runtimeInstanceIdPattern = /^[a-zA-Z0-9_.-]{1,48}$/u;

const booleanEnvironmentValue = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.string().default("info"),
  APP_DATA_DIR: z.string().default(path.resolve(".data")),
  AGENT_WORKSPACE_ROOT: z.string().default(path.resolve("workspaces")),
  CODEX_HOME: z.string().default(path.resolve("codex-home")),
  CODEX_BIN: z.string().default("codex"),
  CODEX_SANDBOX_MODE: z
    .enum(["read-only", "workspace-write", "danger-full-access"])
    .default("workspace-write"),
  CODEX_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(600_000),
  CODEX_MAX_OUTPUT_BYTES: z.coerce.number().int().min(65_536).default(2_097_152),
  RUNTIME_PROVIDER: z.enum(["local-process", "container"]).default("local-process"),
  CONTAINER_ENGINE: z.string().min(1).default("docker"),
  CONTAINER_RUNTIME_IMAGE: z.string().min(1).default("volc-agent-runtime:local"),
  CONTAINER_CPU_LIMIT: z.coerce.number().positive().default(2),
  CONTAINER_MEMORY_LIMIT: z
    .string()
    .regex(/^\d+(?:\.\d+)?[bkmg]$/i)
    .default("2g"),
  CONTAINER_PIDS_LIMIT: z.coerce.number().int().positive().default(256),
  CONTAINER_USER: z.string().optional(),
  RUNTIME_INSTANCE_ID: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .regex(/^[a-zA-Z0-9_.-]+$/)
    .default("default"),
  APP_AUTH_TOKEN: z
    .string()
    .trim()
    .max(128)
    .regex(/^[A-Za-z0-9._~-]*$/, "APP_AUTH_TOKEN must use URL-safe characters")
    .optional(),
  ARK_API_KEY: z.string().optional(),
  ARK_MODEL: z.string().optional(),
  SHEPHERD_MODEL: z.string().optional(),
  ARK_BASE_URL: z
    .string()
    .url()
    .default("https://ark.cn-beijing.volces.com/api/v3"),
  SHEPHERD_ROOT: z.string().optional(),
  SHEPHERD_CODEX_HOME_ROOT: z.string().optional(),
  SHEPHERD_EXECUTION_MODE: z
    .enum(["auto", "live", "deterministic"])
    .default("auto"),
  SHEPHERD_DEMO_MODE: booleanEnvironmentValue.default(false),
  SHEPHERD_AUTO_RESOLUTION: booleanEnvironmentValue.default(true),
  SHEPHERD_DELETE_COMPLETED_PLANES: booleanEnvironmentValue.default(false),
  SHEPHERD_MAX_PARALLEL_PLANES: z.coerce.number().int().min(1).max(16).default(4),
  SHEPHERD_CONTRACT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(600_000),
  SHEPHERD_CANDIDATE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(600_000),
  SHEPHERD_VERIFICATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(120_000),
  SHEPHERD_VERIFIER_IMAGE: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AppConfig = ReturnType<typeof loadConfig>;
export type ShepherdExecutionModeSetting = "auto" | "live" | "deterministic";
export type ShepherdExecutionMode = "live" | "deterministic";

function hasUsableArkConfiguration(
  arkApiKey: string,
  arkModel: string,
): boolean {
  return (
    arkApiKey.length > 0 &&
    !arkApiKey.startsWith("replace-") &&
    arkModel.length > 0 &&
    !arkModel.includes("replace-")
  );
}

export function resolveShepherdExecutionMode(input: {
  requested: ShepherdExecutionModeSetting;
  runtimeProvider: "local-process" | "container";
  arkApiKey: string;
  arkModel: string;
}): ShepherdExecutionMode {
  const liveReady =
    input.runtimeProvider === "container" &&
    hasUsableArkConfiguration(input.arkApiKey, input.arkModel);
  if (input.requested === "auto") {
    return liveReady ? "live" : "deterministic";
  }
  if (input.requested === "live" && input.runtimeProvider !== "container") {
    throw new Error(
      "SHEPHERD_EXECUTION_MODE=live requires RUNTIME_PROVIDER=container",
    );
  }
  if (
    input.requested === "live" &&
    !hasUsableArkConfiguration(input.arkApiKey, input.arkModel)
  ) {
    throw new Error(
      "SHEPHERD_EXECUTION_MODE=live requires configured ARK_API_KEY and ARK_MODEL",
    );
  }
  return input.requested;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/gu, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
  );
}

function isStrongNonPlaceholderToken(token: string): boolean {
  if (token.length < 24) return false;
  return !/^(?:replace|change[-_.]?me|placeholder|your[-_.]|example[-_.])/iu.test(
    token,
  );
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(environment);
  const authToken = env.APP_AUTH_TOKEN?.trim() ?? "";
  const arkApiKey = env.ARK_API_KEY?.trim() ?? "";
  const arkModel = env.ARK_MODEL?.trim() ?? "";
  if (!isLoopbackHost(env.HOST) && !isStrongNonPlaceholderToken(authToken)) {
    throw new Error(
      "APP_AUTH_TOKEN must be a non-placeholder token of at least 24 characters for a non-loopback server",
    );
  }
  const defaultContainerUser =
    typeof process.getuid === "function" && typeof process.getgid === "function"
      ? process.getuid() + ":" + process.getgid()
      : "1000:1000";
  return {
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    dataDirectory: path.resolve(env.APP_DATA_DIR),
    workspaceRoot: path.resolve(env.AGENT_WORKSPACE_ROOT),
    codexHome: path.resolve(env.CODEX_HOME),
    codexBin: env.CODEX_BIN,
    codexSandboxMode: env.CODEX_SANDBOX_MODE,
    codexTimeoutMs: env.CODEX_TIMEOUT_MS,
    codexMaxOutputBytes: env.CODEX_MAX_OUTPUT_BYTES,
    runtimeProvider: env.RUNTIME_PROVIDER,
    containerEngine: env.CONTAINER_ENGINE,
    containerRuntimeImage: env.CONTAINER_RUNTIME_IMAGE,
    containerCpuLimit: env.CONTAINER_CPU_LIMIT,
    containerMemoryLimit: env.CONTAINER_MEMORY_LIMIT,
    containerPidsLimit: env.CONTAINER_PIDS_LIMIT,
    containerUser: env.CONTAINER_USER?.trim() || defaultContainerUser,
    runtimeInstanceId: env.RUNTIME_INSTANCE_ID,
    authToken,
    arkApiKey,
    arkModel,
    shepherdModel: env.SHEPHERD_MODEL?.trim() || arkModel,
    arkBaseUrl: env.ARK_BASE_URL.replace(/\/+$/, ""),
    shepherdRoot: path.resolve(
      env.SHEPHERD_ROOT ?? path.join(env.APP_DATA_DIR, "shepherd"),
    ),
    shepherdCodexHomeRoot: path.resolve(
      env.SHEPHERD_CODEX_HOME_ROOT ??
        path.join(env.APP_DATA_DIR, "shepherd-codex-homes"),
    ),
    shepherdExecutionModeSetting: env.SHEPHERD_EXECUTION_MODE,
    shepherdExecutionMode: resolveShepherdExecutionMode({
      requested: env.SHEPHERD_EXECUTION_MODE,
      runtimeProvider: env.RUNTIME_PROVIDER,
      arkApiKey,
      arkModel,
    }),
    shepherdDemoMode: env.SHEPHERD_DEMO_MODE,
    shepherdAutoResolution: env.SHEPHERD_AUTO_RESOLUTION,
    shepherdDeleteCompletedPlanes: env.SHEPHERD_DELETE_COMPLETED_PLANES,
    shepherdMaxParallelPlanes: env.SHEPHERD_MAX_PARALLEL_PLANES,
    shepherdContractTimeoutMs: env.SHEPHERD_CONTRACT_TIMEOUT_MS,
    shepherdCandidateTimeoutMs: env.SHEPHERD_CANDIDATE_TIMEOUT_MS,
    shepherdVerificationTimeoutMs: env.SHEPHERD_VERIFICATION_TIMEOUT_MS,
    shepherdVerifierImage:
      env.SHEPHERD_VERIFIER_IMAGE?.trim() || env.CONTAINER_RUNTIME_IMAGE,
    nodeEnv: env.NODE_ENV,
  };
}

function installationNonceFromFile(contents: string): string {
  const nonce = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  if (
    !verifierInstallationNoncePattern.test(nonce) ||
    (contents !== nonce && contents !== nonce + "\n")
  ) {
    throw new Error("Persisted verifier installation nonce is invalid");
  }
  return nonce;
}

async function readInstallationNonce(filePath: string): Promise<string> {
  let handle: FileHandle;
  try {
    handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    throw new Error("Unable to read the persisted verifier installation nonce");
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 32 || metadata.size > 33) {
      throw new Error("Persisted verifier installation nonce is invalid");
    }
    return installationNonceFromFile(await handle.readFile({ encoding: "utf8" }));
  } finally {
    await handle.close();
  }
}

async function entryExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readInstallationMarker(filePath: string): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    throw new Error("Unable to read the verifier installation marker");
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== 3) {
      throw new Error("Persisted verifier installation marker is invalid");
    }
    if ((await handle.readFile({ encoding: "utf8" })) !== "v1\n") {
      throw new Error("Persisted verifier installation marker is invalid");
    }
  } finally {
    await handle.close();
  }
}

async function establishInstallationMarker(dataDirectory: string): Promise<void> {
  const markerPath = path.join(dataDirectory, VERIFIER_INSTALLATION_MARKER_FILE);
  if (await entryExists(markerPath)) {
    await readInstallationMarker(markerPath);
    return;
  }
  const temporaryPath =
    markerPath + "." + process.pid + "." + randomBytes(8).toString("hex") + ".tmp";
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile("v1\n", { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, markerPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new Error("Unable to persist the verifier installation marker");
      }
    }
    await readInstallationMarker(markerPath);
  } finally {
    if (handle) await handle.close();
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function loadOrCreateInstallationNonce(dataDirectory: string): Promise<string> {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const filePath = path.join(dataDirectory, VERIFIER_INSTALLATION_NONCE_FILE);
  const markerPath = path.join(dataDirectory, VERIFIER_INSTALLATION_MARKER_FILE);
  const markerExists = await entryExists(markerPath);
  if (markerExists) await readInstallationMarker(markerPath);
  if (await entryExists(filePath)) {
    const existing = await readInstallationNonce(filePath);
    await establishInstallationMarker(dataDirectory);
    return existing;
  }
  if (markerExists) {
    throw new Error(
      "Persisted verifier installation nonce is missing for an existing installation",
    );
  }
  const nonce = randomBytes(16).toString("hex");
  const temporaryPath =
    filePath + "." + process.pid + "." + randomBytes(8).toString("hex") + ".tmp";
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      temporaryPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new Error("Unable to create the verifier installation nonce");
  }
  try {
    await handle.writeFile(nonce + "\n", { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, filePath);
      await establishInstallationMarker(dataDirectory);
      return nonce;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const existing = await readInstallationNonce(filePath);
        await establishInstallationMarker(dataDirectory);
        return existing;
      }
      throw new Error("Unable to persist the verifier installation nonce");
    }
  } finally {
    if (handle) await handle.close();
    await unlink(temporaryPath).catch(() => undefined);
  }
}

/**
 * Resolves a restart-stable verifier owner scoped to one persisted installation.
 * A shared app-data root intentionally represents one installation; separate
 * roots receive separate nonces even when their configured Runtime IDs match.
 */
export async function resolveVerifierOwnerId(
  config: Pick<AppConfig, "dataDirectory" | "runtimeInstanceId">,
): Promise<string> {
  if (!runtimeInstanceIdPattern.test(config.runtimeInstanceId)) {
    throw new Error("Invalid Runtime instance ID for verifier ownership");
  }
  const nonce = await loadOrCreateInstallationNonce(
    path.resolve(config.dataDirectory),
  );
  return "verifier." + config.runtimeInstanceId + "." + nonce;
}

export function isArkConfigured(config: AppConfig): boolean {
  return hasUsableArkConfiguration(config.arkApiKey, config.arkModel);
}

function arkCodexConfigToml(
  config: Pick<AppConfig, "arkModel" | "arkBaseUrl">,
  hardenModelShell: boolean,
): string {
  const lines = [
    "# Generated by Volc Agent Launchpad. Edit environment variables, not this file.",
    "model = " + JSON.stringify(config.arkModel || "ep-not-configured"),
    'model_provider = "volcengine_ark"',
    ...(hardenModelShell
      ? ['approval_policy = "never"', "project_root_markers = []"]
      : []),
    "",
    "[model_providers.volcengine_ark]",
    'name = "Volcengine Ark"',
    "base_url = " + JSON.stringify(config.arkBaseUrl),
    'env_key = "ARK_API_KEY"',
    'wire_api = "responses"',
    "requires_openai_auth = false",
    "",
  ];
  if (hardenModelShell) {
    lines.push(
      "[shell_environment_policy]",
      'inherit = "none"',
      "ignore_default_excludes = false",
      'set = { PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME = "/tmp", TMPDIR = "/tmp", LANG = "C", LC_ALL = "C", CI = "1", NO_COLOR = "1" }',
      "",
    );
  }
  return lines.join("\n");
}

export async function writeCodexConfig(config: AppConfig): Promise<void> {
  await mkdir(config.codexHome, { recursive: true });
  await writeFile(
    path.join(config.codexHome, "config.toml"),
    arkCodexConfigToml(config, false),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

/** Writes the minimal, secret-free config for one ephemeral Shepherd turn. */
export async function writeShepherdCodexConfig(
  config: AppConfig,
  codexHome: string,
): Promise<void> {
  if (!isArkConfigured(config)) {
    throw new Error("Live Shepherd execution requires configured Ark credentials");
  }
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await chmod(codexHome, 0o700);
  await writeFile(
    path.join(codexHome, "config.toml"),
    arkCodexConfigToml(config, true),
    {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    },
  );
}
