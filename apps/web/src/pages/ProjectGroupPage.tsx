import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { api } from "../api";
import { Link } from "../router";
import { useShepherdPolling } from "../shepherd-hooks";
import type { Agent, ProjectGroupMessage } from "../types";
import { EmptyState, ErrorState, Icon, LoadingPanel, PageHeader, Spinner, StatePill, formatTime, shortId } from "../ui";
import {
  MAX_PROJECT_GROUP_MESSAGE_LENGTH,
  findProjectGroupMentionCandidates,
  prependProjectGroupMentionWithinLimit,
  replaceProjectGroupMentionQuery,
  type ProjectGroupMentionTarget,
} from "./project-group-mention";

const MENTION_SUGGESTIONS_ID = "group-message-mention-suggestions";
const SCROLL_PINNED_TOLERANCE = 24;

function isPinnedToMessageEnd(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= SCROLL_PINNED_TOLERANCE;
}

function messagesMatch(
  current: readonly ProjectGroupMessage[],
  next: readonly ProjectGroupMessage[],
): boolean {
  return current.length === next.length && current.every((message, index) => message.id === next[index]?.id);
}

function senderName(message: ProjectGroupMessage, agents: Agent[]): string {
  if (message.senderType === "human") return "You";
  if (message.senderType === "shepherd") return "Shepherd";
  return agents.find((agent) => agent.id === message.senderId)?.name ?? "Agent";
}

export function ProjectGroupMentionButton({
  agentName,
  sending,
  onActivate,
}: {
  agentName: string;
  sending: boolean;
  onActivate: () => void;
}) {
  return (
    <button type="button" disabled={sending} onClick={onActivate}>
      @{agentName}
    </button>
  );
}

export function InitializeProjectGroupButton({
  initializing,
  onInitialize,
}: {
  initializing: boolean;
  onInitialize: () => void;
}) {
  return (
    <button className="button button-primary" type="button" onClick={onInitialize} disabled={initializing}>
      {initializing ? "Initializing Project Group…" : "Initialize Project Group"}
    </button>
  );
}

