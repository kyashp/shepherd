import { randomUUID } from "node:crypto";
import {
  appendWithinDurableCapacity,
  assertWithinDurableCapacity,
} from "./collection-capacity.js";
import type { AppConfig } from "./config.js";
import { isArkConfigured, isShepherdModelReviewConfigured } from "./config.js";
import { HttpError, RunCancelledError } from "./errors.js";
import { JsonStore, PersistenceBoundaryError } from "./store.js";
import { normalizeScopedAuthority } from "./shepherd/authority.js";
import {
  beginGeneralProjectDeletion,
  completeGeneralProjectDeletion,
  reconcileGeneralProjectDeletions,
} from "./shepherd/demo-project.js";
import type {
  Agent,
  AgentRole,
  AgentRun,
  AgentRunner,
  CreateAgentInput,
  Database,
  Message,
  ScopedAuthority,
  UpdateAgentInput,
} from "./types.js";
import { WorkspaceManager } from "./workspace.js";

const now = () => new Date().toISOString();

interface AgentDeletionAssessment {
  blockingReference: boolean;
  clarificationMessageIds: Set<string>;
  clarificationProjectId: string | null;
}

const assessAgentDeletion = (
  shepherd: Database["shepherd"],
  agentId: string,
): AgentDeletionAssessment => {
  const clarificationProjectId = `agent-${agentId}`;
  const referencedMessages = shepherd.groupMessages.filter(
    (message) => message.targetAgentId === agentId || message.senderId === agentId,
  );
  const clarificationMessages = referencedMessages.filter(
    (message) =>
      message.projectId === clarificationProjectId &&
      message.missionId === null &&
      message.contractId === null &&
      message.senderType === "human" &&
      message.senderId === null &&
      message.targetAgentId === agentId &&
      message.contractAssignment?.preset === "general-contract" &&
      message.contractAssignment.status === "clarification_required",
  );
  const clarificationMessageIds = new Set(
    clarificationMessages.map((message) => message.id),
  );
  const project = shepherd.projects.find((item) => item.id === clarificationProjectId);
  const hasProjectExecutionHistory =
    shepherd.missions.some((mission) => mission.projectId === clarificationProjectId) ||
    shepherd.planes.some((plane) => plane.projectId === clarificationProjectId) ||
    shepherd.groupMessages.some(
      (message) =>
        message.projectId === clarificationProjectId &&
        !clarificationMessageIds.has(message.id),
    );
  const hasDirectHistory =
    shepherd.contracts.some((contract) => contract.agentId === agentId) ||
    shepherd.events.some((event) => event.agentId === agentId) ||
    referencedMessages.some((message) => !clarificationMessageIds.has(message.id));
  const hasClarificationState = clarificationMessageIds.size > 0;
  const invalidClarificationProject =
    hasClarificationState &&
    (!project || project.activeMissionId !== null || hasProjectExecutionHistory);
  const orphanedAgentProject = !hasClarificationState && project !== undefined;
  return {
    blockingReference:
      hasDirectHistory || invalidClarificationProject || orphanedAgentProject,
    clarificationMessageIds,
    clarificationProjectId:
      hasClarificationState && !invalidClarificationProject
        ? clarificationProjectId
        : null,
  };
};

export type AgentAuthorityPresetId =
  | "frontend"
  | "backend"
  | "verification"
  | "generalist";

export interface AgentAuthorityPreset {
  id: AgentAuthorityPresetId;
  label: string;
  description: string;
  recommendedRole: AgentRole;
  authority: ScopedAuthority;
}

const COMMON_FORBIDDEN_PATTERNS = [
  ".git/**",
  ".shepherd/**",
  "checks/**",
  "policy.json",
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/*.key",
  "**/*.pem",
] as const;

const defineAuthority = (writable: readonly string[]): ScopedAuthority => ({
  readable: ["**"],
  writable: [...writable],
  forbidden: [...COMMON_FORBIDDEN_PATTERNS],
});

