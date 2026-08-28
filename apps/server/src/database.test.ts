import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  appendShepherdEvent,
  emptyDatabase,
  loadDatabase,
  shepherdEventsAfter,
} from "./database.js";
import type { ShepherdEventInput } from "./database.js";

const timestamp = "2026-08-29T12:00:00.000Z";

const eventInput = (summary: string): ShepherdEventInput => ({
  timestamp,
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

describe("Database V2", () => {
  it("migrates a captured V1 fixture without changing any legacy value", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL("./test-fixtures/database-v1.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const originalLegacyValues = {
      agents: structuredClone(raw.agents),
      messages: structuredClone(raw.messages),
      runs: structuredClone(raw.runs),
    };

    const loaded = loadDatabase(raw, timestamp);

    expect(loaded.migrated).toBe(true);
    expect(loaded.database.version).toBe(2);
    expect({
      agents: loaded.database.agents,
      messages: loaded.database.messages,
      runs: loaded.database.runs,
    }).toEqual(originalLegacyValues);
    expect(loaded.database.shepherd).toMatchObject({
      projects: [],
      missions: [],
      contracts: [],
      planes: [],
      claims: [],
      collisions: [],
      candidates: [],
      events: [],
      groupMessages: [],
      nextEventSequence: 1,
      settings: { updatedAt: timestamp },
    });
    expect(raw.version).toBe(1);
  });

  it("round-trips V2 state without treating it as a migration", () => {
    const database = emptyDatabase(timestamp);
    const event = appendShepherdEvent(database, eventInput("created"));

    const loaded = loadDatabase(database, "unused");

    expect(loaded).toEqual({ database, migrated: false });
    expect(loaded.database).not.toBe(database);
    expect(event.sequence).toBe(1);
  });

  it("rejects truncated and unsupported databases instead of silently resetting", () => {
    expect(() => loadDatabase({ version: 1, agents: [] })).toThrow(
      "legacy collections must be arrays",
    );
    expect(() =>
      loadDatabase({ version: 2, agents: [], messages: [], runs: [] }),
    ).toThrow("shepherd state is missing");
    expect(() =>
      loadDatabase({ version: 99, agents: [], messages: [], runs: [] }),
    ).toThrow("expected version 1 or 2");
  });

  it("allocates monotonic polling cursors and returns bounded ordered pages", () => {
    const database = emptyDatabase(timestamp);
    appendShepherdEvent(database, eventInput("one"));
    appendShepherdEvent(database, eventInput("two"));
    appendShepherdEvent(database, eventInput("three"));

    expect(database.shepherd.nextEventSequence).toBe(4);
    expect(shepherdEventsAfter(database, 1, 1).map((event) => event.summary)).toEqual([
      "two",
    ]);
    expect(shepherdEventsAfter(database, 1).map((event) => event.sequence)).toEqual([
      2, 3,
    ]);
    expect(() => shepherdEventsAfter(database, -1)).toThrow("non-negative");
  });

  it("bounds event summaries and safe detail fields before persistence", () => {
    const database = emptyDatabase(timestamp);
    const event = appendShepherdEvent(database, {
      ...eventInput("x".repeat(700)),
      details: Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [
          `field-${index}`,
          "y".repeat(2_500),
        ]),
      ),
    });

    expect(event.summary.length).toBe(500);
    expect(Object.keys(event.details)).toHaveLength(32);
    expect(String(event.details["field-0"]).length).toBe(2_000);
  });
});
