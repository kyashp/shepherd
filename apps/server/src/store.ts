import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  appendShepherdEvent,
  emptyDatabase,
  loadDatabase,
  shepherdEventsAfter,
} from "./database.js";
import type { ShepherdEventInput } from "./database.js";
import type { ShepherdEvent } from "./shepherd/domain.js";
import { redactText } from "./shepherd/redaction.js";
import type { Database } from "./types.js";

export interface JsonStoreOptions {
  sensitiveValues?: readonly string[];
}

const unboundedRedactText = (value: string, secrets: readonly string[]): string =>
  redactText(value, { secrets, maxStringLength: Number.MAX_SAFE_INTEGER });

/** Clone JSON-shaped state while inspecting data descriptors, never accessors. */
const sanitizeStrings = <T>(
  input: T,
  secrets: readonly string[],
  seen = new WeakMap<object, object>(),
): T => {
  if (typeof input === "string") {
    return unboundedRedactText(input, secrets) as T;
  }
  if (input === null || typeof input !== "object") return input;

  const cached = seen.get(input);
  if (cached) return cached as T;
  const output: object = Array.isArray(input) ? new Array(input.length) : {};
  seen.set(input, output);
  for (const key of Object.keys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new Error(`Database state contains an accessor at '${key}'`);
    }
    Object.defineProperty(output, key, {
      value: sanitizeStrings(descriptor.value, secrets, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output as T;
};

export class JsonStore {
  private data: Database = emptyDatabase();
  private queue: Promise<void> = Promise.resolve();
  private readonly sensitiveValues: readonly string[];

  constructor(
    private readonly filePath: string,
    options: JsonStoreOptions = {},
  ) {
    this.sensitiveValues = [
      ...new Set(
        (options.sensitiveValues ?? []).filter(
          (value) => typeof value === "string" && value.trim().length >= 4,
        ),
      ),
    ].sort((left, right) => right.length - left.length);
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const loaded = loadDatabase(JSON.parse(raw) as unknown);
      // Persist on every load so a newly configured canary also scrubs an
      // existing V2 file before that state becomes observable in memory.
      this.data = await this.persist(loaded.database);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      this.data = await this.persist(this.data);
    }
  }

  snapshot(): Database {
    return sanitizeStrings(this.data, this.sensitiveValues);
  }

  async mutate<T>(mutation: (database: Database) => T | Promise<T>): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      const next = sanitizeStrings(this.data, this.sensitiveValues);
      const mutationResult = await mutation(next);
      const sanitized = await this.persist(next);
      this.data = sanitized;
      result = sanitizeStrings(mutationResult, this.sensitiveValues);
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  /** Atomically allocates a cursor and persists the event. */
  async appendShepherdEvent(input: ShepherdEventInput): Promise<ShepherdEvent> {
    return this.mutate((database) => appendShepherdEvent(database, input));
  }

  shepherdEventsAfter(cursor: number, limit = 200): ShepherdEvent[] {
    return shepherdEventsAfter(this.snapshot(), cursor, limit);
  }

  private async persist(data: Database): Promise<Database> {
    const sanitized = sanitizeStrings(data, this.sensitiveValues);
    const temporaryPath = this.filePath + ".tmp";
    await writeFile(temporaryPath, JSON.stringify(sanitized, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
    return sanitized;
  }
}
