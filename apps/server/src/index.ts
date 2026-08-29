import path from "node:path";
import { AgentService } from "./agent-service.js";
import { createApp } from "./app.js";
import {
  isShepherdModelReviewConfigured,
  loadConfig,
  resolveVerifierOwnerId,
  writeCodexConfig,
} from "./config.js";
import { createRunner } from "./runner-factory.js";
import { CodexShepherdExecutor } from "./shepherd/codex-executor.js";
import { DeterministicFixtureExecutor } from "./shepherd/executor.js";
import { ArkModelReviewer } from "./shepherd/model-reviewer.js";
import {
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_PROFILE_ID,
  ShepherdService,
} from "./shepherd/service.js";
import {
  ContainerVerifier,
  TrustedCheckRegistry,
} from "./shepherd/verifier.js";
import { JsonStore } from "./store.js";
import { WorkspaceManager } from "./workspace.js";

const config = loadConfig();
await writeCodexConfig(config);

const sensitiveValues = [config.arkApiKey, config.authToken];
const verifierOwnerId = await resolveVerifierOwnerId(config);
const store = new JsonStore(path.join(config.dataDirectory, "launchpad.json"), {
  sensitiveValues,
});
const workspaces = new WorkspaceManager(config.workspaceRoot);
const runner = createRunner(config);
const service = new AgentService(config, store, workspaces, runner);
await service.initialize();

const shepherdPlanesRoot = path.join(
  config.shepherdRoot,
  "planes",
  "auth-demo",
);
const shepherdChecks = new TrustedCheckRegistry([
  {
    id: AUTH_FRONTEND_PROFILE_ID,
    command: "node",
    args: ["checks/frontend.cjs"],
    cwd: ".",
  },
  {
    id: AUTH_BACKEND_PROFILE_ID,
    command: "node",
    args: ["checks/backend.cjs"],
    cwd: ".",
  },
  {
    id: AUTH_PROJECT_PROFILE_ID,
    command: "node",
    args: ["checks/project-security.cjs"],
    cwd: ".",
  },
]);
const shepherdVerifier = new ContainerVerifier(shepherdChecks, {
  planesRoot: shepherdPlanesRoot,
  containerEngine: config.containerEngine,
  containerImage: config.shepherdVerifierImage,
  containerUser: config.containerUser,
  ownerId: verifierOwnerId,
  cpuLimit: Math.min(config.containerCpuLimit, 16),
  memoryLimit: config.containerMemoryLimit,
  pidsLimit: Math.max(16, Math.min(config.containerPidsLimit, 4_096)),
  maxTimeoutMs: Math.min(config.shepherdVerificationTimeoutMs, 600_000),
  maxOutputBytes: Math.min(config.codexMaxOutputBytes, 4_194_304),
  sensitiveValues,
});
const shepherdExecutor =
  config.shepherdExecutionMode === "live"
    ? new CodexShepherdExecutor(config, verifierOwnerId)
    : new DeterministicFixtureExecutor();
// Advisory only. Absent credentials mean no review runs and no advisory event is
// emitted, which is honest; constructing one with a placeholder key would degrade
// every Mission with a permanent false configuration_error alarm.
const shepherdModelReviewer = isShepherdModelReviewConfigured(config)
  ? new ArkModelReviewer({
      enabled: true,
      baseUrl: config.arkBaseUrl,
      apiKey: config.arkApiKey,
      model: config.shepherdModel,
      timeoutMs: 20_000,
      sensitiveValues,
    })
  : undefined;
const shepherdService = new ShepherdService({
  store,
  managedRoot: config.shepherdRoot,
  agentWorkspaceRoot: config.workspaceRoot,
  verifier: shepherdVerifier,
  executor: shepherdExecutor,
  sensitiveValues,
  contractTimeoutMs: config.shepherdContractTimeoutMs,
  candidateTimeoutMs: config.shepherdCandidateTimeoutMs,
  ...(shepherdModelReviewer ? { reviewer: shepherdModelReviewer } : {}),
});
await shepherdService.initialize();

const app = await createApp(config, service, shepherdService);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: config.host, port: config.port });
