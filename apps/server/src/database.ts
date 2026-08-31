import { randomUUID } from "node:crypto";
import { appendWithinDurableCapacity } from "./collection-capacity.js";
import type {
  ProjectGroupMessage,
  ShepherdDatabase,
  ShepherdEvent,
  ShepherdSettings,
} from "./shepherd/domain.js";
import { isValidDatabaseV1, isValidDatabaseV2 } from "./database-schema.js";
import type { Database, DatabaseV1 } from "./types.js";

export interface DatabaseLoadResult {
  database: Database;
  migrated: boolean;
}

export type ShepherdEventInput = Omit<ShepherdEvent, "id" | "sequence" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

export const defaultShepherdSettings = (
  timestamp = new Date().toISOString(),
): ShepherdSettings => ({
  mode: "production",
  contractTimeoutMs: 15 * 60 * 1_000,
  candidateTimeoutMs: 10 * 60 * 1_000,
  autoResolution: true,
  maxConcurrentPlanes: 2,
  retainCompletedPlanes: true,
  modelReviewEnabled: true,
  notifications: {
    missionCompleted: true,
    attentionRequired: true,
    collisionDetected: true,
  },
  updatedAt: timestamp,
});

export const emptyShepherdDatabase = (
  timestamp = new Date().toISOString(),
): ShepherdDatabase => ({
  projects: [],
  missions: [],
  contracts: [],
  planes: [],
  claims: [],
  collisions: [],
  candidates: [],
  events: [],
  groupMessages: [],
  settings: defaultShepherdSettings(timestamp),
  nextEventSequence: 1,
});

export const emptyDatabase = (timestamp = new Date().toISOString()): Database => ({
  version: 2,
  agents: [],
  messages: [],
  runs: [],
  shepherd: emptyShepherdDatabase(timestamp),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function assertLegacyCollections(
  value: Record<string, unknown>,
): asserts value is Record<string, unknown> &
  Pick<DatabaseV1, "agents" | "messages" | "runs"> {
  if (
    !Array.isArray(value.agents) ||
    !Array.isArray(value.messages) ||
    !Array.isArray(value.runs)
  ) {
    throw new Error("Unsupported database format: legacy collections must be arrays");
  }
}

/**
 * Parses the on-disk representation and performs the only supported migration.
 * V1 collection values are cloned byte-for-byte at the JSON value level; no
 * role, authority, or Shepherd defaults are injected into legacy records.
 */
export const loadDatabase = (
  value: unknown,
  timestamp = new Date().toISOString(),
): DatabaseLoadResult => {
  if (!isRecord(value)) {
    throw new Error("Unsupported database format: expected an object");
  }
  if (value.version === 1) {
    assertLegacyCollections(value);
    if (!isValidDatabaseV1(value)) {
      throw new Error("Unsupported database format: invalid version 1 state");
    }
    const legacy = value as unknown as DatabaseV1;
    return {
      database: {
        version: 2,
        agents: structuredClone(legacy.agents),
        messages: structuredClone(legacy.messages),
        runs: structuredClone(legacy.runs),
        shepherd: emptyShepherdDatabase(timestamp),
      },
      migrated: true,
    };
  }
  if (value.version === 2) {
    if (!isValidDatabaseV2(value)) {
      throw new Error("Unsupported database format: invalid version 2 state");
    }
    return {
      database: structuredClone(value),
      migrated: false,
    };
  }
  throw new Error("Unsupported database format: expected version 1 or 2");
};

const bounded = (value: string, limit: number): string =>
  value.length <= limit ? value : value.slice(0, limit - 1) + "…";

const boundedDetails = (
  details: ShepherdEventInput["details"],
): ShepherdEvent["details"] => {
  const output: ShepherdEvent["details"] = {};
  for (const [rawKey, rawValue] of Object.entries(details).slice(0, 32)) {
    const key = bounded(rawKey, 64);
    output[key] = typeof rawValue === "string" ? bounded(rawValue, 2_000) : rawValue;
  }
  return output;
};

/**
 * Appends an event and consumes its durable cursor. Call this inside one
 * JsonStore mutation with the state change it describes so both persist or
 * neither does.
 */
export const appendShepherdEvent = (
  database: Database,
  input: ShepherdEventInput,
): ShepherdEvent => {
  const sequence = database.shepherd.nextEventSequence;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Cannot append Shepherd event: invalid next event sequence");
  }
  const event: ShepherdEvent = {
    id: input.id ?? randomUUID(),
    sequence,
    timestamp: input.timestamp ?? new Date().toISOString(),
    type: input.type,
    summary: bounded(input.summary, 500),
    actor: {
      ...input.actor,
      displayName: bounded(input.actor.displayName, 120),
    },
    missionId: input.missionId,
    contractId: input.contractId,
    agentId: input.agentId,
    planeId: input.planeId,
    collisionId: input.collisionId,
    candidateId: input.candidateId,
    details: boundedDetails(input.details),
  };
  appendWithinDurableCapacity(database.shepherd.events, [event], "Shepherd event");
  database.shepherd.nextEventSequence = sequence + 1;
  return structuredClone(event);
};

export const appendShepherdEvents = (
  database: Database,
  inputs: readonly ShepherdEventInput[],
): ShepherdEvent[] => inputs.map((input) => appendShepherdEvent(database, input));

export const shepherdEventsAfter = (
  database: Database,
  cursor: number,
  limit = 200,
): ShepherdEvent[] => {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("Event cursor must be a non-negative safe integer");
  }
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  return database.shepherd.events
    .filter((event) => event.sequence > cursor)
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, boundedLimit)
    .map((event) => structuredClone(event));
};

export const appendProjectGroupMessage = (
  database: Database,
  message: ProjectGroupMessage,
): ProjectGroupMessage => {
  const persisted = structuredClone(message);
  appendWithinDurableCapacity(
    database.shepherd.groupMessages,
    [persisted],
    "Project Group message",
  );
  return structuredClone(persisted);
};
