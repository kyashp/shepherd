import { describe, expect, it } from "vitest";
import type { ScopedAuthority } from "./domain.js";
import {
  AuthorityPathError,
  decideAuthorityPath,
  intersectScopedAuthority,
  isAlwaysProtectedPath,
  isPatternSubset,
  normalizeRepoPath,
  normalizeRepoPattern,
  normalizeScopedAuthority,
  pathMatchesPattern,
  RESULT_MANIFEST_PATH,
  validateChangedPaths,
} from "./authority.js";

const broadAuthority: ScopedAuthority = {
  readable: ["**"],
  writable: ["**"],
  forbidden: [],
};

describe("authority path normalization", () => {
  it.each([
    ["./apps//web/src/App.tsx", "apps/web/src/App.tsx"],
    ["apps\\web\\src\\App.tsx", "apps/web/src/App.tsx"],
    [" docs/read me.md ", "docs/read me.md"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeRepoPath(input)).toBe(expected);
  });

  it.each([
    ["", "empty_path"],
    [".", "empty_path"],
    ["/etc/passwd", "absolute_path"],
    ["C:\\Users\\person\\secret", "absolute_path"],
    ["../outside", "traversal"],
    ["apps/web/../../outside", "traversal"],
    ["apps\\web\\..\\server", "traversal"],
    ["src/file\0.ts", "control_character"],
    ["src/*.ts", "glob_in_concrete_path"],
  ])("rejects unsafe concrete path %s", (input, code) => {
    expect(() => normalizeRepoPath(input)).toThrowError(AuthorityPathError);
    try {
      normalizeRepoPath(input);
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });

  it("supports only constrained glob syntax", () => {
    expect(normalizeRepoPattern("./apps\\web\\**\\*.tsx")).toBe(
      "apps/web/**/*.tsx",
    );
    for (const pattern of ["src/[ab].ts", "src/{a,b}.ts", "src/**x.ts", "!src/**"]) {
      expect(() => normalizeRepoPattern(pattern)).toThrowError(
        expect.objectContaining({ code: "unsupported_glob" }),
      );
    }
  });
});

describe("authority glob matching and containment", () => {
  it.each([
    ["src/index.ts", "src/**", true],
    ["src", "src/**", true],
    ["src/deep/index.ts", "src/**/*.ts", true],
    ["index.ts", "**/*.ts", true],
    ["src/index.tsx", "**/*.ts", false],
    ["apps/web/App.tsx", "apps/?eb/*.tsx", true],
    ["apps/server/App.tsx", "apps/?eb/*.tsx", false],
  ])("matches %s against %s = %s", (path, pattern, expected) => {
    expect(pathMatchesPattern(path, pattern)).toBe(expected);
  });

  it.each([
    ["apps/web/src/**", "apps/web/**", true],
    ["apps/web/src/App.tsx", "apps/*/**", true],
    ["apps/web/**/*.test.ts", "**/*.ts", true],
    ["apps/**", "apps/web/**", false],
    ["apps/server/**", "apps/web/**", false],
    ["**/*.tsx", "apps/web/**", false],
    ["src/*.ts", "src/?.ts", false],
  ])("proves subset %s within %s = %s", (child, parent, expected) => {
    expect(isPatternSubset(child, parent)).toBe(expected);
  });
});

describe("scoped authority intersection", () => {
  it("normalizes, deduplicates, and intersects a narrower contract", () => {
    const agent: ScopedAuthority = {
      readable: ["apps/web/**", "docs/**"],
      writable: ["apps/web/**"],
      forbidden: ["apps/web/private/**"],
    };
    const contract: ScopedAuthority = {
      readable: ["./apps/web/src/**", "apps/web/src/**"],
      writable: ["apps/web/src/components/**"],
      forbidden: ["apps/web/src/generated/**"],
    };
    expect(intersectScopedAuthority(agent, contract)).toEqual({
      ok: true,
      authority: {
        readable: ["apps/web/src/**"],
        writable: ["apps/web/src/components/**"],
        forbidden: ["apps/web/private/**", "apps/web/src/generated/**"],
      },
    });
  });

  it("rejects every attempted contract broadening", () => {
    const result = intersectScopedAuthority(
      {
        readable: ["apps/web/**"],
        writable: ["apps/web/src/**"],
        forbidden: [],
      },
      {
        readable: ["apps/**"],
        writable: ["apps/web/**", "apps/server/**"],
        forbidden: [],
      },
    );
    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ access: "readable", pattern: "apps/**" }),
        expect.objectContaining({ access: "writable", pattern: "apps/web/**" }),
        expect.objectContaining({ access: "writable", pattern: "apps/server/**" }),
      ]),
    });
  });

  it("rejects traversal before an intersection can be formed", () => {
    expect(() =>
      intersectScopedAuthority(broadAuthority, {
        readable: ["apps/web/../../../etc/**"],
        writable: [],
        forbidden: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "traversal" }));
  });

  it("does not mutate either input", () => {
    const agent: ScopedAuthority = {
      readable: ["z/**", "a/**"],
      writable: ["z/**"],
      forbidden: [],
    };
    const contract: ScopedAuthority = {
      readable: ["z/src/**"],
      writable: ["z/src/**"],
      forbidden: [],
    };
    intersectScopedAuthority(agent, contract);
    expect(agent.readable).toEqual(["z/**", "a/**"]);
    expect(contract.readable).toEqual(["z/src/**"]);
  });

  it("normalizes authorities deterministically", () => {
    expect(
      normalizeScopedAuthority({
        readable: ["z/**", "a/**", "z/**"],
        writable: [],
        forbidden: ["private\\**"],
      }),
    ).toEqual({
      readable: ["a/**", "z/**"],
      writable: [],
      forbidden: ["private/**"],
    });
  });
});

