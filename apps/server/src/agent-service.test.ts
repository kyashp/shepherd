import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentService } from "./agent-service.js";
import { loadConfig } from "./config.js";
import { emptyDatabase } from "./database.js";
import { JsonStore } from "./store.js";
import type { JsonStoreOptions, PersistenceFaultStage } from "./store.js";
import { ShepherdService } from "./shepherd/service.js";
import type { Agent, AgentRunner, Database, RunnerRequest, RunnerResult } from "./types.js";
import { WorkspaceManager } from "./workspace.js";

class FakeRunner implements AgentRunner {
  async run(request: RunnerRequest): Promise<RunnerResult> {
    return {
      output: "Completed: " + request.prompt,
      threadId: request.threadId ?? "fake-thread",
      usage: { inputTokens: 12, outputTokens: 5 },
    };
  }
  async cancel(): Promise<boolean> {
    return false;
  }
  async isAvailable(): Promise<boolean> {
    return true;
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function makeService(
  runner: AgentRunner = new FakeRunner(),
  configOverrides: Record<string, string | undefined> = {},
  storeOptions: JsonStoreOptions = {},
): Promise<AgentService> {
  const testRoot = path.resolve(process.cwd(), ".tmp", "agent-service-tests");
  await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(path.join(testRoot, "case-"));
  temporaryDirectories.push(root);
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: path.join(root, "data"),
    AGENT_WORKSPACE_ROOT: path.join(root, "workspaces"),
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key",
    ARK_MODEL: "ep-test",
    ...configOverrides,
  });
  const service = new AgentService(
    config,
    new JsonStore(path.join(root, "data", "db.json"), storeOptions),
    new WorkspaceManager(path.join(root, "workspaces")),
    runner,
  );
  await service.initialize();
  return service;
}

describe("System capabilities", () => {
  it("reports only whether the Shepherd model reviewer is configured", async () => {
    const configured = await makeService();
    const unavailable = await makeService(new FakeRunner(), { ARK_API_KEY: "" });

    await expect(configured.systemInfo()).resolves.toMatchObject({
      shepherdModelReviewConfigured: true,
    });
    await expect(unavailable.systemInfo()).resolves.toMatchObject({
      shepherdModelReviewConfigured: false,
    });
  });
});

const persistedAgent = (workspacePath: string): Agent => ({
  id: "persisted-agent",
  name: "Persisted Agent",
  description: "Existing Agent",
  instructions: "Stay within the managed workspace.",
  status: "ready",
  workspacePath,
  codexThreadId: null,
  lastError: null,
  createdAt: "2026-08-29T12:00:00.000Z",
  updatedAt: "2026-08-29T12:00:00.000Z",
});

async function makePersistedService(
  root: string,
  database: Database | (Omit<Database, "version" | "shepherd"> & { version: 1 }),
): Promise<AgentService> {
  const dataRoot = path.join(root, "data");
  const workspaceRoot = path.join(root, "workspaces");
  await mkdir(dataRoot, { recursive: true });
  await writeFile(path.join(dataRoot, "db.json"), JSON.stringify(database), "utf8");
  const config = loadConfig({
    NODE_ENV: "test",
    APP_DATA_DIR: dataRoot,
    AGENT_WORKSPACE_ROOT: workspaceRoot,
    CODEX_HOME: path.join(root, "codex"),
    ARK_API_KEY: "test-key",
    ARK_MODEL: "ep-test",
  });
  return new AgentService(
    config,
    new JsonStore(path.join(dataRoot, "db.json")),
    new WorkspaceManager(workspaceRoot),
    new FakeRunner(),
  );
}

