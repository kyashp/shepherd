import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { appendShepherdEvent } from "../database.js";
import { JsonStore } from "../store.js";
import type { Agent, Database } from "../types.js";
import { WorkspaceManager } from "../workspace.js";
import {
  AUTH_CLAIM_KEY,
  BEARER_TRANSPORT,
  COOKIE_TRANSPORT,
  verifiedAuthTransportFact,
  type AuthTransport,
} from "./auth-fixture.js";
import {
  intersectScopedAuthority,
  validateChangedPaths,
} from "./authority.js";
import { detectDeterministicCollisions } from "./collision.js";
import {
  initializeAuthDemoProject,
  initializeShepherdManagedRoot,
  type ManagedAuthDemoProject,
} from "./demo-project.js";
import type {
  AcceptanceCheck,
  ExecutionContract,
  FailureInfo,
  Mission,
  Plane,
  ResolutionCandidate,
  ScopedAuthority,
  SemanticClaim,
  SemanticCollision,
  ShepherdDatabase,
  ShepherdEvent,
  ShepherdProject,
  VerificationEvidence,
} from "./domain.js";
import {
  DeterministicFixtureExecutor,
  type DeterministicOperation,
  type ShepherdExecutor,
} from "./executor.js";
import { ingestContractResultManifest } from "./manifest.js";
import {
  PlaneAuthorityViolationError,
  PlaneManager,
  type ExecutionWorkspace,
} from "./plane-manager.js";
import { PromotionGate } from "./promotion-gate.js";
import { redactText, redactValue } from "./redaction.js";
import {
  applyWinnerDecision,
  decideResolutionWinner,
} from "./resolution.js";
import {
  canTransitionMission,
  transitionContractAndRecord,
  transitionMissionAndRecord,
} from "./state-machine.js";
import type { VerificationRequest } from "./verifier.js";

const SHEPHERD_ACTOR = {
  type: "shepherd",
  id: null,
  displayName: "Shepherd",
} as const;
const VERIFIER_ACTOR = {
  type: "verifier",
  id: null,
  displayName: "Independent verifier",
} as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/u;
const MAX_MANIFEST_BYTES = 64 * 1024;

export const AUTH_FRONTEND_PROFILE_ID = "auth-frontend";
export const AUTH_BACKEND_PROFILE_ID = "auth-backend";
export const AUTH_PROJECT_PROFILE_ID = "auth-project-security";

const frontendCheck = (): AcceptanceCheck => ({
  id: "frontend-contract",
  name: "Frontend authentication contract",
  profileId: AUTH_FRONTEND_PROFILE_ID,
  mandatory: true,
  timeoutMs: 30_000,
});

const backendCheck = (): AcceptanceCheck => ({
  id: "backend-contract",
  name: "Backend authentication contract",
  profileId: AUTH_BACKEND_PROFILE_ID,
  mandatory: true,
  timeoutMs: 30_000,
});

const projectCheck = (): AcceptanceCheck => ({
  id: "project-security",
  name: "Project authentication security invariant",
  profileId: AUTH_PROJECT_PROFILE_ID,
  mandatory: true,
  timeoutMs: 30_000,
});

const protectedPatterns = [
  ".git/**",
  ".shepherd/**",
  "checks/**",
  "policy.json",
] as const;

function authorityFor(area: "frontend" | "backend" | "resolution"): ScopedAuthority {
  const writable =
    area === "resolution"
      ? ["src/frontend/**", "src/backend/**"]
      : [`src/${area}/**`];
  return {
    readable: ["**"],
    writable,
    forbidden: [...protectedPatterns],
  };
}

function boundedContractAuthority(
  agentAuthority: ScopedAuthority,
  requestedAuthority: ScopedAuthority,
): ScopedAuthority {
  const intersection = intersectScopedAuthority(agentAuthority, requestedAuthority);
  if (!intersection.ok) {
    throw new Error("Execution Contract authority exceeds its assigned Agent authority");
  }
  return intersection.authority;
}

export interface ShepherdIndependentVerifier {
  verify(request: VerificationRequest): Promise<VerificationEvidence>;
}

export interface ShepherdServiceOptions {
  store: JsonStore;
  managedRoot: string;
  /** Must match the WorkspaceManager root used by AgentService. */
  agentWorkspaceRoot?: string;
  verifier: ShepherdIndependentVerifier;
  executor?: ShepherdExecutor;
  sensitiveValues?: readonly string[];
  now?: () => Date;
  idFactory?: (prefix: string) => string;
}

export interface DeterministicDemoOptions {
  projectId?: string;
  allowClientReadableCredential?: boolean;
}

export interface ShepherdMissionDetail {
  mission: Mission;
  project: ShepherdProject;
  agents: Agent[];
  contracts: ExecutionContract[];
  planes: Plane[];
  claims: SemanticClaim[];
  collisions: SemanticCollision[];
  candidates: ResolutionCandidate[];
  events: ShepherdEvent[];
}

export interface DeterministicDemoResult {
  mission: Mission;
  collision: SemanticCollision;
  candidates: ResolutionCandidate[];
  selectedCandidate: ResolutionCandidate;
  integrationCommit: string;
  promotedHead: string;
}

interface PreparedMission {
  project: ManagedAuthDemoProject;
  planeManager: PlaneManager;
  missionId: string;
  frontendContractId: string;
  backendContractId: string;
}

interface ContractPlaneInput {
  contractId: string;
  operation: DeterministicOperation;
}

interface CandidateWork {
  candidateId: string;
  plane: Plane;
  operation: Extract<DeterministicOperation, { kind: "resolution_candidate" }>;
}

function replaceById<T extends { id: string }>(collection: T[], value: T): void {
  const index = collection.findIndex((item) => item.id === value.id);
  if (index === -1) collection.push(structuredClone(value));
  else collection[index] = structuredClone(value);
}

interface EventInput {
  type: ShepherdEvent["type"];
  summary: string;
  missionId: string;
  contractId?: string | null;
  agentId?: string | null;
  planeId?: string | null;
  collisionId?: string | null;
  candidateId?: string | null;
  actor?: typeof SHEPHERD_ACTOR | typeof VERIFIER_ACTOR;
  details?: ShepherdEvent["details"];
  timestamp: string;
}

function appendRawEvent(
  database: Database,
  input: EventInput,
): ShepherdEvent {
  return appendShepherdEvent(database, {
    type: input.type,
    summary: input.summary,
    actor: input.actor ?? SHEPHERD_ACTOR,
    missionId: input.missionId,
    contractId: input.contractId ?? null,
    agentId: input.agentId ?? null,
    planeId: input.planeId ?? null,
    collisionId: input.collisionId ?? null,
    candidateId: input.candidateId ?? null,
    details: input.details ?? {},
    timestamp: input.timestamp,
  });
}

async function readBoundedRegularFile(filePath: string): Promise<string> {
  const entry = await lstat(filePath);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error("Result manifest must be a regular file");
  }
  if (entry.size > MAX_MANIFEST_BYTES) {
    throw new Error("Result manifest exceeds the trusted ingestion limit");
  }
  return await readFile(filePath, "utf8");
}

