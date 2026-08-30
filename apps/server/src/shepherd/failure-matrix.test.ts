import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentService } from "../agent-service.js";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { JsonStore } from "../store.js";
import type { VerificationEvidence } from "./domain.js";
import {
  DeterministicFixtureExecutor,
  type ShepherdExecutionRequest,
  type ShepherdExecutionResult,
  type ShepherdExecutor,
} from "./executor.js";
import {
  ShepherdService,
  type ShepherdIndependentVerifier,
  type ShepherdMissionDetail,
} from "./service.js";
import { HostTrustedFixtureVerifier } from "./test-fixtures/host-trusted-verifier.js";
import type { VerificationRequest } from "./verifier.js";

const execFileAsync = promisify(execFile);
const matrixTestRoot = fileURLToPath(
  new URL("../../../../.tmp/shepherd-failure-matrix-tests/", import.meta.url),
);
const cleanupRoots: string[] = [];

type FailureMode =
  | "missing_manifest"
  | "malformed_manifest"
  | "omitted_declared_key"
  | "contract_acceptance"
  | "final_reverification"
  | "objective_tie";

interface FailureMatrixFixture {
  caseRoot: string;
  detail: ShepherdMissionDetail;
  reloadedDetail: ShepherdMissionDetail;
  rejection: Error;
  apiMission: Record<string, unknown>;
  apiEvents: Array<Record<string, unknown>>;
  actualProtectedHead: string;
}

const agentService = {
  listAgents: () => [],
  systemInfo: async () => ({}),
} as unknown as AgentService;

async function makeCaseRoot(): Promise<string> {
  await mkdir(matrixTestRoot, { recursive: true });
  const root = await mkdtemp(path.join(matrixTestRoot, "fm-01-"));
  cleanupRoots.push(root);
  return root;
}

afterEach(async () => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

class ManifestFaultExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
  private readonly inner = new DeterministicFixtureExecutor();

  constructor(
    private readonly mode: Extract<
      FailureMode,
      "missing_manifest" | "malformed_manifest" | "omitted_declared_key"
    >,
  ) {}

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    const result = await this.inner.run(request);
    if (request.operation.kind !== "frontend_contract") return result;

    const manifestPath = path.join(
      request.workspacePath,
      ".shepherd",
      "result.json",
    );
    if (this.mode === "missing_manifest") {
      await rm(manifestPath);
      return result;
    }
    if (this.mode === "malformed_manifest") {
      await writeFile(manifestPath, "{not-json\n", "utf8");
      return result;
    }

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, semanticClaims: [] }, null, 2) + "\n",
      "utf8",
    );
    return result;
  }

  async cancel(executionId: string): Promise<boolean> {
    return await this.inner.cancel(executionId);
  }
}

function failedEvidence(
  evidence: VerificationEvidence,
  summary: string,
): VerificationEvidence {
  let marked = false;
  return {
    ...evidence,
    passed: false,
    checks: evidence.checks.map((check) => {
      if (marked || !check.mandatory) return check;
      marked = true;
      return {
        ...check,
        status: "failed",
        passed: false,
        exitCode: 1,
        error: "Trusted mandatory check failed",
      };
    }),
    summary,
  };
}

function passingEvidence(evidence: VerificationEvidence): VerificationEvidence {
  return {
    ...evidence,
    passed: true,
    checks: evidence.checks.map((check) => ({
      ...check,
      status: "passed",
      passed: true,
      exitCode: 0,
      stderr: "",
      error: null,
    })),
    summary: `${evidence.checks.filter((check) => check.mandatory).length}/${
      evidence.checks.filter((check) => check.mandatory).length
    } mandatory checks passed`,
  };
}

