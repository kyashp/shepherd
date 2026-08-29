const SIMPLE_AGENT_NAME = /^[\p{L}\p{N}_.-]+$/u;

export function formatProjectGroupMention(agentName: string): string {
  return SIMPLE_AGENT_NAME.test(agentName)
    ? `@${agentName}`
    : `@${JSON.stringify(agentName)}`;
}

export function prependProjectGroupMention(
  agentName: string,
  composerContent: string,
): string {
  return `${formatProjectGroupMention(agentName)} ${composerContent}`;
}
