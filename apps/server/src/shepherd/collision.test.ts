import { describe, expect, it } from "vitest";
import type { SemanticClaim } from "./domain.js";
import {
  detectDeterministicCollisions,
  evaluateDeterministicCollision,
  isDeterministicCollision,
  type CollisionClaimView,
  type CollisionContractView,
} from "./collision.js";

const createdAt = "2026-08-29T12:00:00.000Z";

function claim(
  contractId: string,
  value: string,
  overrides: Partial<CollisionClaimView> = {},
): CollisionClaimView {
  return {
    id: `${contractId}-claim`,
    missionId: "mission-1",
    contractId,
    key: "auth.transport",
    value,
    scope: "application",
    mode: "exclusive",
    evidence: [
      { path: `src/${contractId}.ts`, description: "Changed implementation" },
    ],
    valid: true,
    rejectionReason: null,
    createdAt,
    ...overrides,
  };
}

function contract(
  id: string,
  value: string,
  overrides: Partial<CollisionContractView> = {},
): CollisionContractView {
  return {
    id,
    missionId: "mission-1",
    state: "verified",
    claims: [claim(id, value)],
    ...overrides,
  };
}

function pair() {
  const left = contract("contract-a", "JWT");
  const right = contract("contract-b", "HttpOnly Cookie");
  return {
    left,
    right,
    leftClaim: left.claims[0]!,
    rightClaim: right.claims[0]!,
  };
}

describe("deterministic collision predicate", () => {
  it("collides after canonical key, value, and scope normalization", () => {
    const { left, right, leftClaim, rightClaim } = pair();
    leftClaim.key = " Authentication_Method ";
    leftClaim.scope = " Application ";
    rightClaim.key = "auth-transport";
    rightClaim.scope = "application";
    expect(
      evaluateDeterministicCollision(left, leftClaim, right, rightClaim),
    ).toEqual({
      collides: true,
      key: "auth.transport",
      scope: "application",
      leftValue: "bearer-jwt",
      rightValue: "http-only-session-cookie",
    });
  });

  it("works with trusted SemanticClaim records without adaptation", () => {
    const leftClaim = claim("contract-a", "jwt") as SemanticClaim;
    const rightClaim = claim("contract-b", "session-cookie") as SemanticClaim;
    expect(
      isDeterministicCollision(
        contract("contract-a", "jwt", { claims: [leftClaim] }),
        leftClaim,
        contract("contract-b", "session-cookie", { claims: [rightClaim] }),
        rightClaim,
      ),
    ).toBe(true);
  });

  it("rejects comparisons within one contract", () => {
    const left = contract("contract-a", "jwt");
    const right = contract("contract-a", "session-cookie", {
      claims: [claim("contract-a", "session-cookie", { id: "other-claim" })],
    });
    expect(
      evaluateDeterministicCollision(
        left,
        left.claims[0]!,
        right,
        right.claims[0]!,
      ),
    ).toEqual({ collides: false, reason: "same_contract" });
  });

  it("requires the same Mission", () => {
    const { left, right, leftClaim } = pair();
    const movedClaim = { ...right.claims[0]!, missionId: "mission-2" };
    const moved = { ...right, missionId: "mission-2", claims: [movedClaim] };
    expect(
      evaluateDeterministicCollision(left, leftClaim, moved, movedClaim),
    ).toEqual({ collides: false, reason: "different_mission" });
  });

  it.each(["created", "running", "verifying", "verification_failed"] as const)(
    "requires independently verified contracts, not state %s",
    (state) => {
      const { left, right, leftClaim, rightClaim } = pair();
      const unverified = { ...right, state };
      expect(
        evaluateDeterministicCollision(left, leftClaim, unverified, rightClaim),
      ).toEqual({ collides: false, reason: "contract_not_verified" });
    },
  );

  it("rejects a claim attached to the wrong contract or Mission", () => {
    const { left, right, leftClaim, rightClaim } = pair();
    expect(
      evaluateDeterministicCollision(
        left,
        { ...leftClaim, contractId: "contract-x" },
        right,
        rightClaim,
      ),
    ).toEqual({ collides: false, reason: "claim_contract_mismatch" });
    expect(
      evaluateDeterministicCollision(
        left,
        leftClaim,
        right,
        { ...rightClaim, missionId: "mission-x" },
      ),
    ).toEqual({ collides: false, reason: "claim_contract_mismatch" });
  });

  it("does not collide different canonical keys", () => {
    const { left, right, leftClaim, rightClaim } = pair();
    expect(
      evaluateDeterministicCollision(left, leftClaim, right, {
        ...rightClaim,
        key: "auth.storage",
      }),
    ).toEqual({ collides: false, reason: "different_key" });
  });

  it("does not collide distinct semantic scopes", () => {
    const { left, right, leftClaim, rightClaim } = pair();
    expect(
      evaluateDeterministicCollision(left, leftClaim, right, {
        ...rightClaim,
        scope: "admin-portal",
      }),
    ).toEqual({ collides: false, reason: "different_scope" });
  });

  it("does not collide a non-exclusive legacy or untrusted claim", () => {
    const { left, right, leftClaim, rightClaim } = pair();
    expect(
      evaluateDeterministicCollision(
        left,
        { ...leftClaim, mode: "advisory" },
        right,
        rightClaim,
      ),
    ).toEqual({ collides: false, reason: "non_exclusive" });
  });

  it.each([
    ["JWT", "bearer", "same_value"],
    ["HttpOnly Cookie", "session_cookie", "same_value"],
  ])("does not collide alias-equivalent values", (leftValue, rightValue, reason) => {
    const left = contract("contract-a", leftValue);
    const right = contract("contract-b", rightValue);
    expect(
      evaluateDeterministicCollision(
        left,
        left.claims[0]!,
        right,
        right.claims[0]!,
      ),
    ).toEqual({ collides: false, reason });
  });

  it.each([
    [{ valid: false, rejectionReason: "missing_evidence" }],
    [{ evidence: [] }],
    [{ evidence: [{ path: "src/file.ts", description: "   " }] }],
  ])("requires trusted, non-empty evidence %#", (override) => {
    const { left, right, leftClaim, rightClaim } = pair();
    expect(
      evaluateDeterministicCollision(
        left,
        { ...leftClaim, ...override },
        right,
        rightClaim,
      ),
    ).toEqual({ collides: false, reason: "invalid_evidence" });
  });

  it("suppresses a direct dependency because the downstream claim supersedes it", () => {
    const { left, right, leftClaim, rightClaim } = pair();
    expect(
      evaluateDeterministicCollision(left, leftClaim, right, rightClaim, [
        { fromContractId: left.id, toContractId: right.id },
      ]),
    ).toEqual({ collides: false, reason: "dependency_supersession" });
  });

  it("suppresses transitive and reverse dependency relationships", () => {
    const { left, right, leftClaim, rightClaim } = pair();
    const forward = [
      { fromContractId: left.id, toContractId: "middle" },
      { fromContractId: "middle", toContractId: right.id },
    ];
    expect(
      evaluateDeterministicCollision(left, leftClaim, right, rightClaim, forward),
    ).toEqual({ collides: false, reason: "dependency_supersession" });
    expect(
      evaluateDeterministicCollision(
        left,
        leftClaim,
        right,
        rightClaim,
        forward.map((edge) => ({
          fromContractId: edge.toContractId,
          toContractId: edge.fromContractId,
        })),
      ),
    ).toEqual({ collides: false, reason: "dependency_supersession" });
  });
});

