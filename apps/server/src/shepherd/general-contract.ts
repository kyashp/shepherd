import {
  decideAuthorityPath,
  normalizeRepoPath,
} from "./authority.js";
import type { ExpectedArtifact, ScopedAuthority } from "./domain.js";

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_DRAFT_MESSAGES = 8;
const MAX_OBJECTIVE_LENGTH = 8_000;
const MAX_ARTIFACTS = 8;
const MAX_ACCEPTANCE_LENGTH = 500;
const MAX_REQUIRED_CONTENT_LENGTH = 200;
const REQUIRED_SAFETY_SCOPE =
  "Safety: project files only; no external, production, privileged, destructive, or credential operations.";

export type GeneralContractMissingField =
  | "objective"
  | "expected_artifact"
  | "acceptance_evidence"
  | "authority"
  | "safety";

export interface GeneralContractPlan {
  status: "clarification_required" | "ready";
  objective: string;
  title: string;
  expectedArtifacts: ExpectedArtifact[];
  acceptanceSummary: string | null;
  requiredContent: string | null;
  missingFields: GeneralContractMissingField[];
  unsafeIntentDetected: boolean;
  clarification: string | null;
}

export class GeneralContractPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneralContractPlanError";
  }
}

function normalizeMessage(content: string): string {
  const normalized = content.normalize("NFKC").trim();
  if (
    normalized.length < 1 ||
    normalized.length > MAX_MESSAGE_LENGTH ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)
  ) {
    throw new GeneralContractPlanError(
      "A Shepherd Contract message must contain 1 to 2000 safe characters",
    );
  }
  return normalized;
}

const REPLACE_PRIOR_REQUEST = /^replace\s+(?:the\s+)?prior\s+request\s*:\s*/iu;

function effectiveObjective(messages: readonly string[]): string {
  const normalized = messages.map(normalizeMessage);
  let replacementIndex = -1;
  for (let index = 0; index < normalized.length; index += 1) {
    if (REPLACE_PRIOR_REQUEST.test(normalized[index]!)) replacementIndex = index;
  }
  const latest = normalized.at(-1);
  if (
    replacementIndex < 0 &&
    normalized.length > 1 &&
    latest &&
    contractSections(latest) !== null &&
    normalized.slice(0, -1).every((message) =>
      artifactCandidates(message).length === 0 &&
      safetyConcernsFrom(taskForSafetyScan(message, contractSections(message))).length === 0
    )
  ) {
    return latest;
  }
  const effectiveMessages = replacementIndex < 0
    ? normalized
    : [
        normalized[replacementIndex]!.replace(REPLACE_PRIOR_REQUEST, "").trim(),
        ...normalized.slice(replacementIndex + 1),
      ].filter(Boolean);
  if (effectiveMessages.length > MAX_DRAFT_MESSAGES) {
    throw new GeneralContractPlanError(
      "A Shepherd Contract draft must contain 1 to 8 bounded messages",
    );
  }
  return effectiveMessages.join("\n\n");
}

type SafetyConcern =
  | "credential or sensitive-data transfer"
  | "Shepherd safeguard bypass"
  | "destructive repository or host action"
  | "privileged host or system modification"
  | "external or production side effect";

