import type {
  AgentRole,
  ScopedAuthority,
  ShepherdDatabase,
} from "./shepherd/domain.js";

export type { AgentRole, ScopedAuthority, ShepherdDatabase } from "./shepherd/domain.js";

export type AgentStatus = "ready" | "busy" | "stopped" | "error";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type MessageRole = "user" | "assistant";

export interface Agent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  workspacePath: string;
  codexThreadId: string | null;
  lastError: string | null;
  /** Added in Database V2. Optional keeps captured V1 Agent values lossless. */
  role?: AgentRole;
  /** Added in Database V2; absence means the server applies its safe default preset. */
  authority?: ScopedAuthority;
  currentContractId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  agentId: string;
  runId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface RunUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: RunStatus;
  prompt: string;
  output: string | null;
  error: string | null;
  usage: RunUsage | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface DatabaseV1 {
  version: 1;
  agents: Agent[];
  messages: Message[];
  runs: AgentRun[];
}

export interface DatabaseV2 {
  version: 2;
  agents: Agent[];
  messages: Message[];
  runs: AgentRun[];
  shepherd: ShepherdDatabase;
}

/** The only writable in-memory database representation. */
export type Database = DatabaseV2;

export interface CreateAgentInput {
  name: string;
  description?: string | undefined;
  instructions?: string | undefined;
  role?: AgentRole | undefined;
  authority?: ScopedAuthority | undefined;
}

export interface UpdateAgentInput {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
  role?: AgentRole | undefined;
  authority?: ScopedAuthority | undefined;
}

export interface RunnerResult {
  output: string;
  threadId: string | null;
  usage: RunUsage | null;
}

export interface ResumableRunnerRequest {
  mode?: "resumable";
  agentId: string;
  workspacePath: string;
  prompt: string;
  threadId: string | null;
}

/**
 * A one-turn Runtime request that cannot resume or reuse the legacy Agent
 * session store. The caller owns creation and cleanup of the private home.
 */
export interface FreshEphemeralRunnerRequest {
  mode: "fresh-ephemeral";
  agentId: string;
  workspacePath: string;
  prompt: string;
  threadId: null;
  codexHome: string;
  timeoutMs: number;
}

export type RunnerRequest =
  | ResumableRunnerRequest
  | FreshEphemeralRunnerRequest;

export function isFreshEphemeralRunnerRequest(
  request: RunnerRequest,
): request is FreshEphemeralRunnerRequest {
  return request.mode === "fresh-ephemeral";
}

export interface AgentRunner {
  readonly runtimeKind?: "local-process" | "container";
  run(request: RunnerRequest): Promise<RunnerResult>;
  cancel(agentId: string): Promise<boolean>;
  isAvailable(): Promise<boolean>;
}

export type EphemeralPreflightResult =
  | { available: true }
  | {
      available: false;
      stage: "container_create" | "container_start" | "output_validation" | "cleanup";
      reason:
        | "engine_error"
        | "invalid_container_id"
        | "non_root_required"
        | "private_home_must_be_read_only"
        | "codex_version_probe_failed"
        | "sandbox_listen_denial_failed"
        | "sandbox_connect_denial_failed"
        | "credential_isolation_failed"
        | "sandbox_probe_failed"
        | "output_too_large"
        | "codex_version_mismatch"
        | "success_marker_missing"
        | "cleanup_failed";
    };

export interface EphemeralContainerRunner extends AgentRunner {
  readonly runtimeKind: "container";
  reconcileInterrupted?(): Promise<number>;
  isEphemeralAvailable?(
    workspacePath: string,
    codexHome: string,
  ): Promise<boolean | EphemeralPreflightResult>;
}
