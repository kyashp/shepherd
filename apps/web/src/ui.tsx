import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "shepherd"
  | "group"
  | "agents"
  | "add"
  | "settings"
  | "activity"
  | "plane"
  | "arrow"
  | "check"
  | "alert"
  | "edit"
  | "play"
  | "stop"
  | "send";

const iconPaths: Record<IconName, ReactNode> = {
  shepherd: <><path d="M6.2 10.5a3.8 3.8 0 1 1 7.6 0v2.2" /><path d="M4.5 13.2c1.6.7 3.2 1.1 4.7 1.1 1.6 0 3-.4 4.3-1.1l2 1.8M9.8 7.1V4.5M7.8 5.7l2-1.2 2 1.2" /></>,
  group: <><path d="M7.4 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM13.9 10a2.4 2.4 0 1 0 0-4.8" /><path d="M2.8 16.2c.5-2.4 2-3.7 4.6-3.7s4.2 1.3 4.7 3.7M12.4 12.2c2.7-.2 4.3 1 4.8 3.2" /></>,
  agents: <><rect x="4" y="3.7" width="12" height="12.6" rx="2.4" /><path d="M7 7.5h6M7 10h6M7 12.5h3.8" /></>,
  add: <path d="M10 4.5v11M4.5 10h11" />,
  settings: <><circle cx="10" cy="10" r="2.5" /><path d="m10 2.8.7 1.6 1.8.7 1.6-.6 1.4 1.4-.6 1.6.7 1.8 1.6.7v2l-1.6.7-.7 1.8.6 1.6-1.4 1.4-1.6-.6-1.8.7-.7 1.6H8l-.7-1.6-1.8-.7-1.6.6-1.4-1.4.6-1.6-.7-1.8-1.6-.7v-2l1.6-.7.7-1.8-.6-1.6 1.4-1.4 1.6.6 1.8-.7L8 2.8Z" /></>,
  activity: <path d="M2.5 10h3l1.7-4.2 3.1 8.4 2.1-5.4 1.2 1.2h3.9" />,
  plane: <><path d="M4 4.5h5v5H4zM11 10.5h5v5h-5z" /><path d="M9 7h2.2c1.3 0 2.3 1 2.3 2.3v1.2" /></>,
  arrow: <path d="m7 4 6 6-6 6" />,
  check: <path d="m4.5 10.2 3.4 3.3 7.6-7.4" />,
  alert: <><path d="M10 3 17 16H3Z" /><path d="M10 7.3v4.2M10 14v.1" /></>,
  edit: <><path d="m5 14.7.7-3.1 7.4-7.4 2.7 2.7-7.4 7.4Z" /><path d="M4.5 16h11" /></>,
  play: <path d="m7 5 8 5-8 5Z" />,
  stop: <rect x="5.5" y="5.5" width="9" height="9" rx="1" />,
  send: <><path d="m3.5 4 13 6-13 6 2-6Z" /><path d="M5.5 10h7" /></>,
};

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {iconPaths[name]}
    </svg>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function shortId(value: string | null | undefined, length = 8): string {
  if (!value) return "—";
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function stateTone(value: string): "success" | "danger" | "warning" | "purple" | "neutral" {
  if (/verified|passed|selected|promoted|completed|ready/u.test(value)) return "success";
  if (/failed|denied|timed_out|error|rejected/u.test(value)) return "danger";
  if (/attention|collision|blocked|interrupted|cancelled/u.test(value)) return "warning";
  if (/running|verifying|resolving|busy|queued|created|promoting/u.test(value)) return "purple";
  return "neutral";
}

export function StatePill({ value, label }: { value: string; label?: string }) {
  return <span className={`state-pill tone-${stateTone(value)}`}>{label ?? titleCase(value)}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  status,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-heading-copy">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <div className="title-line">
          <h1>{title}</h1>
          {status}
        </div>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  icon = "activity",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <Icon name="alert" />
      <div>
        <strong>Couldn’t load this view</strong>
        <p>{message}</p>
      </div>
      {onRetry ? <button className="button button-ghost" onClick={onRetry}>Retry</button> : null}
    </div>
  );
}

export function LoadingPanel({ label = "Loading current data…" }: { label?: string }) {
  return <div className="loading-panel" aria-live="polite"><Spinner /><span>{label}</span></div>;
}
