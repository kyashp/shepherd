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
