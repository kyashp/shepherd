import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { Link } from "../router";
import { useShepherdPolling } from "../shepherd-hooks";
import type { Agent, ProjectGroupMessage } from "../types";
import { EmptyState, ErrorState, Icon, LoadingPanel, PageHeader, Spinner, StatePill, formatTime, shortId } from "../ui";

function senderName(message: ProjectGroupMessage, agents: Agent[]): string {
  if (message.senderType === "human") return "You";
  if (message.senderType === "shepherd") return "Shepherd";
  return agents.find((agent) => agent.id === message.senderId)?.name ?? "Agent";
}

export function ProjectGroupPage({ agents }: { agents: Agent[] }) {
  const { state, loading, error: stateError, connected, refresh: refreshState } = useShepherdPolling();
  const project = state?.projects[0] ?? null;
  const [messages, setMessages] = useState<ProjectGroupMessage[]>([]);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const messageEnd = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  const refreshMessages = useCallback(async () => {
    if (!project || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await api.groupMessages(project.id);
      setMessages(result.messages);
      setMessageError(null);
    } catch (reason) {
      setMessageError(reason instanceof Error ? reason.message : "Project Group is unavailable");
    } finally {
      setMessagesLoading(false);
      inFlight.current = false;
    }
  }, [project]);

  useEffect(() => {
    if (!project) {
      setMessagesLoading(false);
      return;
    }
    setMessagesLoading(true);
    void refreshMessages();
    const interval = window.setInterval(() => void refreshMessages(), 1_100);
    return () => window.clearInterval(interval);
  }, [project, refreshMessages]);

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  const sortedMessages = useMemo(() => [...messages].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  ), [messages]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!project || !content.trim()) return;
    const nextContent = content.trim();
    setSending(true);
    setMessageError(null);
    try {
      await api.sendGroupMessage(project.id, {
        clientMessageId: crypto.randomUUID(),
        content: nextContent,
        ...(nextContent.startsWith("@") ? { assignmentPreset: "auth-demo-contract" as const } : {}),
      });
      setContent("");
      await Promise.all([refreshMessages(), refreshState()]);
    } catch (reason) {
      setMessageError(reason instanceof Error ? reason.message : "Message could not be routed");
    } finally {
      setSending(false);
    }
  };

  if (loading && !state) return <LoadingPanel label="Loading Project Group…" />;
  if (!state) return <ErrorState message={stateError ?? "Shepherd project state is unavailable."} onRetry={() => void refreshState()} />;

  return (
    <div className="page group-page">
      <PageHeader
        title="Project Group"
        description="Route work to Shepherd or target an Agent with an explicit mention."
        status={<><StatePill value="neutral" label={`${agents.length + 2} members`} /><span className={`connection-status ${connected && !messageError ? "connected" : "reconnecting"}`}><span />{connected && !messageError ? "Connected" : "Reconnecting"}</span></>}
      />
      <section className="group-chat-panel" aria-label="Project Group conversation">
        <div className="group-members" aria-label="Available mention targets">
          <span>Route directly:</span>
          {agents.map((agent) => (
            <button key={agent.id} onClick={() => setContent((current) => current || `@${agent.name} `)}>@{agent.name}</button>
          ))}
        </div>
        {messageError ? (
          <div className="reconnect-banner" role="status">{messageError} · retrying automatically</div>
        ) : null}
        <div className="group-messages" aria-live="polite">
          {messagesLoading && messages.length === 0 ? <LoadingPanel label="Loading real group messages…" /> : null}
          {!messagesLoading && sortedMessages.length === 0 ? (
            <EmptyState
              icon="group"
              title={project ? "The Project Group is quiet" : "No Shepherd project yet"}
              description={project ? "Unmentioned messages go to Shepherd. Start with @AgentName to create a targeted contract." : "Start a Mission in Shepherd to initialize the managed demo project and its group conversation."}
            />
          ) : null}
          {sortedMessages.map((message) => {
            const name = senderName(message, agents);
            return (
              <article className={`group-message group-message-${message.senderType}`} key={message.id}>
                <span className="message-avatar">{message.senderType === "shepherd" ? <Icon name="shepherd" /> : name.slice(0, 1).toUpperCase()}</span>
                <div>
                  <header><strong>{name}</strong><time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time></header>
                  <p>{message.content}</p>
                  {message.contractId ? (
                    <Link className="contract-link" href="/shepherd">
                      Contract {shortId(message.contractId, 14)} <Icon name="arrow" />
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
          <div ref={messageEnd} />
        </div>
        <form className="chat-composer" onSubmit={submit}>
          <label htmlFor="group-message" className="sr-only">Message Project Group</label>
          <textarea
            id="group-message"
            rows={2}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Message Project Group…"
            disabled={!project || sending}
            maxLength={2_000}
          />
          <div><span>Unmentioned → Shepherd · @AgentName → targeted contract</span><button className="send-button" aria-label="Send group message" disabled={!content.trim() || sending}>{sending ? <Spinner /> : <Icon name="send" />}</button></div>
        </form>
      </section>
    </div>
  );
}
