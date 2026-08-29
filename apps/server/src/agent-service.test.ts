import {
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "./agent-service.js";
import { loadConfig } from "./config.js";
import { emptyDatabase } from "./database.js";
import { JsonStore } from "./store.js";
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
    new JsonStore(path.join(root, "data", "db.json")),
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