class FailureMatrixVerifier
  extends HostTrustedFixtureVerifier
  implements ShepherdIndependentVerifier
{
  constructor(
    private readonly mode: Extract<
      FailureMode,
      "contract_acceptance" | "final_reverification" | "objective_tie"
    >,
  ) {
    super();
  }

  override async verify(request: VerificationRequest): Promise<VerificationEvidence> {
    const evidence = await super.verify(request);
    if (this.mode === "contract_acceptance" && request.targetType === "contract") {
      return failedEvidence(
        evidence,
        "A mandatory Contract acceptance check failed",
      );
    }
    if (this.mode === "final_reverification" && request.targetType === "promotion") {
      return failedEvidence(
        evidence,
        "Final independent re-verification failed",
      );
    }
    if (this.mode === "objective_tie" && request.targetType === "candidate") {
      return passingEvidence(evidence);
    }
    return evidence;
  }
}

function executorFor(mode: FailureMode): ShepherdExecutor {
  if (
    mode === "missing_manifest" ||
    mode === "malformed_manifest" ||
    mode === "omitted_declared_key"
  ) {
    return new ManifestFaultExecutor(mode);
  }
  return new DeterministicFixtureExecutor();
}

function verifierFor(mode: FailureMode): ShepherdIndependentVerifier {
  if (
    mode === "contract_acceptance" ||
    mode === "final_reverification" ||
    mode === "objective_tie"
  ) {
    return new FailureMatrixVerifier(mode);
  }
  return new HostTrustedFixtureVerifier();
}

function durableProjection(detail: ShepherdMissionDetail) {
  return {
    mission: {
      state: detail.mission.state,
      attentionReason: detail.mission.attentionReason,
      failure: detail.mission.failure,
    },
    project: {
      protectedHeadCommit: detail.project.protectedHeadCommit,
      activeMissionId: detail.project.activeMissionId,
    },
    contracts: detail.contracts.map((contract) => ({
      id: contract.id,
      state: contract.state,
      failure: contract.failure,
      planeId: contract.planeId,
    })),
    planes: detail.planes.map((plane) => ({
      id: plane.id,
      kind: plane.kind,
      state: plane.state,
      error: plane.error,
      verificationEvidenceIds: plane.verificationEvidenceIds,
    })),
    candidates: detail.candidates.map((candidate) => ({
      id: candidate.id,
      executionState: candidate.executionState,
      selectionState: candidate.selectionState,
      promotionState: candidate.promotionState,
      promotionEvidence: candidate.promotionEvidence,
      failure: candidate.failure,
    })),
    events: detail.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      missionId: event.missionId,
      contractId: event.contractId,
      planeId: event.planeId,
      collisionId: event.collisionId,
      candidateId: event.candidateId,
      details: event.details,
    })),
  };
}

