import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const pollingRuns = useRef(new Set<string>());
  const messageEnd = useRef<HTMLDivElement>(null);
  const { state: shepherdState } = useShepherdPolling(Boolean(agent?.currentContractId));

  const contract = useMemo(() => agent?.currentContractId
    ? shepherdState?.contracts.find((item) => item.id === agent.currentContractId) ?? null
    : null, [agent?.currentContractId, shepherdState?.contracts]);
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
  }, [messages, activeRun]);

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
    setPrompt("");
    setError(null);
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
  const composerDisabled = agent.status === "stopped" || agent.status === "busy" || runActive;

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
          <div><span className="eyebrow">Legacy Playground</span><h2>Build something with your Agent</h2></div>
          <span className="connection-status connected"><span />{agent.status === "stopped" ? "Agent stopped" : "Playground ready"}</span>
        </div>
        <div className="messages" aria-live="polite">
          {loading ? <LoadingPanel label="Loading conversation…" /> : null}
          {!loading && messages.length === 0 && !runActive ? (
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
            placeholder={agent.status === "stopped" ? "Start this Agent to continue…" : "Describe what you want the Agent to do…"}
            disabled={composerDisabled}
            rows={2}
            maxLength={50_000}
          />
          <div><span>Enter to send · Shift + Enter for newline · {system?.codexSandboxMode ?? "sandbox checking"}</span><button className="send-button" aria-label="Send message" disabled={!prompt.trim() || composerDisabled}><Icon name="send" /></button></div>
        </form>
      </section>
    </div>
  );
}
