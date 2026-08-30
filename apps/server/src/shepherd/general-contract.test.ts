import { describe, expect, it } from "vitest";
import type { ScopedAuthority } from "./domain.js";
import {
  GeneralContractPlanError,
  planGeneralContract,
} from "./general-contract.js";

const authority: ScopedAuthority = {
  readable: ["**"],
  writable: ["apps/**", "docs/**", "scripts/**", "src/**", "tests/**"],
  forbidden: [".git/**", ".shepherd/**", ".env", "**/*.pem"],
};

describe("general private-chat Contract planning", () => {
  it("creates a bounded plan from an explicit objective, artifact, and acceptance statement", () => {
    expect(
      planGeneralContract([
        'Create `scripts/hello.py` that prints "Hello, world!". Acceptance: the file exists and contains "Hello, world!".',
      ], authority),
    ).toEqual({
      status: "ready",
      objective:
        'Create `scripts/hello.py` that prints "Hello, world!". Acceptance: the file exists and contains "Hello, world!".',
      title: 'Create scripts/hello.py that prints "Hello, world!"',
      expectedArtifacts: [
        {
          path: "scripts/hello.py",
          description: "Required artifact for the confirmed Agent request",
          required: true,
        },
      ],
      acceptanceSummary: 'the file exists and contains "Hello, world!".',
      requiredContent: "Hello, world!",
      missingFields: [],
      clarification: null,
    });
  });

  it("asks for artifact and acceptance details instead of creating a guessed Contract", () => {
    expect(planGeneralContract(["Implement authentication."], authority)).toMatchObject({
      status: "clarification_required",
      expectedArtifacts: [],
      missingFields: ["expected_artifact", "acceptance_evidence"],
      clarification: expect.stringContaining("project-relative file"),
    });
  });

  it("keeps unsupported acceptance prose in clarification instead of weakening it", () => {
    for (const acceptance of [
      "npm test passes",
      "the JSON has the correct shape",
      "the HTTP endpoint returns 200",
    ]) {
      expect(
        planGeneralContract(
          [`Create \`scripts/result.txt\`. Acceptance: ${acceptance}.`],
          authority,
        ),
      ).toMatchObject({
        status: "clarification_required",
        acceptanceSummary: `${acceptance}.`,
        requiredContent: null,
        missingFields: expect.arrayContaining(["acceptance_evidence"]),
      });
    }
  });

  it("rejects an ambiguous literal predicate across multiple artifacts", () => {
    expect(
      planGeneralContract(
        [
          'Create `scripts/left.txt` and `scripts/right.txt`. Acceptance: the files contain "ready".',
        ],
        authority,
      ),
    ).toMatchObject({
      status: "clarification_required",
      requiredContent: "ready",
      missingFields: expect.arrayContaining(["acceptance_evidence"]),
    });
  });

  it("accepts a strict existence predicate because every declared artifact is checked", () => {
    expect(
      planGeneralContract(
        ["Create `scripts/result.txt`. Acceptance: the file exists and is non-empty."],
        authority,
      ),
    ).toMatchObject({
      status: "ready",
      requiredContent: null,
      missingFields: [],
    });
  });

  it("rejects negated or compound acceptance predicates outside the verifier allowlist", () => {
    for (const acceptance of [
      "the file must not contain \"secret\"",
      "the file must not exist",
      "the file exists and npm test passes",
      "the file contains \"ready\" and npm test passes",
      "the file contains \"ready\" and must not contain \"failed\"",
    ]) {
      expect(
        planGeneralContract(
          [`Create \`scripts/result.txt\`. Acceptance: ${acceptance}.`],
          authority,
        ),
      ).toMatchObject({
        status: "clarification_required",
        requiredContent: null,
        missingFields: expect.arrayContaining(["acceptance_evidence"]),
      });
    }
  });

  it("rejects Acceptance clauses with omitted suffixes, duplicates, or oversized tails", () => {
    for (const content of [
      "Create `scripts/result.txt`. Acceptance: the file exists.\nand npm test passes.",
      "Create `scripts/result.txt`. Acceptance: the file exists. Acceptance: the file contains \"ready\".",
      `Create \`scripts/result.txt\`. Acceptance: the file exists.${" ".repeat(500)}and npm test passes.`,
    ]) {
      expect(planGeneralContract([content], authority)).toMatchObject({
        status: "clarification_required",
        requiredContent: null,
        missingFields: expect.arrayContaining(["acceptance_evidence"]),
      });
    }
  });

  it("asks for a concrete objective when the request is only a vague reference", () => {
    expect(planGeneralContract(["Fix it."], authority)).toMatchObject({
      status: "clarification_required",
      missingFields: ["objective", "expected_artifact", "acceptance_evidence"],
      clarification: expect.stringContaining("specific change"),
    });
  });

  it("combines bounded follow-up clarification messages into one exact objective", () => {
    const result = planGeneralContract(
      [
        "Create `scripts/hello.py`.",
        'Acceptance: the file must contain "Hello from Shepherd".',
      ],
      authority,
    );
    expect(result).toMatchObject({
      status: "ready",
      objective:
        'Create `scripts/hello.py`.\n\nAcceptance: the file must contain "Hello from Shepherd".',
      acceptanceSummary: 'the file must contain "Hello from Shepherd".',
      requiredContent: "Hello from Shepherd",
      missingFields: [],
    });
  });

  it("rejects protected or authority-incompatible artifact paths", () => {
    for (const content of [
      "Create `.env`. Acceptance: the file exists.",
      "Create `private/secret.txt`. Acceptance: the file exists.",
      "Create `../outside.txt`. Acceptance: the file exists.",
    ]) {
      expect(planGeneralContract([content], authority)).toMatchObject({
        status: "clarification_required",
        expectedArtifacts: [],
        missingFields: expect.arrayContaining(["authority"]),
        clarification: expect.stringContaining("configured writable authority"),
      });
    }
  });

  it("normalizes Unicode and deduplicates artifact paths deterministically", () => {
    const result = planGeneralContract(
      [
        "Ｃｒｅａｔｅ `src\\feature.ts` and `./src/feature.ts`. Acceptance: both references identify the same required file.",
      ],
      authority,
    );
    expect(result.expectedArtifacts.map((artifact) => artifact.path)).toEqual([
      "src/feature.ts",
    ]);
  });

  it("bounds each message and the accumulated clarification context", () => {
    expect(() => planGeneralContract(["x".repeat(2_001)], authority)).toThrowError(
      GeneralContractPlanError,
    );
    expect(() =>
      planGeneralContract(Array.from({ length: 9 }, () => "Create `src/a.ts`."), authority),
    ).toThrowError(GeneralContractPlanError);
    expect(() =>
      planGeneralContract(["Create `src/a.ts`.\u0000 Acceptance: exists."], authority),
    ).toThrowError(GeneralContractPlanError);
  });
});