async function existingRegularPaths(
  root: string,
  changedPaths: readonly string[],
): Promise<string[]> {
  const existing: string[] = [];
  for (const changedPath of changedPaths) {
    const destination = path.join(root, ...changedPath.split("/"));
    try {
      const entry = await lstat(destination);
      if (!entry.isSymbolicLink() && entry.isFile()) existing.push(changedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return existing;
}

function terminalMission(state: Mission["state"]): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

function pathsOverlap(left: string, right: string): boolean {
  const relative = path.relative(left, right);
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) &&
      relative !== ".." &&
      !path.isAbsolute(relative)) ||
    (() => {
      const inverse = path.relative(right, left);
      return (
        !inverse.startsWith(".." + path.sep) &&
        inverse !== ".." &&
        !path.isAbsolute(inverse)
      );
    })()
  );
}

/** Stable UUID-shaped identity accepted by all existing Agent API routes. */
export function deterministicDemoAgentId(
  projectId: string,
  role: "frontend" | "backend",
): string {
  const bytes = createHash("sha256")
    .update(`shepherd-demo-agent\0${projectId}\0${role}`, "utf8")
    .digest()
    .subarray(0, 16);
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Could not derive deterministic Agent identity");
  }
  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

class AuthorityViolationError extends Error {
  constructor(readonly stage: "contract" | "candidate") {
    super(`Scoped authority denied ${stage} changes`);
    this.name = "AuthorityViolationError";
  }
}

/**
 * Orchestrates the deterministic, real-Git Shepherd walking skeleton. The
 * shared JsonStore must be initialized once by application composition before
 * this service is used; initialize() establishes only the managed project root.
 */
export class ShepherdService {
  private readonly store: JsonStore;
  private readonly managedRoot: string;
  private readonly agentWorkspaceRoot: string;
  private readonly workspaceManager: WorkspaceManager;
  private readonly verifier: ShepherdIndependentVerifier;
  private readonly executor: ShepherdExecutor;
  private readonly sensitiveValues: string[];
  private readonly now: () => Date;
  private readonly idFactory: (prefix: string) => string;
  private readonly activeProjects = new Set<string>();
  private readonly backgroundRuns = new Map<
    string,
    Promise<DeterministicDemoResult | null>
  >();

  constructor(options: ShepherdServiceOptions) {
    this.store = options.store;
    this.managedRoot = path.resolve(options.managedRoot);
    this.agentWorkspaceRoot = path.resolve(
      options.agentWorkspaceRoot ?? path.join(this.managedRoot, "agent-workspaces"),
    );
    this.workspaceManager = new WorkspaceManager(this.agentWorkspaceRoot);
    this.verifier = options.verifier;
    this.executor = options.executor ?? new DeterministicFixtureExecutor();
    this.sensitiveValues = [...new Set(options.sensitiveValues ?? [])].filter(
      (value) => value.length > 0,
    );
    this.now = options.now ?? (() => new Date());
    this.idFactory =
      options.idFactory ??
      ((prefix) => `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 12)}`);
  }

  async initialize(): Promise<void> {
    await initializeShepherdManagedRoot(this.managedRoot);
    await this.initializeWorkspaceRoot();
    const snapshot = this.store.snapshot();
    for (const project of snapshot.shepherd.projects) {
      const missionIds = new Set(
        snapshot.shepherd.missions
          .filter((mission) => mission.projectId === project.id)
          .map((mission) => mission.id),
      );
      const agentIds = new Set(
        snapshot.shepherd.contracts
          .filter((contract) => missionIds.has(contract.missionId))
          .map((contract) => contract.agentId),
      );
      for (const agent of snapshot.agents.filter((item) => agentIds.has(item.id))) {
        await this.ensureAgentWorkspace(agent, project.repositoryPath, null, true);
      }
    }
  }

  state(): ShepherdDatabase {
    return this.store.snapshot().shepherd;
  }

  missionDetail(missionId: string): ShepherdMissionDetail | null {
    const database = this.store.snapshot();
    const mission = database.shepherd.missions.find((item) => item.id === missionId);
    if (!mission) return null;
    const project = database.shepherd.projects.find(
      (item) => item.id === mission.projectId,
    );
    if (!project) throw new Error("Mission references a missing Shepherd project");
    const contracts = database.shepherd.contracts.filter(
      (item) => item.missionId === missionId,
    );
    const agentIds = new Set(contracts.map((contract) => contract.agentId));
    return {
      mission,
      project,
      agents: database.agents.filter((agent) => agentIds.has(agent.id)),
      contracts,
      planes: database.shepherd.planes.filter(
        (item) => item.missionId === missionId,
      ),
      claims: database.shepherd.claims.filter(
        (item) => item.missionId === missionId,
      ),
      collisions: database.shepherd.collisions.filter(
        (item) => item.missionId === missionId,
      ),
      candidates: database.shepherd.candidates.filter(
        (item) => item.missionId === missionId,
      ),
      events: database.shepherd.events
        .filter((item) => item.missionId === missionId)
        .sort((left, right) => left.sequence - right.sequence),
    };
  }

  eventsAfter(cursor: number, limit = 200): ShepherdEvent[] {
    return this.store.shepherdEventsAfter(cursor, limit);
  }

  async startDeterministicDemo(
    options: DeterministicDemoOptions = {},
  ): Promise<{ missionId: string }> {
    const projectId = options.projectId ?? "auth-demo";
    this.claimProject(projectId);
    let prepared: PreparedMission;
    try {
      prepared = await this.prepareMission(options);
    } catch (error) {
      this.activeProjects.delete(projectId);
      throw error;
    }
    const operation = this.executePreparedMission(prepared)
      .catch(async (error: unknown) => {
        await this.recordMissionFailure(prepared.missionId, error, "background_demo");
        return null;
      })
      .finally(() => {
        this.backgroundRuns.delete(prepared.missionId);
        this.activeProjects.delete(projectId);
      });
    this.backgroundRuns.set(prepared.missionId, operation);
    return { missionId: prepared.missionId };
  }

  async runDeterministicDemo(
    options: DeterministicDemoOptions = {},
  ): Promise<DeterministicDemoResult> {
    const projectId = options.projectId ?? "auth-demo";
    this.claimProject(projectId);
    let missionId: string | null = null;
    try {
      const prepared = await this.prepareMission(options);
      missionId = prepared.missionId;
      return await this.executePreparedMission(prepared);
    } catch (error) {
      if (missionId) await this.recordMissionFailure(missionId, error, "deterministic_demo");
      throw error;
    } finally {
      this.activeProjects.delete(projectId);
    }
  }

  private claimProject(projectId: string): void {
    if (this.activeProjects.has(projectId)) {
      throw new Error("A deterministic Mission is already active for this project");
    }
    this.activeProjects.add(projectId);
  }

