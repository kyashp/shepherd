import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ShepherdDatabase } from "./domain.js";
import type { ShepherdFaultCheckpoint } from "./service.js";

const fixture = fileURLToPath(
  new URL("./test-fixtures/recovery-process.ts", import.meta.url),
);
const roots: string[] = [];
const children = new Set<ChildProcess>();
const protectedRefCheckpoint = "protected_ref_updated_before_worktree_sync" as const;
type ProcessCheckpoint = ShepherdFaultCheckpoint | typeof protectedRefCheckpoint;

afterEach(async () => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function start(root: string, mode: ProcessCheckpoint | "recover") {
  const child = fork(fixture, [root, mode], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.add(child);
  return child;
}

function message<T extends Record<string, unknown>>(
  child: ChildProcess,
  type: string,
  timeoutMs = 25_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-8_000);
    });
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${type}: ${stderr}`));
    }, timeoutMs);
    const onMessage = (value: unknown) => {
      const record = value as Record<string, unknown>;
      if (record.type === "error") {
        clearTimeout(timeout);
        reject(new Error(String(record.message)));
      } else if (record.type === type) {
        clearTimeout(timeout);
        child.off("message", onMessage);
        resolve(record as T);
      }
    };
    child.on("message", onMessage);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0 && signal !== "SIGKILL") {
        reject(new Error(`Fixture exited ${code}/${signal}: ${stderr}`));
      } else if (signal !== "SIGKILL") {
        // A clean exit without the awaited message is a real failure, not a slow
        // one. Rejecting here reports the cause immediately instead of spending the
        // whole timeout and then blaming host speed.
        reject(
          new Error(
            `Fixture exited ${code}/${signal} without sending ${type}: ${stderr}`,
          ),
        );
      }
    });
  });
}

async function killAt(root: string, checkpoint: ProcessCheckpoint) {
  const child = start(root, checkpoint);
  await message(child, "ready");
  const reached = await message<{ type: string; checkpoint: string }>(
    child,
    "checkpoint",
  );
  expect(reached.checkpoint).toBe(checkpoint);
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
  await exited;
  children.delete(child);
}

async function recover(root: string) {
  const child = start(root, "recover");
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const recovered = await message<{
    type: string;
    state: ShepherdDatabase;
    privateEntries: Record<string, string[]>;
    startupError: string | null;
  }>(child, "recovered");
  await exited;
  children.delete(child);
  return recovered;
}

describe("process-level startup recovery", () => {
  for (const checkpoint of [
    "contract_execution_workspace_ready",
    "contract_verification_snapshot_ready",
    "promotion_ready_for_cas",
    "promotion_cas_completed",
  ] as const) {
    it(`survives SIGKILL at ${checkpoint} without a falsely green Mission`, async () => {
      const root = await mkdtemp(
        path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "recovery-process-"),
      );
      roots.push(root);
      await killAt(root, checkpoint);

      const first = await recover(root);
      expect(first.startupError).toBeNull();
      const mission = first.state.missions[0];
      expect(mission).toBeDefined();
      expect(mission?.state).toBe("attention_required");
      expect(mission?.state).not.toBe("completed");
      expect(mission?.completedAt).toBeNull();
      expect(mission?.failure).toMatchObject({
        stage: "startup_reconciliation",
      });
      expect(Object.values(first.privateEntries).flat()).toEqual([]);
      expect(first.state.planes.some((plane) => plane.state === "running")).toBe(false);
      if (checkpoint === "promotion_ready_for_cas") {
        const selected = first.state.candidates.find(
          (candidate) => candidate.selectionState === "selected",
        );
        expect(selected).toMatchObject({
          promotionState: "interrupted",
          promotionEvidence: { passed: true, targetType: "promotion" },
        });
        const selectedPlane = first.state.planes.find(
          (plane) => plane.id === selected?.planeId,
        );
        expect(selectedPlane?.verificationEvidenceIds).toContain(
          selected?.promotionEvidence?.id,
        );
        expect(first.state.projects[0]?.protectedHeadCommit).toBe(
          first.state.missions[0]?.baseCommit,
        );
      }

      const cursor = first.state.nextEventSequence;
      const second = await recover(root);
      expect(second.startupError).toBeNull();
      expect(second.state.nextEventSequence).toBe(cursor);
      expect(second.state.missions[0]?.state).toBe("attention_required");

      if (checkpoint === "promotion_cas_completed") {
        const recoveryEvent = first.state.events.find(
          (event) => event.details.classification === "selected_candidate_post_cas",
        );
        expect(recoveryEvent?.details.expectedHead).not.toBe(
          recoveryEvent?.details.observedHead,
        );
        const selected = first.state.candidates.find(
          (candidate) => candidate.selectionState === "selected",
        );
        expect(selected).toMatchObject({
          executionState: "passed",
          promotionState: "interrupted",
        });
      }
    }, 60_000);
  }

  it("fails closed when SIGKILL lands after update-ref but before read-tree", async () => {
    const root = await mkdtemp(
      path.join(process.env.TMPDIR ?? ".tmp/shepherd-tests", "recovery-cas-gap-"),
    );
    roots.push(root);
    await killAt(root, protectedRefCheckpoint);

    const first = await recover(root);
    expect(first.startupError).toBe("Shepherd startup artifact reconciliation failed");
    const mission = first.state.missions[0];
    const project = first.state.projects[0];
    const recoveryEvent = first.state.events.find(
      (event) => event.details.classification === "protected_worktree_mismatch",
    );
    expect(mission).toMatchObject({
      state: "attention_required",
      completedAt: null,
      failure: {
        code: "protected_branch_moved",
        stage: "startup_reconciliation",
      },
    });
    expect(recoveryEvent).toBeDefined();
    expect(recoveryEvent?.details.observedHead).not.toBe(
      recoveryEvent?.details.expectedHead,
    );
    expect(recoveryEvent?.details.protectedIndexMatchesHead).toBe(false);
    expect(recoveryEvent?.details.protectedWorktreeClean).toBe(false);
    expect(project?.protectedHeadCommit).toBe(recoveryEvent?.details.expectedHead);
    expect(Object.values(first.privateEntries).flat()).toEqual([]);

    const cursor = first.state.nextEventSequence;
    const second = await recover(root);
    expect(second.startupError).toBe("Shepherd startup artifact reconciliation failed");
    const afterFailedRestart = JSON.parse(
      await readFile(path.join(root, "state.json"), "utf8"),
    ) as { shepherd: ShepherdDatabase };
    expect(afterFailedRestart.shepherd.nextEventSequence).toBe(cursor);
    expect(afterFailedRestart.shepherd.projects[0]?.protectedHeadCommit).toBe(
      project?.protectedHeadCommit,
    );
  }, 60_000);
});
