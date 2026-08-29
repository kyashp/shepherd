import { useEffect, useMemo, useState, type FormEvent } from "react";
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

const filterLabels: Array<{ id: EventFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "contracts", label: "Contracts" },
  { id: "verification", label: "Verification" },
  { id: "collisions", label: "Collisions" },
  { id: "resolution", label: "Resolution" },
];

const terminalMissionStates = new Set(["completed", "failed", "cancelled", "attention_required"]);
const blockedDetailKeys = /secret|token|prompt|session|workspace|worktree|execution.?identity|fingerprint/iu;

function matchesFilter(event: ShepherdEvent, filter: EventFilter): boolean {
  if (filter === "all") return true;
  if (filter === "contracts") return /contract|agent_completed|authority/u.test(event.type);
  if (filter === "verification") return /verification|claim|model_review/u.test(event.type);
  if (filter === "collisions") return /collision/u.test(event.type);
  return /resolution|candidate|tie|promotion/u.test(event.type);
}

function EvidenceSummary({ evidence }: { evidence: VerificationEvidence }) {
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

function EventEvidence({
  event,
  state,
}: {
  event: ShepherdEvent;
  state: ShepherdState;
}) {
  const contract = event.contractId
    ? state.contracts.find((item) => item.id === event.contractId)
    : null;
  const candidate = event.candidateId
    ? state.candidates.find((item) => item.id === event.candidateId)
    : null;
  const collision = event.collisionId
    ? state.collisions.find((item) => item.id === event.collisionId)
    : null;
  const evidence = contract?.verificationEvidence.at(-1) ?? candidate?.verificationEvidence ?? null;
  const safeDetails = Object.entries(event.details).filter(([key]) => !blockedDetailKeys.test(key));
  if (!evidence && !collision && safeDetails.length === 0 && !contract?.failure && !candidate?.failure) {
    return null;
  }
  return (
    <details className="event-evidence">
      <summary>View evidence</summary>
      {evidence ? <EvidenceSummary evidence={evidence} /> : null}
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
  events,
  mission,
  filter,
  setFilter,
}: {
  state: ShepherdState;
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
              <EventEvidence event={event} state={state} />
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
          <div>{ticks.map((tick) => <time key={tick}>{formatTime(new Date(tick).toISOString())}</time>)}</div>
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
              <div className="timeline-label"><strong>Resolution</strong><span>{shortId(candidate.id, 12)}</span></div>
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
  useEffect(() => {
    let active = true;
    void api.plane(planeId).then(({ plane: next }) => {
      if (active) setPlane(next);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Plane detail unavailable");
    });
    return () => { active = false; };
  }, [planeId]);
  const contract = plane?.contractId ? state.contracts.find((item) => item.id === plane.contractId) : null;
  const candidate = plane?.candidateId ? state.candidates.find((item) => item.id === plane.candidateId) : null;
  const agent = contract ? agents.find((item) => item.id === contract.agentId) : null;
  return (
    <aside className="detail-drawer" role="dialog" aria-modal="false" aria-labelledby="plane-detail-title">
      <div className="drawer-heading">
        <div><span className="eyebrow">Plane detail</span><h2 id="plane-detail-title">{plane?.purpose ?? shortId(planeId, 18)}</h2></div>
        <button onClick={onClose} aria-label="Close Plane detail">×</button>
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
          {candidate?.verificationEvidence ? <EvidenceSummary evidence={candidate.verificationEvidence} /> : null}
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
        onClick={() => setSelectedPlaneId(plane.id)}
        title={plane.purpose}
      >
        <span className="tree-connector" />
        <Icon name="plane" />
        <span className="tree-copy">
          <strong>{agent?.name ?? (candidate ? candidate.targetValue : titleCase(plane.kind))}</strong>
          <small>{shortId(plane.id, 14)}</small>
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
              <p>{collision.reason}</p>
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
  const tied = state.candidates.filter((candidate) =>
    candidate.missionId === mission.id && candidate.selectionState === "tied" && candidate.executionState === "passed",
  );
  if (tied.length === 0 && mission.state !== "attention_required") return null;
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
        <span className="eyebrow">Human decision required</span>
        <h2 id="attention-title">{tied.length > 0 ? "Verified candidates are objectively tied" : "Mission needs attention"}</h2>
        <p>{mission.attentionReason ?? mission.failure?.message ?? "Inspect the preserved evidence before deciding what happens next."}</p>
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
      const result = await api.sendShepherdMessage(intent.trim());
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
        <ContractStream state={state} events={events} mission={mission} filter={filter} setFilter={setFilter} />
        <div className="kernel-right-column">
          <Timeline mission={mission} contracts={contracts} candidates={candidates} agents={agents} collisions={collisions} />
          <PlaneTree mission={mission} project={project} state={state} agents={agents} requestedPlaneId={requestedPlaneId} />
        </div>
      </div>

      <form className="kernel-composer" onSubmit={submitMission}>
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
          rows={2}
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