async function runFailureMatrixCase(mode: FailureMode): Promise<FailureMatrixFixture> {
  const caseRoot = await makeCaseRoot();
  const storePath = path.join(caseRoot, "state.json");
  const managedRoot = path.join(caseRoot, "managed");
  const agentWorkspaceRoot = path.join(caseRoot, "agent-workspaces");
  const store = new JsonStore(storePath);
  await store.initialize();
  const service = new ShepherdService({
    store,
    managedRoot,
    agentWorkspaceRoot,
    executor: executorFor(mode),
    verifier: verifierFor(mode),
  });

  let rejection: Error | null = null;
  try {
    await service.runDeterministicDemo();
  } catch (error) {
    if (error instanceof Error) rejection = error;
    else throw error;
  }
  if (!rejection) throw new Error(`Failure matrix case ${mode} unexpectedly passed`);

  const missionId = service.state().missions.at(-1)?.id;
  if (!missionId) throw new Error("Failure matrix Mission was not persisted");
  const detail = service.missionDetail(missionId);
  if (!detail) throw new Error("Failure matrix Mission detail disappeared");

  const actualProtectedHead = (
    await execFileAsync(
      "git",
      ["-C", detail.project.repositoryPath, "rev-parse", "HEAD"],
      {
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
        },
        encoding: "utf8",
      },
    )
  ).stdout.trim();

  const reloadedStore = new JsonStore(storePath);
  await reloadedStore.initialize();
  const reloadedService = new ShepherdService({
    store: reloadedStore,
    managedRoot,
    agentWorkspaceRoot,
    verifier: new HostTrustedFixtureVerifier(),
  });
  await reloadedService.initialize();
  const reloadedDetail = reloadedService.missionDetail(missionId);
  if (!reloadedDetail) throw new Error("Reloaded failure matrix detail disappeared");

  const app = await createApp(
    loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }),
    agentService,
    reloadedService,
  );
  try {
    const missionResponse = await app.inject({
      method: "GET",
      url: `/api/shepherd/missions/${missionId}`,
    });
    expect(missionResponse.statusCode).toBe(200);
    expect(missionResponse.body).not.toContain(caseRoot);

    const eventResponse = await app.inject({
      method: "GET",
      url: "/api/shepherd/events?cursor=0&limit=200",
    });
    expect(eventResponse.statusCode).toBe(200);
    expect(eventResponse.body).not.toContain(caseRoot);

    return {
      caseRoot,
      detail,
      reloadedDetail,
      rejection,
      apiMission: missionResponse.json() as Record<string, unknown>,
      apiEvents: (eventResponse.json() as {
        events: Array<Record<string, unknown>>;
      }).events,
      actualProtectedHead,
    };
  } finally {
    await app.close();
  }
}

const contractCases = [
  {
    name: "missing result manifest",
    mode: "missing_manifest" as const,
    rejection: /result manifest is missing/iu,
    contractState: "manifest_missing",
    code: "missing_result_manifest",
    eventType: "mission_state_changed",
  },
  {
    name: "malformed result manifest",
    mode: "malformed_manifest" as const,
    rejection: /Strict result manifest ingestion failed: malformed_manifest/iu,
    contractState: "manifest_malformed",
    code: "malformed_manifest",
    eventType: "mission_state_changed",
  },
  {
    name: "omitted declared claim key",
    mode: "omitted_declared_key" as const,
    rejection: /Strict result manifest ingestion failed: omitted_declared_claim_key/iu,
    contractState: "claim_rejected",
    code: "omitted_declared_claim_key",
    eventType: "claim_rejected",
  },
  {
    name: "failed mandatory Contract acceptance",
    mode: "contract_acceptance" as const,
    rejection: /failed independent verification/iu,
    contractState: "verification_failed",
    code: "failed_independent_acceptance",
    eventType: "verification_failed",
  },
] as const;

