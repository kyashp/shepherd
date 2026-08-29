import { describe, expect, it, vi } from "vitest";
import {
  ArkModelReviewer,
  MODEL_REVIEW_MAX_INPUT_BYTES,
  MODEL_REVIEW_MAX_RESPONSE_BYTES,
  type ArkModelReviewerOptions,
  type ModelReviewInput,
  type ModelReviewResult,
  type ModelReviewerFetch,
} from "./model-reviewer.js";

const API_KEY = "ark-secret-value-123456";
const SENSITIVE_VALUE = "database-password-987654";

function baseInput(): ModelReviewInput {
  return {
    contracts: [
      {
        contractId: "contract-a",
        objective: "Implement the server authentication transport.",
        manifestSummary: "Adds the server authentication boundary.",
        claims: [
          {
            key: "ui.session.mode",
            value: "server-backed",
            scope: "application",
            mode: "exclusive",
          },
          {
            key: "auth.transport",
            value: "bearer-jwt",
            scope: "application",
            mode: "exclusive",
          },
        ],
        changedFiles: ["src/server.ts", "src/shared.ts"],
        diffSummary: "Adds bearer authentication to the API.",
      },
      {
        contractId: "contract-b",
        objective: "Implement the browser authentication workflow.",
        manifestSummary: "Adds the browser login workflow.",
        claims: [
          {
            key: "auth.method",
            value: "session-cookie",
            scope: "application",
            mode: "exclusive",
          },
          {
            key: "ui.session.transport",
            value: "cookie",
            scope: "application",
            mode: "exclusive",
          },
        ],
        changedFiles: ["src/browser.ts", "src/shared.ts"],
        diffSummary: "Adds a browser session cookie flow.",
      },
    ],
  };
}

function validEvidence() {
  return [
    {
      contract_id: "contract-a",
      source: "claim",
      ref: "auth.transport",
    },
    {
      contract_id: "contract-b",
      source: "claim",
      ref: "auth.method",
    },
  ];
}

function validFinding(overrides: Record<string, unknown> = {}) {
  return {
    kind: "equivalent_key",
    left_contract_id: "contract-a",
    right_contract_id: "contract-b",
    left_key: "auth.transport",
    right_key: "auth.method",
    confidence: "high",
    reason: "Both claims select the application authentication transport.",
    evidence_refs: validEvidence(),
    ...overrides,
  };
}

function manifestContentFinding() {
  return validFinding({
    kind: "likely_incompatibility",
    reason: "The manifest summaries describe incompatible authentication transports.",
    evidence_refs: [
      ...validEvidence(),
      {
        contract_id: "contract-a",
        source: "manifest",
        ref: "Adds the server authentication boundary.",
      },
      {
        contract_id: "contract-b",
        source: "manifest",
        ref: "Adds the browser login workflow.",
      },
    ],
  });
}

