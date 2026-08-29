import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDatabase } from "./database.js";
import type { ShepherdEventInput } from "./database.js";
import { JsonStore, MAX_DATABASE_BYTES } from "./store.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

async function makeTemporaryDirectory(): Promise<string> {
  const root = path.resolve(process.cwd(), ".tmp", "store-tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, "case-"));
  temporaryDirectories.push(directory);
  return directory;
}

const eventInput = (summary: string): ShepherdEventInput => ({
  type: "mission_created",
  summary,
  actor: { type: "shepherd", id: null, displayName: "Shepherd" },
  missionId: null,
  contractId: null,
  agentId: null,
  planeId: null,
  collisionId: null,
  candidateId: null,
  details: {},
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JsonStore", () => {
  it("rejects a FIFO state path without blocking startup", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    await execFileAsync("mkfifo", [databasePath]);

    await expect(new JsonStore(databasePath).initialize()).rejects.toThrow(
      "Database state file must be a regular file",
    );
  });

  it("rejects a symbolic-link state file without reading its target", async () => {
    const root = await makeTemporaryDirectory();
    const targetPath = path.join(root, "outside-state.json");
    const databasePath = path.join(root, "db.json");
    const targetContents = JSON.stringify(emptyDatabase());
    await writeFile(targetPath, targetContents, "utf8");
    await symlink(targetPath, databasePath);

    await expect(new JsonStore(databasePath).initialize()).rejects.toThrow(
      "Database state file must not be a symbolic link",
    );
    expect(await readFile(targetPath, "utf8")).toBe(targetContents);
  });

  it("rejects an oversized state file before reading or parsing it", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    await writeFile(databasePath, "{", "utf8");
    await truncate(databasePath, MAX_DATABASE_BYTES + 1);

    await expect(new JsonStore(databasePath).initialize()).rejects.toThrow(
      "Database state file exceeds the maximum supported size",
    );
  });

  it("uses an exclusive unique temporary file and leaves a fixed-name symlink untouched", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const fixedTemporaryPath = databasePath + ".tmp";
    const targetPath = path.join(root, "sentinel.txt");
    await writeFile(targetPath, "preserve", "utf8");
    await symlink(targetPath, fixedTemporaryPath);

    const store = new JsonStore(databasePath);
    await store.initialize();

    expect(await readlink(fixedTemporaryPath)).toBe(targetPath);
    expect(await readFile(targetPath, "utf8")).toBe("preserve");
    expect(JSON.parse(await readFile(databasePath, "utf8"))).toMatchObject({
      version: 2,
    });
    expect(
      (await readdir(root)).filter(
        (entry) => /^db\.json\..+\.tmp$/u.test(entry),
      ),
    ).toEqual([]);
  });

  it("does not publish a mutation in memory when persistence fails", async () => {
    const root = await makeTemporaryDirectory();
    const originalPath = path.join(root, "db.json");
    const store = new JsonStore(originalPath);
    await store.initialize();

    const mutableStore = store as unknown as { filePath: string };
    mutableStore.filePath = path.join(root, "missing-directory", "db.json");
    await expect(
      store.mutate((database) => {
        database.shepherd.settings.modelReviewEnabled = false;
      }),
    ).rejects.toThrow();
    expect(store.snapshot().shepherd.settings.modelReviewEnabled).toBe(true);

    mutableStore.filePath = originalPath;
    await store.mutate((database) => {
      database.shepherd.settings.modelReviewEnabled = false;
    });
    expect(store.snapshot().shepherd.settings.modelReviewEnabled).toBe(false);
  });

  it("migrates V1 on disk atomically and preserves legacy values", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const fixture = await readFile(
      new URL("./test-fixtures/database-v1.json", import.meta.url),
      "utf8",
    );
    await writeFile(databasePath, fixture, "utf8");
    const captured = JSON.parse(fixture) as {
      agents: unknown[];
      messages: unknown[];
      runs: unknown[];
    };

    const store = new JsonStore(databasePath);
    await store.initialize();

    expect(store.snapshot()).toMatchObject({
      version: 2,
      agents: captured.agents,
      messages: captured.messages,
      runs: captured.runs,
      shepherd: { nextEventSequence: 1, events: [] },
    });
    const persisted = JSON.parse(await readFile(databasePath, "utf8")) as {
      version: number;
      agents: unknown[];
    };
    expect(persisted.version).toBe(2);
    expect(persisted.agents).toEqual(captured.agents);
  });

  it("serializes concurrent event allocation without duplicate cursors", async () => {
    const root = await makeTemporaryDirectory();
    const store = new JsonStore(path.join(root, "db.json"));
    await store.initialize();

    const events = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        store.appendShepherdEvent(eventInput(`event-${index}`)),
      ),
    );

    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect(store.snapshot().shepherd.nextEventSequence).toBe(41);
    expect(store.shepherdEventsAfter(35).map((event) => event.sequence)).toEqual([
      36, 37, 38, 39, 40,
    ]);
  });

  it("does not consume an event cursor when persistence fails", async () => {
    const root = await makeTemporaryDirectory();
    const originalPath = path.join(root, "db.json");
    const store = new JsonStore(originalPath);
    await store.initialize();
    const mutableStore = store as unknown as { filePath: string };
    mutableStore.filePath = path.join(root, "missing-directory", "db.json");

    await expect(store.appendShepherdEvent(eventInput("not durable"))).rejects.toThrow();
    expect(store.snapshot().shepherd).toMatchObject({
      events: [],
      nextEventSequence: 1,
    });

    mutableStore.filePath = originalPath;
    const event = await store.appendShepherdEvent(eventInput("durable"));
    expect(event.sequence).toBe(1);
  });

  it("rejects an oversized mutation atomically and leaves a restartable file", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const store = new JsonStore(databasePath, { maximumDatabaseBytes: 4_096 });
    await store.initialize();
    const before = await readFile(databasePath, "utf8");

    await expect(
      store.mutate((database) => {
        database.agents.push({
          id: "large-agent",
          name: "Large Agent",
          description: "",
          instructions: "x".repeat(8_000),
          status: "ready",
          workspacePath: "/managed/large-agent",
          codexThreadId: null,
          lastError: null,
          createdAt: "2026-08-29T12:00:00.000Z",
          updatedAt: "2026-08-29T12:00:00.000Z",
        });
      }),
    ).rejects.toThrow("Database state exceeds the maximum supported size");

    expect(store.snapshot().agents).toEqual([]);
    expect(await readFile(databasePath, "utf8")).toBe(before);
    const restarted = new JsonStore(databasePath, { maximumDatabaseBytes: 4_096 });
    await restarted.initialize();
    expect(restarted.snapshot().agents).toEqual([]);
  });

  it("removes configured and common credentials from every persisted string", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const canary = "STORE_CANARY_4d9f8127";
    const bearer = "abcdef0123456789";
    const store = new JsonStore(databasePath, {
      sensitiveValues: ["", "   ", "abc", canary],
    });
    await store.initialize();

    await store.mutate((database) => {
      database.agents.push({
        id: "agent-secret",
        name: "Secret-safe Agent",
        description: "abc123 ordinary marker",
        instructions: "",
        status: "ready",
        workspacePath: "/managed/agent-secret",
        codexThreadId: null,
        lastError: null,
        createdAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:00:00.000Z",
      });
      database.messages.push({
        id: "message-secret",
        agentId: "agent-secret",
        runId: "run-secret",
        role: "user",
        content: `Please retain this ordinary request, but not ${canary}`,
        createdAt: "2026-08-29T12:00:00.000Z",
      });
      database.runs.push({
        id: "run-secret",
        agentId: "agent-secret",
        status: "completed",
        prompt: `Implement the ordinary transport flow; marker ${canary}`,
        output: `Completed safely. Authorization: Bearer ${bearer}`,
        error: `Runtime rejected credential ${canary}`,
        usage: null,
        startedAt: "2026-08-29T12:00:00.000Z",
        completedAt: "2026-08-29T12:00:01.000Z",
        createdAt: "2026-08-29T12:00:00.000Z",
      });
      database.shepherd.missions.push({
        id: "mission-secret",
        projectId: "project-1",
        originalIntent: "Preserve this legitimate mission intent",
        baseCommit: "a".repeat(40),
        contractIds: [],
        dependencyEdges: [],
        collisionIds: [],
        resolutionIds: [],
        state: "failed",
        attentionReason: null,
        failure: {
          code: "agent_runtime_error",
          message: `Failure evidence contained ${canary}`,
          stage: "execution",
          at: "2026-08-29T12:00:01.000Z",
          retryable: false,
        },
        createdAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:00:01.000Z",
        startedAt: "2026-08-29T12:00:00.000Z",
        completedAt: "2026-08-29T12:00:01.000Z",
      });
      database.shepherd.projects.push({
        id: "project-1",
        displayName: "Secret-safe project",
        repositoryPath: "/managed/project-1",
        protectedBranch: "main",
        protectedHeadCommit: "a".repeat(40),
        activeMissionId: null,
        createdAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:00:01.000Z",
      });
    });
    const event = await store.appendShepherdEvent({
      ...eventInput(`Collision evidence ${canary}`),
      details: {
        failure: `Verifier exposed ${canary}`,
        ordinary: "Scope validation remains inspectable",
      },
    });

    const snapshot = store.snapshot();
    const memoryJson = JSON.stringify(snapshot);
    const diskJson = await readFile(databasePath, "utf8");
    for (const serialized of [memoryJson, diskJson]) {
      expect(serialized).not.toContain(canary);
      expect(serialized).not.toContain(bearer);
      expect(serialized).toContain("[REDACTED]");
      expect(serialized).toContain("ordinary transport flow");
      expect(serialized).toContain("legitimate mission intent");
      expect(serialized).toContain("Scope validation remains inspectable");
    }
    expect(snapshot.runs[0]?.prompt).toContain("Implement the ordinary transport flow");
    expect(snapshot.messages[0]?.content).toContain("ordinary request");
    expect(event.summary).toBe("Collision evidence [REDACTED]");
    // Short values are not treated as configured secrets.
    expect(JSON.stringify(snapshot)).toContain("abc123");
  });

  it("scrubs an existing V2 file before publishing it during initialize", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const canary = "EXISTING_CANARY_91ea35";
    const database = emptyDatabase("2026-08-29T12:00:00.000Z");
    database.agents.push({
      id: "agent-1",
      name: "Existing Agent",
      description: "",
      instructions: "",
      status: "ready",
      workspacePath: "/managed/agent-1",
      codexThreadId: null,
      lastError: null,
      createdAt: "2026-08-29T12:00:00.000Z",
      updatedAt: "2026-08-29T12:00:00.000Z",
    });
    database.runs.push({
      id: "run-1",
      agentId: "agent-1",
      status: "completed",
      prompt: "Keep this request",
      output: "Stored",
      error: null,
      usage: null,
      startedAt: "2026-08-29T12:00:00.000Z",
      completedAt: "2026-08-29T12:00:00.000Z",
      createdAt: "2026-08-29T12:00:00.000Z",
    });
    database.messages.push({
      id: "existing-message",
      agentId: "agent-1",
      runId: "run-1",
      role: "user",
      content: `Keep this request and remove ${canary}`,
      createdAt: "2026-08-29T12:00:00.000Z",
    });
    await writeFile(databasePath, JSON.stringify(database), "utf8");

    const store = new JsonStore(databasePath, { sensitiveValues: [canary] });
    await store.initialize();

    expect(JSON.stringify(store.snapshot())).not.toContain(canary);
    expect(JSON.stringify(store.snapshot())).toContain("Keep this request");
    expect(await readFile(databasePath, "utf8")).not.toContain(canary);
  });

  it("rejects accessor-backed mutation state without invoking the accessor", async () => {
    const root = await makeTemporaryDirectory();
    const store = new JsonStore(path.join(root, "db.json"));
    await store.initialize();
    let invoked = false;

    await expect(
      store.mutate((database) => {
        Object.defineProperty(database.shepherd.settings, "accessor", {
          enumerable: true,
          get: () => {
            invoked = true;
            return "must never run";
          },
        });
      }),
    ).rejects.toThrow("contains an accessor");
    expect(invoked).toBe(false);
    expect(JSON.stringify(store.snapshot())).not.toContain("must never run");
  });
});