describe("FM-01 deterministic failure matrix", () => {
  it.each(contractCases)(
    "preserves causal evidence for $name across service, API, and reload",
    async ({ mode, rejection, contractState, code, eventType }) => {
      const result = await runFailureMatrixCase(mode);
      expect(result.rejection.message).toMatch(rejection);
      expect(result.detail.mission).toMatchObject({
        state: "failed",
        attentionReason: null,
        failure: {
          code,
          stage:
            mode === "contract_acceptance"
              ? "contract_verification"
              : "manifest_ingestion",
          retryable: false,
        },
      });

      const failedContracts = result.detail.contracts.filter(
        (contract) => contract.failure?.code === code,
      );
      expect(failedContracts).toHaveLength(mode === "contract_acceptance" ? 2 : 1);
      for (const contract of failedContracts) {
        expect(contract).toMatchObject({
          state: contractState,
          failure: {
            code,
            stage:
              mode === "contract_acceptance"
                ? "contract_verification"
                : "manifest_ingestion",
          },
        });
        const plane = result.detail.planes.find((item) => item.id === contract.planeId);
        expect(plane).toMatchObject({
          kind: "contract",
          state: "failed",
          error: {
            code,
            stage:
              mode === "contract_acceptance"
                ? "contract_verification"
                : "manifest_ingestion",
          },
        });
        expect(result.detail.events).toContainEqual(
          expect.objectContaining({
            type: eventType,
            missionId: result.detail.mission.id,
            contractId: contract.id,
            planeId: contract.planeId,
            details: expect.objectContaining({
              to: contractState,
              failureCode: code,
              stage:
                mode === "contract_acceptance"
                  ? "contract_verification"
                  : "manifest_ingestion",
            }),
          }),
        );
      }

      expect(result.detail.planes.every((plane) => plane.kind === "contract")).toBe(
        true,
      );
      expect(result.detail.collisions).toEqual([]);
      expect(result.detail.candidates).toEqual([]);
      expect(
        result.detail.events.some((event) => event.type === "promotion_started"),
      ).toBe(false);
      expect(
        result.detail.events.some((event) => event.type === "promotion_completed"),
      ).toBe(false);
      expect(result.detail.project.protectedHeadCommit).toBe(
        result.detail.mission.baseCommit,
      );
      expect(result.actualProtectedHead).toBe(result.detail.mission.baseCommit);
      expect(durableProjection(result.reloadedDetail)).toEqual(
        durableProjection(result.detail),
      );
      expect(result.apiMission.mission).toMatchObject({
        state: "failed",
        failure: { code },
      });
      expect(result.apiMission.project).toMatchObject({
        protectedHeadCommit: result.detail.mission.baseCommit,
      });
      expect(result.apiMission.contracts).toContainEqual(
        expect.objectContaining({
          state: contractState,
          failure: expect.objectContaining({ code }),
        }),
      );
      expect(result.apiMission.planes).toContainEqual(
        expect.objectContaining({
          state: "failed",
          error: expect.objectContaining({ code }),
        }),
      );
      expect(result.apiEvents).toContainEqual(
        expect.objectContaining({
          type: eventType,
          details: expect.objectContaining({ failureCode: code }),
        }),
      );
    },
    30_000,
  );

  it("preserves an objective tie without entering the promotion gate", async () => {
    const result = await runFailureMatrixCase("objective_tie");
    expect(result.rejection.message).toBe(
      "Resolution requires attention: objective_tie",
    );
    expect(result.detail.mission).toMatchObject({
      state: "attention_required",
      attentionReason: "objective_tie",
      failure: {
        code: "objective_tie",
        stage: "resolution_selection",
        retryable: false,
      },
    });
    expect(result.detail.contracts.every((contract) => contract.state === "verified"))
      .toBe(true);
    expect(result.detail.candidates).toHaveLength(2);
    expect(
      result.detail.candidates.every(
        (candidate) =>
          candidate.executionState === "passed" &&
          candidate.selectionState === "tied" &&
          candidate.promotionState === "not_started",
      ),
    ).toBe(true);
    expect(result.detail.events).toContainEqual(
      expect.objectContaining({
        type: "tie_escalated",
        missionId: result.detail.mission.id,
        collisionId: result.detail.collisions[0]?.id,
        details: expect.objectContaining({ reason: "objective_tie" }),
      }),
    );
    expect(
      result.detail.events.some((event) => event.type === "promotion_started"),
    ).toBe(false);
    expect(
      result.detail.events.some((event) => event.type === "promotion_completed"),
    ).toBe(false);
    expect(result.detail.project.protectedHeadCommit).toBe(
      result.detail.mission.baseCommit,
    );
    expect(result.actualProtectedHead).toBe(result.detail.mission.baseCommit);
    expect(durableProjection(result.reloadedDetail)).toEqual(
      durableProjection(result.detail),
    );
    expect(result.apiMission).toMatchObject({
      mission: {
        state: "attention_required",
        attentionReason: "objective_tie",
        failure: { code: "objective_tie" },
      },
      candidates: [
        expect.objectContaining({
          executionState: "passed",
          selectionState: "tied",
          promotionState: "not_started",
        }),
        expect.objectContaining({
          executionState: "passed",
          selectionState: "tied",
          promotionState: "not_started",
        }),
      ],
    });
    expect(result.apiEvents).toContainEqual(
      expect.objectContaining({
        type: "tie_escalated",
        details: expect.objectContaining({ reason: "objective_tie" }),
      }),
    );
  }, 30_000);

  it("persists failed final re-verification evidence without promotion", async () => {
    const result = await runFailureMatrixCase("final_reverification");
    expect(result.rejection.message).toBe(
      "Promotion failed: final_reverification_failure",
    );
    expect(result.detail.mission).toMatchObject({
      state: "attention_required",
      attentionReason: "final_reverification_failure",
      failure: {
        code: "final_reverification_failure",
        stage: "promotion",
        retryable: false,
      },
    });
    const selected = result.detail.candidates.find(
      (candidate) => candidate.selectionState === "selected",
    );
    expect(selected).toMatchObject({
      executionState: "passed",
      promotionState: "failed",
      promotionEvidence: {
        targetType: "promotion",
        passed: false,
      },
      failure: {
        code: "final_reverification_failure",
        stage: "promotion",
      },
    });
    const selectedPlane = result.detail.planes.find(
      (plane) => plane.id === selected?.planeId,
    );
    expect(selectedPlane?.verificationEvidenceIds).toContain(
      selected?.promotionEvidence?.id,
    );
    expect(result.detail.collisions[0]?.state).toBe("attention_required");
    expect(result.detail.events).toContainEqual(
      expect.objectContaining({
        type: "promotion_started",
        missionId: result.detail.mission.id,
        collisionId: selected?.collisionId,
        candidateId: selected?.id,
        planeId: selected?.planeId,
      }),
    );
    expect(result.detail.events).toContainEqual(
      expect.objectContaining({
        type: "mission_state_changed",
        missionId: result.detail.mission.id,
        summary: "Promotion failed after final gate evaluation",
        details: expect.objectContaining({
          from: "resolving",
          to: "attention_required",
          reason: "final_reverification_failure",
          failureCode: "final_reverification_failure",
          stage: "promotion",
        }),
      }),
    );
    expect(
      result.detail.events.some((event) => event.type === "promotion_completed"),
    ).toBe(false);
    expect(result.detail.project.protectedHeadCommit).toBe(
      result.detail.mission.baseCommit,
    );
    expect(result.actualProtectedHead).toBe(result.detail.mission.baseCommit);
    expect(durableProjection(result.reloadedDetail)).toEqual(
      durableProjection(result.detail),
    );
    expect(result.apiMission.mission).toMatchObject({
      state: "attention_required",
      attentionReason: "final_reverification_failure",
      failure: { code: "final_reverification_failure" },
    });
    expect(result.apiMission.candidates).toContainEqual(
      expect.objectContaining({
        id: selected?.id,
        promotionState: "failed",
        promotionEvidence: expect.objectContaining({
          targetType: "promotion",
          passed: false,
        }),
        failure: expect.objectContaining({ code: "final_reverification_failure" }),
      }),
    );
    expect(result.apiMission.planes).toContainEqual(
      expect.objectContaining({
        id: selected?.planeId,
        verificationEvidenceIds: expect.arrayContaining([
          selected?.promotionEvidence?.id,
        ]),
      }),
    );
    expect(result.apiEvents).toContainEqual(
      expect.objectContaining({
        type: "promotion_started",
        candidateId: selected?.id,
      }),
    );
    expect(result.apiEvents).toContainEqual(
      expect.objectContaining({
        type: "mission_state_changed",
        missionId: result.detail.mission.id,
        summary: "Promotion failed after final gate evaluation",
        details: expect.objectContaining({
          from: "resolving",
          to: "attention_required",
          reason: "final_reverification_failure",
          failureCode: "final_reverification_failure",
          stage: "promotion",
        }),
      }),
    );
  }, 30_000);
});
