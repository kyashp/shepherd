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
  // Iconoir cube-scan, solid variant (MIT): https://iconoir.com
  shepherd: <>
    <path fillRule="evenodd" clipRule="evenodd" d="M2.25 3C2.25 2.58579 2.58579 2.25 3 2.25H6C6.41421 2.25 6.75 2.58579 6.75 3C6.75 3.41421 6.41421 3.75 6 3.75H3.75V6C3.75 6.41421 3.41421 6.75 3 6.75C2.58579 6.75 2.25 6.41421 2.25 6V3Z" fill="currentColor" />
    <path fillRule="evenodd" clipRule="evenodd" d="M17.25 3C17.25 2.58579 17.5858 2.25 18 2.25H21C21.4142 2.25 21.75 2.58579 21.75 3V6C21.75 6.41421 21.4142 6.75 21 6.75C20.5858 6.75 20.25 6.41421 20.25 6V3.75H18C17.5858 3.75 17.25 3.41421 17.25 3Z" fill="currentColor" />
    <path fillRule="evenodd" clipRule="evenodd" d="M3 17.25C3.41421 17.25 3.75 17.5858 3.75 18V20.25H6C6.41421 20.25 6.75 20.5858 6.75 21C6.75 21.4142 6.41421 21.75 6 21.75H3C2.58579 21.75 2.25 21.4142 2.25 21V18C2.25 17.5858 2.58579 17.25 3 17.25Z" fill="currentColor" />
    <path fillRule="evenodd" clipRule="evenodd" d="M21 17.25C21.4142 17.25 21.75 17.5858 21.75 18V21C21.75 21.4142 21.4142 21.75 21 21.75H18C17.5858 21.75 17.25 21.4142 17.25 21C17.25 20.5858 17.5858 20.25 18 20.25H20.25V18C20.25 17.5858 20.5858 17.25 21 17.25Z" fill="currentColor" />
    <path fillRule="evenodd" clipRule="evenodd" d="M12.9004 6.6654C12.3462 6.33289 11.6538 6.33289 11.0996 6.6654L7.09963 9.0654C6.57252 9.38167 6.25 9.95131 6.25 10.566V14.4336C6.25 15.0483 6.57252 15.618 7.09963 15.9342L11.0996 18.3342C11.6538 18.6668 12.3462 18.6668 12.9004 18.3342L16.9004 15.9342C17.4275 15.618 17.75 15.0483 17.75 14.4336V10.566C17.75 9.95131 17.4275 9.38167 16.9004 9.0654L12.9004 6.6654ZM9.3642 10.6785C9.00209 10.4773 8.5455 10.6078 8.34437 10.9699C8.14324 11.332 8.27373 11.7886 8.63583 11.9898L11.25 13.4418V16.0001C11.25 16.4144 11.5858 16.7501 12 16.7501C12.4142 16.7501 12.75 16.4144 12.75 16.0001V13.4456C12.9152 13.3554 13.1243 13.241 13.3607 13.1115C13.9447 12.7916 14.6961 12.3787 15.3642 12.0077C15.7263 11.8066 15.8568 11.35 15.6557 10.9879C15.4546 10.6257 14.998 10.4952 14.6359 10.6964C13.9716 11.0653 13.223 11.4766 12.6401 11.796C12.3908 11.9325 12.172 12.0521 12.0032 12.1443L9.3642 10.6785Z" fill="currentColor" />
  </>,
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
  const solid = name === "shepherd";
  return (
    <svg
      aria-hidden="true"
      viewBox={solid ? "0 0 24 24" : "0 0 20 20"}
      fill="none"
      stroke={solid ? "none" : "currentColor"}
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