describe("Agent lifecycle", () => {
  it("rejects an out-of-root persisted Agent workspace before the service starts", async () => {
    const testRoot = path.resolve(process.cwd(), ".tmp", "agent-service-tests");
    await mkdir(testRoot, { recursive: true });
    const root = await mkdtemp(path.join(testRoot, "case-"));
    temporaryDirectories.push(root);
    const outside = path.join(root, "outside-managed-root");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel.txt"), "preserve", "utf8");
    const database = emptyDatabase("2026-08-29T12:00:00.000Z");
    database.agents.push(persistedAgent(outside));
    const service = await makePersistedService(root, database);

    await expect(service.initialize()).rejects.toThrow(
      "Agent workspace does not match its server-owned identity",
    );
    expect(await readFile(path.join(outside, "sentinel.txt"), "utf8")).toBe(
      "preserve",
    );
  });

  it("applies the same workspace binding after a valid lossless V1 migration", async () => {
    const testRoot = path.resolve(process.cwd(), ".tmp", "agent-service-tests");
    await mkdir(testRoot, { recursive: true });
    const root = await mkdtemp(path.join(testRoot, "case-"));
    temporaryDirectories.push(root);
    const outside = path.join(root, "legacy-outside-root");
    await mkdir(outside);
    const agent = persistedAgent(outside);
    const service = await makePersistedService(root, {
      version: 1,
      agents: [agent],
      messages: [],
      runs: [],
    });

    await expect(service.initialize()).rejects.toThrow(
      "Agent workspace does not match its server-owned identity",
    );
  });

  it("rejects a symlink at the exact persisted managed workspace path", async () => {
    const testRoot = path.resolve(process.cwd(), ".tmp", "agent-service-tests");
    await mkdir(testRoot, { recursive: true });
    const root = await mkdtemp(path.join(testRoot, "case-"));
    temporaryDirectories.push(root);
    const workspaceRoot = path.join(root, "workspaces");
    const outside = path.join(root, "symlink-target");
    await mkdir(workspaceRoot);
    await mkdir(outside);
    const expected = path.join(workspaceRoot, "persisted-agent");
    await symlink(outside, expected);
    const database = emptyDatabase("2026-08-29T12:00:00.000Z");
    database.agents.push(persistedAgent(expected));
    const service = await makePersistedService(root, database);

    await expect(service.initialize()).rejects.toThrow(
      "Agent workspace cannot be a symlink or non-directory",
    );
  });

  it("creates, updates, stops, starts and deletes an Agent", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Builder" });
    expect(service.listAgents()).toHaveLength(1);
    expect((await service.updateAgent(agent.id, { description: "Builds apps" })).description)
      .toBe("Builds apps");
    expect((await service.stopAgent(agent.id)).status).toBe("stopped");
    expect((await service.startAgent(agent.id)).status).toBe("ready");
    await expect(service.deleteAgent(agent.id)).resolves.toEqual({ deleted: true });
    expect(service.listAgents()).toHaveLength(0);
  });

  it("preserves an Agent and workspace while a private Contract prompt references it", async () => {
    const service = await makeService();
    const agent = await service.createAgent({
      name: "Pending frontend owner",
      role: "Frontend",
    });
    const internals = service as unknown as {
      store: JsonStore;
      workspaces: WorkspaceManager;
    };
    await internals.store.mutate((database) => {
      database.shepherd.projects.push({
        id: "auth-demo",
        displayName: "Authentication collision demo",
        repositoryPath: path.join(agent.workspacePath, "managed-project"),
        protectedBranch: "main",
        protectedHeadCommit: "a".repeat(40),
        activeMissionId: null,
        createdAt: agent.createdAt,
        updatedAt: agent.createdAt,
      });
      database.shepherd.groupMessages.push({
        id: "group-private-pending-frontend",
        projectId: "auth-demo",
        missionId: null,
        senderType: "human",
        senderId: null,
        content: "Implement frontend auth with an HttpOnly session cookie.",
        targetAgentId: agent.id,
        contractId: null,
        contractAssignment: {
          preset: "auth-demo-contract",
          role: "Frontend",
          transport: "http-only-session-cookie",
        },
        requestFingerprint: "b".repeat(64),
        createdAt: agent.createdAt,
      });
    });
    const archive = vi.spyOn(internals.workspaces, "archive");

    await expect(service.deleteAgent(agent.id)).rejects.toMatchObject({
      statusCode: 409,
      message: "Cannot delete an Agent referenced by durable Shepherd history",
    });
    expect(archive).not.toHaveBeenCalled();
    expect(service.getAgent(agent.id)).toMatchObject({ id: agent.id, status: "ready" });
    expect(
      internals.store.snapshot().shepherd.groupMessages.find(
        (message) => message.targetAgentId === agent.id,
      ),
    ).toBeDefined();
    await expect(readFile(path.join(agent.workspacePath, "AGENTS.md"), "utf8"))
      .resolves.toContain("Pending frontend owner");
  });

  it("deletes an Agent whose only Shepherd references are unbound clarification drafts", async () => {
    const service = await makeService();
    const agent = await service.createAgent({
      name: "Clarification-only owner",
      role: "Frontend",
    });
    const internals = service as unknown as {
      store: JsonStore;
      workspaces: WorkspaceManager;
    };
    const caseRoot = path.dirname(path.dirname(agent.workspacePath));
    const managedRoot = path.join(caseRoot, "data", "shepherd");
    const shepherd = new ShepherdService({
      store: internals.store,
      managedRoot,
      agentWorkspaceRoot: path.dirname(agent.workspacePath),
      verifier: {
        verify: async () => {
          throw new Error("Clarification-only intake must not invoke verification");
        },
      },
    });
    await shepherd.initialize();
    await expect(
      shepherd.submitPrivateContractPrompt({
        agentId: agent.id,
        clientMessageId: "clarification-only-prompt",
        content: "Create a greeting script.",
      }),
    ).resolves.toMatchObject({
      status: "clarification_required",
      missionId: null,
      contractId: null,
    });
    await expect(
      shepherd.submitPrivateContractPrompt({
        agentId: agent.id,
        clientMessageId: "clarification-only-follow-up",
        content: "Create src/hello.py that prints a greeting.",
      }),
    ).resolves.toMatchObject({
      status: "clarification_required",
      missionId: null,
      contractId: null,
    });
    expect(internals.store.snapshot().shepherd).toMatchObject({
      projects: [{ id: `agent-${agent.id}`, activeMissionId: null }],
      missions: [],
      contracts: [],
      planes: [],
      events: [],
    });
    expect(internals.store.snapshot().shepherd.groupMessages).toHaveLength(2);

    await expect(service.deleteAgent(agent.id)).resolves.toEqual({ deleted: true });

    const deleted = internals.store.snapshot();
    expect(deleted.agents).toHaveLength(0);
    expect(deleted.shepherd.projects).toHaveLength(0);
    expect(deleted.shepherd.groupMessages).toHaveLength(0);
    await expect(lstat(agent.workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(managedRoot, "repositories", `agent-${agent.id}`)))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(managedRoot, "planes", `agent-${agent.id}`)))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(path.join(managedRoot, "projects", `agent-${agent.id}.json`)))
      .rejects.toMatchObject({ code: "ENOENT" });

    const recovered = new ShepherdService({
      store: internals.store,
      managedRoot,
      agentWorkspaceRoot: path.dirname(agent.workspacePath),
      verifier: {
        verify: async () => {
          throw new Error("Recovery must not invoke verification");
        },
      },
    });
    await expect(recovered.initialize()).resolves.toBeUndefined();
  });

  it.each([
    ["primary_temp_open", true],
    ["primary_directory_sync", false],
  ] as const)(
    "reconciles Agent and clarification Project deletion after %s",
    async (faultStage, agentRemainsDurable) => {
      let inject = false;
      const service = await makeService(new FakeRunner(), {}, {
        persistenceFaultCheckpoint: (stage: PersistenceFaultStage) => {
          if (inject && stage === faultStage) {
            inject = false;
            throw new Error("injected persistence fault");
          }
        },
      });
      const agent = await service.createAgent({
        name: `Recoverable ${faultStage} Agent`,
        role: "Generalist",
      });
      const internals = service as unknown as { store: JsonStore };
      const caseRoot = path.dirname(path.dirname(agent.workspacePath));
      const dataRoot = path.join(caseRoot, "data");
      const managedRoot = path.join(dataRoot, "shepherd");
      const workspaceRoot = path.dirname(agent.workspacePath);
      const shepherd = new ShepherdService({
        store: internals.store,
        managedRoot,
        agentWorkspaceRoot: workspaceRoot,
        verifier: {
          verify: async () => {
            throw new Error("Clarification recovery must not invoke verification");
          },
        },
      });
      await shepherd.initialize();
      await shepherd.submitPrivateContractPrompt({
        agentId: agent.id,
        clientMessageId: `recoverable-${faultStage}`,
        content: "Create a greeting script.",
      });

      inject = true;
      await expect(service.deleteAgent(agent.id)).rejects.toMatchObject({
        statusCode: 500,
        message: "Agent deletion persistence is uncertain; restart to reconcile safely",
      });
      await expect(lstat(agent.workspacePath)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });

      const persistedBeforeRestart = JSON.parse(
        await readFile(path.join(dataRoot, "db.json"), "utf8"),
      ) as Database;
      expect(persistedBeforeRestart.agents.some((item) => item.id === agent.id))
        .toBe(agentRemainsDurable);
      expect(
        persistedBeforeRestart.shepherd.projects.some(
          (item) => item.id === `agent-${agent.id}`,
        ),
      ).toBe(agentRemainsDurable);

      const config = loadConfig({
        NODE_ENV: "test",
        APP_DATA_DIR: dataRoot,
        AGENT_WORKSPACE_ROOT: workspaceRoot,
        CODEX_HOME: path.join(caseRoot, "codex"),
        ARK_API_KEY: "test-key",
        ARK_MODEL: "ep-test",
      });
      const recoveredStore = new JsonStore(path.join(dataRoot, "db.json"));
      const recoveredAgents = new AgentService(
        config,
        recoveredStore,
        new WorkspaceManager(workspaceRoot),
        new FakeRunner(),
      );
      await expect(recoveredAgents.initialize()).resolves.toBeUndefined();
      const recoveredShepherd = new ShepherdService({
        store: recoveredStore,
        managedRoot,
        agentWorkspaceRoot: workspaceRoot,
        verifier: {
          verify: async () => {
            throw new Error("Deletion recovery must not invoke verification");
          },
        },
      });
      await expect(recoveredShepherd.initialize()).resolves.toBeUndefined();

      expect(recoveredAgents.listAgents().some((item) => item.id === agent.id))
        .toBe(agentRemainsDurable);
      if (agentRemainsDurable) {
        await expect(lstat(agent.workspacePath)).resolves.toMatchObject({
          isDirectory: expect.any(Function),
        });
        await expect(
          lstat(path.join(managedRoot, "projects", `agent-${agent.id}.json`)),
        ).resolves.toMatchObject({ isFile: expect.any(Function) });
      } else {
        await expect(lstat(agent.workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          lstat(path.join(managedRoot, "projects", `agent-${agent.id}.json`)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(
        (await readdir(path.join(workspaceRoot, ".deleted"))).some((name) =>
          name.startsWith(`.deleting-agent-${agent.id}`),
        ),
      ).toBe(false);
      expect(
        (await readdir(path.join(managedRoot, "projects"))).some((name) =>
          name.startsWith(`.deleting-general-agent-${agent.id}`),
        ),
      ).toBe(false);
    },
  );

  it("serializes Agent archive against a racing private Contract prompt", async () => {
    let blockDeletionPersistence = false;
    let persistenceStarted!: () => void;
    const persistenceObserved = new Promise<void>((resolve) => {
      persistenceStarted = resolve;
    });
    let releasePersistence!: () => void;
    const persistenceBarrier = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const service = await makeService(new FakeRunner(), {}, {
      persistenceFaultCheckpoint: async (stage) => {
        if (blockDeletionPersistence && stage === "primary_write") {
          blockDeletionPersistence = false;
          persistenceStarted();
          await persistenceBarrier;
        }
      },
    });
    const agent = await service.createAgent({
      name: "Racing frontend owner",
      role: "Frontend",
    });
    const internals = service as unknown as {
      store: JsonStore;
      workspaces: WorkspaceManager;
    };
    const caseRoot = path.dirname(path.dirname(agent.workspacePath));
    const managedRoot = path.join(caseRoot, "data", "shepherd");
    const shepherd = new ShepherdService({
      store: internals.store,
      managedRoot,
      agentWorkspaceRoot: path.dirname(agent.workspacePath),
      verifier: {
        verify: async () => {
          throw new Error("The first private prompt must not invoke verification");
        },
      },
    });
    await shepherd.initialize();
    blockDeletionPersistence = true;
    const deletion = service.deleteAgent(agent.id);
    await persistenceObserved;
    const racingPrompt = shepherd.submitPrivateContractPrompt({
      agentId: agent.id,
      clientMessageId: "racing-private-prompt",
      content: "Implement frontend auth with an HttpOnly session cookie.",
    });
    const promptRejection = expect(racingPrompt).rejects.toMatchObject({
      code: "conflict",
    });
    releasePersistence();

    await expect(deletion).resolves.toEqual({ deleted: true });
    await promptRejection;
    expect(internals.store.snapshot().shepherd.projects).toHaveLength(0);
    expect(internals.store.snapshot().shepherd.groupMessages).toHaveLength(0);
    expect(() => service.getAgent(agent.id)).toThrow("Agent not found");
    await expect(lstat(agent.workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
    const archivedNames = await readdir(path.join(path.dirname(agent.workspacePath), ".deleted"));
    expect(archivedNames.filter((name) => name.startsWith(`${agent.id}-`))).toHaveLength(1);
    expect(archivedNames.some((name) => name.startsWith(".deleting-agent-"))).toBe(false);
    await expect(lstat(path.join(managedRoot, "projects", "auth-demo.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    const recovered = new ShepherdService({
      store: internals.store,
      managedRoot,
      agentWorkspaceRoot: path.dirname(agent.workspacePath),
      verifier: {
        verify: async () => {
          throw new Error("Recovery must not invoke verification");
        },
      },
    });
    await expect(recovered.initialize()).resolves.toBeUndefined();
  });

  it("does not strand a general-project policy journal when clarification races deletion", async () => {
    let blockDeletionPersistence = false;
    let persistenceStarted!: () => void;
    const persistenceObserved = new Promise<void>((resolve) => {
      persistenceStarted = resolve;
    });
    let releasePersistence!: () => void;
    const persistenceBarrier = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const service = await makeService(new FakeRunner(), {}, {
      persistenceFaultCheckpoint: async (stage) => {
        if (blockDeletionPersistence && stage === "primary_write") {
          blockDeletionPersistence = false;
          persistenceStarted();
          await persistenceBarrier;
        }
      },
    });
    const agent = await service.createAgent({
      name: "Racing general draft owner",
      role: "Generalist",
    });
    const internals = service as unknown as { store: JsonStore };
    const caseRoot = path.dirname(path.dirname(agent.workspacePath));
    const managedRoot = path.join(caseRoot, "data", "shepherd");
    const workspaceRoot = path.dirname(agent.workspacePath);
    const shepherd = new ShepherdService({
      store: internals.store,
      managedRoot,
      agentWorkspaceRoot: workspaceRoot,
      verifier: {
        verify: async () => {
          throw new Error("Clarification race must not invoke verification");
        },
      },
    });
    await shepherd.initialize();
    await expect(
      shepherd.submitPrivateContractPrompt({
        agentId: agent.id,
        clientMessageId: "general-race-first",
        content: "Create a greeting script.",
      }),
    ).resolves.toMatchObject({ status: "clarification_required" });

    blockDeletionPersistence = true;
    const deletion = service.deleteAgent(agent.id);
    await persistenceObserved;
    const racingPrompt = shepherd.submitPrivateContractPrompt({
      agentId: agent.id,
      clientMessageId: "general-race-follow-up",
      content: "Create scripts/hello.txt containing a greeting.",
    });
    const promptRejection = expect(racingPrompt).rejects.toMatchObject({
      code: "conflict",
    });
    releasePersistence();

    await expect(deletion).resolves.toEqual({ deleted: true });
    await promptRejection;
    expect(await readdir(path.join(managedRoot, "projects"))).toEqual([]);
    expect(internals.store.snapshot().shepherd.projects).toEqual([]);
    expect(internals.store.snapshot().shepherd.groupMessages).toEqual([]);

    const config = loadConfig({
      NODE_ENV: "test",
      APP_DATA_DIR: path.join(caseRoot, "data"),
      AGENT_WORKSPACE_ROOT: workspaceRoot,
      CODEX_HOME: path.join(caseRoot, "codex"),
      ARK_API_KEY: "test-key",
      ARK_MODEL: "ep-test",
    });
    const recoveredStore = new JsonStore(path.join(caseRoot, "data", "db.json"));
    const recoveredAgents = new AgentService(
      config,
      recoveredStore,
      new WorkspaceManager(workspaceRoot),
      new FakeRunner(),
    );
    await expect(recoveredAgents.initialize()).resolves.toBeUndefined();
    const recoveredShepherd = new ShepherdService({
      store: recoveredStore,
      managedRoot,
      agentWorkspaceRoot: workspaceRoot,
      verifier: {
        verify: async () => {
          throw new Error("Restart after the clarification race must remain idle");
        },
      },
    });
    await expect(recoveredShepherd.initialize()).resolves.toBeUndefined();
  });

  it("does not stop an Agent reserved by Shepherd while cancellation is pending", async () => {
    let cancellationStarted!: () => void;
    const cancellationObserved = new Promise<void>((resolve) => {
      cancellationStarted = resolve;
    });
    let releaseCancellation!: () => void;
    const cancellationBarrier = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const service = await makeService({
      run: async () => ({ output: "done", threadId: "thread", usage: null }),
      cancel: async () => {
        cancellationStarted();
        await cancellationBarrier;
        return true;
      },
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Reserved during stop" });
    const stop = service.stopAgent(agent.id);
    await cancellationObserved;
    const store = (service as unknown as { store: JsonStore }).store;
    const reservedSnapshot = store.snapshot();
    const reserved = reservedSnapshot.agents.find((item) => item.id === agent.id);
    if (!reserved) throw new Error("Test Agent disappeared");
    reserved.currentContractId = "contract-race-guard";
    reserved.status = "busy";
    const mutation = vi.spyOn(store, "mutate").mockImplementationOnce(async (mutator) => {
      return await mutator(reservedSnapshot);
    });
    releaseCancellation();

    await expect(stop).rejects.toMatchObject({ statusCode: 409 });
    expect(mutation).toHaveBeenCalledOnce();
    expect(service.getAgent(agent.id)).toMatchObject({ status: "ready" });
  });

  it("persists role and normalized scoped authority across restart", async () => {
    const testRoot = path.resolve(process.cwd(), ".tmp", "agent-service-tests");
    await mkdir(testRoot, { recursive: true });
    const root = await mkdtemp(path.join(testRoot, "case-"));
    temporaryDirectories.push(root);
    const dataRoot = path.join(root, "data");
    const workspaceRoot = path.join(root, "workspaces");
    const databasePath = path.join(dataRoot, "db.json");
    const config = loadConfig({
      NODE_ENV: "test",
      APP_DATA_DIR: dataRoot,
      AGENT_WORKSPACE_ROOT: workspaceRoot,
      CODEX_HOME: path.join(root, "codex"),
      ARK_API_KEY: "test-key",
      ARK_MODEL: "ep-test",
    });
    const first = new AgentService(
      config,
      new JsonStore(databasePath),
      new WorkspaceManager(workspaceRoot),
      new FakeRunner(),
    );
    await first.initialize();
    const created = await first.createAgent({
      name: "Frontend owner",
      role: "Frontend",
      authority: {
        readable: ["./src//frontend/**", "src/frontend/**"],
        writable: ["src/frontend/components/**", "src/frontend/**"],
        forbidden: [".shepherd/**", ".git/**"],
      },
    });
    expect(created).toMatchObject({
      role: "Frontend",
      authority: {
        readable: ["src/frontend/**"],
        writable: ["src/frontend/**", "src/frontend/components/**"],
        forbidden: [".git/**", ".shepherd/**"],
      },
    });

    const second = new AgentService(
      config,
      new JsonStore(databasePath),
      new WorkspaceManager(workspaceRoot),
      new FakeRunner(),
    );
    await second.initialize();
    expect(second.getAgent(created.id)).toMatchObject({
      role: "Frontend",
      authority: created.authority,
    });
  });

  it("defaults new Agents to the bounded generalist preset", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Builder" });
    expect(agent.role).toBe("Generalist");
    expect(agent.authority?.readable).toEqual(["**"]);
    expect(agent.authority?.writable).toEqual([
      "apps/**",
      "docs/**",
      "scripts/**",
      "src/**",
      "test/**",
      "tests/**",
    ]);
    expect(agent.authority?.forbidden).toContain(".shepherd/**");
  });

  it("rejects host paths, traversal, null bytes, and unsupported glob syntax", async () => {
    const service = await makeService();
    for (const pattern of [
      "/etc/passwd",
      "../outside/**",
      "src/\0secret/**",
      "src/{frontend,backend}/**",
      "C:\\Users\\owner\\repo\\**",
    ]) {
      await expect(
        service.createAgent({
          name: "Unsafe",
          authority: { readable: ["**"], writable: [pattern], forbidden: [] },
        }),
        pattern,
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(service.listAgents()).toHaveLength(0);
  });

  it("resets authority to the matching preset on a role-only update", async () => {
    const service = await makeService();
    const created = await service.createAgent({ name: "Owner", role: "Backend" });
    const roleOnly = await service.updateAgent(created.id, { role: "Generalist" });
    expect(roleOnly.role).toBe("Generalist");
    expect(roleOnly.authority?.writable).toEqual([
      "apps/**",
      "docs/**",
      "scripts/**",
      "src/**",
      "test/**",
      "tests/**",
    ]);

    await expect(
      service.updateAgent(created.id, {
        name: "Should not persist",
        authority: {
          readable: ["**"],
          writable: ["../../host/**"],
          forbidden: [],
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(service.getAgent(created.id).name).toBe("Owner");
  });

  it("persists a playground conversation", async () => {
    const service = await makeService();
    const agent = await service.createAgent({ name: "Coder" });
    const { run } = await service.sendMessage(agent.id, "write hello world");
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
    const messages = service.getMessages(agent.id);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).toContain("write hello world");
    expect(service.getAgent(agent.id).codexThreadId).toBe("fake-thread");
  });

  it("atomically accepts only one concurrent run per Agent", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const runner: AgentRunner = {
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    };
    const service = await makeService(runner);
    const agent = await service.createAgent({ name: "Concurrent" });
    const attempts = await Promise.allSettled([
      service.sendMessage(agent.id, "first"),
      service.sendMessage(agent.id, "second"),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: { statusCode: 409 } });
    expect(service.getMessages(agent.id)).toHaveLength(1);

    finish({ output: "done", threadId: "thread", usage: null });
    const accepted = attempts.find((attempt) => attempt.status === "fulfilled");
    if (accepted?.status === "fulfilled") {
      await expect.poll(() => service.getRun(accepted.value.run.id).status).toBe("completed");
    }
  });

  it("does not let start reset a busy Agent and admit a second run", async () => {
    let finish!: (result: RunnerResult) => void;
    const pending = new Promise<RunnerResult>((resolve) => {
      finish = resolve;
    });
    const service = await makeService({
      run: () => pending,
      cancel: async () => false,
      isAvailable: async () => true,
    });
    const agent = await service.createAgent({ name: "Busy" });
    const { run } = await service.sendMessage(agent.id, "first");

    await expect(service.startAgent(agent.id)).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.sendMessage(agent.id, "second")).rejects.toMatchObject({
      statusCode: 409,
    });

    finish({ output: "done", threadId: "thread", usage: null });
    await expect.poll(() => service.getRun(run.id).status).toBe("completed");
  });
});
