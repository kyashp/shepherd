import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDatabase } from "./database.js";
import type { ShepherdEventInput } from "./database.js";
import { JsonStore } from "./store.js";

const temporaryDirectories: string[] = [];

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
  missionId: "mission-1",
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
  it("does not publish a mutation in memory when persistence fails", async () => {
    const root = await makeTemporaryDirectory();
    const originalPath = path.join(root, "db.json");
    const store = new JsonStore(originalPath);
    await store.initialize();

    const mutableStore = store as unknown as { filePath: string };
    mutableStore.filePath = path.join(root, "missing-directory", "db.json");
    await expect(
      store.mutate((database) => {
        database.messages.push({
          id: "message-1",
          agentId: "agent-1",
          runId: "run-1",
          role: "user",
          content: "must not become visible",
          createdAt: new Date().toISOString(),
        });
      }),
    ).rejects.toThrow();
    expect(store.snapshot().messages).toEqual([]);

    mutableStore.filePath = originalPath;
    await store.mutate((database) => {
      database.messages.push({
        id: "message-2",
        agentId: "agent-1",
        runId: "run-2",
        role: "user",
        content: "queue recovered",
        createdAt: new Date().toISOString(),
      });
    });
    expect(store.snapshot().messages.map((message) => message.content)).toEqual([
      "queue recovered",
    ]);
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
        baseCommit: "abc123",
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