const SAFETY_PATTERNS: readonly {
  concern: SafetyConcern;
  pattern: RegExp;
}[] = [
  {
    concern: "credential or sensitive-data transfer",
    pattern:
      /\b(?:send|upload|exfiltrat(?:e|ing)|copy|transmit|publish)(?:es|s)?\b[^.\r\n]{0,100}\b(?:api[\s-]*keys?|credentials?|passwords?|secrets?|access[\s-]*tokens?|private[\s-]*keys?)\b/giu,
  },
  {
    concern: "credential or sensitive-data transfer",
    pattern:
      /(?:\b(?:api[\s-]*keys?|credentials?|passwords?|secrets?|(?:access|auth|deployment|session)[\s-]*tokens?|private[\s-]*keys?|environment\s+variables?)\b|(?:^|[\s\\/])\.env(?:\.|\b))/giu,
  },
  {
    concern: "Shepherd safeguard bypass",
    pattern:
      /\b(?:ignore|disregard|bypass|disable|evade|circumvent|override)\b[^.\r\n]{0,100}\b(?:shepherd|safeguards?|guardrails?|authority|verification|verifier|sandbox|security|permissions?)\b/giu,
  },
  {
    concern: "destructive repository or host action",
    pattern:
      /\b(?:run|execute|invoke|use)(?:s)?\b[^.\r\n]{0,40}\b(?:rm\s+-[^\r\n ]*r[^\r\n ]*f|git\s+(?:reset\s+--hard|clean\s+-[^\r\n ]*f))\b/giu,
  },
  {
    concern: "destructive repository or host action",
    pattern:
      /\b(?:delete|erase|wipe|destroy|remove)\b\s+(?:all|every|the\s+entire)\s+(?:repository|workspace|host|system|filesystem|files?)\b/giu,
  },
  {
    concern: "privileged host or system modification",
    pattern:
      /\b(?:run|execute|invoke|use)(?:s)?\b[^.\r\n]{0,40}\b(?:sudo|su\s+-|chmod\s+777|chown)\b/giu,
  },
  {
    concern: "privileged host or system modification",
    pattern:
      /\b(?:modify|write(?:\s+to)?|delete)\b[^.\r\n]{0,60}\b(?:the\s+)?(?:host|system|\/etc\b)/giu,
  },
  {
    concern: "external or production side effect",
    pattern:
      /\b(?:deploy|publish|release|push|apply)(?:es|s)?\b[^.\r\n]{0,60}\b(?:to|into|against)\s+(?:the\s+)?(?:production|prod|live\s+(?:environment|system))\b/giu,
  },
  {
    concern: "external or production side effect",
    pattern:
      /\b(?:send|upload|transmit|publish)(?:es|s)?\b[^.\r\n]{0,100}\b(?:external|remote|third[\s-]*party)\b/giu,
  },
  {
    concern: "external or production side effect",
    pattern:
      /\b(?:webhooks?|external\s+(?:server|service|system)|production\s+(?:environment|service|system))\b/giu,
  },
  {
    concern: "external or production side effect",
    pattern:
      /\b(?:run|execute|invoke|use)(?:s)?\b[^.\r\n]{0,60}\b(?:curl|wget|scp|ssh|git\s+push)\b/giu,
  },
  {
    concern: "external or production side effect",
    pattern:
      /\b(?:send|post|put|upload|transmit|publish|push|forward|deliver)(?:es|s)?\b[^.\r\n]{0,120}(?:https?:\/\/|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b)/giu,
  },
  {
    concern: "privileged host or system modification",
    pattern:
      /\b(?:disable|modify|replace|reconfigure|stop)(?:s|d|ing)?\b[^.\r\n]{0,60}\b(?:firewall|antivirus|endpoint\s+protection|system\s+service|daemon)\b/giu,
  },
  {
    concern: "destructive repository or host action",
    pattern:
      /(?:\brm\s+-[^\r\n ]*r[^\r\n ]*f\b|\bgit\s+(?:reset\s+--hard|clean\s+-[^\r\n ]*f|push\s+--force)\b)/giu,
  },
];

function isNegated(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 48), index);
  if (
    /\b(?:(?:do|does|did|must|should|will|would|can|could)\s+)?not\s+(?:refuse|avoid|prevent|stop)\s+(?:[\p{L}\p{N}_-]+\s+){0,3}$/iu.test(prefix)
  ) {
    return false;
  }
  return /\b(?:(?:do|does|did|must|should|will|would|can|could)\s+)?(?:not|never)\s+(?:[\p{L}\p{N}_-]+\s+){0,3}$/iu.test(
    prefix,
  );
}

function safetyConcernsFrom(task: string): SafetyConcern[] {
  const requestedWork = task
    .replace(/`[^`\r\n]*`/gu, "`artifact`")
    .replace(/\s+/gu, " ");
  const concerns: SafetyConcern[] = [];
  for (const { concern, pattern } of SAFETY_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of requestedWork.matchAll(pattern)) {
      if (match.index === undefined || isNegated(requestedWork, match.index)) continue;
      if (!concerns.includes(concern)) concerns.push(concern);
    }
  }
  return concerns;
}

interface ContractSections {
  task: string;
  acceptance: string;
}

const escapedSafetyScope = REQUIRED_SAFETY_SCOPE.replace(
  /[.*+?^${}()|[\]\\]/gu,
  "\\$&",
);
const terminalContractPattern = new RegExp(
  `^([\\s\\S]*\\S)\\s+${escapedSafetyScope}\\s+Acceptance\\s*:\\s*([^\\r\\n]{1,${MAX_ACCEPTANCE_LENGTH}})$`,
  "iu",
);

function contractSections(objective: string): ContractSections | null {
  const match = terminalContractPattern.exec(objective);
  const task = match?.[1]?.trim();
  const acceptance = match?.[2]?.trim();
  return task && acceptance ? { task, acceptance } : null;
}

function taskForSafetyScan(
  objective: string,
  sections: ContractSections | null,
): string {
  if (sections) return sections.task;
  return objective
    .replaceAll(REQUIRED_SAFETY_SCOPE, " ")
    .replace(/\bacceptance\s*:[^\r\n]*$/iu, " ");
}

function artifactCandidates(objective: string): string[] {
  const candidates: string[] = [];
  for (const match of objective.matchAll(/`([^`\r\n]{1,256})`/gu)) {
    if (match[1]) candidates.push(match[1]);
  }
  for (const match of objective.matchAll(
    /(?:^|[\s(])((?:\.?\.?[\\/])?(?:[\p{L}\p{N}_.-]+[\\/])*[\p{L}\p{N}_-]+\.[\p{L}\p{N}]{1,16})(?=$|[\s),;:.])/gu,
  )) {
    if (match[1]) candidates.push(match[1]);
  }
  const output: string[] = [];
  for (const candidate of candidates) {
    try {
      const normalized = normalizeRepoPath(candidate);
      if (!output.includes(normalized)) output.push(normalized);
    } catch {
      const normalized = candidate.normalize("NFKC").trim();
      if (normalized && !output.includes(normalized)) output.push(normalized);
    }
  }
  return output.slice(0, MAX_ARTIFACTS);
}