describe("actual path authority decisions", () => {
  it.each([
    [".git/config"],
    ["nested/.git/config"],
    [".shepherd/state.json"],
    ["nested/.shepherd/state.json"],
    [".env"],
    ["config/.env.production"],
    ["keys/server.pem"],
    ["keys/server.key"],
    ["config/credentials.json"],
  ])("always protects %s even under a broad grant", (path) => {
    expect(isAlwaysProtectedPath(path)).toBe(true);
    expect(decideAuthorityPath(broadAuthority, path, "write")).toMatchObject({
      allowed: false,
      reason: "always_protected",
    });
  });

  it("lets explicit forbidden patterns override a writable grant", () => {
    const decision = decideAuthorityPath(
      {
        readable: ["apps/**"],
        writable: ["apps/**"],
        forbidden: ["apps/server/secrets/**"],
      },
      "apps/server/secrets/token.txt",
      "write",
    );
    expect(decision).toMatchObject({
      allowed: false,
      ingestionOnly: false,
      reason: "explicitly_forbidden",
    });
  });

  it("distinguishes readable and writable grants", () => {
    const authority: ScopedAuthority = {
      readable: ["docs/**"],
      writable: ["src/**"],
      forbidden: [],
    };
    expect(decideAuthorityPath(authority, "docs/guide.md", "read").allowed).toBe(
      true,
    );
    expect(decideAuthorityPath(authority, "docs/guide.md", "write")).toMatchObject({
      allowed: false,
      reason: "outside_writable_scope",
    });
    expect(decideAuthorityPath(authority, "src/index.ts", "read")).toMatchObject({
      allowed: false,
      reason: "outside_readable_scope",
    });
  });

  it("permits only the exact result manifest as a non-integrable write", () => {
    const restrictive: ScopedAuthority = {
      readable: [],
      writable: [],
      forbidden: [".shepherd/**"],
    };
    expect(decideAuthorityPath(restrictive, RESULT_MANIFEST_PATH, "write")).toEqual({
      rawPath: RESULT_MANIFEST_PATH,
      path: RESULT_MANIFEST_PATH,
      access: "write",
      allowed: true,
      ingestionOnly: true,
      reason: "result_manifest_ingestion_only",
    });
    expect(decideAuthorityPath(restrictive, RESULT_MANIFEST_PATH, "read")).toMatchObject({
      allowed: false,
      reason: "always_protected",
    });
    expect(
      decideAuthorityPath(restrictive, ".shepherd/result.json.bak", "write"),
    ).toMatchObject({ allowed: false, reason: "always_protected" });
  });

  it("fails closed for malformed actual paths and malformed authorities", () => {
    expect(decideAuthorityPath(broadAuthority, "../../escape", "write")).toMatchObject({
      path: null,
      allowed: false,
      reason: "invalid_path",
    });
    expect(
      decideAuthorityPath(
        { readable: [], writable: ["src/[ab].ts"], forbidden: [] },
        "src/a.ts",
        "write",
      ),
    ).toMatchObject({ allowed: false, reason: "invalid_path" });
  });

  it("separates the manifest from integrable paths and reports every denial", () => {
    const result = validateChangedPaths(
      [
        "src/index.ts",
        ".shepherd/result.json",
        "src/index.ts",
        "docs/outside.md",
        "../escape",
      ],
      { readable: ["src/**"], writable: ["src/**"], forbidden: [] },
    );
    expect(result.allowed).toBe(false);
    expect(result.integrablePaths).toEqual(["src/index.ts"]);
    expect(result.manifestPaths).toEqual([RESULT_MANIFEST_PATH]);
    expect(result.denied.map((item) => item.reason)).toEqual([
      "outside_writable_scope",
      "invalid_path",
    ]);
    expect(result.decisions).toHaveLength(5);
  });
});
