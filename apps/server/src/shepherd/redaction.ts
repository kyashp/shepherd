export type RedactedJson =
  | string
  | number
  | boolean
  | null
  | RedactedJson[]
  | { [key: string]: RedactedJson };

export interface RedactionOptions {
  /** Exact secret values planted/configured by trusted code. */
  secrets?: readonly string[];
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
  maxNodes?: number;
}

const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const MAX_DEPTH = "[MAX_DEPTH]";
const CIRCULAR = "[CIRCULAR]";
const UNSUPPORTED = "[UNSUPPORTED]";

const DEFAULTS: Required<Omit<RedactionOptions, "secrets">> = {
  maxDepth: 8,
  maxArrayItems: 50,
  maxObjectKeys: 50,
  maxStringLength: 2_000,
  maxNodes: 1_000,
};

const SENSITIVE_CANONICAL_KEYS = new Set([
  "accesstoken",
  "apikey",
  "arkapikey",
  "authorization",
  "bearertoken",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "env",
  "environment",
  "password",
  "passwd",
  "privatekey",
  "prompt",
  "rawprompt",
  "refreshtoken",
  "secret",
  "setcookie",
  "systemprompt",
]);

function canonicalKey(key: string): string {
  return key.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_CANONICAL_KEYS.has(canonicalKey(key));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function validateLimit(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function configuredSecrets(options: RedactionOptions): string[] {
  return [...new Set((options.secrets ?? []).filter((secret) => secret.length > 0))]
    .sort((left, right) => right.length - left.length);
}

/** Redact known secret values and common credential encodings from free text. */
export function redactText(
  input: string,
  options: Pick<RedactionOptions, "secrets" | "maxStringLength"> = {},
): string {
  const maxLength = validateLimit(
    options.maxStringLength ?? DEFAULTS.maxStringLength,
    DEFAULTS.maxStringLength,
  );
  let value = input.normalize("NFKC");

  for (const secret of configuredSecrets(options)) {
    value = value.replace(new RegExp(escapeRegExp(secret), "gu"), REDACTED);
  }

  value = value
    .replace(
      /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/giu,
      REDACTED,
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/gu,
      REDACTED,
    )
    .replace(
      /(\bBearer\s+)[A-Za-z0-9._~+/=-]{6,}/giu,
      `$1${REDACTED}`,
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|cookie)\s*[:=]\s*["']?)[^\s"',;]+/giu,
      `$1${REDACTED}`,
    )
    .replace(/(https?:\/\/[^\s/:@]+:)[^\s/@]+@/giu, `$1${REDACTED}@`);

  if (value.length <= maxLength) return value;
  const room = Math.max(0, maxLength - TRUNCATED.length);
  return `${value.slice(0, room)}${TRUNCATED}`;
}

interface RedactionContext {
  options: Required<Omit<RedactionOptions, "secrets">> & {
    secrets: readonly string[];
  };
  ancestors: WeakSet<object>;
  nodesRemaining: number;
}

function consumeNode(context: RedactionContext): boolean {
  if (context.nodesRemaining <= 0) return false;
  context.nodesRemaining -= 1;
  return true;
}

function boundedKey(key: string, context: RedactionContext): string {
  return redactText(key, {
    secrets: context.options.secrets,
    maxStringLength: Math.min(200, context.options.maxStringLength),
  });
}

function redactUnknown(
  input: unknown,
  context: RedactionContext,
  depth: number,
): RedactedJson {
  if (!consumeNode(context)) return TRUNCATED;
  if (input === null) return null;
  if (typeof input === "string") {
    return redactText(input, context.options);
  }
  if (typeof input === "number") return Number.isFinite(input) ? input : String(input);
  if (typeof input === "boolean") return input;
  if (typeof input === "bigint") return input.toString();
  if (typeof input === "undefined" || typeof input === "symbol" || typeof input === "function") {
    return UNSUPPORTED;
  }
  if (depth >= context.options.maxDepth) return MAX_DEPTH;

  if (context.ancestors.has(input)) return CIRCULAR;
  context.ancestors.add(input);
  try {
    if (input instanceof Date) {
      return Number.isNaN(input.valueOf()) ? "Invalid Date" : input.toISOString();
    }
    if (input instanceof Error) {
      return {
        name: redactText(input.name, context.options),
        message: redactText(input.message, context.options),
      };
    }
    if (Array.isArray(input)) {
      const bounded = input
        .slice(0, context.options.maxArrayItems)
        .map((item) => redactUnknown(item, context, depth + 1));
      if (input.length > context.options.maxArrayItems) bounded.push(TRUNCATED);
      return bounded;
    }
    if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) {
      return "[BINARY_DATA]";
    }

    const output: Record<string, RedactedJson> = {};
    const keys = Object.keys(input).sort((left, right) => left.localeCompare(right));
    const selected = keys.slice(0, context.options.maxObjectKeys);
    for (const key of selected) {
      const safeKey = boundedKey(key, context);
      if (isSensitiveKey(key)) {
        output[safeKey] = REDACTED;
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor)) {
        output[safeKey] = "[UNINSPECTABLE]";
        continue;
      }
      output[safeKey] = redactUnknown(descriptor.value, context, depth + 1);
    }
    if (keys.length > context.options.maxObjectKeys) {
      output["[truncated_keys]"] = keys.length - context.options.maxObjectKeys;
    }
    return output;
  } finally {
    context.ancestors.delete(input);
  }
}

/**
 * Convert arbitrary input into bounded, JSON-safe, recursively redacted data.
 * Accessors are never invoked and cycles cannot escape into persistence.
 */
export function redactValue(
  input: unknown,
  options: RedactionOptions = {},
): RedactedJson {
  const normalized = {
    secrets: configuredSecrets(options),
    maxDepth: validateLimit(options.maxDepth ?? DEFAULTS.maxDepth, DEFAULTS.maxDepth),
    maxArrayItems: validateLimit(
      options.maxArrayItems ?? DEFAULTS.maxArrayItems,
      DEFAULTS.maxArrayItems,
    ),
    maxObjectKeys: validateLimit(
      options.maxObjectKeys ?? DEFAULTS.maxObjectKeys,
      DEFAULTS.maxObjectKeys,
    ),
    maxStringLength: validateLimit(
      options.maxStringLength ?? DEFAULTS.maxStringLength,
      DEFAULTS.maxStringLength,
    ),
    maxNodes: validateLimit(options.maxNodes ?? DEFAULTS.maxNodes, DEFAULTS.maxNodes),
  };
  return redactUnknown(
    input,
    {
      options: normalized,
      ancestors: new WeakSet(),
      nodesRemaining: normalized.maxNodes,
    },
    0,
  );
}

/** Produce a final exact-size-bounded string for logs or subprocess evidence. */
export function stringifyRedacted(
  input: unknown,
  options: RedactionOptions & { maxOutputLength?: number } = {},
): string {
  const output = JSON.stringify(redactValue(input, options));
  const maxOutputLength = validateLimit(options.maxOutputLength ?? 20_000, 20_000);
  if (output.length <= maxOutputLength) return output;
  const marker = TRUNCATED;
  if (JSON.stringify(marker).length > maxOutputLength) return "";
  let lower = 0;
  let upper = output.length;
  let candidate = JSON.stringify(marker);
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const next = JSON.stringify(`${output.slice(0, middle)}${marker}`);
    if (next.length <= maxOutputLength) {
      candidate = next;
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return candidate;
}