const AUTHORITY_PRESETS: Readonly<Record<AgentAuthorityPresetId, AgentAuthorityPreset>> = {
  frontend: {
    id: "frontend",
    label: "Frontend",
    description: "Frontend application and fixture files.",
    recommendedRole: "Frontend",
    authority: defineAuthority(["apps/web/**", "src/frontend/**"]),
  },
  backend: {
    id: "backend",
    label: "Backend",
    description: "Server application and backend fixture files.",
    recommendedRole: "Backend",
    authority: defineAuthority(["apps/server/**", "src/backend/**"]),
  },
  verification: {
    id: "verification",
    label: "Verification",
    description: "Repository tests and verification fixtures.",
    recommendedRole: "Verification",
    authority: defineAuthority([
      "test/**",
      "tests/**",
      "**/*.spec.*",
      "**/*.test.*",
    ]),
  },
  generalist: {
    id: "generalist",
    label: "Generalist",
    description: "Common source, documentation, script, and test areas.",
    recommendedRole: "Generalist",
    authority: defineAuthority([
      "apps/**",
      "docs/**",
      "scripts/**",
      "src/**",
      "test/**",
      "tests/**",
    ]),
  },
};

const PRESET_FOR_ROLE: Readonly<Record<AgentRole, AgentAuthorityPresetId>> = {
  Frontend: "frontend",
  Backend: "backend",
  Verification: "verification",
  Generalist: "generalist",
};

export function agentAuthorityPreset(
  id: AgentAuthorityPresetId,
): AgentAuthorityPreset {
  return structuredClone(AUTHORITY_PRESETS[id]);
}

export function listAgentAuthorityPresets(): AgentAuthorityPreset[] {
  return Object.values(AUTHORITY_PRESETS).map((preset) => structuredClone(preset));
}

function safeAuthority(
  authority: ScopedAuthority | undefined,
  role: AgentRole,
): ScopedAuthority {
  try {
    return normalizeScopedAuthority(
      authority ?? agentAuthorityPreset(PRESET_FOR_ROLE[role]).authority,
    );
  } catch {
    throw new HttpError(
      400,
      "Authority must contain normalized repository-relative patterns only",
    );
  }
}

