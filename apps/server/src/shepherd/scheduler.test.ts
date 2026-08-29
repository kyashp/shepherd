import { describe, expect, it } from "vitest";
import type { ExecutionContract, Mission } from "./domain.js";
import {
  DagValidationError,
  selectRunnableContracts,
  validateContractDag,
  type SchedulableContract,
  type SchedulableMission,
} from "./scheduler.js";

const contract = (
  id: string,
  dependencyIds: string[] = [],
  overrides: Partial<SchedulableContract> = {},
): SchedulableContract => ({
  id,
  missionId: "mission",
  agentId: `agent-${id}`,
  dependencyIds,
  state: "queued",
  ...overrides,
});

const mission = (
  contracts: readonly SchedulableContract[],
  state: Mission["state"] = "running",
): SchedulableMission => ({
  id: "mission",
  state,
  contractIds: contracts.map(({ id }) => id),
  dependencyEdges: contracts.flatMap((item) =>
    item.dependencyIds.map((dependencyId) => ({
      fromContractId: dependencyId,
      toContractId: item.id,
      required: true,
    })),
  ),
});

const runtime = {
  activePlaneCount: 0,
  maxPlaneConcurrency: 4,
};

const errorCode = (run: () => void, code: DagValidationError["code"]) => {
  expect(run).toThrow(DagValidationError);
  try {
    run();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
};

describe("validateContractDag", () => {
  it("accepts an acyclic dependency graph", () => {
    const contracts = [contract("a"), contract("b", ["a"]), contract("c", ["a", "b"])];
    expect(() => validateContractDag(mission(contracts), contracts)).not.toThrow();
  });

  it("rejects unknown dependencies in either representation", () => {
    const contracts = [contract("a", ["missing"])];
    errorCode(() => validateContractDag(mission(contracts), contracts), "unknown_dependency");

    const valid = [contract("a")];
    const malformed = mission(valid);
    malformed.dependencyEdges.push({ fromContractId: "missing", toContractId: "a", required: true });
    errorCode(() => validateContractDag(malformed, valid), "unknown_dependency");
  });

  it("rejects self dependencies", () => {
    const contracts = [contract("a", ["a"])];
    errorCode(() => validateContractDag(mission(contracts), contracts), "self_dependency");
  });

  it("rejects direct and indirect cycles", () => {
    const pair = [contract("a", ["b"]), contract("b", ["a"])];
    errorCode(() => validateContractDag(mission(pair), pair), "cycle");

    const triple = [contract("a", ["c"]), contract("b", ["a"]), contract("c", ["b"])];
    errorCode(() => validateContractDag(mission(triple), triple), "cycle");
  });

  it("rejects duplicate Contracts, duplicate edges, Mission mismatch, and representation drift", () => {
    const duplicate = [contract("a"), contract("a")];
    errorCode(() => validateContractDag(mission(duplicate), duplicate), "duplicate_contract");

    const valid = [contract("a"), contract("b", ["a"])];
    const duplicateEdge = mission(valid);
    duplicateEdge.dependencyEdges.push({ ...duplicateEdge.dependencyEdges[0]! });
    errorCode(() => validateContractDag(duplicateEdge, valid), "duplicate_dependency");

    errorCode(
      () => validateContractDag(mission([contract("a", [], { missionId: "other" })]), [contract("a", [], { missionId: "other" })]),
      "mission_contract_mismatch",
    );

    const drifted = mission(valid);
    drifted.dependencyEdges = [];
    errorCode(() => validateContractDag(drifted, valid), "dependency_mismatch");
  });
});

describe("selectRunnableContracts", () => {
  it("selects multiple independent jobs in stable ID order", () => {
    const contracts = [contract("z"), contract("a"), contract("m")];
    const result = selectRunnableContracts(mission(contracts), contracts, runtime);
    expect(result.selected.map(({ id }) => id)).toEqual(["a", "m", "z"]);
    expect(result.blocked).toEqual([]);
  });

  it("requires verified dependencies and distinguishes pending from failed", () => {
    const contracts = [
      contract("failed", [], { state: "verification_failed" }),
      contract("pending", [], { state: "running" }),
      contract("after-failed", ["failed"]),
      contract("after-pending", ["pending"]),
    ];
    const result = selectRunnableContracts(mission(contracts), contracts, runtime);
    expect(result.blocked.map(({ contract: item, reason }) => [item.id, reason])).toEqual([
      ["after-failed", { code: "dependency_failed", dependencyIds: ["failed"] }],
      ["after-pending", { code: "dependency_pending", dependencyIds: ["pending"] }],
    ]);
  });

  it.each<ExecutionContract["state"]>([
    "execution_failed", "execution_timed_out", "manifest_missing", "manifest_malformed",
    "authority_denied", "verification_failed", "claim_rejected", "attention_required",
    "cancelled", "interrupted",
  ])("treats terminal dependency state %s as failed", (state) => {
    const contracts = [contract("base", [], { state }), contract("next", ["base"])];
    expect(selectRunnableContracts(mission(contracts), contracts, runtime).blocked[0]?.reason)
      .toEqual({ code: "dependency_failed", dependencyIds: ["base"] });
  });

  it("blocks all eligible work when the Mission is inactive", () => {
    const contracts = [contract("a"), contract("b")];
    const result = selectRunnableContracts(mission(contracts, "attention_required"), contracts, runtime);
    expect(result.selected).toEqual([]);
    expect(result.blocked.map(({ reason }) => reason)).toEqual([
      { code: "mission_inactive", missionState: "attention_required" },
      { code: "mission_inactive", missionState: "attention_required" },
    ]);
  });

  it("honors existing and same-batch Agent execution identity occupancy", () => {
    const contracts = [
      contract("a", [], { agentId: "shared" }),
      contract("b", [], { agentId: "shared" }),
      contract("c", [], { agentId: "already-busy" }),
    ];
    const result = selectRunnableContracts(mission(contracts), contracts, {
      ...runtime,
      busyAgentIds: new Set(["already-busy"]),
    });
    expect(result.selected.map(({ id }) => id)).toEqual(["a"]);
    expect(result.blocked.map(({ contract: item, reason }) => [item.id, reason])).toEqual([
      ["b", { code: "agent_unavailable", agentId: "shared" }],
      ["c", { code: "agent_unavailable", agentId: "already-busy" }],
    ]);
  });

  it("honors the project mutation lock before allocating work", () => {
    const contracts = [contract("a"), contract("b")];
    const result = selectRunnableContracts(mission(contracts), contracts, {
      ...runtime,
      mutationLockHeld: true,
    });
    expect(result.selected).toEqual([]);
    expect(result.blocked.every(({ reason }) => reason.code === "mutation_lock_held")).toBe(true);
  });

  it("caps the batch by available Plane capacity with deterministic winners", () => {
    const contracts = [contract("c"), contract("a"), contract("b")];
    const result = selectRunnableContracts(mission(contracts), contracts, {
      activePlaneCount: 1,
      maxPlaneConcurrency: 3,
    });
    expect(result.selected.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(result.blocked).toMatchObject([
      { contract: { id: "c" }, reason: { code: "plane_capacity_exhausted" } },
    ]);
  });

  it("does not schedule contracts already executing or terminal", () => {
    const contracts = [
      contract("queued"),
      contract("running", [], { state: "running" }),
      contract("verified", [], { state: "verified" }),
    ];
    expect(selectRunnableContracts(mission(contracts), contracts, runtime).selected.map(({ id }) => id))
      .toEqual(["queued"]);
  });

  it("rejects invalid concurrency accounting", () => {
    const contracts = [contract("a")];
    expect(() => selectRunnableContracts(mission(contracts), contracts, {
      activePlaneCount: -1,
      maxPlaneConcurrency: 0,
    })).toThrow(RangeError);
  });
});