  private identifier(prefix: string): string {
    const id = this.idFactory(prefix);
    if (!SAFE_ID.test(id)) throw new Error("ID factory returned an unsafe identifier");
    return id;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private safeText(input: string, maxStringLength = 1_000): string {
    return redactText(input, {
      secrets: this.sensitiveValues,
      maxStringLength,
    }).replace(
      /(?:[A-Za-z]:\\[^\s"'`,;]+|\/(?:home|workspace|tmp|var|root|Users)(?:\/[^\s"'`,;]+)+)/gu,
      "[PATH]",
    );
  }

  private makeFailure(error: unknown, stage: string, at: string): FailureInfo {
    const raw = error instanceof Error ? error.message : "Unknown failure";
    return {
      code: "unknown",
      message: this.safeText(raw),
      stage,
      at,
      retryable: false,
    };
  }

  private recordEvent(database: Database, input: EventInput): ShepherdEvent {
    const redacted = redactValue(input.details ?? {}, {
      secrets: this.sensitiveValues,
      maxDepth: 2,
      maxArrayItems: 16,
      maxObjectKeys: 32,
      maxStringLength: 500,
      maxNodes: 128,
    });
    const details: ShepherdEvent["details"] = {};
    if (typeof redacted === "object" && redacted !== null && !Array.isArray(redacted)) {
      for (const [key, value] of Object.entries(redacted)) {
        details[this.safeText(key, 64)] =
          typeof value === "string"
            ? this.safeText(value, 500)
            : typeof value === "number" || typeof value === "boolean" || value === null
              ? value
              : this.safeText(JSON.stringify(value), 500);
      }
    }
    return appendRawEvent(database, {
      ...input,
      summary: this.safeText(input.summary, 500),
      details,
    });
  }

  private sanitizeEvidence(evidence: VerificationEvidence): VerificationEvidence {
    return {
      ...evidence,
      summary: this.safeText(evidence.summary, 1_000),
      checks: evidence.checks.map((check) => ({
        ...check,
        name: this.safeText(check.name, 200),
        stdout: this.safeText(check.stdout, 2_000),
        stderr: this.safeText(check.stderr, 2_000),
        error: check.error === null ? null : this.safeText(check.error, 1_000),
      })),
    };
  }

  private async prepareMission(
    options: DeterministicDemoOptions,
  ): Promise<PreparedMission> {
    await this.initialize();
    const project = await initializeAuthDemoProject({
      managedRoot: this.managedRoot,
      projectId: options.projectId ?? "auth-demo",
      allowClientReadableCredential:
        options.allowClientReadableCredential ?? false,
    });
    const planeManager = new PlaneManager({
      repositoryPath: project.repositoryPath,
      planesRoot: project.planesRoot,
      protectedBranch: project.protectedBranch,
      now: this.now,
    });
    await planeManager.initialize();

    const createdAt = this.timestamp();
    const missionId = this.identifier("mission");
    const frontendContractId = this.identifier("contract-front");
    const backendContractId = this.identifier("contract-back");
    const frontendAgentId = deterministicDemoAgentId(project.projectId, "frontend");
    const backendAgentId = deterministicDemoAgentId(project.projectId, "backend");
    const frontendAuthority = authorityFor("frontend");
    const backendAuthority = authorityFor("backend");
    const frontendContractAuthority = boundedContractAuthority(
      frontendAuthority,
      authorityFor("frontend"),
    );
    const backendContractAuthority = boundedContractAuthority(
      backendAuthority,
      authorityFor("backend"),
    );
    const currentAgents = this.store.snapshot().agents;
    const frontendAgent = this.makeAgent(
      currentAgents.find((agent) => agent.id === frontendAgentId),
      frontendAgentId,
      "Frontend Agent",
      "Frontend",
      frontendAuthority,
      createdAt,
    );
    const backendAgent = this.makeAgent(
      currentAgents.find((agent) => agent.id === backendAgentId),
      backendAgentId,
      "Backend Agent",
      "Backend",
      backendAuthority,
      createdAt,
    );
    await this.ensureAgentWorkspace(
      frontendAgent,
      project.repositoryPath,
      project.planesRoot,
      currentAgents.some((agent) => agent.id === frontendAgentId),
    );
    await this.ensureAgentWorkspace(
      backendAgent,
      project.repositoryPath,
      project.planesRoot,
      currentAgents.some((agent) => agent.id === backendAgentId),
    );

    await this.store.mutate((database) => {
      const existingActive = database.shepherd.missions.find(
        (mission) =>
          mission.projectId === project.projectId && !terminalMission(mission.state),
      );
      if (existingActive) {
        throw new Error("The managed project already has a non-terminal Mission");
      }
      const existingProject = database.shepherd.projects.find(
        (item) => item.id === project.projectId,
      );
      const projectRecord: ShepherdProject = {
        id: project.projectId,
        displayName: "Authentication collision demo",
        repositoryPath: project.repositoryPath,
        protectedBranch: project.protectedBranch,
        protectedHeadCommit: project.headCommit,
        activeMissionId: missionId,
        createdAt: existingProject?.createdAt ?? createdAt,
        updatedAt: createdAt,
      };
      replaceById(database.shepherd.projects, projectRecord);
      replaceById(database.agents, frontendAgent);
      replaceById(database.agents, backendAgent);

      const mission: Mission = {
        id: missionId,
        projectId: project.projectId,
        originalIntent:
          "Implement frontend and backend authentication, detect their semantic transport collision, and promote the independently verified resolution.",
        baseCommit: project.headCommit,
        contractIds: [frontendContractId, backendContractId],
        dependencyEdges: [],
        collisionIds: [],
        resolutionIds: [],
        state: "planning",
        attentionReason: null,
        failure: null,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        completedAt: null,
      };
      database.shepherd.missions.push(mission);
      const contracts = [
        this.makeContract({
          id: frontendContractId,
          missionId,
          agentId: frontendAgentId,
          title: "Implement frontend authentication transport",
          objective: "Configure the frontend to use bearer JWT authentication.",
          artifactPath: "src/frontend/auth.json",
          authority: frontendContractAuthority,
          acceptanceChecks: [frontendCheck()],
          createdAt,
        }),
        this.makeContract({
          id: backendContractId,
          missionId,
          agentId: backendAgentId,
          title: "Implement backend authentication transport",
          objective:
            "Configure the backend to use an HttpOnly session cookie.",
          artifactPath: "src/backend/auth.json",
          authority: backendContractAuthority,
          acceptanceChecks: [backendCheck()],
          createdAt,
        }),
      ];
      database.shepherd.contracts.push(...contracts);
      this.recordEvent(database, {
        type: "mission_created",
        summary: "Created deterministic authentication collision Mission",
        missionId,
        timestamp: createdAt,
        details: { projectId: project.projectId },
      });
      for (const contract of contracts) {
        this.recordEvent(database, {
          type: "contract_created",
          summary: `Created ${contract.title}`,
          missionId,
          contractId: contract.id,
          agentId: contract.agentId,
          timestamp: createdAt,
        });
        transitionContractAndRecord(database, contract.id, "queued", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: createdAt,
        });
      }
      transitionMissionAndRecord(database, missionId, "queued", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: createdAt,
      });
    });

    return {
      project,
      planeManager,
      missionId,
      frontendContractId,
      backendContractId,
    };
  }

  private async initializeWorkspaceRoot(): Promise<void> {
    try {
      const entry = await lstat(this.agentWorkspaceRoot);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error("Agent workspace root cannot be a symlink or non-directory");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(this.agentWorkspaceRoot, { recursive: true });
    }
    const canonical = await realpath(this.agentWorkspaceRoot);
    if (canonical !== this.agentWorkspaceRoot) {
      throw new Error("Agent workspace root identity changed through a symlink");
    }
    await this.workspaceManager.initialize();
  }

  private async ensureAgentWorkspace(
    agent: Agent,
    repositoryPath: string,
    planesRoot: string | null,
    hasPersistedAgent: boolean,
  ): Promise<void> {
    await this.initializeWorkspaceRoot();
    const workspacePath = path.resolve(agent.workspacePath);
    const expectedPath = path.join(this.agentWorkspaceRoot, agent.id);
    if (workspacePath !== expectedPath) {
      throw new Error("Demo Agent workspace does not match its server-owned identity");
    }
    if (
      pathsOverlap(workspacePath, path.resolve(repositoryPath)) ||
      (planesRoot !== null && pathsOverlap(workspacePath, path.resolve(planesRoot)))
    ) {
      throw new Error("Demo Agent workspace overlaps protected Shepherd state");
    }
    try {
      const entry = await lstat(workspacePath);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error("Demo Agent workspace cannot be a symlink or non-directory");
      }
      if (!hasPersistedAgent) {
        throw new Error("Refusing to adopt an untracked demo Agent workspace");
      }
      if ((await realpath(workspacePath)) !== workspacePath) {
        throw new Error("Demo Agent workspace identity changed through a symlink");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.workspaceManager.create(agent);
      if ((await realpath(workspacePath)) !== workspacePath) {
        throw new Error("Created demo Agent workspace escaped its managed root");
      }
    }
  }

  private makeAgent(
    existing: Agent | undefined,
    id: string,
    name: string,
    role: "Frontend" | "Backend",
    authority: ScopedAuthority,
    timestamp: string,
  ): Agent {
    return {
      id,
      name,
      description: "Trusted deterministic Shepherd fixture Agent",
      instructions: "Operate only within the assigned Execution Contract.",
      status: "ready",
      workspacePath: this.workspaceManager.workspacePath(id),
      codexThreadId: null,
      lastError: null,
      role,
      authority,
      currentContractId: null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
  }

  private makeContract(input: {
    id: string;
    missionId: string;
    agentId: string;
    title: string;
    objective: string;
    artifactPath: string;
    authority: ScopedAuthority;
    acceptanceChecks: AcceptanceCheck[];
    createdAt: string;
  }): ExecutionContract {
    return {
      id: input.id,
      missionId: input.missionId,
      agentId: input.agentId,
      title: input.title,
      objective: input.objective,
      contextualInputs: [],
      dependencyIds: [],
      semanticScopes: ["authentication"],
      declaredClaimKeys: [AUTH_CLAIM_KEY],
      authority: input.authority,
      expectedArtifacts: [
        {
          path: input.artifactPath,
          description: "Authentication transport configuration",
          required: true,
        },
      ],
      acceptance: {
        checks: input.acceptanceChecks,
        objectiveTieBreakers: [],
      },
      planeId: null,
      resultManifestPath: ".shepherd/result.json",
      manifest: null,
      verificationEvidence: [],
      state: "created",
      failure: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      startedAt: null,
      agentCompletedAt: null,
      verifiedAt: null,
      completedAt: null,
    };
  }

  private async executePreparedMission(
    prepared: PreparedMission,
  ): Promise<DeterministicDemoResult> {
    const startedAt = this.timestamp();
    await this.store.mutate((database) => {
      transitionMissionAndRecord(database, prepared.missionId, "running", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: startedAt,
      });
    });

    const contractInputs: ContractPlaneInput[] = [
      {
        contractId: prepared.frontendContractId,
        operation: {
          kind: "frontend_contract",
          contractId: prepared.frontendContractId,
        },
      },
      {
        contractId: prepared.backendContractId,
        operation: {
          kind: "backend_contract",
          contractId: prepared.backendContractId,
        },
      },
    ];
    const contractPlanes: Plane[] = [];
    for (const input of contractInputs) {
      contractPlanes.push(await this.createContractPlane(prepared, input.contractId));
    }
    const contractResults = await Promise.allSettled(
      contractInputs.map((input, index) => {
        const plane = contractPlanes[index];
        if (!plane) throw new Error("Contract Plane was not created");
        return this.executeContract(prepared, input, plane);
      }),
    );
    const contractFailure = contractResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (contractFailure) throw contractFailure.reason;

    const verificationAt = this.timestamp();
    await this.store.mutate((database) => {
      transitionMissionAndRecord(database, prepared.missionId, "verifying", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: verificationAt,
      });
    });

    const integrationPlane = await this.integrateContracts(prepared);
    const integrationCommit = integrationPlane.headCommit;
    if (!integrationCommit) throw new Error("Integration Plane has no immutable head");
    const collision = await this.detectAndPersistCollision(
      prepared.missionId,
      integrationPlane,
    );
    const candidateWorks = await this.createCandidates(
      prepared,
      collision,
      integrationCommit,
    );
    const candidateSettled = await Promise.allSettled(
      candidateWorks.map((work) => this.executeCandidate(prepared, work)),
    );
    for (const [index, settled] of candidateSettled.entries()) {
      if (settled.status === "rejected") {
        const work = candidateWorks[index];
        if (work) await this.persistCandidateInfrastructureFailure(work, settled.reason);
      }
    }

    const candidates = this.store
      .snapshot()
      .shepherd.candidates.filter((item) => item.collisionId === collision.id);
    const decision = decideResolutionWinner(candidates, []);
    if (decision.kind !== "selected") {
      await this.persistAttentionRequired(prepared.missionId, collision.id, decision.reason);
      throw new Error(`Resolution requires attention: ${decision.reason}`);
    }
    const selectedAt = this.timestamp();
    await this.store.mutate((database) => {
      const current = database.shepherd.candidates.filter(
        (item) => item.collisionId === collision.id,
      );
      for (const updated of applyWinnerDecision(current, decision, selectedAt)) {
        replaceById(database.shepherd.candidates, updated);
      }
      this.recordEvent(database, {
        type: "candidate_selected",
        summary: "Selected the independently verified resolution candidate",
        missionId: prepared.missionId,
        collisionId: collision.id,
        candidateId: decision.selectedCandidateId,
        timestamp: selectedAt,
        details: {
          source: decision.source,
          tieBreaker: decision.tieBreaker,
        },
      });
    });

    const selectedCandidate = this.store
      .snapshot()
      .shepherd.candidates.find((item) => item.id === decision.selectedCandidateId);
    if (!selectedCandidate) throw new Error("Selected candidate disappeared before promotion");
    const selectedPlane = this.store
      .snapshot()
      .shepherd.planes.find((item) => item.id === selectedCandidate.planeId);
    if (!selectedPlane) throw new Error("Selected candidate Plane is missing");
    const promotion = await this.promoteCandidate(
      prepared,
      selectedCandidate,
      selectedPlane,
    );
    if (!promotion.promoted) {
      throw new Error(`Promotion failed: ${promotion.reason}`);
    }

    const completedAt = this.timestamp();
    await this.store.mutate((database) => {
      const persistedCandidate = database.shepherd.candidates.find(
        (item) => item.id === selectedCandidate.id,
      );
      const persistedPlane = database.shepherd.planes.find(
        (item) => item.id === selectedPlane.id,
      );
      const persistedCollision = database.shepherd.collisions.find(
        (item) => item.id === collision.id,
      );
      const persistedProject = database.shepherd.projects.find(
        (item) => item.id === prepared.project.projectId,
      );
      if (
        !persistedCandidate ||
        !persistedPlane ||
        !persistedCollision ||
        !persistedProject
      ) {
        throw new Error("Promotion records disappeared before final persistence");
      }
      persistedCandidate.promotionState = "promoted";
      persistedCandidate.result = `Promoted ${persistedCandidate.targetValue}`;
      persistedCandidate.updatedAt = completedAt;
      persistedPlane.verificationEvidenceIds.push(
        promotion.verificationEvidence.id,
      );
      persistedPlane.state = "verified";
      persistedPlane.updatedAt = completedAt;
      persistedCollision.state = "resolved";
      persistedCollision.resolvedAt = completedAt;
      persistedCollision.updatedAt = completedAt;
      persistedProject.protectedHeadCommit = promotion.promotedHead;
      persistedProject.activeMissionId = null;
      persistedProject.updatedAt = completedAt;
      this.recordEvent(database, {
        type: "promotion_completed",
        summary: "Promoted the selected resolution to the protected branch",
        missionId: prepared.missionId,
        planeId: selectedPlane.id,
        collisionId: collision.id,
        candidateId: selectedCandidate.id,
        timestamp: completedAt,
        details: {
          previousHead: promotion.previousHead,
          promotedHead: promotion.promotedHead,
        },
      });
      transitionMissionAndRecord(database, prepared.missionId, "completed", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: completedAt,
      });
    });

