import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { isIP } from "node:net";
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
const containerVolumeNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/u;

export function isLoopbackHost(input: string): boolean {
  const host = input.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  if (host === "localhost") return true;
  const family = isIP(host);
  if (family === 4) return host.split(".")[0] === "127";
  if (family === 6) {
    return host === "::1" || /^::ffff:127(?:\.|$)/u.test(host);
  }
  return false;
}

const booleanEnvironmentValue = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PUBLIC_BIND_ADDR: z.string().trim().min(1).optional(),
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
  CONTAINER_STATE_ROOT: z.string().optional(),
  CONTAINER_STATE_VOLUME: z.string().optional(),
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
    // Empty stays valid on every bind: that is the documented loopback default and
    // the bearer boundary is simply disabled. A token that IS configured turns the
    // boundary on and is reported as required, so it has to be a real credential
    // rather than the placeholder this repository shipped in `.env.example`. The
    // same rule is already enforced in `deploy/volcengine/variables.tf`.
    .refine(
      (value) =>
        value.length === 0 || (value.length >= 24 && !/^replace-/iu.test(value)),
      "A configured APP_AUTH_TOKEN must be 24+ non-placeholder characters",
    )
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
  // Floor and default match the persisted settings schema, `updateSettings` and
  // the API, all of which require at least 2. Accepting 1 here would green-light a
  // value that fails validation on its first write, and a default of 4 would make
  // the persisted default unreachable for an operator who never sets the variable.
  SHEPHERD_MAX_PARALLEL_PLANES: z.coerce.number().int().min(2).max(16).default(2),
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

function hasUsableModelReviewEndpoint(baseUrl: string): boolean {
  if (
    baseUrl !== baseUrl.trim() ||
    baseUrl.length === 0 ||
    baseUrl.length > 2_048 ||
    baseUrl.includes("\\") ||
    /\p{Cc}/u.test(baseUrl)
  ) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    return false;
  }

  const rawPathStart = baseUrl.indexOf("/", "https://".length);
  const rawPath = rawPathStart === -1 ? "" : baseUrl.slice(rawPathStart);
  return (
    !/%2e|%2f|%5c/iu.test(rawPath) &&
    !/(?:^|\/)\.{1,2}(?:\/|$)/u.test(rawPath) &&
    !/\p{Cc}/u.test(rawPath)
  );
}

function hasUsableModelReviewConfiguration(
  apiKey: string,
  model: string,
  baseUrl: string,
): boolean {
  // Keep the readiness gate aligned with ArkModelReviewer's request-time
  // validation so an enabled reviewer cannot immediately degrade as misconfigured.
  return (
    hasUsableArkConfiguration(apiKey, model) &&
    apiKey === apiKey.trim() &&
    apiKey.length >= 8 &&
    apiKey.length <= 4_096 &&
    !/\p{Cc}/u.test(apiKey) &&
    model === model.trim() &&
    model.length <= 256 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u.test(model) &&
    hasUsableModelReviewEndpoint(baseUrl)
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

/**
 * Returns the state-volume-relative subpath for a mount source, or `null` when the
 * source is not strictly inside `root`. Boundary aware on purpose: a sibling such as
 * `/app/state-evil` is not inside `/app/state`, and the root itself has no subpath
 * because an empty `volume-subpath` is not a valid mount. A comma would inject
 * further mount options into the engine's comma-separated mount specification.
 */
export function containerStateSubpath(
  root: string,
  source: string,
): string | null {
  const relative = path.relative(root, source);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative) ||
    /[,\r\n\u0000]/u.test(relative)
  ) {
    return null;
  }
  return relative;
}

/**
 * Resolves the optional container state volume. Host bind mounts remain the
 * default. Both settings are required together: a half-configured deployment must
 * fail at startup rather than degrade silently back to the bind path, because on
 * some hosts that path cannot carry the Agent sandbox's per-file access rights.
 */
