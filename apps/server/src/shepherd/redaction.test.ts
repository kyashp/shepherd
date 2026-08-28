import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  redactText,
  redactValue,
  stringifyRedacted,
} from "./redaction.js";

describe("redactText", () => {
  it("removes every occurrence of explicitly configured secrets", () => {
    const canary = "canary-super-secret-93821";
    const output = redactText(`first=${canary}; second=${canary}`, {
      secrets: [canary],
    });
    expect(output).toBe("first=[REDACTED]; second=[REDACTED]");
    expect(output).not.toContain(canary);
  });

  it.each([
    ["Authorization: Bearer abcdefghijklmnop", "Authorization: [REDACTED]"],
    [
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
      "[REDACTED]",
    ],
    ["api_key='extremely-sensitive'", "api_key='[REDACTED]"],
    ["password=hunter2", "password=[REDACTED]"],
    ["https://person:password123@example.test/a", "person:[REDACTED]@"],
  ])("redacts common credential syntax in %s", (input, fragment) => {
    expect(redactText(input)).toContain(fragment);
  });

  it("redacts private-key blocks", () => {
    const privateKey = [
      "-----BEGIN PRIVATE KEY-----",
      "dGhpcyBpcyBhIHBsYW50ZWQgY2FuYXJ5",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const output = redactText(`before\n${privateKey}\nafter`);
    expect(output).toBe("before\n[REDACTED]\nafter");
  });

  it("bounds text after redaction", () => {
    const output = redactText("x".repeat(500), { maxStringLength: 40 });
    expect(output).toHaveLength(40);
    expect(output.endsWith("[TRUNCATED]")).toBe(true);
  });
});

describe("recursive redaction", () => {
  it("redacts sensitive fields recursively while preserving non-secret token counts", () => {
    const output = redactValue({
      authorization: "Bearer planted-token",
      nested: {
        ARK_API_KEY: "planted-api-key",
        password: "planted-password",
        inputTokens: 123,
      },
      list: [{ cookie: "session=planted" }, "safe"],
    });
    expect(output).toEqual({
      authorization: "[REDACTED]",
      list: [{ cookie: "[REDACTED]" }, "safe"],
      nested: {
        ARK_API_KEY: "[REDACTED]",
        inputTokens: 123,
        password: "[REDACTED]",
      },
    });
    expect(isSensitiveKey("inputTokens")).toBe(false);
    expect(isSensitiveKey("access_token")).toBe(true);
  });

  it("redacts configured canaries in both keys and values", () => {
    const canary = "canary-key-fragment-123";
    const output = redactValue(
      {
        [`prefix-${canary}`]: `value-${canary}`,
        safe: [`again-${canary}`],
      },
      { secrets: [canary] },
    );
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain(canary);
    expect(serialized.match(/\[REDACTED\]/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it("bounds arrays, object keys, depth, nodes, and strings", () => {
    const output = redactValue(
      {
        array: [1, 2, 3, 4],
        deep: { a: { b: { c: "unreachable" } } },
        long: "abcdefghijk",
        object: { a: 1, b: 2, c: 3 },
      },
      {
        maxArrayItems: 2,
        maxObjectKeys: 3,
        maxDepth: 3,
        maxStringLength: 10,
        maxNodes: 50,
      },
    );
    const serialized = JSON.stringify(output);
    expect(serialized).toContain("[TRUNCATED]");
    expect(serialized).toContain("[truncated_keys]");
    expect(serialized).toContain("[MAX_DEPTH]");
    expect(serialized).not.toContain("unreachable");
  });

  it("handles cycles without mutating the source", () => {
    const source: { name: string; self?: unknown } = { name: "source" };
    source.self = source;
    expect(redactValue(source)).toEqual({ name: "source", self: "[CIRCULAR]" });
    expect(source.self).toBe(source);
  });

  it("does not invoke getters while preparing persistence data", () => {
    let invoked = false;
    const source = Object.defineProperty({ safe: "visible" }, "danger", {
      enumerable: true,
      get() {
        invoked = true;
        return "should-never-run";
      },
    });
    expect(redactValue(source)).toEqual({
      danger: "[UNINSPECTABLE]",
      safe: "visible",
    });
    expect(invoked).toBe(false);
  });

  it("converts non-JSON values to explicit safe representations", () => {
    expect(
      redactValue({
        bigint: 10n,
        infinity: Number.POSITIVE_INFINITY,
        missing: undefined,
        binary: new Uint8Array([1, 2, 3]),
        date: new Date("2026-08-29T00:00:00.000Z"),
        error: new Error("api_key=planted-value"),
      }),
    ).toEqual({
      bigint: "10",
      binary: "[BINARY_DATA]",
      date: "2026-08-29T00:00:00.000Z",
      error: { message: "api_key=[REDACTED]", name: "Error" },
      infinity: "Infinity",
      missing: "[UNSUPPORTED]",
    });
  });
});

describe("stringifyRedacted", () => {
  it("returns valid JSON within the exact output limit without leaking secrets", () => {
    const canary = "never-persist-this-canary";
    const output = stringifyRedacted(
      { safe: "x".repeat(5_000), nested: { text: canary } },
      { secrets: [canary], maxOutputLength: 180, maxStringLength: 5_000 },
    );
    expect(output.length).toBeLessThanOrEqual(180);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain(canary);
    expect(output).toContain("[TRUNCATED]");
  });

  it("returns an empty safe string when the caller supplies an unusably tiny cap", () => {
    expect(stringifyRedacted({ a: 1 }, { maxOutputLength: 1 })).toBe("");
  });
});
