import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  appendShepherdEvent,
  emptyDatabase,
  loadDatabase,
  shepherdEventsAfter,
} from "./database.js";
import { isValidDatabaseV2 } from "./database-schema.js";
import type { ShepherdEventInput } from "./database.js";
import type { ShepherdEvent } from "./shepherd/domain.js";
import { redactText } from "./shepherd/redaction.js";
import type { Database } from "./types.js";

export interface JsonStoreOptions {
  sensitiveValues?: readonly string[];
  /** Tests may lower the ceiling; production callers cannot raise it. */
  maximumDatabaseBytes?: number;
  persistenceFaultCheckpoint?: (stage: PersistenceFaultStage) => void | Promise<void>;
}

export type PersistenceFaultStage =
  | "recovery_intent_open"
  | "recovery_intent_stat"
  | "recovery_intent_read"
  | "recovery_intent_close"
  | "journal_temp_open"
  | "journal_write"
  | "journal_file_sync"
  | "journal_close"
  | "journal_rename"
  | "journal_directory_sync"
  | "journal_temp_unlink"
  | "journal_cleanup_marker"
  | "primary_temp_open"
  | "primary_write"
  | "primary_file_sync"
  | "primary_close"
  | "primary_rename"
  | "primary_directory_sync"
  | "primary_temp_unlink"
  | "primary_cleanup_marker"
  | "journal_remove"
  | "journal_remove_directory_sync";

export interface PersistenceRecoveryIntentInput {
  operation: "mission_verification_transition";
  missionId: string;
  contractIds: readonly string[];
  planeIds: readonly string[];
  stage: "mission_verification_persistence";
  timestamp: string;
}

export interface PersistenceRecoveryIntent extends PersistenceRecoveryIntentInput {
  version: 1;
  beforeDigest: string;
}

export class PersistenceBoundaryError extends Error {
  cleanupPending = false;
  constructor(
    readonly stage: "journal" | "primary" | "cleanup" | "recovery_intent_read",
    readonly reason: "unavailable" | "durability_unknown" | "cleanup_pending" | "recovery_pending",
  ) {
    super(
      reason === "recovery_pending"
        ? "Persistence recovery reconciliation is pending"
        : stage === "journal" || stage === "recovery_intent_read"
          ? "Persistence recovery journal is unavailable"
        : stage === "primary"
          ? "Database persistence did not complete durably"
          : "Persistence recovery cleanup remains pending",
    );
    this.name = "PersistenceBoundaryError";
  }
}

export const MAX_DATABASE_BYTES = 64 * 1024 * 1024;
const MAX_INTENT_BYTES = 8 * 1024;
const SAFE_INTENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TEMP_CLEANUP_MARKER = "shepherd-pending-temp-cleanup-v1\n";

const serializeDatabase = (database: Database): string =>
  JSON.stringify(database, null, 2) + "\n";

const digestBytes = (serialized: string): string =>
  createHash("sha256").update(serialized, "utf8").digest("hex");

function parseRecoveryIntent(raw: string): PersistenceRecoveryIntent {
  if (Buffer.byteLength(raw, "utf8") > MAX_INTENT_BYTES) {
    throw new Error("Persistence recovery journal exceeds the supported size");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Persistence recovery journal is malformed");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Persistence recovery journal is malformed");
  }
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).sort();
  const expectedKeys = [
    "beforeDigest", "contractIds", "missionId", "operation", "planeIds",
    "stage", "timestamp", "version",
  ].sort();
  const idsValid = (ids: unknown): ids is string[] =>
    Array.isArray(ids) && ids.length === 2 && ids.every((id) => typeof id === "string" && SAFE_INTENT_ID.test(id));
  if (
    JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
    item.version !== 1 ||
    item.operation !== "mission_verification_transition" ||
    typeof item.missionId !== "string" || !SAFE_INTENT_ID.test(item.missionId) ||
    !idsValid(item.contractIds) || !idsValid(item.planeIds) ||
    item.stage !== "mission_verification_persistence" ||
    typeof item.timestamp !== "string" || !Number.isFinite(Date.parse(item.timestamp)) ||
    typeof item.beforeDigest !== "string" || !SHA256.test(item.beforeDigest)
  ) {
    throw new Error("Persistence recovery journal is invalid");
  }
  return item as unknown as PersistenceRecoveryIntent;
}

const unboundedRedactText = (value: string, secrets: readonly string[]): string =>
  redactText(value, { secrets, maxStringLength: Number.MAX_SAFE_INTEGER });

