import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api";
import { navigate } from "../router";
import { useShepherdPolling } from "../shepherd-hooks";
import type {
  Agent,
  ExecutionContract,
  Mission,
  Plane,
  ResolutionCandidate,
  SemanticCollision,
  ShepherdEvent,
  ShepherdState,
  VerificationEvidence,
} from "../types";
import {
  EmptyState,
  ErrorState,
  Icon,
  LoadingPanel,
  PageHeader,
  Spinner,
  StatePill,
  formatDateTime,
  formatDuration,
  formatTime,
  shortId,
  stateTone,
  titleCase,
} from "../ui";

type EventFilter = "all" | "contracts" | "verification" | "collisions" | "resolution";
type CandidateEvidenceStage = "candidate" | "promotion";

const filterLabels: Array<{ id: EventFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "contracts", label: "Contracts" },
  { id: "verification", label: "Verification" },
  { id: "collisions", label: "Collisions" },
  { id: "resolution", label: "Resolution" },
];

const terminalMissionStates = new Set(["completed", "failed", "cancelled", "attention_required"]);
const blockedDetailKeys = /secret|token|prompt|session|workspace|worktree|execution.?identity|fingerprint/iu;
const timelineTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function matchesFilter(event: ShepherdEvent, filter: EventFilter): boolean {
  if (filter === "all") return true;
  if (filter === "contracts") return /contract|agent_completed|authority/u.test(event.type);
  if (filter === "verification") return /verification|claim/u.test(event.type);
  if (filter === "collisions") return /collision/u.test(event.type);
  return /resolution|candidate|tie|promotion/u.test(event.type);
}

export function EvidenceSummary({ evidence }: { evidence: VerificationEvidence }) {
  return (
    <div className="evidence-summary">
      <div className="evidence-head">
        <StatePill value={evidence.passed ? "passed" : "failed"} />
        <span>{formatDuration(evidence.durationMs)}</span>
      </div>
      <p>{evidence.summary}</p>
      <ul className="check-list">
        {evidence.checks.map((check) => (
          <li key={check.id}>
            <Icon name={check.passed ? "check" : "alert"} />
            <span>{check.name}</span>
            <StatePill value={check.status} />
            <small>{formatDuration(check.durationMs)}</small>
          </li>
        ))}
      </ul>
      {evidence.changedFiles.length > 0 ? (
        <div className="changed-files">
          <strong>{evidence.changedFiles.length} changed file{evidence.changedFiles.length === 1 ? "" : "s"}</strong>
          <span>{evidence.changedFiles.slice(0, 4).join(" · ")}</span>
        </div>
      ) : null}
    </div>
  );
}

