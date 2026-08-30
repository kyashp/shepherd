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

export type GeneralContractMissingField =
  | "objective"
  | "expected_artifact"
  | "acceptance_evidence"
  | "authority";

export interface GeneralContractPlan {
  status: "clarification_required" | "ready";
  objective: string;
  title: string;
  expectedArtifacts: ExpectedArtifact[];
  acceptanceSummary: string | null;
  requiredContent: string | null;
  missingFields: GeneralContractMissingField[];
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

function acceptanceFrom(objective: string): string | null {
  const explicit = /(?:^|\n|[.!?]\s+)acceptance\s*:\s*([^\n]{1,500})/iu.exec(objective);
  if (explicit?.[1]) return explicit[1].trim().slice(0, MAX_ACCEPTANCE_LENGTH);
  return null;
}

function requiredContentFrom(acceptance: string | null): string | null {
  if (!acceptance) return null;
  const match =
    /\b(?:contain|contains|print|prints|return|returns)\b[^"'`\r\n]{0,80}(?:"([^"]{1,200})"|'([^']{1,200})'|`([^`]{1,200})`)/iu.exec(
      acceptance,
    );
  const value = (match?.[1] ?? match?.[2] ?? match?.[3])?.normalize("NFKC").trim();
  return value ? value.slice(0, MAX_REQUIRED_CONTENT_LENGTH) : null;
}

function hasConcreteObjective(objective: string): boolean {
  if (objective.length < 12 || /^(?:fix|do|build|change|improve|update)\s+(?:it|this|that)[.!?]*$/iu.test(objective)) {
    return false;
  }
  return /\b(?:add|build|change|create|fix|implement|make|refactor|remove|rename|replace|test|update|write)\b/iu.test(
    objective,
  );
}

function titleFrom(objective: string, artifacts: readonly ExpectedArtifact[]): string {
  const withoutAcceptance = objective.split(/(?:^|\n|[.!?]\s+)acceptance\s*:/iu)[0] ?? objective;
  const flattened = withoutAcceptance
    .replaceAll("`", "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?]+$/u, "");
  const fallback = artifacts[0] ? `Update ${artifacts[0].path}` : "Clarify Agent work";
  const title = flattened || fallback;
  return title.length <= 96 ? title : title.slice(0, 95).trimEnd() + "…";
}

function clarificationFor(missing: readonly GeneralContractMissingField[]): string {
  const requests: string[] = [];
  if (missing.includes("objective")) {
    requests.push("the specific change the Agent should make");
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
  return `Before I create the Execution Contract, please provide ${requests.join(
    "; ",
  )}. I will keep this draft in the current Agent chat.`;
}

export function planGeneralContract(
  messages: readonly string[],
  authority: ScopedAuthority,
): GeneralContractPlan {
  if (messages.length < 1 || messages.length > MAX_DRAFT_MESSAGES) {
    throw new GeneralContractPlanError(
      "A Shepherd Contract draft must contain 1 to 8 bounded messages",
    );
  }
  const objective = messages.map(normalizeMessage).join("\n\n");
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
  const acceptanceSummary = acceptanceFrom(objective);
  const missingFields: GeneralContractMissingField[] = [];
  if (!hasConcreteObjective(objective)) missingFields.push("objective");
  if (candidates.length === 0) missingFields.push("expected_artifact");
  if (!acceptanceSummary) missingFields.push("acceptance_evidence");
  if (authorityDenied || (candidates.length > 0 && expectedArtifacts.length === 0)) {
    missingFields.push("authority");
  }
  return {
    status: missingFields.length === 0 ? "ready" : "clarification_required",
    objective,
    title: titleFrom(objective, expectedArtifacts),
    expectedArtifacts,
    acceptanceSummary,
    requiredContent: requiredContentFrom(acceptanceSummary),
    missingFields,
    clarification: missingFields.length === 0 ? null : clarificationFor(missingFields),
  };
}
