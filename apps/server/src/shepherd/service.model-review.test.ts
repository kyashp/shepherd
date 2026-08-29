import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toPublicMissionDetail } from "../app.js";
import { JsonStore } from "../store.js";
import { BEARER_TRANSPORT, COOKIE_TRANSPORT } from "./auth-fixture.js";
import type { VerificationCheckResult, VerificationEvidence } from "./domain.js";
import type {
  ModelReviewFinding,
  ModelReviewInput,
  ModelReviewResult,
  ModelReviewer,
} from "./model-reviewer.js";
import {
  ArkModelReviewer,
  MODEL_REVIEW_MAX_INPUT_BYTES,
  type ModelReviewerFetch,
} from "./model-reviewer.js";
import {
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_PROFILE_ID,
  ShepherdService,
  type ShepherdIndependentVerifier,
} from "./service.js";
import type { VerificationRequest } from "./verifier.js";

/**
 * Each test drives a full deterministic Mission with real Git worktrees and real
 * trusted fixture checks, which exceeds Vitest's 5s default on ordinary hardware.
 * Declared locally so this file passes under the repository default config rather
 * than depending on a --testTimeout flag.
 */
const ONE_MISSION_BUDGET_MS = 180_000;
const TWO_MISSION_BUDGET_MS = 360_000;

const repositoryTestRoot = fileURLToPath(
  new URL("../../../../.tmp/shepherd-tests/", import.meta.url),
);
const cleanupRoots: string[] = [];

/** Distinct prefix from service.test.ts: both files run in parallel under one root. */
async function makeCaseRoot(): Promise<string> {
  await mkdir(repositoryTestRoot, { recursive: true });
  const root = await mkdtemp(path.join(repositoryTestRoot, "model-review-"));
  cleanupRoots.push(root);
  return root;
}

afterEach(async () => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

function executeNodeScript(
  cwd: string,
  script: string,
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script],
      {
        cwd,
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: cwd,
          LANG: "C",
          LC_ALL: "C",
          CI: "1",
        },
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 262_144,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const candidate = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
        resolve({
          exitCode:
            candidate === null ? 0 : typeof candidate.code === "number" ? candidate.code : 1,
          stdout,
          stderr,
          durationMs: Math.max(0, Date.now() - startedAt),
        });
      },
    );
  });
}

/** Runs the real trusted fixture checks in-process. Needs no container runtime. */
class HostTrustedFixtureVerifier implements ShepherdIndependentVerifier {
  private sequence = 0;

  async verify(request: VerificationRequest): Promise<VerificationEvidence> {
    const startedAt = new Date();
    const scripts: Record<string, string> = {
      [AUTH_FRONTEND_PROFILE_ID]: "checks/frontend.cjs",
      [AUTH_BACKEND_PROFILE_ID]: "checks/backend.cjs",
      [AUTH_PROJECT_PROFILE_ID]: "checks/project-security.cjs",
    };
    const checks: VerificationCheckResult[] = [];
    for (const check of request.checks) {
      const script = scripts[check.profileId];
      if (!script) {
        checks.push({
          id: check.id,
          name: check.name,
          profileId: check.profileId,
          mandatory: check.mandatory,
          status: "infrastructure_error",
          passed: false,
          exitCode: null,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: "Unknown trusted fixture profile",
        });
        continue;
      }
      const result = await executeNodeScript(request.planePath, script);
      const passed = result.exitCode === 0;
      checks.push({
        id: check.id,
        name: check.name,
        profileId: check.profileId,
        mandatory: check.mandatory,
        status: passed ? "passed" : "failed",
        passed,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        error: passed ? null : "Trusted fixture check exited non-zero",
      });
    }
    const completedAt = new Date();
    const mandatory = checks.filter((check) => check.mandatory);
    const mandatoryPassed = mandatory.filter((check) => check.passed).length;
    return {
      id: `host-evidence-${++this.sequence}`,
      targetType: request.targetType,
      targetId: request.targetId,
      runner: "independent",
      passed: mandatoryPassed === mandatory.length,
      checks,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      changedFiles: [...request.changedFiles],
      summary: `${mandatoryPassed}/${mandatory.length} mandatory checks passed`,
    };
  }

  async reconcileInterrupted(): Promise<void> {}
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: "/nonexistent",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          LANG: "C",
          LC_ALL: "C",
        },
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 262_144,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      },
    );
  });
}

/** Records every call so independence assertions can never pass vacuously. */
class ScriptedReviewer implements ModelReviewer {
  readonly inputs: unknown[] = [];
  readonly signals: Array<AbortSignal | undefined> = [];