    const detail = this.missionDetail(prepared.missionId);
    if (!detail) throw new Error("Completed Mission could not be reloaded");
    const finalCollision = detail.collisions.find((item) => item.id === collision.id);
    const finalSelected = detail.candidates.find(
      (item) => item.id === selectedCandidate.id,
    );
    if (!finalCollision || !finalSelected) {
      throw new Error("Completed resolution records could not be reloaded");
    }
    return {
      mission: detail.mission,
      collision: finalCollision,
      candidates: detail.candidates,
      selectedCandidate: finalSelected,
      integrationCommit,
      promotedHead: promotion.promotedHead,
    };
  }

  private async createContractPlane(
    prepared: PreparedMission,
    contractId: string,
  ): Promise<Plane> {
    const snapshot = this.store.snapshot();
    const contract = snapshot.shepherd.contracts.find((item) => item.id === contractId);
    if (!contract) throw new Error("Execution Contract is missing");
    const plane = await prepared.planeManager.createPlane({
      id: this.identifier("plane-contract"),
      projectId: prepared.project.projectId,
      missionId: prepared.missionId,
      kind: "contract",
      contractId,
      candidateId: null,
      baseCommit: prepared.project.headCommit,
      purpose: contract.objective,
      executionIdentity: this.identifier("execution"),
      authority: contract.authority,
    });
    await this.store.mutate((database) => {
      database.shepherd.planes.push(plane);
      const persisted = database.shepherd.contracts.find(
        (item) => item.id === contractId,
      );
      if (!persisted) throw new Error("Execution Contract disappeared");
      persisted.planeId = plane.id;
      persisted.updatedAt = this.timestamp();
    });
    return plane;
  }

  private async persistContractAuthorityDenial(
    contractId: string,
    planeId: string,
    changedPaths: readonly string[],
  ): Promise<never> {
    const deniedAt = this.timestamp();
    const failure: FailureInfo = {
      code: "unauthorized_file_change",
      message: "Actual changes exceeded the Contract's scoped authority",
      stage: "contract_authority",
      at: deniedAt,
      retryable: false,
    };
    await this.store.mutate((database) => {
      transitionContractAndRecord(database, contractId, "authority_validation", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: deniedAt,
      });
      transitionContractAndRecord(database, contractId, "authority_denied", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: deniedAt,
        failure,
      });
      const plane = database.shepherd.planes.find((item) => item.id === planeId);
      if (plane) {
        plane.state = "failed";
        plane.error = failure;
        plane.changedFiles = [...changedPaths];
        plane.updatedAt = deniedAt;
      }
      const contract = database.shepherd.contracts.find(
        (item) => item.id === contractId,
      );
      const agent = database.agents.find((item) => item.id === contract?.agentId);
      if (agent) {
        agent.status = "error";
        agent.currentContractId = null;
        agent.lastError = failure.message;
        agent.updatedAt = deniedAt;
      }
    });
    throw new AuthorityViolationError("contract");
  }

  private async executeContract(
    prepared: PreparedMission,
    input: ContractPlaneInput,
    initialPlane: Plane,
  ): Promise<void> {
    const startedAt = this.timestamp();
    await this.store.mutate((database) => {
      transitionContractAndRecord(database, input.contractId, "running", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: startedAt,
      });
      const agent = database.agents.find(
        (item) =>
          item.id ===
          database.shepherd.contracts.find((contract) => contract.id === input.contractId)
            ?.agentId,
      );
      if (agent) {
        agent.status = "busy";
        agent.currentContractId = input.contractId;
        agent.updatedAt = startedAt;
      }
      const plane = database.shepherd.planes.find((item) => item.id === initialPlane.id);
      if (plane) {
        plane.state = "running";
        plane.updatedAt = startedAt;
      }
    });
    let executionWorkspace: ExecutionWorkspace | null = null;
    try {
      executionWorkspace =
        await prepared.planeManager.createExecutionWorkspace(initialPlane);
      await this.executor.run({
        executionId: initialPlane.executionIdentity,
        workspacePath: executionWorkspace.path,
        operation: input.operation,
      });
    } catch (error) {
      const failedAt = this.timestamp();
      const failure = this.makeFailure(error, "contract_execution", failedAt);
      await this.store.mutate((database) => {
        transitionContractAndRecord(
          database,
          input.contractId,
          "execution_failed",
          {
            actor: "control_plane",
            eventActor: SHEPHERD_ACTOR,
            timestamp: failedAt,
            failure,
          },
        );
        const plane = database.shepherd.planes.find(
          (item) => item.id === initialPlane.id,
        );
        if (plane) {
          plane.state = "failed";
          plane.error = failure;
          plane.updatedAt = failedAt;
        }
        const persistedContract = database.shepherd.contracts.find(
          (item) => item.id === input.contractId,
        );
        const agent = database.agents.find(
          (item) => item.id === persistedContract?.agentId,
        );
        if (agent) {
          agent.status = "error";
          agent.currentContractId = null;
          agent.lastError = failure.message;
          agent.updatedAt = failedAt;
        }
      });
      if (executionWorkspace) {
        await prepared.planeManager.destroyExecutionWorkspace(executionWorkspace);
      }
      throw error;
    }
    const agentCompletedAt = this.timestamp();
    await this.store.mutate((database) => {
      transitionContractAndRecord(database, input.contractId, "agent_completed", {
        actor: "agent_runtime",
        eventActor: {
          type: "agent",
          id: database.shepherd.contracts.find((item) => item.id === input.contractId)
            ?.agentId ?? null,
          displayName: "Contract Agent",
        },
        timestamp: agentCompletedAt,
      });
    });

    if (!executionWorkspace) {
      throw new Error("Contract execution workspace disappeared after completion");
    }
    try {
      await prepared.planeManager.importExecutionWorkspace(
        initialPlane,
        executionWorkspace,
      );
    } catch (error) {
      if (error instanceof PlaneAuthorityViolationError) {
        await this.persistContractAuthorityDenial(
          input.contractId,
          initialPlane.id,
          error.deniedPaths,
        );
      }
      throw error;
    } finally {
      await prepared.planeManager.destroyExecutionWorkspace(executionWorkspace);
    }

    const changedPaths = await prepared.planeManager.git.changedFilesSince(
      initialPlane.baseCommit,
      initialPlane.worktreePath,
    );
    const contract = this.store
      .snapshot()
      .shepherd.contracts.find((item) => item.id === input.contractId);
    if (!contract) throw new Error("Execution Contract disappeared after Agent completion");
    const authority = validateChangedPaths(changedPaths, contract.authority);
    if (!authority.allowed) {
      await this.persistContractAuthorityDenial(
        input.contractId,
        initialPlane.id,
        changedPaths,
      );
    }
    if (authority.manifestPaths.length !== 1) {
      const failedAt = this.timestamp();
      const failure: FailureInfo = {
        code: "missing_result_manifest",
        message: "The Contract did not produce exactly one trusted result manifest",
        stage: "manifest_ingestion",
        at: failedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        transitionContractAndRecord(database, input.contractId, "manifest_missing", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: failedAt,
          failure,
        });
      });
      throw new Error("Contract result manifest is missing");
    }

    const manifestPath = path.join(
      initialPlane.worktreePath,
      ".shepherd",
      "result.json",
    );
    let manifestRaw: string;
    try {
      manifestRaw = await readBoundedRegularFile(manifestPath);
    } catch (error) {
      const failedAt = this.timestamp();
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      const failure: FailureInfo = {
        code: missing ? "missing_result_manifest" : "malformed_manifest",
        message: missing
          ? "The Contract result manifest is missing"
          : "The Contract result manifest could not be safely read",
        stage: "manifest_ingestion",
        at: failedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        transitionContractAndRecord(
          database,
          input.contractId,
          missing ? "manifest_missing" : "manifest_malformed",
          {
            actor: "control_plane",
            eventActor: SHEPHERD_ACTOR,
            timestamp: failedAt,
            failure,
          },
        );
      });
      throw error;
    }
    const existingPaths = await existingRegularPaths(
      initialPlane.worktreePath,
      changedPaths,
    );
    const ingestion = ingestContractResultManifest(manifestRaw, {
      expectedContractId: input.contractId,
      missionId: prepared.missionId,
      declaredClaimKeys: contract.declaredClaimKeys,
      existingPaths,
      changedPaths,
      createdAt: this.timestamp(),
      claimId: (index) => `${input.contractId}-claim-${index + 1}`,
    });
    if (!ingestion.ok) {
      const failedAt = this.timestamp();
      const malformed = ingestion.failureCode === "malformed_manifest";
      const failure: FailureInfo = {
        code: ingestion.failureCode,
        message: `Strict result manifest ingestion failed: ${ingestion.failureCode}`,
        stage: "manifest_ingestion",
        at: failedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        if (malformed) {
          transitionContractAndRecord(
            database,
            input.contractId,
            "manifest_malformed",
            {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
              failure,
            },
          );
        } else {
          transitionContractAndRecord(
            database,
            input.contractId,
            "authority_validation",
            {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
            },
          );
          transitionContractAndRecord(
            database,
            input.contractId,
            "claim_rejected",
            {
              actor: "control_plane",
              eventActor: SHEPHERD_ACTOR,
              timestamp: failedAt,
              failure,
            },
          );
        }
      });
      throw new Error(
        `Strict result manifest ingestion failed: ${ingestion.failureCode}`,
      );
    }
    const authorityAt = this.timestamp();
    await this.store.mutate((database) => {
      transitionContractAndRecord(
        database,
        input.contractId,
        "authority_validation",
        {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: authorityAt,
        },
      );
      this.recordEvent(database, {
        type: "authority_accepted",
        summary: "Accepted the actual Git diff within Contract authority",
        missionId: prepared.missionId,
        contractId: input.contractId,
        planeId: initialPlane.id,
        timestamp: authorityAt,
        details: { changedFileCount: changedPaths.length },
      });
    });
    await rm(manifestPath);
    const finalizedChangedPaths = await prepared.planeManager.git.changedFilesSince(
      initialPlane.baseCommit,
      initialPlane.worktreePath,
    );
    const finalizedAuthority = validateChangedPaths(
      finalizedChangedPaths,
      contract.authority,
    );
    if (!finalizedAuthority.allowed || finalizedAuthority.manifestPaths.length !== 0) {
      throw new Error("Contract diff failed authority after manifest removal");
    }
    let plane = await prepared.planeManager.commitPlane(
      initialPlane,
      `Finalize Contract ${input.contractId}`,
    );
    plane = { ...plane, state: "inspecting", updatedAt: this.timestamp() };
    const verificationStartedAt = this.timestamp();
    await this.store.mutate((database) => {
      replaceById(database.shepherd.planes, plane);
      const persisted = database.shepherd.contracts.find(
        (item) => item.id === input.contractId,
      );
      if (!persisted) throw new Error("Execution Contract disappeared at ingestion");
      persisted.manifest = ingestion.manifest;
      persisted.updatedAt = verificationStartedAt;
      transitionContractAndRecord(database, input.contractId, "verifying", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: verificationStartedAt,
      });
    });

    if (!plane.headCommit) throw new Error("Contract Plane has no immutable commit");
    const evidence = this.sanitizeEvidence(
      await prepared.planeManager.withVerificationSnapshot(
        plane.headCommit,
        async (snapshot) =>
          await this.verifier.verify({
            targetType: "contract",
            targetId: input.contractId,
            planePath: snapshot.path,
            checks: contract.acceptance.checks,
            changedFiles: plane.changedFiles,
          }),
      ),
    );
    const verifiedAt = this.timestamp();
    if (!evidence.passed) {
      const failure: FailureInfo = {
        code: "failed_independent_acceptance",
        message: evidence.summary,
        stage: "contract_verification",
        at: verifiedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        transitionContractAndRecord(
          database,
          input.contractId,
          "verification_failed",
          {
            actor: "independent_verifier",
            eventActor: VERIFIER_ACTOR,
            timestamp: verifiedAt,
            failure,
          },
        );
      });
      throw new Error(`Contract ${input.contractId} failed independent verification`);
    }
    const verifiedTransport = verifiedAuthTransportFact(evidence);
    const claimsCorroborated =
      verifiedTransport !== null &&
      ingestion.claims.every(
        (claim) =>
          claim.key !== AUTH_CLAIM_KEY || claim.value === verifiedTransport,
      );
    if (!claimsCorroborated) {
      const failure: FailureInfo = {
        code: "invalid_semantic_evidence",
        message:
          "Independent verification did not corroborate the Agent-declared semantic claim",
        stage: "claim_corroboration",
        at: verifiedAt,
        retryable: false,
      };
      await this.store.mutate((database) => {
        transitionContractAndRecord(database, input.contractId, "claim_rejected", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: verifiedAt,
          failure,
        });
      });
      throw new Error(`Contract ${input.contractId} semantic claim was not corroborated`);
    }
    await this.store.mutate((database) => {
      for (const claim of ingestion.claims) replaceById(database.shepherd.claims, claim);
      this.recordEvent(database, {
        type: "claims_loaded",
        summary: "Loaded independently corroborated semantic claims",
        missionId: prepared.missionId,
        contractId: input.contractId,
        planeId: plane.id,
        timestamp: verifiedAt,
        details: { claimCount: ingestion.claims.length },
      });
      transitionContractAndRecord(database, input.contractId, "verified", {
        actor: "independent_verifier",
        eventActor: VERIFIER_ACTOR,
        timestamp: verifiedAt,
        verificationEvidence: evidence,
      });
      const persistedPlane = database.shepherd.planes.find(
        (item) => item.id === plane.id,
      );
      if (persistedPlane) {
        persistedPlane.state = "verified";
        persistedPlane.verificationEvidenceIds.push(evidence.id);
        persistedPlane.updatedAt = verifiedAt;
      }
      const persistedContract = database.shepherd.contracts.find(
        (item) => item.id === input.contractId,
      );
      const agent = database.agents.find(
        (item) => item.id === persistedContract?.agentId,
      );
      if (agent) {
        agent.status = "ready";
        agent.currentContractId = null;
        agent.updatedAt = verifiedAt;
      }
    });
  }

  private async integrateContracts(prepared: PreparedMission): Promise<Plane> {
    let integration = await prepared.planeManager.createIntegrationPlane({
      id: this.identifier("plane-integration"),
      projectId: prepared.project.projectId,
      missionId: prepared.missionId,
      baseCommit: prepared.project.headCommit,
      purpose: "Integrate independently verified Contract commits",
      executionIdentity: this.identifier("integration"),
      authority: authorityFor("resolution"),
    });
    await this.store.mutate((database) => {
      database.shepherd.planes.push(integration);
    });
    const contractPlanes = this.store
      .snapshot()
      .shepherd.planes.filter(
        (plane) => plane.missionId === prepared.missionId && plane.kind === "contract",
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    if (contractPlanes.length !== 2) {
      throw new Error("Integration requires exactly two verified Contract Planes");
    }
    for (const contractPlane of contractPlanes) {
      const merged = await prepared.planeManager.mergePlane(
        integration,
        contractPlane,
      );
      if (!merged.merged || merged.conflictFiles.length > 0) {
        throw new Error("Verified Contracts produced a textual Git conflict");
      }
      integration = merged.plane;
      await this.store.mutate((database) => {
        replaceById(database.shepherd.planes, integration);
      });
    }
    return integration;
  }

  private async detectAndPersistCollision(
    missionId: string,
    integrationPlane: Plane,
  ): Promise<SemanticCollision> {
    const snapshot = this.store.snapshot();
    const contracts = snapshot.shepherd.contracts
      .filter((contract) => contract.missionId === missionId)
      .map((contract) => ({
        ...contract,
        claims: snapshot.shepherd.claims.filter(
          (claim) => claim.contractId === contract.id,
        ),
      }));
    const detected = detectDeterministicCollisions(contracts, {
      dependencyEdges:
        snapshot.shepherd.missions.find((mission) => mission.id === missionId)
          ?.dependencyEdges ?? [],
      createdAt: this.timestamp(),
      collisionId: () => this.identifier("collision"),
    });
    if (detected.length !== 1) {
      throw new Error(
        `Expected one deterministic semantic collision, found ${detected.length}`,
      );
    }
    const collision = detected[0];
    if (!collision) throw new Error("Collision detector returned no record");
    const collisionAt = this.timestamp();
    await this.store.mutate((database) => {
      database.shepherd.collisions.push(collision);
      const mission = database.shepherd.missions.find(
        (item) => item.id === missionId,
      );
      if (!mission) throw new Error("Mission disappeared during collision detection");
      mission.collisionIds.push(collision.id);
      mission.resolutionIds.push(collision.id);
      const persistedIntegration = database.shepherd.planes.find(
        (item) => item.id === integrationPlane.id,
      );
      if (persistedIntegration) {
        persistedIntegration.state = "inspecting";
        persistedIntegration.updatedAt = collisionAt;
      }
      this.recordEvent(database, {
        type: "collision_detected",
        summary: collision.reason,
        missionId,
        planeId: integrationPlane.id,
        collisionId: collision.id,
        timestamp: collisionAt,
        details: {
          key: collision.key,
          scope: collision.scope,
          gitConflict: false,
        },
      });
      transitionMissionAndRecord(database, missionId, "collision", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: collisionAt,
      });
      transitionMissionAndRecord(database, missionId, "resolving", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp: collisionAt,
      });
      collision.state = "resolving";
      collision.updatedAt = collisionAt;
      replaceById(database.shepherd.collisions, collision);
    });
    return collision;
  }

  private async createCandidates(
    prepared: PreparedMission,
    collision: SemanticCollision,
    integrationCommit: string,
  ): Promise<CandidateWork[]> {
    const candidates: Array<{ value: AuthTransport; strategy: string }> = [
      { value: BEARER_TRANSPORT, strategy: "Unify on bearer JWT" },
      {
        value: COOKIE_TRANSPORT,
        strategy: "Unify on HttpOnly session cookie",
      },
    ];
    const works: CandidateWork[] = [];
    for (const input of candidates) {
      const candidateId = this.identifier("candidate");
      const plane = await prepared.planeManager.createResolutionPlane({
        id: this.identifier("plane-resolution"),
        projectId: prepared.project.projectId,
        missionId: prepared.missionId,
        candidateId,
        baseCommit: integrationCommit,
        purpose: input.strategy,
        executionIdentity: this.identifier("resolution-exec"),
        authority: authorityFor("resolution"),
      });
      const createdAt = this.timestamp();
      const candidate: ResolutionCandidate = {
        id: candidateId,
        missionId: prepared.missionId,
        collisionId: collision.id,
        strategy: input.strategy,
        targetKey: collision.key,
        targetValue: input.value,
        planeId: plane.id,
        executionState: "queued",
        selectionState: "pending",
        promotionState: "not_started",
        verificationEvidence: null,
        changedFiles: [],
        diffSummary: "",
        result: null,
        retryCount: 0,
        failure: null,
        createdAt,
        updatedAt: createdAt,
      };
      await this.store.mutate((database) => {
        database.shepherd.planes.push(plane);
        database.shepherd.candidates.push(candidate);
        const persistedCollision = database.shepherd.collisions.find(
          (item) => item.id === collision.id,
        );
        if (!persistedCollision) throw new Error("Collision disappeared");
        persistedCollision.candidateIds.push(candidate.id);
        persistedCollision.updatedAt = createdAt;
        this.recordEvent(database, {
          type: "candidate_created",
          summary: `Created resolution candidate: ${input.strategy}`,
          missionId: prepared.missionId,
          planeId: plane.id,
          collisionId: collision.id,
          candidateId,
          timestamp: createdAt,
          details: { targetValue: input.value, baseCommit: integrationCommit },
        });
      });
      works.push({
        candidateId,
        plane,
        operation: {
          kind: "resolution_candidate",
          candidateId,
          targetTransport: input.value,
        },
      });
    }
    return works;
  }

  private async executeCandidate(
    prepared: PreparedMission,
    work: CandidateWork,
  ): Promise<void> {
    const startedAt = this.timestamp();
    await this.store.mutate((database) => {
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === work.candidateId,
      );
      const plane = database.shepherd.planes.find((item) => item.id === work.plane.id);
      if (!candidate || !plane) throw new Error("Candidate records disappeared");
      candidate.executionState = "running";
      candidate.updatedAt = startedAt;
      plane.state = "running";
      plane.updatedAt = startedAt;
    });
    const executionWorkspace =
      await prepared.planeManager.createExecutionWorkspace(work.plane);
    try {
      await this.executor.run({
        executionId: work.plane.executionIdentity,
        workspacePath: executionWorkspace.path,
        operation: work.operation,
      });
      try {
        await prepared.planeManager.importExecutionWorkspace(
          work.plane,
          executionWorkspace,
        );
      } catch (error) {
        if (error instanceof PlaneAuthorityViolationError) {
          throw new AuthorityViolationError("candidate");
        }
        throw error;
      }
    } finally {
      await prepared.planeManager.destroyExecutionWorkspace(executionWorkspace);
    }
    const actualChanged = await prepared.planeManager.git.changedFilesSince(
      work.plane.baseCommit,
      work.plane.worktreePath,
    );
    const authority = validateChangedPaths(actualChanged, work.plane.authority);
    if (!authority.allowed || authority.manifestPaths.length > 0) {
      throw new AuthorityViolationError("candidate");
    }
    let plane = await prepared.planeManager.commitPlane(
      work.plane,
      `Finalize resolution candidate ${work.candidateId}`,
    );
    plane = { ...plane, state: "inspecting", updatedAt: this.timestamp() };
    await this.store.mutate((database) => {
      replaceById(database.shepherd.planes, plane);
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === work.candidateId,
      );
      if (!candidate) throw new Error("Candidate disappeared before verification");
      candidate.executionState = "verifying";
      candidate.changedFiles = [...plane.changedFiles];
      candidate.diffSummary = plane.diffSummary;
      candidate.updatedAt = this.timestamp();
    });
    if (!plane.headCommit) throw new Error("Candidate Plane has no immutable commit");
    const evidence = this.sanitizeEvidence(
      await prepared.planeManager.withVerificationSnapshot(
        plane.headCommit,
        async (snapshot) =>
          await this.verifier.verify({
            targetType: "candidate",
            targetId: work.candidateId,
            planePath: snapshot.path,
            checks: [frontendCheck(), backendCheck(), projectCheck()],
            changedFiles: plane.changedFiles,
          }),
      ),
    );
    const completedAt = this.timestamp();
    await this.store.mutate((database) => {
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === work.candidateId,
      );
      const persistedPlane = database.shepherd.planes.find(
        (item) => item.id === plane.id,
      );
      if (!candidate || !persistedPlane) throw new Error("Candidate records disappeared");
      candidate.executionState = evidence.passed ? "passed" : "failed";
      candidate.verificationEvidence = evidence;
      candidate.failure = evidence.passed
        ? null
        : {
            code: "failed_independent_acceptance",
            message: evidence.summary,
            stage: "candidate_verification",
            at: completedAt,
            retryable: false,
          };
      candidate.updatedAt = completedAt;
      persistedPlane.state = evidence.passed ? "verified" : "failed";
      persistedPlane.verificationEvidenceIds.push(evidence.id);
      persistedPlane.updatedAt = completedAt;
      this.recordEvent(database, {
        type: evidence.passed ? "candidate_passed" : "candidate_failed",
        summary: evidence.summary,
        missionId: prepared.missionId,
        planeId: plane.id,
        collisionId: candidate.collisionId,
        candidateId: candidate.id,
        actor: VERIFIER_ACTOR,
        timestamp: completedAt,
        details: { passed: evidence.passed },
      });
    });
  }

  private async persistCandidateInfrastructureFailure(
    work: CandidateWork,
    error: unknown,
  ): Promise<void> {
    const failedAt = this.timestamp();
    await this.store.mutate((database) => {
      const candidate = database.shepherd.candidates.find(
        (item) => item.id === work.candidateId,
      );
      const plane = database.shepherd.planes.find((item) => item.id === work.plane.id);
      if (!candidate || !plane || candidate.executionState === "failed") return;
      candidate.executionState = "failed";
      candidate.failure =
        error instanceof AuthorityViolationError
          ? {
              code: "unauthorized_file_change",
              message: "Actual Git changes exceeded the candidate's scoped authority",
              stage: "candidate_authority",
              at: failedAt,
              retryable: false,
            }
          : this.makeFailure(error, "candidate_execution", failedAt);
      candidate.updatedAt = failedAt;
      plane.state = "failed";
      plane.error = candidate.failure;
      plane.updatedAt = failedAt;
      this.recordEvent(database, {
        type: "candidate_failed",
        summary: candidate.failure.message,
        missionId: candidate.missionId,
        planeId: plane.id,
        collisionId: candidate.collisionId,
        candidateId: candidate.id,
        timestamp: failedAt,
      });
    });
  }

  private async persistAttentionRequired(
    missionId: string,
    collisionId: string,
    reason: string,
  ): Promise<void> {
    const timestamp = this.timestamp();
    await this.store.mutate((database) => {
      const collision = database.shepherd.collisions.find(
        (item) => item.id === collisionId,
      );
      if (collision) {
        collision.state = "attention_required";
        collision.updatedAt = timestamp;
      }
      transitionMissionAndRecord(database, missionId, "attention_required", {
        actor: "control_plane",
        eventActor: SHEPHERD_ACTOR,
        timestamp,
        attentionReason: reason,
      });
    });
  }

  private async promoteCandidate(
    prepared: PreparedMission,
    candidate: ResolutionCandidate,
    plane: Plane,
  ) {
    const startedAt = this.timestamp();
    await this.store.mutate((database) => {
      const persisted = database.shepherd.candidates.find(
        (item) => item.id === candidate.id,
      );
      if (!persisted) throw new Error("Selected candidate disappeared");
      persisted.promotionState = "reverifying";
      persisted.updatedAt = startedAt;
      this.recordEvent(database, {
        type: "promotion_started",
        summary: "Started final authority and independent verification gate",
        missionId: prepared.missionId,
        planeId: plane.id,
        collisionId: candidate.collisionId,
        candidateId: candidate.id,
        timestamp: startedAt,
      });
    });
    const gate = new PromotionGate(
      prepared.planeManager.git,
      {
        verify: async (request) =>
          this.sanitizeEvidence(await this.verifier.verify(request)),
      },
      async (input) => {
        const decision = validateChangedPaths(
          input.changedFiles,
          input.plane.authority,
        );
        return {
          allowed: decision.allowed && decision.manifestPaths.length === 0,
          reason: decision.allowed
            ? null
            : "Final candidate diff exceeds scoped authority",
        };
      },
      prepared.planeManager,
    );
    return await gate.promote({
      candidate,
      plane,
      protectedBranch: prepared.project.protectedBranch,
      expectedHead: prepared.project.headCommit,
      checks: [frontendCheck(), backendCheck(), projectCheck()],
      loadPersistedSelectedCandidateId: async () => {
        const selected = this.store
          .snapshot()
          .shepherd.candidates.filter(
            (item) =>
              item.collisionId === candidate.collisionId &&
              item.selectionState === "selected",
          );
        return selected.length === 1 ? (selected[0]?.id ?? null) : null;
      },
    });
  }

  private async recordMissionFailure(
    missionId: string,
    error: unknown,
    stage: string,
  ): Promise<void> {
    const failedAt = this.timestamp();
    await this.store.mutate((database) => {
      const mission = database.shepherd.missions.find(
        (item) => item.id === missionId,
      );
      if (
        !mission ||
        terminalMission(mission.state) ||
        mission.state === "attention_required"
      ) {
        return;
      }
      const failure = this.makeFailure(error, stage, failedAt);
      if (canTransitionMission(mission.state, "failed", "control_plane")) {
        transitionMissionAndRecord(database, missionId, "failed", {
          actor: "control_plane",
          eventActor: SHEPHERD_ACTOR,
          timestamp: failedAt,
          failure,
        });
      }
      const project = database.shepherd.projects.find(
        (item) => item.id === mission.projectId,
      );
      if (project?.activeMissionId === missionId) {
        project.activeMissionId = null;
        project.updatedAt = failedAt;
      }
    });
  }
}