export function ExecutionContractPanel({
  contract,
  agent,
}: {
  contract: ExecutionContract;
  agent: Agent | null;
}) {
  const timestamps = [
    ["Created", contract.createdAt],
    ["Updated", contract.updatedAt],
    ["Started", contract.startedAt],
    ["Agent completed", contract.agentCompletedAt],
    ["Verified", contract.verifiedAt],
    ["Completed", contract.completedAt],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return (
    <section className="contract-definition" aria-label="Agent execution contract">
      <div className="contract-definition-heading">
        <div><span className="eyebrow">Agent execution contract</span><strong>{contract.title}</strong></div>
        <StatePill value={contract.state} />
      </div>
      <dl className="event-details contract-core-details">
        <div><dt>Contract ID</dt><dd>{contract.id}</dd></div>
        <div><dt>Assigned Agent</dt><dd>{agent?.name ?? contract.agentId}</dd></div>
        <div><dt>Agent ID</dt><dd>{contract.agentId}</dd></div>
        <div><dt>Mission</dt><dd>{contract.missionId}</dd></div>
        <div><dt>Plane</dt><dd>{contract.planeId ?? "Assigned when execution starts"}</dd></div>
      </dl>
      <div className="contract-definition-section">
        <strong>Objective</strong>
        <p>{contract.objective}</p>
      </div>
      <div className="contract-definition-grid">
        <div>
          <strong>Dependencies</strong>
          <p>{contract.dependencyIds.length > 0 ? contract.dependencyIds.join(" · ") : "None — runnable in parallel"}</p>
        </div>
        <div>
          <strong>Semantic contract</strong>
          <p>Scopes: {contract.semanticScopes.join(" · ") || "None"}</p>
          <p>Exclusive claims: {contract.declaredClaimKeys.join(" · ") || "None"}</p>
        </div>
      </div>
      <div className="contract-definition-section">
        <strong>Contextual inputs</strong>
        {contract.contextualInputs.length > 0 ? (
          <ul className="contract-compact-list">
            {contract.contextualInputs.map((input) => (
              <li key={`${input.name}-${input.sourceContractId ?? "mission"}`}><span>{input.name}</span><code>{input.value}</code></li>
            ))}
          </ul>
        ) : <p>None</p>}
      </div>
      <div className="contract-definition-section">
        <strong>Scoped authority</strong>
        <dl className="contract-authority">
          <div><dt>Readable</dt><dd>{contract.authority.readable.join(" · ")}</dd></div>
          <div><dt>Writable</dt><dd>{contract.authority.writable.join(" · ")}</dd></div>
          <div><dt>Forbidden</dt><dd>{contract.authority.forbidden.join(" · ")}</dd></div>
        </dl>
      </div>
      <div className="contract-definition-section">
        <strong>Expected artifacts</strong>
        <ul className="contract-compact-list">
          {contract.expectedArtifacts.map((artifact) => (
            <li key={artifact.path}><code>{artifact.path}</code><span>{artifact.required ? "Required" : "Optional"} · {artifact.description}</span></li>
          ))}
        </ul>
      </div>
      <div className="contract-definition-section">
        <strong>Independent acceptance</strong>
        <ul className="contract-compact-list">
          {contract.acceptance.checks.map((check) => (
            <li key={check.id}><span>{check.name}</span><code>{check.profileId} · {check.mandatory ? "mandatory" : "optional"} · {formatDuration(check.timeoutMs)}</code></li>
          ))}
        </ul>
        <p>Result manifest: <code>{contract.resultManifestPath}</code></p>
        <p>Objective tie-breakers: {contract.acceptance.objectiveTieBreakers.join(" · ") || "None"}</p>
      </div>
      <dl className="event-details contract-timestamps">
        {timestamps.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatDateTime(value)}</dd></div>)}
      </dl>
    </section>
  );
}

export function eventEvidencePresentation(
  event: Pick<ShepherdEvent, "type">,
  contract: ExecutionContract | null,
  candidate: ResolutionCandidate | null,
): { evidence: VerificationEvidence; label: string } | null {
  if (contract?.verificationEvidence.at(-1)) {
    return {
      evidence: contract.verificationEvidence.at(-1)!,
      label: "Contract verification",
    };
  }
  if (!candidate) return null;
  if (event.type === "promotion_completed") {
    return candidate.promotionEvidence
      ? {
          evidence: candidate.promotionEvidence,
          label: "Final promotion re-verification",
        }
      : null;
  }
  if (event.type === "promotion_started") return null;
  return candidate.verificationEvidence
    ? { evidence: candidate.verificationEvidence, label: "Candidate verification" }
    : null;
}

export function candidateEvidenceStages(candidate: ResolutionCandidate | null) {
  if (!candidate) return [];
  return [
    candidate.verificationEvidence
      ? {
          id: "candidate" as const,
          label: "Candidate verification",
          evidence: candidate.verificationEvidence,
        }
      : null,
    candidate.promotionEvidence
      ? {
          id: "promotion" as const,
          label: "Final promotion re-verification",
          evidence: candidate.promotionEvidence,
        }
      : null,
  ].filter((stage): stage is NonNullable<typeof stage> => stage !== null);
}