export class AgentService {
  private readonly activeExecutions = new Map<string, Promise<void>>();
  private readonly cancellationRequests = new Set<string>();
  private readonly deletionReservations = new Set<string>();
  private pendingAgentCreations = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStore,
    private readonly workspaces: WorkspaceManager,
    private readonly runner: AgentRunner,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.workspaces.initialize();
    await this.workspaces.reconcileArchiveDeletions(
      new Set(this.store.snapshot().agents.map((agent) => agent.id)),
    );
    for (const agent of this.store.snapshot().agents) {
      await this.workspaces.assertManagedWorkspace(agent);
    }
    await this.store.mutate((database) => {
      for (const run of database.runs) {
        if (run.status === "queued" || run.status === "running") {
          run.status = "cancelled";
          run.error = "Server restarted while this run was active";
          run.completedAt = now();
        }
      }
      for (const agent of database.agents) {
        if (agent.status === "busy") {
          agent.status = "ready";
          agent.updatedAt = now();
        }
      }
    });
  }

  listAgents(): Agent[] {
    return this.store
      .snapshot()
      .agents.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getAgent(id: string): Agent {
    const agent = this.store.snapshot().agents.find((item) => item.id === id);
    if (!agent) {
      throw new HttpError(404, "Agent not found");
    }
    return agent;
  }

  async createAgent(input: CreateAgentInput): Promise<Agent> {
    const timestamp = now();
    const id = randomUUID();
    const role = input.role ?? "Generalist";
    const agent: Agent = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      instructions: input.instructions?.trim() ?? "",
      status: "ready",
      workspacePath: this.workspaces.workspacePath(id),
      codexThreadId: null,
      lastError: null,
      role,
      authority: safeAuthority(input.authority, role),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    assertWithinDurableCapacity(
      this.store.snapshot().agents,
      this.pendingAgentCreations + 1,
      "Agent",
    );
    this.pendingAgentCreations += 1;
    try {
      await this.workspaces.create(agent);
      await this.store.mutate((database) =>
        appendWithinDurableCapacity(database.agents, [agent], "Agent"),
      );
      return agent;
    } finally {
      this.pendingAgentCreations -= 1;
    }
  }

  async updateAgent(id: string, input: UpdateAgentInput): Promise<Agent> {
    const current = this.getAgent(id);
    if (current.status === "busy" || current.currentContractId) {
      throw new HttpError(409, "Stop the active run before editing this Agent");
    }
    const updated = await this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (agent.status === "busy" || agent.currentContractId) {
        throw new HttpError(409, "Stop the active run before editing this Agent");
      }
      if (input.name !== undefined) agent.name = input.name.trim();
      if (input.description !== undefined) agent.description = input.description.trim();
      if (input.instructions !== undefined) agent.instructions = input.instructions.trim();
      if (input.role !== undefined) agent.role = input.role;
      if (input.authority !== undefined) {
        agent.authority = safeAuthority(
          input.authority,
          input.role ?? agent.role ?? "Generalist",
        );
      } else if (input.role !== undefined) {
        agent.authority = safeAuthority(undefined, input.role);
      } else if (agent.authority === undefined) {
        agent.authority = safeAuthority(undefined, agent.role ?? "Generalist");
      }
      agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
    await this.workspaces.writeInstructions(updated);
    return updated;
  }

  async deleteAgent(id: string): Promise<{ deleted: true }> {
    if (this.deletionReservations.has(id)) {
      throw new HttpError(409, "Agent deletion is already in progress");
    }
    this.deletionReservations.add(id);
    let retainDeletionReservation = false;
    try {
      const agent = this.getAgent(id);
      const initialAssessment = assessAgentDeletion(
        this.store.snapshot().shepherd,
        id,
      );
      if (initialAssessment.blockingReference) {
        throw new HttpError(
          409,
          "Cannot delete an Agent referenced by durable Shepherd history",
        );
      }
      await this.cancelExecution(id);
      let journaledProjectId: string | null = null;
      let workspaceJournaled = false;
      try {
        await this.workspaces.beginArchiveDeletion(agent);
        workspaceJournaled = true;
        const deletion = await this.store.mutate(async (database) => {
          const currentAgent = database.agents.find((item) => item.id === id);
          if (!currentAgent) {
            throw new HttpError(404, "Agent not found");
          }
          const assessment = assessAgentDeletion(database.shepherd, id);
          if (assessment.blockingReference) {
            throw new HttpError(
              409,
              "Cannot delete an Agent referenced by durable Shepherd history",
            );
          }
          if (assessment.clarificationProjectId) {
            await beginGeneralProjectDeletion(
              this.config.shepherdRoot,
              assessment.clarificationProjectId,
            );
            journaledProjectId = assessment.clarificationProjectId;
          }
          database.agents = database.agents.filter((item) => item.id !== id);
          database.messages = database.messages.filter((item) => item.agentId !== id);
          database.runs = database.runs.filter((item) => item.agentId !== id);
          if (assessment.clarificationProjectId) {
            database.shepherd.groupMessages = database.shepherd.groupMessages.filter(
              (message) => !assessment.clarificationMessageIds.has(message.id),
            );
            database.shepherd.projects = database.shepherd.projects.filter(
              (project) => project.id !== assessment.clarificationProjectId,
            );
          }
          return {
            deleted: true as const,
            clarificationProjectId: assessment.clarificationProjectId,
          };
        });
        if (deletion.clarificationProjectId) {
          try {
            await completeGeneralProjectDeletion(
              this.config.shepherdRoot,
              deletion.clarificationProjectId,
            );
          } catch {
            const durableProjectIds = new Set(
              this.store.snapshot().shepherd.projects.map((project) => project.id),
            );
            try {
              await reconcileGeneralProjectDeletions(
                this.config.shepherdRoot,
                durableProjectIds,
              );
            } catch {
              throw new HttpError(
                500,
                "Agent was archived; managed clarification cleanup requires restart",
              );
            }
          }
        }
        await this.workspaces.completeArchiveDeletion(id);
        return { deleted: true };
      } catch (error) {
        if (error instanceof PersistenceBoundaryError) {
          retainDeletionReservation = true;
          throw new HttpError(
            500,
            "Agent deletion persistence is uncertain; restart to reconcile safely",
          );
        }
        if (workspaceJournaled || journaledProjectId) {
          const durableAgentIds = new Set(
            this.store.snapshot().agents.map((item) => item.id),
          );
          const durableProjectIds = new Set(
            this.store.snapshot().shepherd.projects.map((project) => project.id),
          );
          await Promise.all([
            workspaceJournaled
              ? this.workspaces.reconcileArchiveDeletions(durableAgentIds)
              : Promise.resolve(),
            journaledProjectId
              ? reconcileGeneralProjectDeletions(
                  this.config.shepherdRoot,
                  durableProjectIds,
                )
              : Promise.resolve(),
          ]).catch(() => undefined);
        }
        throw error;
      }
    } finally {
      if (!retainDeletionReservation) {
        this.deletionReservations.delete(id);
      }
    }
  }

  async startAgent(id: string): Promise<Agent> {
    if (this.getAgent(id).currentContractId) {
      throw new HttpError(409, "Shepherd is currently using this Agent");
    }
    return this.setStatus(id, "ready", true);
  }

  async stopAgent(id: string): Promise<Agent> {
    if (this.getAgent(id).currentContractId) {
      throw new HttpError(409, "Cancel or finish the Shepherd Contract first");
    }
    await this.cancelExecution(id);
    return this.setStatus(id, "stopped", true);
  }

  getMessages(agentId: string): Message[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .messages.filter((message) => message.agentId === agentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  getRun(runId: string): AgentRun {
    const run = this.store.snapshot().runs.find((item) => item.id === runId);
    if (!run) {
      throw new HttpError(404, "Run not found");
    }
    return run;
  }

  getRuns(agentId: string): AgentRun[] {
    this.getAgent(agentId);
    return this.store
      .snapshot()
      .runs.filter((run) => run.agentId === agentId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async sendMessage(
    agentId: string,
    prompt: string,
  ): Promise<{ run: AgentRun; message: Message }> {
    if (this.deletionReservations.has(agentId)) {
      throw new HttpError(409, "Agent deletion is in progress");
    }
    if (!isArkConfigured(this.config)) {
      throw new HttpError(
        503,
        "Ark is not configured. Set ARK_API_KEY and ARK_MODEL, then restart.",
      );
    }
    const timestamp = now();
    const runId = randomUUID();
    const run: AgentRun = {
      id: runId,
      agentId,
      status: "queued",
      prompt,
      output: null,
      error: null,
      usage: null,
      startedAt: null,
      completedAt: null,
      createdAt: timestamp,
    };
    const message: Message = {
      id: randomUUID(),
      agentId,
      runId,
      role: "user",
      content: prompt,
      createdAt: timestamp,
    };
    const agentAtStart = await this.store.mutate((database) => {
      if (this.deletionReservations.has(agentId)) {
        throw new HttpError(409, "Agent deletion is in progress");
      }
      const storedAgent = database.agents.find((item) => item.id === agentId);
      if (!storedAgent) {
        throw new HttpError(404, "Agent not found");
      }
      if (storedAgent.status === "stopped") {
        throw new HttpError(409, "Start the Agent before sending a message");
      }
      if (storedAgent.status === "busy") {
        throw new HttpError(409, "This Agent is already running");
      }
      if (storedAgent.currentContractId) {
        throw new HttpError(409, "Shepherd is currently using this Agent");
      }
      appendWithinDurableCapacity(database.runs, [run], "Agent run");
      appendWithinDurableCapacity(database.messages, [message], "Agent message");
      const snapshot = structuredClone(storedAgent);
      storedAgent.status = "busy";
      storedAgent.lastError = null;
      storedAgent.updatedAt = timestamp;
      return snapshot;
    });
    if (this.deletionReservations.has(agentId)) {
      await this.store.mutate((database) => {
        database.runs = database.runs.filter((item) => item.id !== run.id);
        database.messages = database.messages.filter((item) => item.id !== message.id);
        const storedAgent = database.agents.find((item) => item.id === agentId);
        if (storedAgent?.status === "busy") {
          storedAgent.status = "ready";
          storedAgent.updatedAt = now();
        }
      });
      throw new HttpError(409, "Agent deletion is in progress");
    }
    const execution = this.executeRun(agentAtStart, run);
    this.activeExecutions.set(agentId, execution);
    void execution
      .finally(() => {
        if (this.activeExecutions.get(agentId) === execution) {
          this.activeExecutions.delete(agentId);
        }
      })
      .catch(() => undefined);
    return { run, message };
  }

  async systemInfo(): Promise<Record<string, unknown>> {
    return {
      arkConfigured: isArkConfigured(this.config),
      arkBaseUrl: this.config.arkBaseUrl,
      arkModel: this.config.arkModel || null,
      codexAvailable: await this.runner.isAvailable(),
      codexSandboxMode: this.config.codexSandboxMode,
      runtimeProvider: this.config.runtimeProvider,
      shepherdExecutionMode: this.config.shepherdExecutionMode,
      shepherdModelReviewConfigured: isShepherdModelReviewConfigured(this.config),
      containerEngine:
        this.config.runtimeProvider === "container"
          ? this.config.containerEngine
          : null,
      runtime:
        this.config.runtimeProvider === "container"
          ? "Codex CLI in " + this.config.containerEngine + " Runtime"
          : "Codex CLI in application container",
    };
  }

  private async executeRun(agentAtStart: Agent, run: AgentRun): Promise<void> {
    await this.store.mutate((database) => {
      const storedRun = database.runs.find((item) => item.id === run.id);
      if (storedRun) {
        storedRun.status = "running";
        storedRun.startedAt = now();
      }
    });
    try {
      if (this.cancellationRequests.has(agentAtStart.id)) {
        throw new RunCancelledError();
      }
      await this.workspaces.assertManagedWorkspace(agentAtStart);
      const result = await this.runner.run({
        agentId: agentAtStart.id,
        workspacePath: agentAtStart.workspacePath,
        prompt: run.prompt,
        threadId: agentAtStart.codexThreadId,
      });
      const completedAt = now();
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (!storedRun || !agent) return;
        storedRun.status = "completed";
        storedRun.output = result.output;
        storedRun.usage = result.usage;
        storedRun.completedAt = completedAt;
        appendWithinDurableCapacity(database.messages, [{
          id: randomUUID(),
          agentId: agent.id,
          runId: run.id,
          role: "assistant",
          content: result.output,
          createdAt: completedAt,
        }], "Agent message");
        agent.status = "ready";
        agent.codexThreadId = result.threadId;
        agent.lastError = null;
        agent.updatedAt = completedAt;
      });
    } catch (error) {
      const completedAt = now();
      const cancelled = error instanceof RunCancelledError;
      const message = error instanceof Error ? error.message : String(error);
      await this.store.mutate((database) => {
        const storedRun = database.runs.find((item) => item.id === run.id);
        const agent = database.agents.find((item) => item.id === agentAtStart.id);
        if (storedRun) {
          storedRun.status = cancelled ? "cancelled" : "failed";
          storedRun.error = message;
          storedRun.completedAt = completedAt;
        }
        if (agent) {
          if (agent.status !== "stopped") {
            agent.status = cancelled ? "ready" : "error";
          }
          agent.lastError = cancelled ? null : message;
          agent.updatedAt = completedAt;
        }
      });
    }
  }

  private async setStatus(
    id: string,
    status: Agent["status"],
    rejectShepherdReservation = false,
  ): Promise<Agent> {
    return this.store.mutate((database) => {
      const agent = database.agents.find((item) => item.id === id);
      if (!agent) {
        throw new HttpError(404, "Agent not found");
      }
      if (rejectShepherdReservation && agent.currentContractId) {
        throw new HttpError(
          409,
          status === "stopped"
            ? "Cancel or finish the Shepherd Contract first"
            : "Shepherd is currently using this Agent",
        );
      }
      if (status === "ready" && agent.status === "busy") {
        throw new HttpError(409, "Stop the active run before starting this Agent");
      }
      agent.status = status;
      if (status === "ready") agent.lastError = null;
      agent.updatedAt = now();
      return structuredClone(agent);
    });
  }

  private async cancelExecution(agentId: string): Promise<void> {
    this.cancellationRequests.add(agentId);
    try {
      await this.runner.cancel(agentId);
      const execution = this.activeExecutions.get(agentId);
      if (execution) {
        await execution;
      }
    } finally {
      this.cancellationRequests.delete(agentId);
    }
  }
}
