import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { Link, navigate } from "../router";
import { useShepherdPolling } from "../shepherd-hooks";
import type { Agent, AgentRun, Message, SystemInfo } from "../types";
import { EmptyState, ErrorState, Icon, LoadingPanel, PageHeader, Spinner, StatePill, formatTime, shortId } from "../ui";

const starterPrompts = [
  "Inspect this workspace and explain what you would improve first.",
  "Build a focused TypeScript feature and add tests.",
  "Run the relevant checks and diagnose any failure.",
];

const activeStatuses = new Set(["queued", "running"]);

export function AgentPage({
  agent,
  system,
  onAgentsChanged,
}: {
  agent: Agent | null;
  system: SystemInfo | null;
  onAgentsChanged: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [shepherdMode, setShepherdMode] = useState(true);
  const [shepherdSubmitting, setShepherdSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const pollingRuns = useRef(new Set<string>());
  const messageEnd = useRef<HTMLDivElement>(null);
  const shepherdEligible = Boolean(agent);
  const {
    state: shepherdState,
    refresh: refreshShepherd,
  } = useShepherdPolling(Boolean(agent));

  const privateContractMessages = useMemo(() => {
    if (!agent) return [];
    return (shepherdState?.groupMessages ?? []).filter(
      (message) =>
        message.targetAgentId === agent.id && Boolean(message.contractAssignment),
    );
  }, [agent, shepherdState?.groupMessages]);
  const privateContractPrompt = privateContractMessages.at(-1) ?? null;

  const visibleContractId = agent?.currentContractId ?? privateContractPrompt?.contractId ?? null;
  const contract = useMemo(() => visibleContractId
    ? shepherdState?.contracts.find((item) => item.id === visibleContractId) ?? null
    : null, [visibleContractId, shepherdState?.contracts]);
  const visibleMission = privateContractPrompt?.missionId
    ? shepherdState?.missions.find((item) => item.id === privateContractPrompt.missionId) ?? null
    : null;
  const plane = contract?.planeId
    ? shepherdState?.planes.find((item) => item.id === contract.planeId) ?? null
    : null;

  const refreshMessages = useCallback(async (agentId: string) => {
    const result = await api.messages(agentId);
    if (mounted.current) setMessages(result.messages);
  }, []);

  const pollRun = useCallback(async (runId: string, agentId: string) => {
    if (pollingRuns.current.has(runId)) return;
    pollingRuns.current.add(runId);
    try {
      while (mounted.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        if (!mounted.current) return;
        const result = await api.run(runId);
        setActiveRun(result.run);
        if (!activeStatuses.has(result.run.status)) {
          await Promise.all([refreshMessages(agentId), onAgentsChanged()]);
          return;
        }
      }
    } finally {
      pollingRuns.current.delete(runId);
    }
  }, [onAgentsChanged, refreshMessages]);

  useEffect(() => {
    mounted.current = true;
    setShepherdMode(true);
    if (!agent) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void Promise.all([api.messages(agent.id), api.runs(agent.id)]).then(([messageResult, runResult]) => {
      if (!mounted.current) return;
      setMessages(messageResult.messages);
      const latest = runResult.runs[0] ?? null;
      setActiveRun(latest);
      if (latest && activeStatuses.has(latest.status)) void pollRun(latest.id, agent.id);
    }).catch((reason) => {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Playground unavailable");
    }).finally(() => {
      if (mounted.current) setLoading(false);
    });
    return () => { mounted.current = false; };
  }, [agent?.id, pollRun]);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages, activeRun, privateContractPrompt, contract?.state]);

  useEffect(() => {
    if (
      agent?.status === "busy" &&
      visibleMission &&
      ["completed", "failed", "cancelled", "attention_required"].includes(
        visibleMission.state,
      )
    ) {
      void onAgentsChanged();
    }
  }, [agent?.status, onAgentsChanged, visibleMission?.state]);

  const toggle = async () => {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      if (agent.status === "stopped") await api.startAgent(agent.id);
      else await api.stopAgent(agent.id);
      await onAgentsChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agent lifecycle action failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!agent || !window.confirm(`Delete ${agent.name}? Its workspace will be safely archived by the control plane.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAgent(agent.id);
      await onAgentsChanged();
      navigate("/agents");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agent could not be deleted");
    } finally {
      setBusy(false);
    }
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!agent || !prompt.trim()) return;
    const content = prompt.trim();
    setError(null);
    if (shepherdMode) {
      setShepherdSubmitting(true);
      try {
        await api.submitPrivateContractPrompt(agent.id, content);
        setPrompt("");
        await Promise.all([onAgentsChanged(), refreshShepherd()]);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Shepherd Contract could not be created");
        await onAgentsChanged();
      } finally {
        setShepherdSubmitting(false);
      }
      return;
    }
    setPrompt("");
    try {
      const result = await api.sendMessage(agent.id, content);
      if (!mounted.current) return;
      setMessages((current) => [...current, result.message]);
      setActiveRun(result.run);
      await onAgentsChanged();
      await pollRun(result.run.id, agent.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message could not be started");
      setActiveRun(null);
      await onAgentsChanged();
    }
  };

  if (loading && !agent) return <LoadingPanel label="Loading Agent…" />;
  if (!agent) return <ErrorState message="Agent not found." />;

  const runActive = Boolean(activeRun && activeStatuses.has(activeRun.status));
  const legacyComposerDisabled = agent.status === "stopped" || agent.status === "busy" || runActive;
  const awaitingAuthPeer =
    privateContractPrompt?.contractAssignment?.preset === "auth-demo-contract" &&
    privateContractPrompt.missionId === null;
  const generalContractActive =
    privateContractPrompt?.contractAssignment?.preset === "general-contract" &&
    privateContractPrompt.contractAssignment.status === "accepted" &&
    visibleMission !== null &&
    !["completed", "failed", "cancelled", "attention_required"].includes(visibleMission.state);
  const shepherdComposerDisabled =
    !shepherdEligible ||
    agent.status === "stopped" ||
    agent.status === "busy" ||
    awaitingAuthPeer ||
    generalContractActive ||
    shepherdSubmitting;
  const composerDisabled = shepherdMode
    ? shepherdComposerDisabled
    : legacyComposerDisabled;

  return (
    <div className="page agent-page">
      <PageHeader
        title={agent.name}
        description={agent.description || "A Codex coding Agent in an isolated persistent workspace."}
        status={<><StatePill value={agent.status} /><StatePill value={(agent.role ?? "Generalist").toLowerCase()} label={agent.role ?? "Generalist"} /></>}
        actions={
          <>
            <Link className="button button-ghost" href={`/agents/${encodeURIComponent(agent.id)}/edit`}><Icon name="edit" />Edit</Link>
            <button className="button button-ghost" onClick={() => void toggle()} disabled={busy}>
              <Icon name={agent.status === "stopped" ? "play" : "stop"} />
              {agent.status === "stopped" ? "Start" : "Stop"}
            </button>
            <button className="button button-danger" onClick={() => void remove()} disabled={busy || agent.status === "busy"}>Delete</button>
          </>
        }
      />
      {error ? <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)}>×</button></div> : null}
      <div className="agent-context-bar">
        <div><span className="eyebrow">Role</span><strong>{agent.role ?? "Generalist"}</strong></div>
        <div>
          <span className="eyebrow">Current contract</span>
          {agent.currentContractId ? <Link href="/shepherd">{shortId(agent.currentContractId, 16)} <StatePill value={contract?.state ?? "queued"} /></Link> : <strong>None</strong>}
        </div>
        <div>
          <span className="eyebrow">Plane</span>
          {plane ? <Link href={`/shepherd?plane=${encodeURIComponent(plane.id)}`}>{shortId(plane.id, 14)} <Icon name="arrow" /></Link> : <strong>Not assigned</strong>}
        </div>
      </div>

      <section className="playground" aria-label={`${agent.name} Playground`}>
        <div className="playground-topbar">
          <div><span className="eyebrow">{shepherdMode ? "Shepherd managed" : "Direct Playground"}</span><h2>Build something with your Agent</h2></div>
          <span className="connection-status connected"><span />{agent.status === "stopped" ? "Agent stopped" : shepherdMode ? "Shepherd route ready" : "Playground ready"}</span>
        </div>
        <div className="messages" aria-live="polite">
          {loading ? <LoadingPanel label="Loading conversation…" /> : null}
          {!loading && messages.length === 0 && !runActive && !privateContractPrompt ? (
            <EmptyState
              icon="activity"
              title={`What should ${agent.name} build?`}
              description="The Agent can inspect project files, write code, run checks, and continue across follow-up messages."
              action={
                <div className="prompt-grid">
                  {starterPrompts.map((item) => <button key={item} onClick={() => setPrompt(item)}><Icon name="arrow" />{item}</button>)}
                </div>
              }
            />
          ) : null}
          {messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              <header><strong>{message.role === "user" ? "You" : agent.name}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></header>
              <div>{message.content}</div>
            </article>
          ))}
          {privateContractMessages.map((message) => {
            const assignment = message.contractAssignment;
            if (!assignment) return null;
            const isLatest = message.id === privateContractPrompt?.id;
            const showsClarification =
              assignment.preset === "general-contract" &&
              assignment.status === "clarification_required";
            return (
              <Fragment key={message.id}>
                <article className="message message-user">
                  <header><strong>You · Shepherd Contract</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></header>
                  <div>{message.content}</div>
                </article>
                {isLatest || showsClarification ? (
                  <article className="message message-assistant shepherd-contract-status">
                    <header><strong>Shepherd</strong><span>{(showsClarification ? assignment.status : contract?.state ?? (assignment.preset === "general-contract" ? assignment.status : "collecting")).replaceAll("_", " ")}</span></header>
                    <div>
                      {showsClarification
                        ? <>Before I create the Execution Contract, please provide {assignment.missingFields.map((field) => field.replaceAll("_", " ")).join(", ")}. Include at least one writable project-relative file and an explicit <strong>Acceptance:</strong> statement.</>
                        : contract
                        ? <>Contract <Link href="/shepherd">{shortId(contract.id, 16)}</Link> is {contract.state.replaceAll("_", " ")}. Open Shepherd for its Plane, independent evidence, and protected promotion.</>
                        : assignment.preset === "auth-demo-contract"
                          ? <>Prompt captured and validated as <strong>{assignment.transport}</strong>. Prompt the {agent.role === "Frontend" ? "Backend" : "Frontend"} Agent in its private chat to start the Mission.</>
                          : <>The Contract draft is confirmed and queued for isolated execution.</>}
                    </div>
                  </article>
                ) : null}
              </Fragment>
            );
          })}
          {runActive ? (
            <article className="message message-assistant thinking">
              <header><strong>{agent.name}</strong><span>working</span></header>
              <div className="thinking-row"><Spinner />Codex is reading, editing, or running checks…</div>
            </article>
          ) : null}
          {activeRun?.status === "failed" ? <div className="run-error" role="alert"><strong>Run failed</strong><span>{activeRun.error ?? "The runtime stopped without a result."}</span></div> : null}
          <div ref={messageEnd} />
        </div>
        <form className="chat-composer" onSubmit={send}>
          <label htmlFor="agent-message" className="sr-only">Message {agent.name}</label>
          <textarea
            id="agent-message"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={agent.status === "stopped"
              ? "Start this Agent to continue…"
              : shepherdMode
                ? "Describe the change, project-relative files, and Acceptance: evidence…"
                : "Describe what you want the Agent to do…"}
            disabled={composerDisabled}
            rows={2}
            maxLength={shepherdMode ? 2_000 : 50_000}
          />
          <div>
            {shepherdEligible ? (
              <label className="contract-route-choice">
                <input
                  type="checkbox"
                  checked={shepherdMode}
                  onChange={(event) => setShepherdMode(event.target.checked)}
                  disabled={agent.status === "busy" || shepherdSubmitting}
                />
                <span>Route through Shepherd</span>
              </label>
            ) : null}
            <span>{shepherdMode ? "Creates a verified Contract · " : "Enter to send · "}Shift + Enter for newline · {system?.codexSandboxMode ?? "sandbox checking"}</span>
            <button className="send-button" aria-label={shepherdMode ? "Send Shepherd Contract" : "Send message"} disabled={!prompt.trim() || composerDisabled}>
              {shepherdSubmitting ? <Spinner label="Creating Contract" /> : <Icon name="send" />}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