function providerEnvelope(
  review: unknown = { findings: [] },
  overrides: Record<string, unknown> = {},
) {
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
          {
            type: "output_text",
            text: JSON.stringify(review),
            annotations: [],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function completedResponse(review: unknown = { findings: [] }): Response {
  return jsonResponse(providerEnvelope(review));
}

function makeFetch(response: Response) {
  return vi.fn<ModelReviewerFetch>(async () => response);
}

function makeReviewer(
  fetchImpl: ModelReviewerFetch,
  overrides: Partial<ArkModelReviewerOptions> = {},
): ArkModelReviewer {
  return new ArkModelReviewer({
    enabled: true,
    baseUrl: "https://ark.example.test/api/v3/",
    apiKey: API_KEY,
    model: "gpt-5.6-sol",
    timeoutMs: 5_000,
    sensitiveValues: [SENSITIVE_VALUE],
    fetchImpl,
    ...overrides,
  });
}

function expectDegraded(
  result: ModelReviewResult,
  reason: Extract<ModelReviewResult, { status: "degraded" }>["reason"],
  retryable: boolean,
): void {
  expect(result).toStrictEqual({ status: "degraded", reason, retryable });
}

describe("ArkModelReviewer request contract", () => {
  it("sends one bounded, non-persistent strict-schema request with canonical input", async () => {
    const fetchImpl = makeFetch(completedResponse());
    const input = baseInput();
    input.contracts.reverse();
    input.contracts[0]!.changedFiles = ["src\\shared.ts", "src/browser.ts"];
    input.contracts[1]!.claims.reverse();

    const result = await makeReviewer(fetchImpl).review(input);

    expect(result).toStrictEqual({ status: "completed", findings: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://ark.example.test/api/v3/responses");
    expect(init).toBeDefined();
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      credentials: "omit",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(init ?? {}).sort()).toStrictEqual([
      "body",
      "credentials",
      "headers",
      "method",
      "redirect",
      "signal",
    ]);

    const bodyText = String(init?.body);
    expect(bodyText).not.toContain(API_KEY);
    expect(bodyText).not.toContain(SENSITIVE_VALUE);
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      store: false,
      stream: false,
      max_output_tokens: 1_536,
    });
    expect(body.instructions).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body).not.toHaveProperty("background");
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("metadata");
    expect(JSON.parse(String(body.input))).toStrictEqual({
      schema_version: 1,
      contracts: [
        {
          contract_id: "contract-a",
          objective: "Implement the server authentication transport.",
          manifest_summary: "Adds the server authentication boundary.",
          claims: [
            {
              key: "auth.transport",
              value: "bearer-jwt",
              scope: "application",
              mode: "exclusive",
            },
            {
              key: "ui.session.mode",
              value: "server-backed",
              scope: "application",
              mode: "exclusive",
            },
          ],
          changed_files: ["src/server.ts", "src/shared.ts"],
          diff_summary: "Adds bearer authentication to the API.",
        },
        {
          contract_id: "contract-b",
          objective: "Implement the browser authentication workflow.",
          manifest_summary: "Adds the browser login workflow.",
          claims: [
            {
              key: "auth.method",
              value: "session-cookie",
              scope: "application",
              mode: "exclusive",
            },
            {
              key: "ui.session.transport",
              value: "cookie",
              scope: "application",
              mode: "exclusive",
            },
          ],
          changed_files: ["src/browser.ts", "src/shared.ts"],
          diff_summary: "Adds a browser session cookie flow.",
        },
      ],
    });

    const text = body.text as {
      format: {
        type: string;
        name: string;
        strict: boolean;
        schema: Record<string, unknown>;
      };
    };
    expect(text.format.type).toBe("json_schema");
    expect(text.format.name).toBe("shepherd_semantic_review_v1");
    expect(text.format.strict).toBe(true);
    expect(text.format.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["findings"],
    });
    const findings = (
      (text.format.schema.properties as Record<string, unknown>)
        .findings as Record<string, unknown>
    );
    expect(findings.maxItems).toBe(8);
    const finding = findings.items as Record<string, unknown>;
    expect(finding.additionalProperties).toBe(false);
    expect(finding.required).toStrictEqual([
      "kind",
      "left_contract_id",
      "right_contract_id",
      "left_key",
      "right_key",
      "confidence",
      "reason",
      "evidence_refs",
    ]);
    const findingProperties = finding.properties as Record<string, unknown>;
    const references = findingProperties.evidence_refs as Record<string, unknown>;
    expect(references).toMatchObject({ minItems: 1, maxItems: 6 });
    expect(references.items).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["contract_id", "source", "ref"],
    });
  });

  it("requires literal stable selectors instead of field contents", async () => {
    const fetchImpl = makeFetch(completedResponse());

    await makeReviewer(fetchImpl).review(baseInput());

    const init = fetchImpl.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.instructions).toContain(
      "For objective, manifest, and diff_summary sources, use the literal ref selectors objective, manifest_summary, and diff_summary respectively; never copy field contents into ref.",
    );
  });

  it("returns disabled without validating configuration, input, or calling fetch", async () => {
    const fetchImpl = makeFetch(completedResponse());
    const reviewer = makeReviewer(fetchImpl, {
      enabled: false,
      baseUrl: "not a URL",
      apiKey: "",
      model: "",
    });
    await expect(reviewer.review(null)).resolves.toStrictEqual({
      status: "disabled",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "http://ark.example.test/api/v3",
    "https://user@ark.example.test/api/v3",
    "https://user:pass@ark.example.test/api/v3",
    "https://ark.example.test/api/v3?secret=value",
    "https://ark.example.test/api/v3#fragment",
    "https://ark.example.test/api/../v3",
    "https://ark.example.test/api/%2e%2e/v3",
    "https://ark.example.test/api/%2Fadmin",
    "https://ark.example.test/api/%5cadmin",
    "https://ark.example.test\\api\\v3",
    "https://ark.example.test\n.evil.test/api/v3",
    " https://ark.example.test/api/v3",
    "not-a-url",
  ])("rejects unsafe provider URL %s before fetch", async (baseUrl) => {
    const fetchImpl = makeFetch(completedResponse());
    const result = await makeReviewer(fetchImpl, { baseUrl }).review(baseInput());
    expectDegraded(result, "configuration_error", false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { name: "short key", overrides: { apiKey: "short" } },
    { name: "key whitespace", overrides: { apiKey: ` ${API_KEY}` } },
    { name: "key control", overrides: { apiKey: "valid-key\nsecret" } },
    { name: "blank model", overrides: { model: "" } },
    { name: "model whitespace", overrides: { model: " model" } },
    { name: "model control", overrides: { model: "model\nname" } },
    { name: "model too long", overrides: { model: `m${"x".repeat(256)}` } },
    { name: "zero timeout", overrides: { timeoutMs: 0 } },
    { name: "fractional timeout", overrides: { timeoutMs: 1.5 } },
    { name: "excessive timeout", overrides: { timeoutMs: 120_001 } },
    { name: "short sensitive value", overrides: { sensitiveValues: ["tiny"] } },
    {
      name: "too many sensitive values",
      overrides: {
        sensitiveValues: Array.from(
          { length: 65 },
          (_unused, index) => `sensitive-value-${index}`,
        ),
      },
    },
    {
      name: "sensitive control",
      overrides: { sensitiveValues: ["sensitive\nvalue"] },
    },
    {
      name: "overlong base URL",
      overrides: { baseUrl: `https://ark.example.test/${"a".repeat(2_048)}` },
    },
    { name: "non-string base URL", overrides: { baseUrl: 42 } },
    { name: "non-array sensitive values", overrides: { sensitiveValues: "secret" } },
    { name: "non-boolean enable flag", overrides: { enabled: "yes" } },
    { name: "non-function fetch", overrides: { fetchImpl: "fetch" } },
  ])("rejects invalid $name configuration", async ({ overrides }) => {
    const fetchImpl = makeFetch(completedResponse());
    const result = await makeReviewer(
      fetchImpl,
      overrides as Partial<ArkModelReviewerOptions>,
    ).review(baseInput());
    expectDegraded(result, "configuration_error", false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ArkModelReviewer input and secret boundaries", () => {
  it.each([
    {
      name: "one contract",
      mutate: (input: ModelReviewInput) => input.contracts.pop(),
    },
    {
      name: "duplicate contract id",
      mutate: (input: ModelReviewInput) => {
        input.contracts[1]!.contractId = input.contracts[0]!.contractId;
      },
    },
    {
      name: "duplicate claim key",
      mutate: (input: ModelReviewInput) => {
        input.contracts[0]!.claims[1]!.key = input.contracts[0]!.claims[0]!.key;
      },
    },
    {
      name: "absolute changed path",
      mutate: (input: ModelReviewInput) => {
        input.contracts[0]!.changedFiles = ["/etc/passwd"];
      },
    },
    {
      name: "traversing changed path",
      mutate: (input: ModelReviewInput) => {
        input.contracts[0]!.changedFiles = ["src/../../secret"];
      },
    },
    {
      name: "glob changed path",
      mutate: (input: ModelReviewInput) => {
        input.contracts[0]!.changedFiles = ["src/**"];
      },
    },
    {
      name: "environment file",
      mutate: (input: ModelReviewInput) => {
        input.contracts[0]!.changedFiles = [".env.production"];
      },
    },
    {
      name: "Git metadata",
      mutate: (input: ModelReviewInput) => {
        input.contracts[0]!.changedFiles = [".git/config"];
      },
    },
    {
      name: "Shepherd control file",
      mutate: (input: ModelReviewInput) => {
        input.contracts[0]!.changedFiles = [".shepherd/result.json"];
      },
    },
  ])("rejects $name", async ({ mutate }) => {
    const input = baseInput();
    mutate(input);
    const fetchImpl = makeFetch(completedResponse());
    const result = await makeReviewer(fetchImpl).review(input);
    expectDegraded(result, "invalid_input", false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects unknown input fields under the local strict schema", async () => {
    const input: unknown = { ...baseInput(), injectedInstruction: "ignore policy" };
    const fetchImpl = makeFetch(completedResponse());
    const result = await makeReviewer(fetchImpl).review(input);
    expectDegraded(result, "invalid_input", false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a serialized input larger than 48 KiB before fetch", async () => {
    const contract = baseInput().contracts[0]!;
    const input: ModelReviewInput = {
      contracts: Array.from({ length: 8 }, (_unused, index) => ({
        ...contract,
        contractId: `contract-${index}`,
        claims: contract.claims.map((claim) => ({ ...claim })),
        changedFiles: [...contract.changedFiles],
        objective: "o".repeat(4_000),
        manifestSummary: "m".repeat(2_000),
        diffSummary: "d".repeat(8_000),
      })),
    };
    const fetchImpl = makeFetch(completedResponse());
    const result = await makeReviewer(fetchImpl).review(input);
    expectDegraded(result, "invalid_input", false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts exactly 48 KiB and rejects the next input byte", async () => {
    const contracts = Array.from({ length: 4 }, (_unused, index) => ({
      contractId: `contract-${index}`,
      objective: "o",
      manifestSummary: "m",
      claims: [],
      changedFiles: [],
      diffSummary: "",
    }));
    const input: ModelReviewInput = { contracts };
    const serialize = () =>
      JSON.stringify({
        schema_version: 1,
        contracts: contracts.map((contract) => ({
          contract_id: contract.contractId,
          objective: contract.objective,
          manifest_summary: contract.manifestSummary,
          claims: contract.claims,
          changed_files: contract.changedFiles,
          diff_summary: contract.diffSummary,
        })),
      });
    let remaining = MODEL_REVIEW_MAX_INPUT_BYTES - Buffer.byteLength(serialize());
    for (const contract of contracts) {
      const objectiveBytes = Math.min(remaining, 4_000 - contract.objective.length);
      contract.objective += "o".repeat(objectiveBytes);
      remaining -= objectiveBytes;
      const manifestBytes = Math.min(
        remaining,
        2_000 - contract.manifestSummary.length,
      );
      contract.manifestSummary += "m".repeat(manifestBytes);
      remaining -= manifestBytes;
      const diffBytes = Math.min(remaining, 8_000);
      contract.diffSummary += "d".repeat(diffBytes);
      remaining -= diffBytes;
    }
    expect(remaining).toBe(0);
    expect(Buffer.byteLength(serialize())).toBe(MODEL_REVIEW_MAX_INPUT_BYTES);

    const atLimitFetch = makeFetch(completedResponse());
    await expect(makeReviewer(atLimitFetch).review(input)).resolves.toStrictEqual({
      status: "completed",
      findings: [],
    });
    expect(atLimitFetch).toHaveBeenCalledTimes(1);

    const extendable = contracts.find((contract) => contract.diffSummary.length < 8_000);
    expect(extendable).toBeDefined();
    extendable!.diffSummary += "d";
    const overLimitFetch = makeFetch(completedResponse());
    const result = await makeReviewer(overLimitFetch).review(input);
    expectDegraded(result, "invalid_input", false);
    expect(overLimitFetch).not.toHaveBeenCalled();
  });

  it.each([
    { location: "objective", secret: API_KEY },
    { location: "diff", secret: SENSITIVE_VALUE },
  ])("blocks a $location secret before it reaches fetch", async ({ location, secret }) => {
    const input = baseInput();
    if (location === "objective") input.contracts[0]!.objective += secret;
    else input.contracts[0]!.diffSummary += secret;
    const fetchImpl = makeFetch(completedResponse());
    const result = await makeReviewer(fetchImpl).review(input);
    expectDegraded(result, "invalid_input", false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ArkModelReviewer provider status and transport handling", () => {
  it.each([
    [400, "configuration_error", false],
    [401, "authentication_error", false],
    [403, "configuration_error", false],
    [404, "configuration_error", false],
    [408, "provider_error", true],
    [418, "provider_error", false],
    [429, "rate_limited", true],
    [500, "provider_error", true],
    [503, "provider_error", true],
  ] as const)(
    "maps HTTP %i without exposing or retrying its body",
    async (status, reason, retryable) => {
      const providerSecret = `${API_KEY}:provider-message-and-id`;
      const fetchImpl = makeFetch(
        new Response(providerSecret, {
          status,
          headers: { "content-type": "text/plain" },
        }),
      );
      const result = await makeReviewer(fetchImpl).review(baseInput());
      expectDegraded(result, reason, retryable);
      expect(JSON.stringify(result)).not.toContain(providerSecret);
      expect(JSON.stringify(result)).not.toContain(API_KEY);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("collapses a secret-bearing fetch exception and never retries", async () => {
    const fetchImpl = vi.fn<ModelReviewerFetch>(async () => {
      throw new Error(`request failed for ${API_KEY}; response id resp-private`);
    });
    const result = await makeReviewer(fetchImpl).review(baseInput());
    expectDegraded(result, "transport_error", true);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
    expect(JSON.stringify(result)).not.toContain("resp-private");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honours the deadline, aborts the request, and makes one attempt", async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn<ModelReviewerFetch>(
        async (_url, init) =>
          await new Promise<Response>(() => {
            requestSignal = init?.signal ?? undefined;
          }),
      );
      const promise = makeReviewer(fetchImpl, { timeoutMs: 25 }).review(baseInput());
      await vi.advanceTimersByTimeAsync(25);
      const result = await promise;
      expectDegraded(result, "timeout", true);
      expect(requestSignal?.aborted).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns caller cancellation before fetch", async () => {
    const fetchImpl = makeFetch(completedResponse());
    const controller = new AbortController();
    controller.abort();
    await expect(
      makeReviewer(fetchImpl).review(baseInput(), controller.signal),
    ).resolves.toStrictEqual({ status: "cancelled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns caller cancellation while the request is pending", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<ModelReviewerFetch>(
      async (_url, init) =>
        await new Promise<Response>(() => {
          requestSignal = init?.signal ?? undefined;
        }),
    );
    const controller = new AbortController();
    const promise = makeReviewer(fetchImpl).review(baseInput(), controller.signal);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(promise).resolves.toStrictEqual({ status: "cancelled" });
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns caller cancellation during a stalled response stream", async () => {
    let pullStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      pullStarted = resolve;
    });
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        pullStarted();
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, {
      headers: { "content-type": "application/json" },
    });
    const fetchImpl = makeFetch(response);
    const controller = new AbortController();
    const promise = makeReviewer(fetchImpl).review(baseInput(), controller.signal);
    await started;
    controller.abort();
    await expect(promise).resolves.toStrictEqual({ status: "cancelled" });
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies the deadline while reading a stalled response body", async () => {
    vi.useFakeTimers();
    try {
      const stream = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => undefined);
        },
      });
      const fetchImpl = makeFetch(
        new Response(stream, {
          headers: { "content-type": "application/json" },
        }),
      );
      const promise = makeReviewer(fetchImpl, { timeoutMs: 25 }).review(baseInput());
      await vi.advanceTimersByTimeAsync(25);
      const result = await promise;
      expectDegraded(result, "timeout", true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ArkModelReviewer bounded response parsing", () => {
  it.each([
    {
      name: "missing content type",
      response: new Response(JSON.stringify(providerEnvelope())),
    },
    {
      name: "non-JSON content type",
      response: new Response(JSON.stringify(providerEnvelope()), {
        headers: { "content-type": "text/plain" },
      }),
    },
    {
      name: "JSON-suffix content type",
      response: new Response(JSON.stringify(providerEnvelope()), {
        headers: { "content-type": "application/problem+json" },
      }),
    },
    {
      name: "empty body",
      response: new Response(null, {
        headers: { "content-type": "application/json" },
      }),
    },
    {
      name: "malformed JSON",
      response: new Response("{", {
        headers: { "content-type": "application/json" },
      }),
    },
    {
      name: "array envelope",
      response: jsonResponse([]),
    },
    {
      name: "missing envelope fields",
      response: jsonResponse({}),
    },
    {
      name: "invalid content length",
      response: new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "not-a-number",
        },
      }),
    },
    {
      name: "invalid UTF-8",
      response: new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-type": "application/json" },
      }),
    },
  ])("degrades an invalid $name response", async ({ response }) => {
    const fetchImpl = makeFetch(response);
    const result = await makeReviewer(fetchImpl).review(baseInput());
    expectDegraded(result, "invalid_response", false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an over-limit declared response before parsing", async () => {
    const fetchImpl = makeFetch(
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": String(MODEL_REVIEW_MAX_RESPONSE_BYTES + 1),
        },
      }),
    );
    const result = await makeReviewer(fetchImpl).review(baseInput());
    expectDegraded(result, "invalid_response", false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a zero-byte stream chunk instead of allowing an unbounded no-progress loop", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(0));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = makeFetch(
      new Response(stream, {
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await makeReviewer(fetchImpl, { timeoutMs: 1 }).review(baseInput());
    expectDegraded(result, "invalid_response", false);
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("contains a hostile stream cancellation rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0xc3, 0x28]));
        },
        cancel() {
          return Promise.reject(new Error("hostile cancellation rejection"));
        },
      });
      const fetchImpl = makeFetch(
        new Response(stream, {
          headers: { "content-type": "application/json" },
        }),
      );
      const result = await makeReviewer(fetchImpl).review(baseInput());
      expectDegraded(result, "invalid_response", false);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("accepts a valid response stream at exactly 128 KiB", async () => {
    const envelope = providerEnvelope();
    const serialize = (padding: string) => JSON.stringify({ ...envelope, padding });
    const emptyBytes = Buffer.byteLength(serialize(""));
    const padding = "p".repeat(MODEL_REVIEW_MAX_RESPONSE_BYTES - emptyBytes);
    const body = serialize(padding);
    expect(Buffer.byteLength(body)).toBe(MODEL_REVIEW_MAX_RESPONSE_BYTES);
    const midpoint = Math.floor(body.length / 2);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(body.slice(0, midpoint)));
        controller.enqueue(encoder.encode(body.slice(midpoint)));
        controller.close();
      },
    });
    const fetchImpl = makeFetch(
      new Response(stream, {
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(makeReviewer(fetchImpl).review(baseInput())).resolves.toStrictEqual({
      status: "completed",
      findings: [],
    });
  });

  it.each(["single", "chunked"])(
    "rejects an oversized %s stream and cancels it",
    async (shape) => {
      let cancelled = false;
      const chunks =
        shape === "single"
          ? [new Uint8Array(MODEL_REVIEW_MAX_RESPONSE_BYTES + 1)]
          : [
              new Uint8Array(64 * 1024),
              new Uint8Array(64 * 1024),
              new Uint8Array(1),
            ];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
          if (shape === "chunked") return new Promise<void>(() => undefined);
        },
      });
      const fetchImpl = makeFetch(
        new Response(stream, {
          headers: { "content-type": "application/json" },
        }),
      );
      const result = await makeReviewer(fetchImpl).review(baseInput());
      expectDegraded(result, "invalid_response", false);
      expect(cancelled).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {
      name: "stored response",
      envelope: providerEnvelope(undefined, { store: true }),
      reason: "storage_contract_violation",
      retryable: false,
    },
    {
      name: "missing storage attestation",
      envelope: (() => {
        const value = providerEnvelope();
        const { store: _store, ...withoutStore } = value;
        return withoutStore;
      })(),
      reason: "storage_contract_violation",
      retryable: false,
    },
    {
      name: "wrong object",
      envelope: providerEnvelope(undefined, { object: "response.chunk" }),
      reason: "invalid_response",
      retryable: false,
    },
    {
      name: "non-string status",
      envelope: providerEnvelope(undefined, { status: 200 }),
      reason: "invalid_response",
      retryable: false,
    },
    {
      name: "non-array output",
      envelope: providerEnvelope(undefined, { output: {} }),
      reason: "invalid_response",
      retryable: false,
    },
    {
      name: "in-progress response",
      envelope: providerEnvelope(undefined, { status: "in_progress" }),
      reason: "incomplete_response",
      retryable: true,
    },
    {
      name: "queued response",
      envelope: providerEnvelope(undefined, { status: "queued" }),
      reason: "incomplete_response",
      retryable: true,
    },
    {
      name: "failed response",
      envelope: providerEnvelope(undefined, { status: "failed" }),
      reason: "incomplete_response",
      retryable: true,
    },
    {
      name: "incomplete response",
      envelope: providerEnvelope(undefined, { status: "incomplete" }),
      reason: "incomplete_response",
      retryable: true,
    },
    {
      name: "provider error object",
      envelope: providerEnvelope(undefined, {
        error: { message: "private provider detail", code: "provider_code" },
      }),
      reason: "incomplete_response",
      retryable: true,
    },
    {
      name: "incomplete details",
      envelope: providerEnvelope(undefined, {
        incomplete_details: { reason: "max_output_tokens" },
      }),
      reason: "incomplete_response",
      retryable: true,
    },
  ] as const)(
    "handles $name without provider details",
    async ({ envelope, reason, retryable }) => {
      const fetchImpl = makeFetch(jsonResponse(envelope));
      const result = await makeReviewer(fetchImpl).review(baseInput());
      expectDegraded(result, reason, retryable);
      expect(JSON.stringify(result)).not.toContain(API_KEY);
      expect(JSON.stringify(result)).not.toContain("provider_code");
    },
  );

  it.each([
    { name: "empty output", output: [] },
    { name: "reasoning only", output: [{ type: "reasoning" }] },
    { name: "null item", output: [null] },
    { name: "unexpected item", output: [{ type: "tool_call" }] },
    {
      name: "two messages",
      output: [
        providerEnvelope().output[1],
        providerEnvelope().output[1],
      ],
    },
    {
      name: "wrong role",
      output: [
        {
          ...providerEnvelope().output[1],
          role: "user",
        },
      ],
    },
    {
      name: "incomplete message",
      output: [
        {
          ...providerEnvelope().output[1],
          status: "incomplete",
        },
      ],
    },
    {
      name: "empty content",
      output: [{ ...providerEnvelope().output[1], content: [] }],
    },
    {
      name: "multiple content items",
      output: [
        {
          ...providerEnvelope().output[1],
          content: [
            (providerEnvelope().output[1] as { content: unknown[] }).content[0],
            (providerEnvelope().output[1] as { content: unknown[] }).content[0],
          ],
        },
      ],
    },
    {
      name: "wrong content type",
      output: [
        {
          ...providerEnvelope().output[1],
          content: [{ type: "refusal", refusal: "no" }],
        },
      ],
    },
    {
      name: "missing output text",
      output: [
        {
          ...providerEnvelope().output[1],
          content: [{ type: "output_text" }],
        },
      ],
    },
  ])("rejects $name", async ({ output }) => {
    const fetchImpl = makeFetch(jsonResponse(providerEnvelope(undefined, { output })));
    const result = await makeReviewer(fetchImpl).review(baseInput());
    expectDegraded(result, "invalid_response", false);
  });

  it("rejects secret material anywhere in a successful provider body", async () => {
    const fetchImpl = makeFetch(
      completedResponse({
        findings: [validFinding({ reason: `Echoed ${SENSITIVE_VALUE}` })],
      }),
    );
    const result = await makeReviewer(fetchImpl).review(baseInput());
    expectDegraded(result, "invalid_response", false);
    expect(JSON.stringify(result)).not.toContain(SENSITIVE_VALUE);
  });
});

describe("ArkModelReviewer strict semantic output validation", () => {
  it.each([
    {
      name: "unknown top-level key",
      review: { findings: [], extra: true },
    },
    {
      name: "unknown finding key",
      review: { findings: [validFinding({ extra: true })] },
    },
    {
      name: "unknown evidence key",
      review: {
        findings: [
          validFinding({
            evidence_refs: [
              { ...validEvidence()[0], extra: true },
              validEvidence()[1],
            ],
          }),
        ],
      },
    },
    {
      name: "more than eight findings",
      review: { findings: Array.from({ length: 9 }, () => validFinding()) },
    },
    {
      name: "no evidence",
      review: { findings: [validFinding({ evidence_refs: [] })] },
    },
    {
      name: "more than six references",
      review: {
        findings: [
          validFinding({
            evidence_refs: Array.from({ length: 7 }, (_unused, index) => ({
              ...validEvidence()[index % 2],
            })),
          }),
        ],
      },
    },
    {
      name: "overlong reason",
      review: { findings: [validFinding({ reason: "r".repeat(513) })] },
    },
    {
      name: "unknown confidence",
      review: { findings: [validFinding({ confidence: "certain" })] },
    },
    {
      name: "unknown source",
      review: {
        findings: [
          validFinding({
            evidence_refs: [
              { ...validEvidence()[0], source: "provider_memory" },
              validEvidence()[1],
            ],
          }),
        ],
      },
    },
  ])("rejects $name under the strict local schema", async ({ review }) => {
    const fetchImpl = makeFetch(completedResponse(review));
    const result = await makeReviewer(fetchImpl).review(baseInput());
    expectDegraded(result, "invalid_response", false);
  });

  it("returns a partial completion for the exact manifest-content selector shape", async () => {
    const fetchImpl = makeFetch(
      completedResponse({
        findings: [validFinding(), manifestContentFinding()],
      }),
    );

    const result = await makeReviewer(fetchImpl).review(baseInput());

    expect(result).toStrictEqual({
      status: "completed",
      findings: [
        {
          kind: "equivalent_key",
          leftContractId: "contract-a",
          rightContractId: "contract-b",
          leftKey: "auth.transport",
          rightKey: "auth.method",
          confidence: "high",
          reason: "Both claims select the application authentication transport.",
          evidenceRefs: [
            { contractId: "contract-a", source: "claim", ref: "auth.transport" },
            { contractId: "contract-b", source: "claim", ref: "auth.method" },
          ],
        },
      ],
      droppedFindingCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain(
      "Adds the server authentication boundary.",
    );
  });

  it("degrades when every claimed finding fails semantic validation", async () => {
    const fetchImpl = makeFetch(
      completedResponse({
        findings: [
          manifestContentFinding(),
          validFinding({ right_key: "auth.forged" }),
        ],
      }),
    );

    const result = await makeReviewer(fetchImpl).review(baseInput());

    expectDegraded(result, "invalid_response", false);
  });

  it.each([
    {
      name: "unknown left contract",
      finding: validFinding({ left_contract_id: "contract-forged" }),
    },
    {
      name: "same contract pair",
      finding: validFinding({
        right_contract_id: "contract-a",
        right_key: "auth.transport",
        evidence_refs: [validEvidence()[0], validEvidence()[0]],
      }),
    },
    {
      name: "forged left key",
      finding: validFinding({ left_key: "auth.forged" }),
    },
    {
      name: "empty equivalent key",
      finding: validFinding({ left_key: "" }),
    },
    {
      name: "forged optional incompatibility key",
      finding: validFinding({
        kind: "likely_incompatibility",
        left_key: "objective.forged",
      }),
    },
    {
      name: "reference to unrelated contract",
      finding: validFinding({
        evidence_refs: [
          validEvidence()[0],
          { ...validEvidence()[1], contract_id: "contract-c" },
        ],
      }),
    },
    {
      name: "forged fixed selector",
      finding: validFinding({
        evidence_refs: [
          { contract_id: "contract-a", source: "objective", ref: "raw text" },
          validEvidence()[1],
        ],
      }),
    },
    {
      name: "forged claim selector",
      finding: validFinding({
        evidence_refs: [
          { contract_id: "contract-a", source: "claim", ref: "auth.forged" },
          validEvidence()[1],
        ],
      }),
    },
    {
      name: "forged changed-file selector",
      finding: validFinding({
        evidence_refs: [
          {
            contract_id: "contract-a",
            source: "changed_file",
            ref: "src/forged.ts",
          },
          validEvidence()[1],
        ],
      }),
    },
    {
      name: "evidence from only one side",
      finding: validFinding({
        evidence_refs: [validEvidence()[0]],
      }),
    },
  ])("rejects $name cross-reference forgery", async ({ finding }) => {
    const input = baseInput();
    input.contracts.push({
      ...input.contracts[0]!,
      contractId: "contract-c",
      claims: input.contracts[0]!.claims.map((claim) => ({ ...claim })),
      changedFiles: [...input.contracts[0]!.changedFiles],
    });
    const fetchImpl = makeFetch(completedResponse({ findings: [finding] }));
    const result = await makeReviewer(fetchImpl).review(input);
    expectDegraded(result, "invalid_response", false);
  });

  it("accepts every supported evidence selector only when it cross-references input", async () => {
    const finding = validFinding({
      evidence_refs: [
        { contract_id: "contract-a", source: "objective", ref: "objective" },
        {
          contract_id: "contract-a",
          source: "manifest",
          ref: "manifest_summary",
        },
        {
          contract_id: "contract-a",
          source: "changed_file",
          ref: "src/server.ts",
        },
        {
          contract_id: "contract-b",
          source: "diff_summary",
          ref: "diff_summary",
        },
        {
          contract_id: "contract-b",
          source: "claim",
          ref: "auth.method",
        },
      ],
    });
    const fetchImpl = makeFetch(completedResponse({ findings: [finding] }));
    const result = await makeReviewer(fetchImpl).review(baseInput());
    expect(result).toMatchObject({ status: "completed" });
  });

  it("orients, sorts, and deduplicates validated findings stably", async () => {
    const reversedLow = validFinding({
      left_contract_id: "contract-b",
      right_contract_id: "contract-a",
      left_key: "auth.method",
      right_key: "auth.transport",
      confidence: "low",
      reason: "Lower-confidence duplicate.",
      evidence_refs: [validEvidence()[1], validEvidence()[0], validEvidence()[1]],
    });
    const canonicalHigh = validFinding({
      confidence: "high",
      reason: "Higher-confidence duplicate.",
      evidence_refs: [validEvidence()[1], validEvidence()[0]],
    });
    const incompatibility = validFinding({
      kind: "likely_incompatibility",
      left_key: "",
      right_key: "",
      confidence: "medium",
      reason: "The objectives likely select incompatible session ownership.",
      evidence_refs: [
        { contract_id: "contract-b", source: "objective", ref: "objective" },
        { contract_id: "contract-a", source: "objective", ref: "objective" },
      ],
    });
    const fetchImpl = makeFetch(
      completedResponse({
        findings: [incompatibility, reversedLow, canonicalHigh],
      }),
    );

    const result = await makeReviewer(fetchImpl).review(baseInput());

    expect(result).toStrictEqual({
      status: "completed",
      findings: [
        {
          kind: "equivalent_key",
          leftContractId: "contract-a",
          rightContractId: "contract-b",
          leftKey: "auth.transport",
          rightKey: "auth.method",
          confidence: "high",
          reason: "Higher-confidence duplicate.",
          evidenceRefs: [
            { contractId: "contract-a", source: "claim", ref: "auth.transport" },
            { contractId: "contract-b", source: "claim", ref: "auth.method" },
          ],
        },
        {
          kind: "likely_incompatibility",
          leftContractId: "contract-a",
          rightContractId: "contract-b",
          leftKey: "",
          rightKey: "",
          confidence: "medium",
          reason: "The objectives likely select incompatible session ownership.",
          evidenceRefs: [
            { contractId: "contract-a", source: "objective", ref: "objective" },
            { contractId: "contract-b", source: "objective", ref: "objective" },
          ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("resp-provider-id");
    expect(JSON.stringify(result)).not.toContain("message-provider-id");
  });
});