export function CandidateEvidencePanel({
  candidate,
  planeId,
}: {
  candidate: ResolutionCandidate;
  planeId: string;
}) {
  const [evidenceStage, setEvidenceStage] = useState<CandidateEvidenceStage>("candidate");
  useEffect(() => setEvidenceStage("candidate"), [planeId]);
  const stages = candidateEvidenceStages(candidate);
  const selectedStage = stages.find((stage) => stage.id === evidenceStage) ?? stages[0];
  const selectStageFromKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % stages.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + stages.length) % stages.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = stages.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextStage = stages[nextIndex];
    if (!nextStage) return;
    setEvidenceStage(nextStage.id);
    requestAnimationFrame(() => document.getElementById(`evidence-tab-${nextStage.id}`)?.focus());
  };
  if (!selectedStage) return null;
  return (
    <section className="drawer-section" aria-labelledby="resolution-evidence-title">
      <h3 id="resolution-evidence-title">Resolution evidence</h3>
      {stages.length > 1 ? (
        <div className="filter-row evidence-stage-tabs" role="tablist" aria-label="Resolution evidence stage">
          {stages.map((stage, index) => {
            const selected = stage.id === selectedStage.id;
            return (
              <button
                key={stage.id}
                id={`evidence-tab-${stage.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="resolution-evidence-panel"
                tabIndex={selected ? 0 : -1}
                className={selected ? "active" : ""}
                onClick={() => setEvidenceStage(stage.id)}
                onKeyDown={(event) => selectStageFromKeyboard(event, index)}
              >
                {stage.label}
              </button>
            );
          })}
        </div>
      ) : (
        <strong className="evidence-stage-label">{selectedStage.label}</strong>
      )}
      <div
        id="resolution-evidence-panel"
        role={stages.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={stages.length > 1 ? `evidence-tab-${selectedStage.id}` : undefined}
      >
        <EvidenceSummary evidence={selectedStage.evidence} />
      </div>
    </section>
  );
}

function EventEvidence({
  event,
  state,
  agents,
}: {
  event: ShepherdEvent;
  state: ShepherdState;
  agents: Agent[];
}) {
  const contract = event.contractId
    ? state.contracts.find((item) => item.id === event.contractId) ?? null
    : null;
  const candidate = event.candidateId
    ? state.candidates.find((item) => item.id === event.candidateId) ?? null
    : null;
  const collision = event.collisionId
    ? state.collisions.find((item) => item.id === event.collisionId)
    : null;
  const evidencePresentation = eventEvidencePresentation(event, contract, candidate);
  const safeDetails = Object.entries(event.details).filter(([key]) => !blockedDetailKeys.test(key));
  if (!contract && !evidencePresentation && !collision && safeDetails.length === 0 && !candidate?.failure) {
    return null;
  }
  return (
    <details className="event-evidence">
      <summary>View evidence</summary>
      {contract ? (
        <ExecutionContractPanel
          contract={contract}
          agent={agents.find((item) => item.id === contract.agentId) ?? null}
        />
      ) : null}
      {evidencePresentation ? (
        <section aria-label={evidencePresentation.label}>
          <strong className="evidence-stage-label">{evidencePresentation.label}</strong>
          <EvidenceSummary evidence={evidencePresentation.evidence} />
        </section>
      ) : null}
      {collision ? (
        <div className="claim-compare">
          <div><span>Left</span><strong>{collision.leftClaim.value}</strong></div>
          <span aria-hidden="true">≠</span>
          <div><span>Right</span><strong>{collision.rightClaim.value}</strong></div>
        </div>
      ) : null}
      {contract?.failure || candidate?.failure ? (
        <p className="failure-copy">{contract?.failure?.message ?? candidate?.failure?.message}</p>
      ) : null}
      {safeDetails.length > 0 ? (
        <dl className="event-details">
          {safeDetails.slice(0, 12).map(([key, value]) => (
            <div key={key}>
              <dt>{titleCase(key)}</dt>
              <dd title={String(value ?? "—")}>{String(value ?? "—").slice(0, 180)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </details>
  );
}

function ContractStream({
  state,
  agents,
  events,
  mission,
  filter,
  setFilter,
}: {
  state: ShepherdState;
  agents: Agent[];
  events: ShepherdEvent[];
  mission: Mission | null;
  filter: EventFilter;
  setFilter: (filter: EventFilter) => void;
}) {
  const visibleEvents = events.filter((event) =>
    (!mission || event.missionId === mission.id) && matchesFilter(event, filter),
  );
  return (
    <section className="kernel-panel contract-stream" aria-labelledby="contract-stream-title">
      <div className="panel-heading split-heading">
        <div>
          <span className="eyebrow">Execution contract logs</span>
          <h2 id="contract-stream-title">Contract stream</h2>
        </div>
        <span className="stream-count" aria-label={`${visibleEvents.length} events`}>{visibleEvents.length}</span>
      </div>
      <div className="filter-row" aria-label="Filter execution events">
        {filterLabels.map((item) => (
          <button
            key={item.id}
            className={filter === item.id ? "active" : ""}
            onClick={() => setFilter(item.id)}
            aria-pressed={filter === item.id}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="event-list" aria-live="polite">
        {visibleEvents.length === 0 ? (
          <EmptyState
            icon="activity"
            title={mission ? "No matching events" : "No Mission yet"}
            description={mission ? "Change the filter or wait for the next kernel transition." : "Describe a Mission below to create real Execution Contracts."}
          />
        ) : visibleEvents.map((event) => (
          <article className={`event-card event-${stateTone(event.type)}`} key={event.id}>
            <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
            <span className="event-node" />
            <div className="event-copy">
              <div className="event-title">
                <strong>{event.summary}</strong>
                <StatePill value={event.type} label={titleCase(event.type).replace("Mission ", "")} />
              </div>
              <p>
                {event.actor.displayName}
                {event.contractId ? ` · ${shortId(event.contractId, 13)}` : ""}
              </p>
              <EventEvidence event={event} state={state} agents={agents} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function timelineBounds(mission: Mission, contracts: ExecutionContract[], candidates: ResolutionCandidate[]) {
  const starts = [mission.startedAt, mission.createdAt, ...contracts.map((item) => item.startedAt ?? item.createdAt), ...candidates.map((item) => item.createdAt)]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const ends = [mission.completedAt, mission.updatedAt, ...contracts.map((item) => item.completedAt ?? item.verifiedAt ?? item.updatedAt), ...candidates.map((item) => item.updatedAt)]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const min = Math.min(...starts);
  const rawMax = terminalMissionStates.has(mission.state) ? Math.max(...ends) : Math.max(Date.now(), ...ends);
  const max = Math.max(min + 60_000, rawMax);
  return { min, max };
}

function barPosition(start: string, end: string, min: number, max: number) {
  const span = Math.max(1, max - min);
  const left = Math.max(0, Math.min(98, ((new Date(start).getTime() - min) / span) * 100));
  const right = Math.max(left + 2, Math.min(100, ((new Date(end).getTime() - min) / span) * 100));
  return { left: `${left}%`, width: `${Math.max(2, right - left)}%` };
}

function Timeline({
  mission,
  contracts,
  candidates,
  agents,
  collisions,
}: {
  mission: Mission | null;
  contracts: ExecutionContract[];
  candidates: ResolutionCandidate[];
  agents: Agent[];
  collisions: SemanticCollision[];
}) {
  if (!mission) {
    return (
      <section className="kernel-panel timeline-panel">
        <div className="panel-heading"><span className="eyebrow">Task view</span><h2>Live execution timeline</h2></div>
        <EmptyState icon="activity" title="Timeline waiting" description="Contract timing appears when a Mission starts." />
      </section>
    );
  }
  const { min, max } = timelineBounds(mission, contracts, candidates);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + (max - min) * ratio);
  return (
    <section className="kernel-panel timeline-panel" aria-labelledby="timeline-title">
      <div className="panel-heading split-heading">
        <div><span className="eyebrow">Task view</span><h2 id="timeline-title">Live execution timeline</h2></div>
        <StatePill value={mission.state} />
      </div>
      <div className="timeline-scroll">
        <div className="timeline-axis">
          <span />
          <div>{ticks.map((tick) => <time key={tick}>{timelineTimeFormatter.format(tick)}</time>)}</div>
        </div>
        <div className="timeline-rows">
          {contracts.map((contract) => {
            const start = contract.startedAt ?? contract.createdAt;
            const end = contract.completedAt ?? contract.verifiedAt ?? contract.updatedAt;
            const agent = agents.find((item) => item.id === contract.agentId);
            const position = barPosition(start, end, min, max);
            const estimate = contract.estimatedDurationMs && contract.startedAt
              ? barPosition(contract.startedAt, new Date(new Date(contract.startedAt).getTime() + contract.estimatedDurationMs).toISOString(), min, max)
              : null;
            return (
              <div className="timeline-row" key={contract.id}>
                <div className="timeline-label" title={contract.title}>
                  <strong>{agent?.name ?? "Agent"}</strong>
                  <span>{shortId(contract.id, 12)}</span>
                </div>
                <div className="timeline-track">
                  {estimate ? <span className="estimate-bar" style={estimate}><small>est.</small></span> : null}
                  <span className={`timeline-bar tone-${stateTone(contract.state)}`} style={position} title={`${contract.title}: ${titleCase(contract.state)}`}>
                    <span>{contract.title}</span>
                  </span>
                  {collisions.map((collision) => {
                    const marker = barPosition(collision.createdAt, collision.createdAt, min, max);
                    return <span className="collision-marker" style={{ left: marker.left }} title={`Collision: ${collision.key}`} key={collision.id} />;
                  })}
                </div>
              </div>
            );
          })}
          {candidates.map((candidate) => (
            <div className="timeline-row resolution-row" key={candidate.id}>
              <div className="timeline-label" title={`${candidate.targetValue} · ${candidate.strategy}`}>
                <strong>Resolution</strong><span>{candidate.targetValue}</span>
              </div>
              <div className="timeline-track">
                <span
                  className={`timeline-bar tone-${stateTone(candidate.executionState)}`}
                  style={barPosition(candidate.createdAt, candidate.updatedAt, min, max)}
                  title={candidate.strategy}
                >
                  <span>{candidate.targetValue}</span>
                </span>
              </div>
            </div>
          ))}
          {contracts.length === 0 && candidates.length === 0 ? (
            <div className="compact-empty">Contracts are being planned.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PlaneDetailDrawer({
  planeId,
  state,
  agents,
  onClose,
}: {
  planeId: string;
  state: ShepherdState;
  agents: Agent[];
  onClose: () => void;
}) {
  const [plane, setPlane] = useState<Plane | null>(() => state.planes.find((item) => item.id === planeId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    void api.plane(planeId).then(({ plane: next }) => {
      if (active) setPlane(next);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Plane detail unavailable");
    });
    return () => { active = false; };
  }, [planeId]);
  useEffect(() => closeButtonRef.current?.focus(), [planeId]);
  const contract = plane?.contractId ? state.contracts.find((item) => item.id === plane.contractId) : null;
  const candidate = plane?.candidateId ? state.candidates.find((item) => item.id === plane.candidateId) : null;
  const agent = contract ? agents.find((item) => item.id === contract.agentId) : null;
  return (
    <aside
      className="detail-drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="plane-detail-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="drawer-heading">
        <div><span className="eyebrow">Plane detail</span><h2 id="plane-detail-title">{plane?.purpose ?? shortId(planeId, 18)}</h2></div>
        <button ref={closeButtonRef} onClick={onClose} aria-label="Close Plane detail">×</button>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {!plane ? <LoadingPanel label="Loading Plane evidence…" /> : (
        <>
          <div className="drawer-status"><StatePill value={plane.state} /><StatePill value={plane.kind} /></div>
          <dl className="detail-list">
            <div><dt>Branch</dt><dd title={plane.branch}>{plane.branch}</dd></div>
            <div><dt>Base commit</dt><dd title={plane.baseCommit}>{shortId(plane.baseCommit)}</dd></div>
            <div><dt>Head commit</dt><dd title={plane.headCommit ?? "Not committed"}>{shortId(plane.headCommit)}</dd></div>
            <div><dt>Assigned</dt><dd>{agent?.name ?? (candidate ? "Resolution strategy" : "Shepherd kernel")}</dd></div>
            {candidate ? <div><dt>Strategy</dt><dd>{candidate.strategy}</dd></div> : null}
            <div><dt>Changed files</dt><dd>{plane.changedFiles.length}</dd></div>
          </dl>
          <section className="drawer-section">
            <h3>Diff summary</h3>
            <p>{plane.diffSummary || "No persisted diff summary."}</p>
          </section>
          {plane.changedFiles.length > 0 ? (
            <section className="drawer-section">
              <h3>Project files</h3>
              <ul className="path-list">{plane.changedFiles.map((file) => <li key={file}>{file}</li>)}</ul>
            </section>
          ) : null}
          {contract?.verificationEvidence.at(-1) ? <EvidenceSummary evidence={contract.verificationEvidence.at(-1)!} /> : null}
          {candidate ? <CandidateEvidencePanel candidate={candidate} planeId={planeId} /> : null}
          {candidate && candidate.retryCount > 0 ? (
            <section className="drawer-section retry-evidence">
              <h3>Retry evidence</h3>
              <p>This candidate used its single bounded retry.</p>
              {candidate.previousAttempts?.map((attempt, index) => (
                <button key={attempt.planeId} onClick={() => navigate(`/shepherd?plane=${encodeURIComponent(attempt.planeId)}`)}>
                  Attempt {index + 1} · {titleCase(attempt.executionState)} · {attempt.diffSummary || attempt.failure.message}
                </button>
              ))}
            </section>
          ) : null}
        </>
      )}
    </aside>
  );
}

function PlaneTree({
  mission,
  project,
  state,
  agents,
  requestedPlaneId,
}: {
  mission: Mission | null;
  project: ShepherdState["projects"][number] | null;
  state: ShepherdState;
  agents: Agent[];
  requestedPlaneId: string | null;
}) {
  const [selectedPlaneId, setSelectedPlaneId] = useState<string | null>(requestedPlaneId);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => setSelectedPlaneId(requestedPlaneId), [requestedPlaneId]);
  const planes = mission ? state.planes.filter((plane) => plane.missionId === mission.id) : [];
  const contractPlanes = planes.filter((plane) => plane.kind === "contract");
  const integrationPlanes = planes.filter((plane) => plane.kind === "integration");
  const resolutionPlanes = planes.filter((plane) => plane.kind === "resolution");
  const collisions = mission ? state.collisions.filter((item) => item.missionId === mission.id) : [];

  const planeButton = (plane: Plane, depth: number) => {
    const contract = plane.contractId ? state.contracts.find((item) => item.id === plane.contractId) : null;
    const candidate = plane.candidateId ? state.candidates.find((item) => item.id === plane.candidateId) : null;
    const agent = contract ? agents.find((item) => item.id === contract.agentId) : null;
    return (
      <button
        className="tree-node"
        style={{ "--tree-depth": depth } as React.CSSProperties}
        key={plane.id}
        onClick={(event) => {
          openerRef.current = event.currentTarget;
          setSelectedPlaneId(plane.id);
        }}
        title={plane.purpose}
      >
        <span className="tree-connector" />
        <Icon name="plane" />
        <span className="tree-copy">
          <strong>{agent?.name ?? (candidate ? candidate.targetValue : titleCase(plane.kind))}</strong>
          <small title={plane.id}>{shortId(plane.id, 14)}</small>
        </span>
        <StatePill value={candidate?.selectionState === "selected" ? "selected" : plane.state} />
      </button>
    );
  };

  return (
    <section className="kernel-panel plane-panel" aria-labelledby="plane-tree-title">
      <div className="panel-heading split-heading">
        <div><span className="eyebrow">Work tree (Planes)</span><h2 id="plane-tree-title">Plane tree</h2></div>
        <span className="stream-count">{planes.length}</span>
      </div>
      {!mission || !project ? (
        <EmptyState icon="plane" title="No Planes yet" description="Isolated Planes appear after contracts are admitted." />
      ) : (
        <div className="plane-tree">
          <div className="tree-root">
            <span className="main-branch-dot" />
            <div><strong>{project.protectedBranch}</strong><small>{shortId(project.protectedHeadCommit)}</small></div>
            <StatePill value={mission.state === "completed" ? "promoted" : "protected"} />
          </div>
          {contractPlanes.map((plane) => planeButton(plane, 1))}
          {integrationPlanes.map((plane) => planeButton(plane, 1))}
          {collisions.map((collision) => (
            <details className="tree-collision" key={collision.id}>
              <summary>
                <Icon name="alert" />
                <span><strong>{collision.key}</strong><small>{collision.leftClaim.value} ≠ {collision.rightClaim.value}</small></span>
                <StatePill value={collision.state} />
              </summary>
              <p>{collision.reason} The competing Resolution Planes below fork from the same integration commit and must independently pass the project invariant.</p>
            </details>
          ))}
          {resolutionPlanes.map((plane) => planeButton(plane, 2))}
        </div>
      )}
      {selectedPlaneId ? (
        <PlaneDetailDrawer
          planeId={selectedPlaneId}
          state={state}
          agents={agents}
          onClose={() => {
            setSelectedPlaneId(null);
            if (window.location.search) navigate("/shepherd", true);
            requestAnimationFrame(() => openerRef.current?.focus());
          }}
        />
      ) : null}
    </section>
  );
}

function AttentionControls({
  state,
  mission,
  onChanged,
}: {
  state: ShepherdState;
  mission: Mission;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const collisions = state.collisions.filter((item) => item.missionId === mission.id);
  const ticketId = collisions[0]?.id ?? mission.id;
  const tied = state.candidates.filter((candidate) =>
    candidate.missionId === mission.id && candidate.selectionState === "tied" && candidate.executionState === "passed",
  );
  const failedContract = state.contracts.find(
    (contract) => contract.missionId === mission.id && contract.failure !== null,
  );
  const causalFailure = failedContract?.failure ?? mission.failure;
  const missionFailed = mission.state === "failed";
  const unauthorized = causalFailure?.code === "unauthorized_file_change";
  const promotionStarted = state.events.some(
    (event) => event.missionId === mission.id && event.type === "promotion_started",
  );
  if (tied.length === 0 && mission.state !== "attention_required" && !missionFailed) return null;
  const select = async (candidate: ResolutionCandidate) => {
    if (!window.confirm(`Select the verified future “${candidate.targetValue}” for trusted promotion?`)) return;
    setBusyId(candidate.id);
    setError(null);
    try {
      await api.selectCandidate(candidate.collisionId, candidate.id);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Selection failed");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <section className="attention-panel" aria-labelledby="attention-title">
      <Icon name="alert" />
      <div>
        <span className="eyebrow">{missionFailed ? "Shepherd safety stop" : "Internal human-review ticket"}</span>
        <h2 id="attention-title">
          {tied.length > 0
            ? "Verified candidates are objectively tied"
            : unauthorized
              ? "Unauthorized changes denied"
              : missionFailed
                ? "Mission stopped without promotion"
                : "Mission needs attention"}
        </h2>
        <span className="attention-ticket-ref">Reference {ticketId} · durable {mission.state}</span>
        <p>{mission.attentionReason ?? causalFailure?.message ?? "Inspect the preserved evidence before deciding what happens next."}</p>
        {error ? <div className="field-error" role="alert">{error}</div> : null}
        {tied.length > 0 ? (
          <div className="tie-options">
            {tied.map((candidate) => (
              <div key={candidate.id}>
                <strong>{candidate.targetValue}</strong>
                <p>{candidate.strategy}</p>
                <span>{candidate.verificationEvidence?.summary}</span>
                <button className="button button-primary" disabled={busyId !== null} onClick={() => void select(candidate)}>
                  {busyId === candidate.id ? <Spinner /> : "Select verified future"}
                </button>
              </div>
            ))}
          </div>
        ) : missionFailed && causalFailure ? (
          <div className="collision-links" aria-label="Mission failure evidence">
            <span>{titleCase(causalFailure.code)}</span>
            <span>{titleCase(causalFailure.stage)}</span>
            {failedContract ? <span title={failedContract.id}>{shortId(failedContract.id, 16)} · {titleCase(failedContract.state)}</span> : null}
            <span>{promotionStarted ? "Protected promotion stopped" : "Protected promotion not started"}</span>
          </div>
        ) : (
          <div className="collision-links">
            {collisions.map((collision) => <span key={collision.id}>{collision.key} · {titleCase(collision.state)}</span>)}
          </div>
        )}
      </div>
    </section>
  );
}

export function ShepherdPage({ agents, search }: { agents: Agent[]; search: string }) {
  const { state, events, error, loading, lastUpdated, connected, refresh } = useShepherdPolling();
  const [filter, setFilter] = useState<EventFilter>("all");
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const requestedPlaneId = new URLSearchParams(search).get("plane");

  const sortedMissions = useMemo(() => [...(state?.missions ?? [])].sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  ), [state?.missions]);
  const mission = sortedMissions.find((item) => item.id === selectedMissionId) ?? sortedMissions[0] ?? null;
  const project = mission && state ? state.projects.find((item) => item.id === mission.projectId) ?? null : state?.projects[0] ?? null;
  const contracts = mission && state ? state.contracts.filter((item) => item.missionId === mission.id) : [];
  const candidates = mission && state ? state.candidates.filter((item) => item.missionId === mission.id) : [];
  const collisions = mission && state ? state.collisions.filter((item) => item.missionId === mission.id) : [];

  const submitMission = async (event: FormEvent) => {
    event.preventDefault();
    if (!intent.trim()) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const result = await api.sendShepherdMessage(
        intent.trim(),
      );
      setSelectedMissionId(result.missionId);
      setIntent("");
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Mission could not be created");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!mission || !window.confirm("Cancel this Mission? Running work will stop and evidence will be preserved.")) return;
    setCancelling(true);
    setActionError(null);
    try {
      await api.cancelMission(mission.id);
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Mission cancellation failed");
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !state) return <LoadingPanel label="Connecting to the Shepherd kernel…" />;
  if (!state) return <ErrorState message={error ?? "Shepherd state is unavailable."} onRetry={() => void refresh()} />;

  return (
    <div className="page shepherd-page">
      <PageHeader
        title="Shepherd"
        description="Coordinate verified Agent work through contracts, isolated Planes, and trusted promotion."
        status={<span className={`connection-status ${connected ? "connected" : "reconnecting"}`}><span />{connected ? "Kernel online" : "Reconnecting"}</span>}
        actions={
          <>
            {sortedMissions.length > 1 ? (
              <label className="compact-select">
                <span className="sr-only">Mission</span>
                <select value={mission?.id ?? ""} onChange={(event) => setSelectedMissionId(event.target.value)}>
                  {sortedMissions.map((item) => <option value={item.id} key={item.id}>{shortId(item.id, 15)} · {titleCase(item.state)}</option>)}
                </select>
              </label>
            ) : null}
            {mission && !terminalMissionStates.has(mission.state) ? (
              <button className="button button-danger" disabled={cancelling} onClick={() => void cancel()}>
                {cancelling ? <Spinner /> : "Cancel Mission"}
              </button>
            ) : null}
          </>
        }
      />
      {error && state ? (
        <div className="reconnect-banner" role="status">Showing the last confirmed state · reconnecting automatically</div>
      ) : null}
      {actionError ? <div className="error-banner" role="alert"><span>{actionError}</span><button onClick={() => setActionError(null)}>×</button></div> : null}
      {mission ? <AttentionControls state={state} mission={mission} onChanged={() => void refresh()} /> : null}

      <div className="shepherd-grid">
        <ContractStream state={state} agents={agents} events={events} mission={mission} filter={filter} setFilter={setFilter} />
        <div className="kernel-right-column">
          <Timeline mission={mission} contracts={contracts} candidates={candidates} agents={agents} collisions={collisions} />
          <PlaneTree mission={mission} project={project} state={state} agents={agents} requestedPlaneId={requestedPlaneId} />
        </div>
      </div>

      <form className="kernel-composer" onSubmit={submitMission}>
        <p className="mission-chat-guidance">
          Primary demo: open each Frontend and Backend Agent chat and enable <strong>Route through Shepherd</strong>. This composer remains the managed-Agent fallback.
        </p>
        <label htmlFor="shepherd-intent" className="sr-only">Message Shepherd</label>
        <textarea
          id="shepherd-intent"
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Describe a Mission for Shepherd…"
          rows={1}
          maxLength={2_000}
          disabled={submitting || Boolean(project?.activeMissionId && mission && !terminalMissionStates.has(mission.state))}
        />
        <div>
          <span>
            {project?.activeMissionId && mission && !terminalMissionStates.has(mission.state)
              ? "One mutating Mission at a time · cancel or wait before starting another"
              : `Enter to send · polled about every second${lastUpdated ? ` · updated ${formatTime(lastUpdated.toISOString())}` : ""}`}
          </span>
          <button className="send-button" aria-label="Send Mission" disabled={!intent.trim() || submitting || Boolean(project?.activeMissionId && mission && !terminalMissionStates.has(mission.state))}>
            {submitting ? <Spinner label="Creating Mission" /> : <Icon name="send" />}
          </button>
        </div>
      </form>
    </div>
  );
}
