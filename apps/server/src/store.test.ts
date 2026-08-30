import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { emptyDatabase } from "./database.js";
import type { ShepherdEventInput } from "./database.js";
import {
  JsonStore,
  MAX_DATABASE_BYTES,
  type PersistenceRecoveryIntentInput,
  type PersistenceFaultStage,
} from "./store.js";
import { reconcilePersistenceRecoveryIntent } from "./shepherd/recovery.js";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);
const managedDirectoryFor = (databasePath: string): string =>
  path.join(path.dirname(databasePath), `.${path.basename(databasePath)}.managed-temporaries`);

const recoveryIntent = (): PersistenceRecoveryIntentInput => ({
  operation: "mission_verification_transition",
  missionId: "mission-test",
  contractIds: ["contract-front", "contract-back"],
  planeIds: ["plane-front", "plane-back"],
  stage: "mission_verification_persistence",
  timestamp: "2026-08-30T00:00:00.000Z",
});

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

  it("retains a bounded recovery journal while rolling back a failed primary write", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    let inject = false;
    const store = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (inject && stage === "primary_write") throw new Error("opaque primary fault");
      },
    });
    await store.initialize();
    const before = await readFile(databasePath, "utf8");
    inject = true;
    await expect(store.mutateRecoverably(recoveryIntent(), (database) => {
      database.shepherd.settings.modelReviewEnabled = false;
    })).rejects.toThrow("Database persistence did not complete durably");
    expect(store.snapshot().shepherd.settings.modelReviewEnabled).toBe(true);
    expect(await readFile(databasePath, "utf8")).toBe(before);
    expect(store.persistenceRecoveryIntent()).toMatchObject(recoveryIntent());
    const journal = await readFile(databasePath + ".persistence-intent.json", "utf8");
    expect(journal).not.toContain("opaque primary fault");
    expect(journal.length).toBeLessThan(8_192);
  });

  it("distinguishes a committed rename from directory-sync ambiguity by digest", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    let inject = false;
    const store = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (inject && stage === "primary_directory_sync") {
          throw new Error("opaque directory sync fault");
        }
      },
    });
    await store.initialize();
    inject = true;
    await expect(store.mutateRecoverably(recoveryIntent(), (database) => {
      database.shepherd.settings.modelReviewEnabled = false;
    })).rejects.toThrow("Database persistence did not complete durably");
    const pending = store.persistenceRecoveryIntent();
    expect(pending).not.toBeNull();

    const restarted = new JsonStore(databasePath);
    await restarted.initialize();
    expect(restarted.snapshot().shepherd.settings.modelReviewEnabled).toBe(false);
    expect(restarted.persistenceRecoveryIntent()).toEqual(pending);
    expect(restarted.currentDigest()).not.toBe(pending?.beforeDigest);
  });

  it("blocks the primary mutation when recovery journal creation fails", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    let inject = false;
    const store = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (inject && stage === "journal_write") throw new Error("opaque journal fault");
      },
    });
    await store.initialize();
    const before = await readFile(databasePath, "utf8");
    inject = true;
    await expect(store.mutateRecoverably(recoveryIntent(), (database) => {
      database.shepherd.settings.modelReviewEnabled = false;
    })).rejects.toThrow("Persistence recovery journal is unavailable");
    expect(store.snapshot().shepherd.settings.modelReviewEnabled).toBe(true);
    expect(await readFile(databasePath, "utf8")).toBe(before);
    expect(store.persistenceRecoveryIntent()).toBeNull();
    await expect(readFile(databasePath + ".persistence-intent.json", "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    "journal_temp_open",
    "journal_write",
    "journal_file_sync",
    "journal_close",
    "journal_rename",
    "journal_directory_sync",
  ] satisfies PersistenceFaultStage[])("bounds %s journal faults without changing primary state", async (faultStage) => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const canary = `F06_SECRET ${faultStage} EACCES /Users/private/journal`;
    let inject = false;
    const store = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (inject && stage === faultStage) throw new Error(canary);
      },
      sensitiveValues: ["F06_SECRET"],
    });
    await store.initialize();
    const before = await readFile(databasePath, "utf8");
    inject = true;
    const error = await store.mutateRecoverably(recoveryIntent(), (database) => {
      database.shepherd.settings.modelReviewEnabled = false;
    }).then(() => null, (caught: unknown) => caught as Error);
    expect(error).toMatchObject({
      name: "PersistenceBoundaryError",
      message: "Persistence recovery journal is unavailable",
    });
    expect(`${error?.message}\n${error?.stack}`).not.toContain(canary);
    expect(await readFile(databasePath, "utf8")).toBe(before);
    expect(store.snapshot().shepherd.settings.modelReviewEnabled).toBe(true);
    expect(store.persistenceRecoveryIntent() !== null).toBe(
      faultStage === "journal_directory_sync",
    );
  });

  it.each([
    "primary_temp_open",
    "primary_write",
    "primary_file_sync",
    "primary_close",
    "primary_rename",
    "primary_directory_sync",
  ] satisfies PersistenceFaultStage[])("retains recoverable evidence with bounded %s primary faults", async (faultStage) => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const canary = `F06_SECRET ${faultStage} EIO /home/private/state`;
    let inject = false;
    const store = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (inject && stage === faultStage) throw new Error(canary);
      },
      sensitiveValues: ["F06_SECRET"],
    });
    await store.initialize();
    inject = true;
    const error = await store.mutateRecoverably(recoveryIntent(), (database) => {
      database.shepherd.settings.modelReviewEnabled = false;
    }).then(() => null, (caught: unknown) => caught as Error);
    expect(error).toMatchObject({
      name: "PersistenceBoundaryError",
      message: "Database persistence did not complete durably",
    });
    expect(`${error?.message}\n${error?.stack}`).not.toContain(canary);
    expect(store.persistenceRecoveryIntent()).toMatchObject(recoveryIntent());
    const onDisk = JSON.parse(await readFile(databasePath, "utf8")) as ReturnType<typeof emptyDatabase>;
    expect(onDisk.shepherd.settings.modelReviewEnabled).toBe(
      faultStage === "primary_directory_sync" ? false : true,
    );
  });

  it.each(["journal_remove", "journal_remove_directory_sync"] satisfies PersistenceFaultStage[])(
    "leaves committed state and an idempotent journal on %s cleanup failure",
    async (faultStage) => {
      const root = await makeTemporaryDirectory();
      const databasePath = path.join(root, "db.json");
      let inject = false;
      const store = new JsonStore(databasePath, {
        persistenceFaultCheckpoint: (stage) => {
          if (inject && stage === faultStage) throw new Error("F06_SECRET cleanup path");
        },
      });
      await store.initialize();
      inject = true;
      await expect(store.mutateRecoverably(recoveryIntent(), (database) => {
        database.shepherd.settings.modelReviewEnabled = false;
      })).rejects.toThrow("Persistence recovery cleanup remains pending");
      expect(JSON.parse(await readFile(databasePath, "utf8"))).toMatchObject({
        shepherd: { settings: { modelReviewEnabled: false } },
      });
      expect(store.persistenceRecoveryIntent()).toMatchObject(recoveryIntent());
    },
  );

  it.each([
    "primary_marker_temp_open", "primary_marker_write", "primary_marker_file_sync",
    "primary_marker_close", "primary_marker_rename", "primary_marker_directory_sync",
    "journal_marker_temp_open", "journal_marker_write", "journal_marker_file_sync",
    "journal_marker_close", "journal_marker_rename", "journal_marker_directory_sync",
  ] satisfies PersistenceFaultStage[])("never creates an unmarked sensitive temp after %s", async (faultStage) => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    let inject = false;
    const store = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (inject && stage === faultStage) throw new Error("TST22_PRIVATE marker failure");
      },
    });
    await store.initialize();
    inject = true;
    const operation = faultStage.startsWith("primary_")
      ? store.mutate((database) => { database.shepherd.settings.modelReviewEnabled = false; })
      : store.mutateRecoverably(recoveryIntent(), () => undefined);
    const error = await operation.then(() => null, (caught: unknown) => caught as Error);
    expect(error).toMatchObject({ name: "PersistenceBoundaryError" });
    expect(`${error?.message}\n${error?.stack}`).not.toContain("TST22_PRIVATE");
    const managedDirectory = managedDirectoryFor(databasePath);
    const sensitiveTemps = (await readdir(managedDirectory)).filter((name) =>
      /db\.json(?:\.persistence-intent\.json)?\.[0-9a-f-]+\.tmp$/iu.test(name),
    );
    expect(sensitiveTemps).toEqual([]);
    inject = false;
    await store.initialize();
    expect((await readdir(managedDirectory)).filter((name) => name.includes("managed-temporary"))).toEqual([]);
  });

  it("blocks ordinary mutations and event allocation while recovery is pending", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    let inject = false;
    const store = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (inject && stage === "primary_write") throw new Error("primary blocked");
      },
    });
    await store.initialize();
    inject = true;
    await expect(store.mutateRecoverably(recoveryIntent(), (database) => {
      database.shepherd.settings.modelReviewEnabled = false;
    })).rejects.toThrow("Database persistence did not complete durably");
    inject = false;
    const before = await readFile(databasePath, "utf8");
    await expect(store.mutate((database) => {
      database.shepherd.settings.autoResolution = false;
    })).rejects.toThrow("Persistence recovery reconciliation is pending");
    await expect(store.appendShepherdEvent(eventInput("must not allocate")))
      .rejects.toThrow("Persistence recovery reconciliation is pending");
    expect(await readFile(databasePath, "utf8")).toBe(before);
    expect(store.snapshot().shepherd.nextEventSequence).toBe(1);
    expect(store.snapshot().shepherd.events).toEqual([]);
  });

  it.each(["malformed", "oversized", "symlink"] as const)(
    "fails closed on a %s recovery journal",
    async (variant) => {
      const root = await makeTemporaryDirectory();
      const databasePath = path.join(root, "db.json");
      let inject = false;
      const store = new JsonStore(databasePath, {
        persistenceFaultCheckpoint: (stage) => {
          if (inject && stage === "primary_write") throw new Error("seed pending");
        },
      });
      await store.initialize();
      inject = true;
      await expect(store.mutateRecoverably(recoveryIntent(), (database) => {
        database.shepherd.settings.modelReviewEnabled = false;
      })).rejects.toThrow();
      const journalPath = databasePath + ".persistence-intent.json";
      if (variant === "malformed") {
        await writeFile(journalPath, "{not-json}\n", { encoding: "utf8", mode: 0o600 });
      } else if (variant === "oversized") {
        await writeFile(journalPath, "x".repeat(8_193), { encoding: "utf8", mode: 0o600 });
      } else {
        const outside = path.join(root, "outside-journal.json");
        await writeFile(outside, JSON.stringify(store.persistenceRecoveryIntent()), "utf8");
        await unlink(journalPath);
        await symlink(outside, journalPath);
      }
      const restarted = new JsonStore(databasePath);
      const error = await restarted.initialize().then(() => null, (caught: unknown) => caught as Error);
      expect(error?.message).toMatch(/Persistence recovery journal/u);
      expect(`${error?.message}\n${error?.stack}`).not.toContain(root);
    },
  );

  it("rejects a valid journal whose durable entity IDs are unknown", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    let inject = false;
    const store = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (inject && stage === "primary_write") throw new Error("seed pending");
      },
    });
    await store.initialize();
    inject = true;
    await expect(store.mutateRecoverably(recoveryIntent(), () => undefined)).rejects.toThrow();
    const restarted = new JsonStore(databasePath);
    await restarted.initialize();
    await expect(reconcilePersistenceRecoveryIntent({ store: restarted }))
      .rejects.toThrow("Persistence recovery journal references unknown durable entities");
    expect(restarted.persistenceRecoveryIntent()).not.toBeNull();
  });

  it.each([
    "recovery_intent_open",
    "recovery_intent_stat",
    "recovery_intent_read",
    "recovery_intent_close",
  ] satisfies PersistenceFaultStage[])("bounds %s failures without exposing native diagnostics", async (faultStage) => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    let seedFault = false;
    const seed = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (seedFault && stage === "primary_write") throw new Error("seed journal");
      },
    });
    await seed.initialize();
    seedFault = true;
    await expect(seed.mutateRecoverably(recoveryIntent(), () => undefined)).rejects.toThrow();
    const canary = `TST21_SECRET EACCES /Users/private/${faultStage}`;
    const restarted = new JsonStore(databasePath, {
      persistenceFaultCheckpoint: (stage) => {
        if (stage === faultStage) throw new Error(canary);
      },
    });
    const error = await restarted.initialize().then(() => null, (caught: unknown) => caught as Error);
    expect(error).toMatchObject({
      name: "PersistenceBoundaryError",
      stage: "recovery_intent_read",
      message: "Persistence recovery journal is unavailable",
    });
    expect(`${error?.message}\n${error?.stack}\n${String((error as Error & { cause?: unknown })?.cause)}`)
      .not.toMatch(/TST21_SECRET|\/Users\/private|EACCES/u);
  });

  it.each([
    ["primary_file_sync", "primary_temp_unlink"],
    ["journal_file_sync", "journal_temp_unlink"],
  ] satisfies [PersistenceFaultStage, PersistenceFaultStage][])(
    "preserves %s failure and removes its retained temp on restart after %s",
    async (primaryStage, cleanupStage) => {
      const root = await makeTemporaryDirectory();
      const databasePath = path.join(root, "db.json");
      let inject = false;
      const store = new JsonStore(databasePath, {
        persistenceFaultCheckpoint: (stage) => {
          if (inject && (stage === primaryStage || stage === cleanupStage)) {
            throw new Error(`TST21_SECRET ${stage} /private/temp`);
          }
        },
      });
      await store.initialize();
      inject = true;
      const error = await store.mutateRecoverably(recoveryIntent(), (database) => {
        database.shepherd.settings.modelReviewEnabled = false;
      }).then(() => null, (caught: unknown) => caught as Error);
      expect(error?.name).toBe("PersistenceBoundaryError");
      expect(error?.message).toBe(
        primaryStage === "primary_file_sync"
          ? "Database persistence did not complete durably"
          : "Persistence recovery journal is unavailable",
      );
      const managedDirectory = managedDirectoryFor(databasePath);
      const retained = (await readdir(managedDirectory)).filter((name) => name.endsWith(".tmp"));
      expect(retained).toHaveLength(1);
      expect(await readFile(path.join(managedDirectory, retained[0]!), "utf8")).not.toHaveLength(0);
      const restarted = new JsonStore(databasePath);
      await restarted.initialize();
      expect((await readdir(managedDirectory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    },
  );

  it("fails closed on a symlinked managed-temp name without touching its outside target", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const outside = path.join(root, "outside-canary.txt");
    await writeFile(outside, "outside unchanged\n", "utf8");
    const managedDirectory = managedDirectoryFor(databasePath);
    await mkdir(managedDirectory, { mode: 0o700 });
    const hostileTemp = path.join(managedDirectory, "db.json.123e4567-e89b-42d3-a456-426614174000.tmp");
    const hostileMarker = path.join(managedDirectory, "managed-temporary.json");
    await writeFile(hostileTemp, "hostile temp\n", { encoding: "utf8", mode: 0o600 });
    await symlink(outside, hostileMarker);
    const error = await new JsonStore(databasePath).initialize()
      .then(() => null, (caught: unknown) => caught as Error);
    expect(error).toMatchObject({
      name: "PersistenceBoundaryError",
      stage: "cleanup",
      message: "Persistence recovery cleanup remains pending",
    });
    expect(`${error?.message}\n${error?.stack}`).not.toContain(root);
    expect(await readFile(outside, "utf8")).toBe("outside unchanged\n");
    expect(await readlink(hostileMarker)).toBe(outside);
  });

  it("fails closed on a symlinked private managed directory without touching its target", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const outsideDirectory = path.join(root, "outside-directory");
    await mkdir(outsideDirectory);
    const outside = path.join(outsideDirectory, "canary.txt");
    await writeFile(outside, "outside unchanged\n", "utf8");
    await symlink(outsideDirectory, managedDirectoryFor(databasePath));

    const error = await new JsonStore(databasePath).initialize()
      .then(() => null, (caught: unknown) => caught as Error);
    expect(error).toMatchObject({
      name: "PersistenceBoundaryError",
      stage: "cleanup",
      message: "Persistence recovery cleanup remains pending",
    });
    expect(`${error?.message}\n${error?.stack}`).not.toContain(root);
    expect(await readFile(outside, "utf8")).toBe("outside unchanged\n");
  });

  it("does not follow an exact-pattern partial publication symlink", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const managedDirectory = managedDirectoryFor(databasePath);
    await mkdir(managedDirectory, { mode: 0o700 });
    const outside = path.join(root, "outside-publication.txt");
    await writeFile(outside, "outside unchanged\n", "utf8");
    const hostile = path.join(managedDirectory, "managed-temporary.json.123e4567-e89b-42d3-a456-426614174000.tmp");
    await symlink(outside, hostile);

    const error = await new JsonStore(databasePath).initialize()
      .then(() => null, (caught: unknown) => caught as Error);
    expect(error).toMatchObject({ name: "PersistenceBoundaryError", stage: "cleanup" });
    expect(`${error?.message}\n${error?.stack}`).not.toContain(root);
    expect(await readFile(outside, "utf8")).toBe("outside unchanged\n");
    expect(await readlink(hostile)).toBe(outside);
  });

  it.each([
    ["primary_file_sync", "primary_temp_unlink"],
    ["journal_file_sync", "journal_temp_unlink"],
  ] satisfies [PersistenceFaultStage, PersistenceFaultStage][])(
    "preserves %s across %s failure with same-instance cleanup",
    async (primaryStage, unlinkStage) => {
      const root = await makeTemporaryDirectory();
      const databasePath = path.join(root, "db.json");
      let inject = false;
      const store = new JsonStore(databasePath, {
        persistenceFaultCheckpoint: (stage) => {
          if (
            inject &&
            (stage === primaryStage || stage === unlinkStage)
          ) {
            throw new Error(`TST21_TRIPLE ${stage} /private/triple`);
          }
        },
      });
      await store.initialize();
      inject = true;
      const error = await store.mutateRecoverably(recoveryIntent(), () => undefined)
        .then(() => null, (caught: unknown) => caught as Error & { stage?: string; cleanupPending?: boolean });
      expect(error?.stage).toBe(primaryStage.startsWith("primary") ? "primary" : "journal");
      expect(error?.cleanupPending).toBe(true);
      expect(`${error?.message}\n${error?.stack}`).not.toMatch(/TST21_TRIPLE|\/private\/triple/u);
      const managedDirectory = managedDirectoryFor(databasePath);
      expect((await readdir(managedDirectory)).filter((name) => name.endsWith(".tmp"))).toHaveLength(1);
      inject = false;
      await store.initialize();
      expect((await readdir(managedDirectory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    },
  );

  it.each([
    ["primary", "primary_temp_unlink", "primary_file_sync"],
    ["primary", "primary_temp_directory_sync", "primary_file_sync"],
    ["primary", "primary_marker_unlink", null],
    ["primary", "primary_marker_unlink_directory_sync", null],
    ["journal", "journal_temp_unlink", "journal_file_sync"],
    ["journal", "journal_temp_directory_sync", "journal_file_sync"],
    ["journal", "journal_marker_unlink", null],
    ["journal", "journal_marker_unlink_directory_sync", null],
  ] satisfies ["primary" | "journal", PersistenceFaultStage, PersistenceFaultStage | null][])(
    "converges %s managed cleanup after %s across same-instance and two restarts",
    async (kind, cleanupStage, initiatingStage) => {
      const root = await makeTemporaryDirectory();
      const databasePath = path.join(root, "db.json");
      let inject = false;
      const store = new JsonStore(databasePath, {
        persistenceFaultCheckpoint: (stage) => {
          if (inject && (stage === cleanupStage || stage === initiatingStage)) {
            throw new Error(`TST22_SECRET ${stage} /Users/private/managed-temp`);
          }
        },
      });
      await store.initialize();
      inject = true;
      const operation = kind === "primary"
        ? store.mutate((database) => { database.shepherd.settings.modelReviewEnabled = false; })
        : store.mutateRecoverably(recoveryIntent(), () => undefined);
      const error = await operation.then(() => null, (caught: unknown) => caught as Error);
      expect(error).toMatchObject({ name: "PersistenceBoundaryError" });
      expect(`${error?.message}\n${error?.stack}`).not.toMatch(/TST22_SECRET|\/Users\/private/u);
      const managedDirectory = managedDirectoryFor(databasePath);
      const artifactsBeforeRestart = await readdir(managedDirectory);
      if (!cleanupStage.endsWith("marker_unlink_directory_sync")) {
        expect(artifactsBeforeRestart.some((name) => name.includes("managed-temporary"))).toBe(true);
      }

      inject = false;
      await store.initialize();
      await new JsonStore(databasePath).initialize();
      await new JsonStore(databasePath).initialize();
      expect((await readdir(managedDirectory)).filter((name) =>
        name.includes("managed-temporary") || /db\.json(?:\.persistence-intent\.json)?\.[0-9a-f-]+\.tmp$/iu.test(name),
      )).toEqual([]);
    },
  );

  it("cleans empty/truncated managed publications without touching parent-directory lookalikes", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const managedDirectory = managedDirectoryFor(databasePath);
    await mkdir(managedDirectory, { mode: 0o700 });
    const partialMarkers = [
      ["123e4567-e89b-42d3-a456-426614174000", ""],
      ["323e4567-e89b-42d3-a456-426614174000", "{"],
      ["423e4567-e89b-42d3-a456-426614174000", "{\"version\":1,\"marker\":"],
    ] as const;
    const unrelated = path.join(root, "managed-temporary.json.223e4567-e89b-42d3-a456-426614174000.tmp");
    for (const [publicationId, contents] of partialMarkers) {
      await writeFile(
        path.join(managedDirectory, `managed-temporary.json.${publicationId}.tmp`),
        contents,
        { mode: 0o600 },
      );
    }
    await writeFile(unrelated, "unrelated unchanged\n", { mode: 0o600 });

    await new JsonStore(databasePath).initialize();

    expect((await readdir(managedDirectory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(await readFile(unrelated, "utf8")).toBe("unrelated unchanged\n");
  });

  it.each([
    ["primary_file_sync", "primary_temp_unlink"],
    ["journal_file_sync", "journal_temp_unlink"],
  ] satisfies [PersistenceFaultStage, PersistenceFaultStage][])(
    "does not orphan or accumulate a prior %s temp before the next same-instance write",
    async (primaryStage, cleanupStage) => {
      const root = await makeTemporaryDirectory();
      const databasePath = path.join(root, "db.json");
      let inject = false;
      const store = new JsonStore(databasePath, {
        persistenceFaultCheckpoint: (stage) => {
          if (inject && (stage === primaryStage || stage === cleanupStage)) {
            throw new Error("TST22_PRIVATE repeated fault");
          }
        },
      });
      await store.initialize();
      inject = true;
      const first = primaryStage.startsWith("primary")
        ? store.mutate((database) => { database.shepherd.settings.autoResolution = false; })
        : store.mutateRecoverably(recoveryIntent(), () => undefined);
      await expect(first).rejects.toMatchObject({ name: "PersistenceBoundaryError" });
      const managedDirectory = managedDirectoryFor(databasePath);
      expect((await readdir(managedDirectory)).filter((name) => name.endsWith(".tmp"))).toHaveLength(1);

      inject = false;
      await store.mutate((database) => { database.shepherd.settings.autoResolution = false; });
      expect((await readdir(managedDirectory)).filter((name) =>
        name.includes("managed-temporary") || name.endsWith(".tmp"),
      )).toEqual([]);
    },
  );

  it("idempotently consumes an authoritative marker whose temp is already absent", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const managedDirectory = managedDirectoryFor(databasePath);
    await mkdir(managedDirectory, { mode: 0o700 });
    const markerPath = path.join(managedDirectory, "managed-temporary.json");
    await writeFile(markerPath, JSON.stringify({
      version: 1,
      marker: "shepherd-managed-temporary-v1",
      publicationId: "123e4567-e89b-42d3-a456-426614174000",
      kind: "primary",
      temporaryName: "db.json.123e4567-e89b-42d3-a456-426614174000.tmp",
    }) + "\n", { mode: 0o600 });

    await new JsonStore(databasePath).initialize();
    await new JsonStore(databasePath).initialize();

    await expect(readFile(markerPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed on a marker with non-schema fields without touching unrelated files", async () => {
    const root = await makeTemporaryDirectory();
    const databasePath = path.join(root, "db.json");
    const managedDirectory = managedDirectoryFor(databasePath);
    await mkdir(managedDirectory, { mode: 0o700 });
    const markerPath = path.join(managedDirectory, "managed-temporary.json");
    const unrelated = path.join(root, "outside-canary.txt");
    await writeFile(unrelated, "outside unchanged\n", "utf8");
    await writeFile(markerPath, JSON.stringify({
      version: 1,
      marker: "shepherd-managed-temporary-v1",
      publicationId: "123e4567-e89b-42d3-a456-426614174000",
      kind: "primary",
      temporaryName: "db.json.123e4567-e89b-42d3-a456-426614174000.tmp",
      outside: unrelated,
    }) + "\n", { mode: 0o600 });

    const error = await new JsonStore(databasePath).initialize()
      .then(() => null, (caught: unknown) => caught as Error);
    expect(error).toMatchObject({
      name: "PersistenceBoundaryError",
      stage: "cleanup",
      message: "Persistence recovery cleanup remains pending",
    });
    expect(`${error?.message}\n${error?.stack}`).not.toContain(root);
    expect(await readFile(unrelated, "utf8")).toBe("outside unchanged\n");
  });
});