const readDatabaseFile = async (
  filePath: string,
  maximumBytes: number,
): Promise<string> => {
  let handle;
  try {
    handle = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const entry = await handle.stat();
    if (!entry.isFile()) {
      throw new Error("Database state file must be a regular file");
    }
    if (entry.size > maximumBytes) {
      throw new Error("Database state file exceeds the maximum supported size");
    }
    return await handle.readFile({ encoding: "utf8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error("Database state file must not be a symbolic link");
    }
    throw error;
  } finally {
    await handle?.close();
  }
};

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
  private readonly maximumDatabaseBytes: number;
  private readonly persistenceFaultCheckpoint?: JsonStoreOptions["persistenceFaultCheckpoint"];
  private pendingIntent: PersistenceRecoveryIntent | null = null;
  private readonly pendingTemporaryPaths = new Set<string>();

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
    const requestedMaximum = options.maximumDatabaseBytes ?? MAX_DATABASE_BYTES;
    if (!Number.isSafeInteger(requestedMaximum) || requestedMaximum < 1_024) {
      throw new Error("Database byte ceiling must be a safe integer of at least 1024");
    }
    this.maximumDatabaseBytes = Math.min(requestedMaximum, MAX_DATABASE_BYTES);
    this.persistenceFaultCheckpoint = options.persistenceFaultCheckpoint;
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await this.cleanupManagedTemporaryFiles();
    try {
      const raw = await readDatabaseFile(this.filePath, this.maximumDatabaseBytes);
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
    this.pendingIntent = await this.readRecoveryIntent();
  }

  snapshot(): Database {
    return sanitizeStrings(this.data, this.sensitiveValues);
  }

  async mutate<T>(mutation: (database: Database) => T | Promise<T>): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      if (this.pendingIntent) {
        throw new PersistenceBoundaryError("journal", "recovery_pending");
      }
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

  async mutateRecoverably<T>(
    intent: PersistenceRecoveryIntentInput,
    mutation: (database: Database) => T | Promise<T>,
  ): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      if (this.pendingIntent) {
        throw new Error("A persistence recovery journal already requires reconciliation");
      }
      const next = sanitizeStrings(this.data, this.sensitiveValues);
      const mutationResult = await mutation(next);
      const journal: PersistenceRecoveryIntent = {
        ...intent,
        version: 1,
        contractIds: [...intent.contractIds],
        planeIds: [...intent.planeIds],
        beforeDigest: digestBytes(serializeDatabase(this.data)),
      };
      parseRecoveryIntent(JSON.stringify(journal));
      try {
        await this.writeRecoveryIntent(journal);
      } catch (error) {
        this.pendingIntent = await this.readRecoveryIntent().catch(() => null);
        throw error;
      }
      this.pendingIntent = journal;
      const sanitized = await this.persist(next);
      this.data = sanitized;
      result = sanitizeStrings(mutationResult, this.sensitiveValues);
      await this.clearPersistenceRecoveryIntent();
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  async mutateForPersistenceReconciliation<T>(
    intent: PersistenceRecoveryIntent,
    mutation: (database: Database) => T | Promise<T>,
  ): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      if (
        !this.pendingIntent ||
        JSON.stringify(this.pendingIntent) !== JSON.stringify(intent)
      ) {
        throw new PersistenceBoundaryError("journal", "recovery_pending");
      }
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

  persistenceRecoveryIntent(): PersistenceRecoveryIntent | null {
    return this.pendingIntent ? structuredClone(this.pendingIntent) : null;
  }

  currentDigest(): string {
    return digestBytes(serializeDatabase(this.data));
  }

  async persistedDigest(): Promise<string> {
    try {
      return digestBytes(await readDatabaseFile(this.filePath, this.maximumDatabaseBytes));
    } catch {
      throw new PersistenceBoundaryError("primary", "unavailable");
    }
  }

  async clearPersistenceRecoveryIntent(): Promise<void> {
    const journalPath = this.recoveryIntentPath();
    try {
      await this.checkpoint("journal_remove");
      await unlink(journalPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await this.checkpoint("journal_remove_directory_sync");
      await this.syncParentDirectory();
      this.pendingIntent = null;
    } catch {
      throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
    }
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
    if (!isValidDatabaseV2(sanitized)) {
      throw new Error("Refusing to persist invalid database state");
    }
    const serialized = serializeDatabase(sanitized);
    if (Buffer.byteLength(serialized, "utf8") > this.maximumDatabaseBytes) {
      throw new Error("Database state exceeds the maximum supported size");
    }
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    let temporaryCreated = false;
    let primaryFailed = false;
    let primaryFailure: PersistenceBoundaryError | null = null;
    try {
      await this.checkpoint("primary_temp_open");
      const handle = await open(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      this.pendingTemporaryPaths.add(temporaryPath);
      try {
        await this.checkpoint("primary_write");
        await handle.writeFile(serialized, "utf8");
        await this.checkpoint("primary_file_sync");
        await handle.sync();
      } finally {
        await handle.close();
        await this.checkpoint("primary_close");
      }
      await this.checkpoint("primary_rename");
      await rename(temporaryPath, this.filePath);
      temporaryCreated = false;
      this.pendingTemporaryPaths.delete(temporaryPath);
      await this.checkpoint("primary_directory_sync");
      await this.syncParentDirectory();
      return sanitized;
    } catch {
      primaryFailed = true;
      primaryFailure = new PersistenceBoundaryError("primary", "durability_unknown");
      throw primaryFailure;
    } finally {
      if (temporaryCreated) {
        try {
          await this.checkpoint("primary_temp_unlink");
          await unlink(temporaryPath);
          this.pendingTemporaryPaths.delete(temporaryPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            try {
              await this.recordPendingTemporaryCleanup(temporaryPath);
            } catch {
              if (!primaryFailed) {
                throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
              }
              if (primaryFailure) primaryFailure.cleanupPending = true;
            }
            if (!primaryFailed) throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
          }
        }
      }
    }
  }

  private recoveryIntentPath(): string {
    return this.filePath + ".persistence-intent.json";
  }

  private async checkpoint(stage: PersistenceFaultStage): Promise<void> {
    await this.persistenceFaultCheckpoint?.(stage);
  }

  private async syncParentDirectory(): Promise<void> {
    if (process.platform === "win32") return;
    const handle = await open(path.dirname(this.filePath), constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async writeRecoveryIntent(intent: PersistenceRecoveryIntent): Promise<void> {
    const journalPath = this.recoveryIntentPath();
    if (path.dirname(journalPath) !== path.dirname(this.filePath)) {
      throw new Error("Persistence recovery journal escaped the database directory");
    }
    const serialized = JSON.stringify(intent) + "\n";
    const temporaryPath = `${journalPath}.${randomUUID()}.tmp`;
    let temporaryCreated = false;
    let journalFailed = false;
    let journalFailure: PersistenceBoundaryError | null = null;
    try {
      await this.checkpoint("journal_temp_open");
      const handle = await open(temporaryPath, "wx", 0o600);
      temporaryCreated = true;
      this.pendingTemporaryPaths.add(temporaryPath);
      try {
        await this.checkpoint("journal_write");
        await handle.writeFile(serialized, "utf8");
        await this.checkpoint("journal_file_sync");
        await handle.sync();
      } finally {
        await handle.close();
        await this.checkpoint("journal_close");
      }
      await this.checkpoint("journal_rename");
      await rename(temporaryPath, journalPath);
      temporaryCreated = false;
      this.pendingTemporaryPaths.delete(temporaryPath);
      await this.checkpoint("journal_directory_sync");
      await this.syncParentDirectory();
    } catch {
      journalFailed = true;
      journalFailure = new PersistenceBoundaryError("journal", "unavailable");
      throw journalFailure;
    } finally {
      if (temporaryCreated) {
        try {
          await this.checkpoint("journal_temp_unlink");
          await unlink(temporaryPath);
          this.pendingTemporaryPaths.delete(temporaryPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            try {
              await this.recordPendingTemporaryCleanup(temporaryPath);
            } catch {
              if (!journalFailed) {
                throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
              }
              if (journalFailure) journalFailure.cleanupPending = true;
            }
            if (!journalFailed) throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
          }
        }
      }
    }
  }

  private async readRecoveryIntent(): Promise<PersistenceRecoveryIntent | null> {
    const journalPath = this.recoveryIntentPath();
    let handle;
    let primaryError: unknown = null;
    try {
      try {
        await this.checkpoint("recovery_intent_open");
        handle = await open(journalPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        if ((error as NodeJS.ErrnoException).code === "ELOOP") {
          throw new Error("Persistence recovery journal must not be a symbolic link");
        }
        throw new PersistenceBoundaryError("recovery_intent_read", "unavailable");
      }
      let entry;
      try {
        await this.checkpoint("recovery_intent_stat");
        entry = await handle.stat();
      } catch {
        throw new PersistenceBoundaryError("recovery_intent_read", "unavailable");
      }
      if (
        !entry.isFile() ||
        entry.size > MAX_INTENT_BYTES ||
        (process.platform !== "win32" && (entry.mode & 0o077) !== 0)
      ) {
        throw new Error("Persistence recovery journal metadata is invalid");
      }
      if (typeof process.getuid === "function" && entry.uid !== process.getuid()) {
        throw new Error("Persistence recovery journal ownership is invalid");
      }
      let raw: string;
      try {
        await this.checkpoint("recovery_intent_read");
        raw = await handle.readFile({ encoding: "utf8" });
      } catch {
        throw new PersistenceBoundaryError("recovery_intent_read", "unavailable");
      }
      return parseRecoveryIntent(raw);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (handle) {
        try {
          await handle.close();
          await this.checkpoint("recovery_intent_close");
        } catch {
          if (primaryError === null) {
            throw new PersistenceBoundaryError("recovery_intent_read", "unavailable");
          }
        }
      }
    }
  }

  private async cleanupManagedTemporaryFiles(): Promise<void> {
    const directory = path.dirname(this.filePath);
    const databaseName = path.basename(this.filePath).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(
      `^${databaseName}(?:\\.persistence-intent\\.json)?\\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.tmp\\.cleanup-pending$`,
      "iu",
    );
    const temporaryPattern = new RegExp(
      `^${databaseName}(?:\\.persistence-intent\\.json)?\\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.tmp$`,
      "iu",
    );
    try {
      for (const temporaryPath of [...this.pendingTemporaryPaths]) {
        if (
          path.dirname(temporaryPath) !== directory ||
          !temporaryPattern.test(path.basename(temporaryPath))
        ) throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
        const entry = await lstat(temporaryPath);
        const maximumTemporaryBytes = temporaryPath.includes(".persistence-intent.json.")
          ? MAX_INTENT_BYTES
          : this.maximumDatabaseBytes;
        if (
          !entry.isFile() || entry.isSymbolicLink() || entry.size > maximumTemporaryBytes ||
          (process.platform !== "win32" && (entry.mode & 0o077) !== 0) ||
          (typeof process.getuid === "function" && entry.uid !== process.getuid())
        ) throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
        await unlink(temporaryPath);
        this.pendingTemporaryPaths.delete(temporaryPath);
      }
      for (const name of await readdir(directory)) {
        if (!pattern.test(name)) continue;
        const markerPath = path.join(directory, name);
        const markerEntry = await lstat(markerPath);
        if (
          !markerEntry.isFile() || markerEntry.isSymbolicLink() ||
          markerEntry.size !== Buffer.byteLength(TEMP_CLEANUP_MARKER) ||
          (process.platform !== "win32" && (markerEntry.mode & 0o077) !== 0) ||
          (typeof process.getuid === "function" && markerEntry.uid !== process.getuid())
        ) throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
        const markerHandle = await open(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        let markerContent: string;
        try {
          markerContent = await markerHandle.readFile({ encoding: "utf8" });
        } finally {
          await markerHandle.close();
        }
        if (markerContent !== TEMP_CLEANUP_MARKER) {
          throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
        }
        const temporaryPath = markerPath.slice(0, -".cleanup-pending".length);
        const entry = await lstat(temporaryPath);
        const maximumTemporaryBytes = name.includes(".persistence-intent.json.")
          ? MAX_INTENT_BYTES
          : this.maximumDatabaseBytes;
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          entry.size > maximumTemporaryBytes ||
          (process.platform !== "win32" && (entry.mode & 0o077) !== 0) ||
          (typeof process.getuid === "function" && entry.uid !== process.getuid())
        ) {
          throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
        }
        await unlink(temporaryPath);
        await unlink(markerPath);
        this.pendingTemporaryPaths.delete(temporaryPath);
      }
      await this.syncParentDirectory();
    } catch (error) {
      if (error instanceof PersistenceBoundaryError) throw error;
      throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
    }
  }

  private async recordPendingTemporaryCleanup(temporaryPath: string): Promise<void> {
    const markerPath = temporaryPath + ".cleanup-pending";
    try {
      await this.checkpoint(
        temporaryPath.includes(".persistence-intent.json.")
          ? "journal_cleanup_marker"
          : "primary_cleanup_marker",
      );
      const handle = await open(markerPath, "wx", 0o600);
      try {
        await handle.writeFile(TEMP_CLEANUP_MARKER, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.syncParentDirectory();
    } catch {
      throw new PersistenceBoundaryError("cleanup", "cleanup_pending");
    }
  }
}