function acceptanceFrom(objective: string): {
  summary: string | null;
  complete: boolean;
} {
  const matches = [...objective.matchAll(/\bacceptance\s*:/giu)];
  const marker = matches.at(-1);
  if (!marker || marker.index === undefined) {
    return { summary: null, complete: false };
  }
  const tail = objective.slice(marker.index + marker[0].length).trim();
  return {
    summary: tail ? tail.slice(0, MAX_ACCEPTANCE_LENGTH) : null,
    complete:
      matches.length === 1 &&
      tail.length >= 1 &&
      tail.length <= MAX_ACCEPTANCE_LENGTH &&
      !/[\r\n]/u.test(tail),
  };
}

function requiredContentFrom(acceptance: string | null): string | null {
  if (!acceptance) return null;
  // Match the whole acceptance statement. A supported keyword or literal must
  // not make an additional, negated, or otherwise unenforceable predicate look
  // verifiable.
  const match = /^(?:the\s+(?:file|files|artifact|artifacts)|all\s+(?:files|artifacts)|each\s+(?:file|artifact))\s+(?:(?:must\s+)?contain(?:s)?|(?:must\s+)?exist(?:s)?\s+and\s+(?:must\s+)?contain(?:s)?)\s+(?:"([^"\r\n]{1,200})"|'([^'\r\n]{1,200})'|`([^`\r\n]{1,200})`)[.!?]?$/iu.exec(
    acceptance,
  );
  const value = (match?.[1] ?? match?.[2] ?? match?.[3])?.normalize("NFKC").trim();
  return value ? value.slice(0, MAX_REQUIRED_CONTENT_LENGTH) : null;
}

function acceptanceIsIndependentlyVerifiable(
  acceptance: string | null,
  artifactCount: number,
  requiredContent: string | null,
): boolean {
  if (!acceptance || artifactCount < 1) return false;
  if (requiredContent !== null) {
    // The bounded verifier currently supports one literal-content predicate.
    // Requiring one artifact prevents an ambiguous literal from being accepted
    // merely because it appeared in a different declared output.
    return artifactCount === 1;
  }
  return false;
}

