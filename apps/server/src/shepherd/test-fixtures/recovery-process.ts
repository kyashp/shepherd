import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { JsonStore } from "../../store.js";
import type { VerificationEvidence } from "../domain.js";
import { AUTH_FACT_PREFIX } from "../auth-fixture.js";
import {
  AUTH_PROJECT_PROFILE_ID,
  ShepherdService,
  type ShepherdFaultCheckpoint,
} from "../service.js";
import type { VerificationRequest } from "../verifier.js";

const root = process.argv[2];
const mode = process.argv[3];
if (!root || !mode) throw new Error("recovery process fixture requires root and mode");

const send = (message: Record<string, unknown>) => process.send?.(message);
const store = new JsonStore(path.join(root, "state.json"));
await store.initialize();

const verifier = {
  reconcileInterrupted: async () => undefined,
  verify: async (request: VerificationRequest): Promise<VerificationEvidence> => {
    let transport = "http-only-session-cookie";
    for (const relativePath of ["src/frontend/auth.json", "src/backend/auth.json"]) {
      try {
        const value = JSON.parse(
          await readFile(path.join(request.planePath, relativePath), "utf8"),
        ) as { transport?: string };
        if (value.transport) {
          transport = value.transport;
          break;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const checks = request.checks.map((check) => {
      const passed =
        check.profileId !== AUTH_PROJECT_PROFILE_ID ||
        transport === "http-only-session-cookie";
      return {
        id: check.id,
        name: check.name,
        profileId: check.profileId,
        mandatory: check.mandatory,
        status: passed ? ("passed" as const) : ("failed" as const),
        passed,
        exitCode: passed ? 0 : 1,
        durationMs: 1,
        stdout: AUTH_FACT_PREFIX + transport + "\n",
        stderr: "",
        error: passed ? null : "project security policy rejected transport",
      };
    });
    return {
      id: `fixture-evidence-${request.targetType}-${request.targetId}`,
      targetType: request.targetType,
      targetId: request.targetId,
      runner: "independent",
      passed: checks.filter((check) => check.mandatory).every((check) => check.passed),
      checks,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 1,
      changedFiles: [...request.changedFiles],
      summary: "fixture verifier completed",
    };
  },
};

let checkpointReached = false;
const protectedRefCheckpoint = "protected_ref_updated_before_worktree_sync";
const pauseAtCheckpoint = async (checkpoint: string) => {
  if (checkpointReached || checkpoint !== mode) return;
  checkpointReached = true;
  send({ type: "checkpoint", checkpoint });
  await new Promise<void>(() => undefined);
};
const service = new ShepherdService({
  store,
  managedRoot: path.join(root, "managed"),
  agentWorkspaceRoot: path.join(root, "agent-workspaces"),
  verifier,
  ...(mode === protectedRefCheckpoint
    ? {
        gitPromotionFaults: {
          beforeWorktreeSynchronization: async () =>
            await pauseAtCheckpoint(protectedRefCheckpoint),
        },
      }
    : {}),
  ...(mode === "recover"
    ? {}
    : {
        faultCheckpoint: async (checkpoint: ShepherdFaultCheckpoint) => {
          await pauseAtCheckpoint(checkpoint);
        },
      }),
});
let startupError: string | null = null;
try {
  await service.initialize();
} catch (error) {
  startupError = error instanceof Error ? error.message : "unknown startup error";
  if (mode !== "recover") throw error;
}

if (mode !== "recover") {
  const app = Fastify({ logger: false });
  app.get("/state", async () => service.state());
  await app.listen({ host: "127.0.0.1", port: 0 });
  send({ type: "ready" });
  void service.runDeterministicDemo().catch((error: unknown) => {
    send({
      type: "error",
      message: error instanceof Error ? error.message : "unknown",
    });
  });
} else {
  const state = service.state();
  const privateEntries: Record<string, string[]> = {};
  for (const name of [
    ".execution-workspaces",
    ".trusted-materialization",
    ".trusted-verification",
  ]) {
    const directory = path.join(root, "managed", "planes", "auth-demo", name);
    try {
      privateEntries[name] = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      privateEntries[name] = [];
    }
  }
  send({
    type: "recovered",
    state,
    privateEntries,
    startupError,
  });
  process.exit(0);
}