export function ProjectGroupPage({ agents }: { agents: Agent[] }) {
  const { state, loading, error: stateError, connected, refresh: refreshState } = useShepherdPolling();
  const project = state?.projects[0] ?? null;
  const [messages, setMessages] = useState<ProjectGroupMessage[]>([]);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [content, setContent] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [mentionCursor, setMentionCursor] = useState(0);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const messagesPane = useRef<HTMLDivElement>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const messageComposer = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const scrollToMessageEndOnChange = useRef(true);
  const scrollAfterSend = useRef(false);

  const mentionCandidates = useMemo(
    () => findProjectGroupMentionCandidates(content, mentionCursor, agents),
    [agents, content, mentionCursor],
  );
  const showMentionSuggestions = Boolean(project) && !sending && !mentionDismissed && mentionCandidates.length > 0;

  const insertMention = (agent: Agent) => {
    if (sending) return;
    const nextContent = prependProjectGroupMentionWithinLimit(agent.name, agent.id, content);
    flushSync(() => {
      if (nextContent === null) {
        setComposerError("Mention would exceed the 2,000-character message limit.");
      } else {
        setComposerError(null);
        setContent(nextContent);
        setMentionCursor(nextContent.length);
        setMentionDismissed(false);
      }
    });
    const composer = messageComposer.current;
    if (!composer) return;
    composer.focus();
    composer.setSelectionRange(composer.value.length, composer.value.length);
  };

  const refreshMessages = useCallback(async () => {
    if (!project || inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await api.groupMessages(project.id);
      const pinnedToMessageEnd = messagesPane.current
        ? isPinnedToMessageEnd(messagesPane.current)
        : true;
      setMessages((current) => {
        if (messagesMatch(current, result.messages)) return current;
        scrollToMessageEndOnChange.current = scrollAfterSend.current || current.length === 0 || pinnedToMessageEnd;
        scrollAfterSend.current = false;
        return result.messages;
      });
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

  useLayoutEffect(() => {
    if (!scrollToMessageEndOnChange.current) return;
    messageEnd.current?.scrollIntoView({ block: "nearest" });
    scrollToMessageEndOnChange.current = false;
  }, [messages]);

  useEffect(() => {
    setMentionActiveIndex(0);
  }, [content, mentionCursor]);

  const selectMention = (agent: ProjectGroupMentionTarget) => {
    const next = replaceProjectGroupMentionQuery(content, mentionCursor, agent);
    if (!next) return;
    flushSync(() => {
      setContent(next.content);
      setMentionCursor(next.selectionStart);
      setMentionDismissed(true);
      setComposerError(null);
    });
    const composer = messageComposer.current;
    if (!composer) return;
    composer.focus();
    composer.setSelectionRange(next.selectionStart, next.selectionStart);
  };

  const initializeGroup = async () => {
    if (initializing) return;
    setInitializing(true);
    setMessageError(null);
    try {
      await api.initializeProjectGroup();
      await refreshState();
    } catch (reason) {
      setMessageError(reason instanceof Error ? reason.message : "Project Group could not be initialized");
    } finally {
      setInitializing(false);
    }
  };

  const sortedMessages = useMemo(() => [...messages].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  ), [messages]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!project || !content.trim()) return;
    const nextContent = content.trim();
    setSending(true);
    setMessageError(null);
    setComposerError(null);
    try {
      await api.sendGroupMessage(project.id, {
        clientMessageId: crypto.randomUUID(),
        content: nextContent,
        ...(nextContent.startsWith("@") ? { assignmentPreset: "auth-demo-contract" as const } : {}),
      });
      setContent("");
      setMentionCursor(0);
      setMentionDismissed(false);
      scrollAfterSend.current = true;
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
            <ProjectGroupMentionButton
              key={agent.id}
              agentName={agent.name}
              sending={sending || !project}
              onActivate={() => insertMention(agent)}
            />
          ))}
        </div>
        {messageError ? (
          <div className="reconnect-banner" role="status">{messageError} · retrying automatically</div>
        ) : null}
        <div className="group-messages" ref={messagesPane} aria-live="polite">
          {messagesLoading && messages.length === 0 ? <LoadingPanel label="Loading real group messages…" /> : null}
          {!messagesLoading && sortedMessages.length === 0 ? (
            <EmptyState
              icon="group"
              title={project ? "The Project Group is quiet" : "No Shepherd project yet"}
              description={project ? "Unmentioned messages go to Shepherd. Start with @AgentName to create a targeted contract." : "Initialize the fixed Project Group to begin its conversation without starting a Mission."}
              action={!project ? (
                <InitializeProjectGroupButton
                  initializing={initializing}
                  onInitialize={() => void initializeGroup()}
                />
              ) : undefined}
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
            ref={messageComposer}
            id="group-message"
            rows={2}
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setMentionCursor(event.target.selectionStart);
              setMentionDismissed(false);
              setComposerError(null);
            }}
            onSelect={(event) => setMentionCursor(event.currentTarget.selectionStart)}
            onKeyDown={(event) => {
              if (showMentionSuggestions) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setMentionActiveIndex((current) => Math.min(current + 1, mentionCandidates.length - 1));
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setMentionActiveIndex((current) => Math.max(current - 1, 0));
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMentionDismissed(true);
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  const agent = mentionCandidates[mentionActiveIndex];
                  if (agent) selectMention(agent);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Message Project Group…"
            disabled={!project || sending}
            maxLength={MAX_PROJECT_GROUP_MESSAGE_LENGTH}
            aria-describedby={composerError ? "group-message-error" : undefined}
            aria-controls={showMentionSuggestions ? MENTION_SUGGESTIONS_ID : undefined}
            aria-expanded={showMentionSuggestions}
            aria-activedescendant={showMentionSuggestions ? `${MENTION_SUGGESTIONS_ID}-${mentionActiveIndex}` : undefined}
          />
          {showMentionSuggestions ? (
            <div className="group-mention-suggestions" id={MENTION_SUGGESTIONS_ID} role="listbox" aria-label="Agent mentions">
              {mentionCandidates.map((agent, index) => (
                <button
                  id={`${MENTION_SUGGESTIONS_ID}-${index}`}
                  key={agent.id}
                  type="button"
                  role="option"
                  aria-selected={index === mentionActiveIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMention(agent)}
                >
                  @{agent.name}
                </button>
              ))}
            </div>
          ) : null}
          <div>
            <span id={composerError ? "group-message-error" : undefined} role={composerError ? "status" : undefined}>
              {composerError ?? "Unmentioned → Shepherd · @AgentName → targeted contract"}
            </span>
            <button className="send-button" aria-label="Send group message" disabled={!content.trim() || sending}>{sending ? <Spinner /> : <Icon name="send" />}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