describe("deterministic collision materialization", () => {
  it("creates a normalized, evidence-backed collision with no model reviewer", () => {
    const left = contract("contract-z", "Bearer");
    const right = contract("contract-a", "session-cookie");
    const collisions = detectDeterministicCollisions([left, right], {
      createdAt,
      collisionId: (leftId, rightId) => `${leftId}--${rightId}`,
    });
    expect(collisions).toEqual([
      expect.objectContaining({
        id: "contract-a--contract-z",
        missionId: "mission-1",
        key: "auth.transport",
        scope: "application",
        leftContractId: "contract-a",
        rightContractId: "contract-z",
        detectionMechanism: "deterministic",
        candidateIds: [],
        state: "detected",
        createdAt,
        updatedAt: createdAt,
        resolvedAt: null,
        leftClaim: expect.objectContaining({
          value: "http-only-session-cookie",
        }),
        rightClaim: expect.objectContaining({ value: "bearer-jwt" }),
      }),
    ]);
  });

  it("is stable when contract and claim input order changes", () => {
    const first = contract("contract-a", "jwt", {
      claims: [
        claim("contract-a", "jwt", { id: "z-claim" }),
        claim("contract-a", "jwt", {
          id: "a-claim",
          key: "ui.theme",
          value: "dark",
        }),
      ],
    });
    const second = contract("contract-b", "session-cookie", {
      claims: [
        claim("contract-b", "session-cookie", { id: "z-claim-b" }),
        claim("contract-b", "session-cookie", {
          id: "a-claim-b",
          key: "ui.theme",
          value: "light",
        }),
      ],
    });
    const options = { createdAt };
    expect(detectDeterministicCollisions([second, first], options)).toEqual(
      detectDeterministicCollisions(
        [
          { ...first, claims: [...first.claims].reverse() },
          { ...second, claims: [...second.claims].reverse() },
        ],
        options,
      ),
    );
  });

  it("does not produce collisions for near-miss pairs", () => {
    const sameValue = contract("contract-b", "bearer-jwt");
    expect(
      detectDeterministicCollisions(
        [contract("contract-a", "jwt"), sameValue],
        { createdAt },
      ),
    ).toEqual([]);
  });
});
