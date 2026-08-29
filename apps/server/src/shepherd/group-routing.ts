export interface GroupRoutingAgent {
  id: string;
  name: string;
}

export type ProjectGroupRoute =
  | {
      kind: "shepherd";
      content: string;
    }
  | {
      kind: "agent";
      agentId: string;
      agentName: string;
      content: string;
    };

export type GroupRoutingErrorCode =
  | "empty_message"
  | "message_too_large"
  | "control_character"
  | "invalid_agent_directory"
  | "invalid_mention"
  | "unknown_agent"
  | "ambiguous_agent"
  | "multiple_mentions"
  | "missing_message";

export class GroupRoutingError extends Error {
  constructor(
    public readonly code: GroupRoutingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GroupRoutingError";
  }
}

export interface ParseProjectGroupMessageOptions {
  /** Defaults to the starter API's 50 KB message boundary. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 50_000;
const MAX_AGENT_KEY_LENGTH = 128;
const SIMPLE_MENTION = /^@([\p{L}\p{N}_.-]{1,128})(?=\s|$)/u;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

function key(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function normalizeMessage(raw: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_000_000) {
    throw new RangeError("maxBytes must be between 1 and 1000000");
  }
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new GroupRoutingError("message_too_large", "Project Group message is too large");
  }
  if (CONTROL_CHARACTER.test(raw)) {
    throw new GroupRoutingError(
      "control_character",
      "Project Group message contains a forbidden control character",
    );
  }
  const normalized = raw
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\p{Zs}]+/gu, " ")
    .trim();
  if (!normalized) {
    throw new GroupRoutingError("empty_message", "Project Group message cannot be empty");
  }
  if (Buffer.byteLength(normalized, "utf8") > maxBytes) {
    throw new GroupRoutingError("message_too_large", "Project Group message is too large");
  }
  return normalized;
}

function validateAgents(agents: readonly GroupRoutingAgent[]): Map<string, GroupRoutingAgent[]> {
  const lookup = new Map<string, GroupRoutingAgent[]>();
  const ids = new Set<string>();
  for (const agent of agents) {
    const id = agent.id.normalize("NFKC").trim();
    const name = agent.name.normalize("NFKC").trim();
    if (!id || !name || id.length > MAX_AGENT_KEY_LENGTH || name.length > MAX_AGENT_KEY_LENGTH) {
      throw new GroupRoutingError("invalid_agent_directory", "Agent identity is invalid");
    }
    const idKey = key(id);
    if (ids.has(idKey)) {
      throw new GroupRoutingError("invalid_agent_directory", "Agent IDs must be unique");
    }
    ids.add(idKey);
    for (const lookupKey of new Set([idKey, key(name)])) {
      lookup.set(lookupKey, [...(lookup.get(lookupKey) ?? []), agent]);
    }
  }
  const names = new Map<string, number>();
  for (const agent of agents) names.set(key(agent.name), (names.get(key(agent.name)) ?? 0) + 1);
  if ([...names.values()].some((count) => count > 1)) {
    throw new GroupRoutingError(
      "invalid_agent_directory",
      "Agent names must be unique ignoring case and Unicode normalization",
    );
  }
  return lookup;
}

/**
 * Parse a bounded Project Group message without interpreting commands or paths.
 *
 * Routing syntax is deliberately restricted to the beginning of the message:
 * `@AgentName task` for names/IDs made of Unicode letters/numbers plus `_.-`, or
 * `@"Agent Name" task` using a JSON string for whitespace/escaped characters.
 * Everything without a leading directive routes to Shepherd unchanged.
 */
export function parseProjectGroupMessage(
  raw: string,
  agents: readonly GroupRoutingAgent[],
  options: ParseProjectGroupMessageOptions = {},
): ProjectGroupRoute {
  const content = normalizeMessage(raw, options.maxBytes ?? DEFAULT_MAX_BYTES);
  const lookup = validateAgents(agents);
  if (!content.startsWith("@")) return { kind: "shepherd", content };

  let target: string;
  let consumed: number;
  if (content.startsWith('@"')) {
    let escaped = false;
    let closing = -1;
    for (let index = 2; index < content.length; index += 1) {
      const character = content[index]!;
      if (!escaped && character === '"') {
        closing = index;
        break;
      }
      escaped = !escaped && character === "\\";
      if (character !== "\\") escaped = false;
    }
    if (closing < 0 || (content[closing + 1] !== undefined && !/\s/u.test(content[closing + 1]!))) {
      throw new GroupRoutingError("invalid_mention", "Quoted Agent mention is malformed");
    }
    try {
      target = JSON.parse(content.slice(1, closing + 1)) as string;
    } catch {
      throw new GroupRoutingError("invalid_mention", "Quoted Agent mention is malformed");
    }
    consumed = closing + 1;
  } else {
    const match = SIMPLE_MENTION.exec(content);
    if (!match) {
      throw new GroupRoutingError("invalid_mention", "Leading Agent mention is malformed");
    }
    target = match[1]!;
    consumed = match[0].length;
  }

  if (!target || target.length > MAX_AGENT_KEY_LENGTH || CONTROL_CHARACTER.test(target)) {
    throw new GroupRoutingError("invalid_mention", "Agent mention is invalid");
  }
  const matches = lookup.get(key(target)) ?? [];
  if (matches.length === 0) {
    throw new GroupRoutingError("unknown_agent", "Mentioned Agent does not exist");
  }
  if (matches.length !== 1) {
    throw new GroupRoutingError("ambiguous_agent", "Mention matches multiple Agent identities");
  }

  const message = content.slice(consumed).trim();
  if (!message) {
    throw new GroupRoutingError("missing_message", "Agent assignment requires a message");
  }
  // A second leading-token-shaped mention in an assignment is never silently
  // treated as prose. Other injection-looking @ text remains inert content.
  const second = /(?:^|\s)@(?:[\p{L}\p{N}_.-]{1,128}|"(?:[^"\\]|\\.){1,256}")(?=\s|$)/gu;
  for (const ignored of message.matchAll(second)) {
    void ignored;
    throw new GroupRoutingError("multiple_mentions", "Only one Agent may be targeted per message");
  }

  const agent = matches[0]!;
  return {
    kind: "agent",
    agentId: agent.id,
    agentName: agent.name,
    content: message,
  };
}
