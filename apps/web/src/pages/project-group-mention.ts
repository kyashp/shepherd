const SIMPLE_AGENT_NAME = /^[\p{L}\p{N}_.-]+$/u;
const MESSAGE_SPACING = /[\t\p{Zs}]+/gu;
const FORBIDDEN_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const MAX_AGENT_KEY_LENGTH = 128;
export const MAX_PROJECT_GROUP_MESSAGE_LENGTH = 2_000;

export interface ProjectGroupMentionTarget {
  id: string;
  name: string;
}

interface MentionQuery {
  end: number;
  query: string;
}

function leadingMentionQuery(content: string, selectionStart: number): MentionQuery | null {
  const match = /^@([\p{L}\p{N}_.-]*)/u.exec(content);
  if (!match || selectionStart !== match[0].length) return null;
  return { end: match[0].length, query: match[1]!.normalize("NFKC").toLocaleLowerCase("en-US") };
}

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

export function findProjectGroupMentionCandidates(
  content: string,
  selectionStart: number,
  agents: readonly ProjectGroupMentionTarget[],
): ProjectGroupMentionTarget[] {
  const mention = leadingMentionQuery(content, selectionStart);
  if (!mention) return [];
  if (!mention.query) return [...agents];
  return agents.filter((agent) =>
    agent.name.normalize("NFKC").toLocaleLowerCase("en-US").startsWith(mention.query),
  );
}

export function replaceProjectGroupMentionQuery(
  content: string,
  selectionStart: number,
  agent: ProjectGroupMentionTarget,
): { content: string; selectionStart: number } | null {
  const mention = leadingMentionQuery(content, selectionStart);
  if (!mention) return null;
  const replacement = `${formatProjectGroupMention(agent.name, agent.id)} `;
  return {
    content: `${replacement}${content.slice(mention.end).replace(/^\s/u, "")}`,
    selectionStart: replacement.length,
  };
}