export function resolveContainerStateMount(input: {
  root: string | undefined;
  volume: string | undefined;
  mountRoots: readonly { label: string; path: string }[];
}): { root: string; volume: string } | null {
  const root = input.root?.trim() ?? "";
  const volume = input.volume?.trim() ?? "";
  if (!root && !volume) return null;
  if (!root || !volume) {
    throw new Error(
      "CONTAINER_STATE_ROOT and CONTAINER_STATE_VOLUME must be set together",
    );
  }
  if (
    !path.isAbsolute(root) ||
    path.resolve(root) !== root ||
    root === path.parse(root).root ||
    /[,\r\n\u0000]/u.test(root)
  ) {
    throw new Error(
      "CONTAINER_STATE_ROOT must be an absolute canonical path below the filesystem root",
    );
  }
  if (!containerVolumeNamePattern.test(volume)) {
    throw new Error(
      "CONTAINER_STATE_VOLUME must be a valid container volume name",
    );
  }
  for (const entry of input.mountRoots) {
    if (containerStateSubpath(root, entry.path) === null) {
      throw new Error(entry.label + " must be inside CONTAINER_STATE_ROOT");
    }
  }
  return { root, volume };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(environment);
  const authToken = env.APP_AUTH_TOKEN?.trim() ?? "";
  const publicBindAddress = env.PUBLIC_BIND_ADDR ?? env.HOST;
  if (!authToken && !isLoopbackHost(publicBindAddress)) {
    throw new Error("APP_AUTH_TOKEN is required for a non-loopback public bind");
  }
  const arkApiKey = env.ARK_API_KEY?.trim() ?? "";
  const arkModel = env.ARK_MODEL?.trim() ?? "";
  const defaultContainerUser =
    typeof process.getuid === "function" && typeof process.getgid === "function"
      ? process.getuid() + ":" + process.getgid()
      : "1000:1000";
  const dataDirectory = path.resolve(env.APP_DATA_DIR);
  const workspaceRoot = path.resolve(env.AGENT_WORKSPACE_ROOT);
  const codexHome = path.resolve(env.CODEX_HOME);
  const shepherdRoot = path.resolve(
    env.SHEPHERD_ROOT ?? path.join(env.APP_DATA_DIR, "shepherd"),
  );
  const shepherdCodexHomeRoot = path.resolve(
    env.SHEPHERD_CODEX_HOME_ROOT ??
      path.join(env.APP_DATA_DIR, "shepherd-codex-homes"),
  );
  // Every root the Runtime mounts must sit on the state volume, or the container
  // engine cannot resolve it. `dataDirectory` is included because the installation
  // nonce behind the owner label lives there: off the volume, each restart mints a
  // new owner and the owner-scoped container reconciliation stops matching.
  const containerState = resolveContainerStateMount({
    root: env.CONTAINER_STATE_ROOT,
    volume: env.CONTAINER_STATE_VOLUME,
    mountRoots: [
      { label: "APP_DATA_DIR", path: dataDirectory },
      { label: "AGENT_WORKSPACE_ROOT", path: workspaceRoot },
      { label: "CODEX_HOME", path: codexHome },
      { label: "SHEPHERD_ROOT", path: shepherdRoot },
      { label: "SHEPHERD_CODEX_HOME_ROOT", path: shepherdCodexHomeRoot },
    ],
  });
  return {
    host: env.HOST,
    publicBindAddress,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    dataDirectory,
    workspaceRoot,
    codexHome,
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
    containerStateRoot: containerState?.root ?? null,
    containerStateVolume: containerState?.volume ?? null,
    runtimeInstanceId: env.RUNTIME_INSTANCE_ID,
    authToken,
    arkApiKey,
    arkModel,
    shepherdModel: env.SHEPHERD_MODEL?.trim() || arkModel,
    arkBaseUrl: env.ARK_BASE_URL.replace(/\/+$/, ""),
    shepherdRoot,
    shepherdCodexHomeRoot,
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

/**
 * The advisory Shepherd reviewer uses SHEPHERD_MODEL, which falls back to
 * ARK_MODEL. It is deliberately independent of shepherdExecutionMode: the
 * reviewer is a bounded outbound request with no container, worktree, or Codex
 * session, so it stays available in deterministic mode.
 */
export function isShepherdModelReviewConfigured(config: AppConfig): boolean {
  return hasUsableModelReviewConfiguration(
    config.arkApiKey,
    config.shepherdModel,
    config.arkBaseUrl,
  );
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
