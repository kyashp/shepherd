const SIMPLE_AGENT_NAME = /^[\p{L}\p{N}_.-]+$/u;
const MESSAGE_SPACING = /[\t\p{Zs}]+/gu;
const FORBIDDEN_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const MAX_AGENT_KEY_LENGTH = 128;
export const MAX_PROJECT_GROUP_MESSAGE_LENGTH = 2_000;

function formatParserSafeAgentName(agentName: string): string | null {
  const normalizedName = agentName.normalize("NFKC").trim();
  if (
    !normalizedName ||
    normalizedName.length > MAX_AGENT_KEY_LENGTH ||
    FORBIDDEN_CONTROL_CHARACTER.test(normalizedName)
  ) {
    return null;
  }
  if (SIMPLE_AGENT_NAME.test(normalizedName)) return `@${normalizedName}`;

  const quotedName = JSON.stringify(normalizedName);
  const parsedTarget = JSON.parse(quotedName.replace(MESSAGE_SPACING, " ")) as string;
  return parsedTarget === normalizedName ? `@${quotedName}` : null;
}

export function formatProjectGroupMention(agentName: string, agentId: string): string {
  return formatParserSafeAgentName(agentName) ?? `@${agentId}`;
}

export function prependProjectGroupMention(
  agentName: string,
  agentId: string,
  composerContent: string,
): string {
  return `${formatProjectGroupMention(agentName, agentId)} ${composerContent}`;
}

export function prependProjectGroupMentionWithinLimit(
  agentName: string,
  agentId: string,
  composerContent: string,
): string | null {
  const content = prependProjectGroupMention(agentName, agentId, composerContent);
  return content.length <= MAX_PROJECT_GROUP_MESSAGE_LENGTH ? content : null;
}