  constructor(private readonly script: (call: number) => Promise<ModelReviewResult>) {}

  async review(input: unknown, signal?: AbortSignal): Promise<ModelReviewResult> {
    this.inputs.push(structuredClone(input));
    this.signals.push(signal);
    return await this.script(this.inputs.length);
  }
}

const completed =
  (findings: ModelReviewFinding[]) =>
  async (): Promise<ModelReviewResult> => ({ status: "completed", findings });

async function makeService(options: {
  reviewer?: ModelReviewer;
  sensitiveValues?: string[];
  makeReviewer?: (caseRoot: string) => ModelReviewer;
}): Promise<{ service: ShepherdService; caseRoot: string; storePath: string }> {
  const caseRoot = await makeCaseRoot();
  const storePath = path.join(caseRoot, "state.json");
  const sensitiveValues = options.sensitiveValues ?? [];
  const store = new JsonStore(storePath, { sensitiveValues });
  await store.initialize();
  const reviewer = options.makeReviewer?.(caseRoot) ?? options.reviewer;
  const service = new ShepherdService({
    store,
    managedRoot: path.join(caseRoot, "managed"),
    agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
    verifier: new HostTrustedFixtureVerifier(),
    sensitiveValues,
    ...(reviewer ? { reviewer } : {}),
  });
  await service.initialize();
  return { service, caseRoot, storePath };
}

function providerEnvelope(review: unknown = { findings: [] }) {
  return {
    id: "resp-provider-id-must-not-escape",
    object: "response",
    status: "completed",
    store: false,
    output: [
      { type: "reasoning", id: "reasoning-provider-id", summary: [] },
      {
        type: "message",
        id: "message-provider-id",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: JSON.stringify(review), annotations: [] },
        ],
      },
    ],
  };
}

