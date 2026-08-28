import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

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
  SHEPHERD_VERIFIER_IMAGE: z.string().min(1).optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

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
    arkApiKey: env.ARK_API_KEY?.trim() ?? "",
    arkModel: env.ARK_MODEL?.trim() ?? "",
    shepherdModel: env.SHEPHERD_MODEL?.trim() || env.ARK_MODEL?.trim() || "",
    arkBaseUrl: env.ARK_BASE_URL.replace(/\/+$/, ""),
    shepherdRoot: path.resolve(
      env.SHEPHERD_ROOT ?? path.join(env.APP_DATA_DIR, "shepherd"),
    ),
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

export function isArkConfigured(config: AppConfig): boolean {
  return (
    config.arkApiKey.length > 0 &&
    !config.arkApiKey.startsWith("replace-") &&
    config.arkModel.length > 0 &&
    !config.arkModel.includes("replace-")
  );
}

export async function writeCodexConfig(config: AppConfig): Promise<void> {
  await mkdir(config.codexHome, { recursive: true });
  const toml = [
    "# Generated by Volc Agent Launchpad. Edit environment variables, not this file.",
    "model = " + JSON.stringify(config.arkModel || "ep-not-configured"),
    'model_provider = "volcengine_ark"',
    "",
    "[model_providers.volcengine_ark]",
    'name = "Volcengine Ark"',
    "base_url = " + JSON.stringify(config.arkBaseUrl),
    'env_key = "ARK_API_KEY"',
    'wire_api = "responses"',
    "requires_openai_auth = false",
    "",
  ].join("\n");
  await writeFile(path.join(config.codexHome, "config.toml"), toml, {
    encoding: "utf8",
    mode: 0o600,
  });
}