function hasConcreteObjective(
  task: string,
  candidates: readonly string[],
): boolean {
  const imperative = /^(?:please\s+)?(?:add|build|change|create|fix|implement|make|refactor|remove|rename|replace|test|update|write)\s+(?:(?:the|a|an)\s+)?(?:file\s+)?`([^`\r\n]{1,256})`/iu.exec(task);
  let directArtifact: string | null = null;
  if (imperative?.[1]) {
    try {
      directArtifact = normalizeRepoPath(imperative[1]);
    } catch {
      directArtifact = null;
    }
  }
  const proseTask = task.replace(/`[^`\r\n]*`/gu, "`artifact`");
  if (
    task.length < 12 ||
    directArtifact === null ||
    !candidates.includes(directArtifact) ||
    /^(?:fix|do|build|change|improve|update)\s+(?:it|this|that)[.!?]*$/iu.test(proseTask) ||
    /\b(?:if|when|unless|maybe|perhaps|possibly|consider|whether|before\s+doing\s+anything|ask(?:ing)?\s+me|wait(?:ing)?\s+for|pending\s+(?:my\s+)?approval)\b/iu.test(proseTask) ||
    /\b(?:do\s+not|don['’]t|cannot|can['’]t|won['’]t|shouldn['’]t|mustn['’]t|without)\b/iu.test(proseTask) ||
    /\b(?:after\s+(?:i|we)\s+approve|after\s+(?:my|our)\s+approval|subject\s+to|provided\s+that|once\s+approved|until\s+approved|contingent\s+on|await(?:ing)?\s+(?:my|our)?\s*confirmation)\b/iu.test(proseTask) ||
    /\b(?:explain|describe|tell\s+me)\s+(?:how|whether|what)\b/iu.test(proseTask) ||
    /\b(?:(?:do|does|did|must|should|will|would|can|could)\s+)?(?:not|never)\b/iu.test(proseTask)
  ) {
    return false;
  }
  return true;
}

function titleFrom(objective: string, artifacts: readonly ExpectedArtifact[]): string {
  const withoutContractClauses = objective.split(
    /(?:^|\n|[.!?]\s+)(?:safety|acceptance)\s*:/iu,
  )[0] ?? objective;
  const flattened = withoutContractClauses
    .replaceAll("`", "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?]+$/u, "");
  const fallback = artifacts[0] ? `Update ${artifacts[0].path}` : "Clarify Agent work";
  const title = flattened || fallback;
  return title.length <= 96 ? title : title.slice(0, 95).trimEnd() + "…";
}

function clarificationFor(
  missing: readonly GeneralContractMissingField[],
  safetyConcerns: readonly SafetyConcern[],
): string {
  const requests: string[] = [];
  if (missing.includes("objective")) {
    requests.push(
      "one affirmative, unconditional instruction beginning with an action and its quoted project-relative artifact, such as Create `src/feature.ts`",
    );
  }
  if (missing.includes("expected_artifact")) {
    requests.push("at least one project-relative file, such as `src/feature.ts`");
  }
  if (missing.includes("acceptance_evidence")) {
    requests.push(
      'an observable acceptance statement, such as `Acceptance: the file exists and contains "expected text"`',
    );
  }
  if (missing.includes("authority")) {
    requests.push("artifact paths within this Agent's configured writable authority");
  }
  if (missing.includes("safety")) {
    requests.push(safetyConcerns.length > 0
      ? `a safely reframed request because this draft includes ${safetyConcerns.join(
          ", ",
        )}. Begin a new message with \`Replace prior request:\` and fully restate a non-destructive, project-only objective followed by \`${REQUIRED_SAFETY_SCOPE}\``
      : `the explicit scope \`${REQUIRED_SAFETY_SCOPE}\` before the Acceptance statement`);
  }
  return `Before I create the Execution Contract, please provide ${requests.join(
    "; ",
  )}. I will keep this draft in the current Agent chat.`;
}

export function planGeneralContract(
  messages: readonly string[],
  authority: ScopedAuthority,
): GeneralContractPlan {
  if (messages.length < 1) {
    throw new GeneralContractPlanError(
      "A Shepherd Contract draft must contain 1 to 8 bounded messages",
    );
  }
  const objective = effectiveObjective(messages);
  if (objective.length > MAX_OBJECTIVE_LENGTH) {
    throw new GeneralContractPlanError("The accumulated Contract draft is too long");
  }
  const candidates = artifactCandidates(objective);
  const allowedPaths: string[] = [];
  let authorityDenied = false;
  for (const candidate of candidates) {
    const decision = decideAuthorityPath(authority, candidate, "write");
    if (decision.allowed && !decision.ingestionOnly && decision.path) {
      if (!allowedPaths.includes(decision.path)) allowedPaths.push(decision.path);
    } else {
      authorityDenied = true;
    }
  }
  const expectedArtifacts: ExpectedArtifact[] = allowedPaths.map((path) => ({
    path,
    description: "Required artifact for the confirmed Agent request",
    required: true,
  }));
  const acceptance = acceptanceFrom(objective);
  const acceptanceSummary = acceptance.summary;
  const verifiableAcceptance = acceptance.complete ? acceptanceSummary : null;
  const requiredContent = requiredContentFrom(verifiableAcceptance);
  const sections = contractSections(objective);
  const safetyConcerns = safetyConcernsFrom(
    taskForSafetyScan(objective, sections),
  );
  const safetyScopeConfirmed = sections !== null;
  const missingFields: GeneralContractMissingField[] = [];
  if (!hasConcreteObjective(sections?.task ?? objective, candidates)) {
    missingFields.push("objective");
  }
  if (candidates.length === 0) missingFields.push("expected_artifact");
  if (
    !acceptanceIsIndependentlyVerifiable(
      verifiableAcceptance,
      expectedArtifacts.length,
      requiredContent,
    )
  ) {
    missingFields.push("acceptance_evidence");
  }
  if (authorityDenied || (candidates.length > 0 && expectedArtifacts.length === 0)) {
    missingFields.push("authority");
  }
  if (safetyConcerns.length > 0 || !safetyScopeConfirmed) missingFields.push("safety");
  return {
    status: missingFields.length === 0 ? "ready" : "clarification_required",
    objective,
    title: titleFrom(objective, expectedArtifacts),
    expectedArtifacts,
    acceptanceSummary,
    requiredContent,
    missingFields,
    unsafeIntentDetected: safetyConcerns.length > 0,
    clarification:
      missingFields.length === 0
        ? null
        : clarificationFor(missingFields, safetyConcerns),
  };
}