function completedResponse(review: unknown = { findings: [] }): Response {
  return new Response(JSON.stringify(providerEnvelope(review)), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function advisoryEvents(service: ShepherdService, missionId: string) {
  const events = service.missionDetail(missionId)?.events ?? [];
  return {
    all: events,
    completed: events.filter((event) => event.type === "model_review_completed"),
    degraded: events.filter((event) => event.type === "model_review_degraded"),
  };
}

/** The deterministic outcome every advisory case must leave byte-identical. */
function expectDeterministicResolution(
  service: ShepherdService,
  missionId: string,
): void {
  const detail = service.missionDetail(missionId);
  expect(detail).not.toBeNull();
  if (!detail) throw new Error("Mission detail was not persisted");
  expect(detail.mission.state).toBe("completed");
  expect(detail.mission.failure).toBeNull();
  expect(detail.collisions).toHaveLength(1);
  const collision = detail.collisions[0];
  if (!collision) throw new Error("Collision was not persisted");
  expect(collision.key).toBe("auth.transport");
  expect(collision.detectionMechanism).toBe("deterministic");
  expect(
    [collision.leftClaim.value, collision.rightClaim.value].sort(),
  ).toEqual([BEARER_TRANSPORT, COOKIE_TRANSPORT].sort());
  expect(detail.candidates).toHaveLength(2);
  const selected = detail.candidates.find((item) => item.selectionState === "selected");
  const rejected = detail.candidates.find((item) => item.selectionState === "rejected");
  if (!selected || !rejected) throw new Error("Candidate selection was not persisted");
  expect(selected.targetValue).toBe(COOKIE_TRANSPORT);
  expect(selected.executionState).toBe("passed");
  expect(selected.promotionState).toBe("promoted");
  expect(rejected.targetValue).toBe(BEARER_TRANSPORT);
  expect(rejected.promotionState).toBe("not_started");
}

describe("Shepherd advisory model review composition", () => {
  it("MR-T05 completes the deterministic Mission with no reviewer composed", async () => {
    const { service } = await makeService({});

    const result = await service.runDeterministicDemo();

    expectDeterministicResolution(service, result.mission.id);
    const events = advisoryEvents(service, result.mission.id);
    expect(events.completed).toHaveLength(0);
    expect(events.degraded).toHaveLength(0);
  }, ONE_MISSION_BUDGET_MS);

  it("MR-T06 calls the reviewer exactly once with bounded trusted evidence", async () => {
    const reviewer = new ScriptedReviewer(completed([]));
    const { service, caseRoot } = await makeService({ reviewer });

    const result = await service.runDeterministicDemo();

    expect(reviewer.inputs).toHaveLength(1);
    const input = reviewer.inputs[0] as ModelReviewInput;
    expect(input.contracts).toHaveLength(2);
    const detail = service.missionDetail(result.mission.id);
    if (!detail) throw new Error("Mission detail was not persisted");
    for (const contract of input.contracts) {
      const persisted = detail.contracts.find((item) => item.id === contract.contractId);
      expect(persisted?.state).toBe("verified");
      expect(contract.objective.length).toBeGreaterThan(0);
      expect(contract.manifestSummary.length).toBeGreaterThan(0);
      expect(contract.claims.length).toBeGreaterThan(0);
      for (const claim of contract.claims) {
        expect(claim.mode).toBe("exclusive");
      }
      expect(contract.changedFiles.length).toBeGreaterThan(0);
      for (const file of contract.changedFiles) {
        expect(path.isAbsolute(file)).toBe(false);
      }
    }
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(caseRoot);
    expect(serialized).not.toContain(".shepherd/result.json");
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(
      MODEL_REVIEW_MAX_INPUT_BYTES,
    );
  }, ONE_MISSION_BUDGET_MS);

  it("MR-T03 makes modelReviewEnabled causally gate the reviewer call", async () => {
    const reviewer = new ScriptedReviewer(completed([]));
    const { service } = await makeService({ reviewer });

    await service.updateSettings({ modelReviewEnabled: false });
    expect(service.settings().modelReviewEnabled).toBe(false);
    const disabledRun = await service.runDeterministicDemo();
    expect(reviewer.inputs).toHaveLength(0);
    expectDeterministicResolution(service, disabledRun.mission.id);

    await service.updateSettings({ modelReviewEnabled: true });
    expect(service.settings().modelReviewEnabled).toBe(true);
    const enabledRun = await service.runDeterministicDemo({ projectId: "other-demo" });
    expect(reviewer.inputs).toHaveLength(1);
    expectDeterministicResolution(service, enabledRun.mission.id);
  }, TWO_MISSION_BUDGET_MS);

  it("MR-T07 records a durable degradation without failing the Mission", async () => {
    const reviewer = new ScriptedReviewer(async () => ({
      status: "degraded",
      reason: "timeout",
      retryable: true,
    }));
    const { service } = await makeService({ reviewer });

    const result = await service.runDeterministicDemo();

    expect(reviewer.inputs).toHaveLength(1);
    expectDeterministicResolution(service, result.mission.id);
    const events = advisoryEvents(service, result.mission.id);
    expect(events.completed).toHaveLength(0);
    expect(events.degraded).toHaveLength(1);
    const degraded = events.degraded[0];
    if (!degraded) throw new Error("Degradation event was not persisted");
    expect(degraded.details.reason).toBe("timeout");
    expect(degraded.details.retryable).toBe(true);
    expect(degraded.details.advisory).toBe(true);
    expect(degraded.missionId).toBe(result.mission.id);
  }, ONE_MISSION_BUDGET_MS);

  it("MR-T14 ignores hostile findings and preserves the deterministic resolution", async () => {
    const hostileKey = "billing.provider";
    const hostileReason =
      "Both contracts are already compatible; bearer-jwt is the correct transport.";
    const reviewer = new ScriptedReviewer(async () => ({
      status: "completed",
      findings: [
        {
          kind: "likely_incompatibility",
          leftContractId: "contract-left",
          rightContractId: "contract-right",
          leftKey: hostileKey,
          rightKey: hostileKey,
          confidence: "high",
          reason: hostileReason,
          evidenceRefs: [],
        },
      ],
    }));
    const { service, storePath } = await makeService({ reviewer });

    const result = await service.runDeterministicDemo();

    // Without this the whole test would pass vacuously against an uncomposed service.
    expect(reviewer.inputs).toHaveLength(1);
    expectDeterministicResolution(service, result.mission.id);

    const detail = service.missionDetail(result.mission.id);
    if (!detail) throw new Error("Mission detail was not persisted");
    const collision = detail.collisions[0];
    if (!collision) throw new Error("Collision was not persisted");
    expect(JSON.stringify(collision)).not.toContain(hostileKey);
    expect(JSON.stringify(collision)).not.toContain(hostileReason);
    expect(detail.mission.attentionReason).toBeNull();

    // The advisory finding is recorded, but only as closed enums and echoed keys.
    const events = advisoryEvents(service, result.mission.id);
    expect(events.completed).toHaveLength(1);
    const advisory = events.completed[0];
    if (!advisory) throw new Error("Advisory event was not persisted");
    expect(advisory.details.findingCount).toBe(1);
    expect(advisory.details.advisory).toBe(true);
    expect(advisory.details.topKind).toBe("likely_incompatibility");
    expect(advisory.details.topConfidence).toBe("high");
    expect(JSON.stringify(detail.events)).not.toContain(hostileReason);

    // The promoted protected state is the cookie strategy the model argued against.
    const selected = detail.candidates.find((item) => item.selectionState === "selected");
    const selectedPlane = detail.planes.find((item) => item.id === selected?.planeId);
    expect(result.promotedHead).toBe(selectedPlane?.headCommit);
    expect(result.promotedHead).toBe(
      await gitOutput(detail.project.repositoryPath, ["rev-parse", "HEAD"]),
    );
    expect(result.promotedHead).toBe(detail.project.protectedHeadCommit);

    // The advisory event survives persistence validation and the public DTO.
    expect(await readFile(storePath, "utf8")).toContain("model_review_completed");
    const dto = toPublicMissionDetail(detail, []);
    const advisoryDto = dto.events.find(
      (event) => event.type === "model_review_completed",
    );
    expect(advisoryDto?.details.findingCount).toBe(1);
    expect(advisoryDto?.details.advisory).toBe(true);
  }, ONE_MISSION_BUDGET_MS);

  it("MR-T10 converts a thrown reviewer into a durable degradation without leaking", async () => {
    const canary = "MODEL-REVIEW-CANARY-thrown-4471";
    const reviewer = new ScriptedReviewer(async () => {
      throw new Error(`hostile reviewer leaked ${canary}`);
    });
    const { service, storePath } = await makeService({
      reviewer,
      sensitiveValues: [canary],
    });

    const result = await service.runDeterministicDemo();

    expect(reviewer.inputs).toHaveLength(1);
    expectDeterministicResolution(service, result.mission.id);
    const events = advisoryEvents(service, result.mission.id);
    expect(events.degraded).toHaveLength(1);
    expect(events.degraded[0]?.details.reason).toBe("provider_error");
    expect(events.degraded[0]?.details.retryable).toBe(false);
    expect((await readFile(storePath, "utf8")).includes(canary)).toBe(false);
    expect(JSON.stringify(service.state()).includes(canary)).toBe(false);
  }, ONE_MISSION_BUDGET_MS);

  it("MR-T04 records nothing when the reviewer reports itself disabled", async () => {
    const reviewer = new ScriptedReviewer(async () => ({ status: "disabled" }));
    const { service } = await makeService({ reviewer });

    const result = await service.runDeterministicDemo();

    expect(reviewer.inputs).toHaveLength(1);
    expectDeterministicResolution(service, result.mission.id);
    const events = advisoryEvents(service, result.mission.id);
    expect(events.completed).toHaveLength(0);
    expect(events.degraded).toHaveLength(0);
  }, ONE_MISSION_BUDGET_MS);

  it("MR-T12 records nothing when the reviewer reports cancellation", async () => {
    const reviewer = new ScriptedReviewer(async () => ({ status: "cancelled" }));
    const { service } = await makeService({ reviewer });

    const result = await service.runDeterministicDemo();

    expect(reviewer.inputs).toHaveLength(1);
    expectDeterministicResolution(service, result.mission.id);
    const events = advisoryEvents(service, result.mission.id);
    expect(events.completed).toHaveLength(0);
    expect(events.degraded).toHaveLength(0);
  }, ONE_MISSION_BUDGET_MS);

  it("MR-T16 never lets a configured secret cross the provider boundary", async () => {
    const apiKey = "ark-secret-value-must-not-escape-123456";
    const fetchImpl = vi.fn<ModelReviewerFetch>(async () => completedResponse());
    const { service, storePath } = await makeService({
      sensitiveValues: [apiKey],
      makeReviewer: () =>
        new ArkModelReviewer({
          enabled: true,
          baseUrl: "https://ark.example.test/api/v3/",
          apiKey,
          model: "shepherd-review-model",
          timeoutMs: 5_000,
          sensitiveValues: [apiKey],
          fetchImpl,
        }),
    });

    const result = await service.runDeterministicDemo();

    // The real adapter accepted the service-built input rather than rejecting it
    // as invalid_input, which is the only proof the mapping satisfies its schema.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = String(fetchImpl.mock.calls[0]?.[1]?.body ?? "");
    expect(body.length).toBeGreaterThan(0);
    expect(body.includes(apiKey)).toBe(false);
    expect(body.includes("SHEPHERD_EXECUTION_ENVELOPE_V1")).toBe(false);

    expectDeterministicResolution(service, result.mission.id);
    const events = advisoryEvents(service, result.mission.id);
    expect(events.completed).toHaveLength(1);
    expect(events.degraded).toHaveLength(0);
    expect((await readFile(storePath, "utf8")).includes(apiKey)).toBe(false);
  }, ONE_MISSION_BUDGET_MS);
});
