import type { ReactNode } from "react";
import { Link } from "./router";
import type { Agent, SystemInfo } from "./types";
import { Icon } from "./ui";

function isActive(pathname: string, href: string): boolean {
  if (href === "/agents") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({
  agents,
  system,
  pathname,
  children,
  globalError,
  onClearError,
}: {
  agents: Agent[];
  system: SystemInfo | null;
  pathname: string;
  children: ReactNode;
  globalError?: string | null;
  onClearError?: () => void;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/shepherd" aria-label="Agent Launchpad home">
          <div className="brand-mark">A</div>
          <div className="brand-copy">
            <strong>Agent Launchpad</strong>
            <span>Local container · Codex CLI</span>
          </div>
        </Link>

        <Link className="button button-primary create-button" href="/agents/new">
          <Icon name="add" />
          <span>Create Agent</span>
        </Link>

        <div className="sidebar-section-label">Shepherd</div>
        <nav className="primary-nav" aria-label="Shepherd navigation">
          <Link className={`nav-item ${isActive(pathname, "/shepherd") ? "active" : ""}`} href="/shepherd">
            <span className="nav-icon"><Icon name="shepherd" /></span>
            <span className="nav-copy"><strong>Shepherd</strong><small>Execution kernel</small></span>
            <span className="online-dot" title="Kernel route available" />
          </Link>
        </nav>

        <div className="sidebar-section-label">Group chat</div>
        <nav className="primary-nav" aria-label="Project group navigation">
          <Link className={`nav-item ${isActive(pathname, "/project-group") ? "active" : ""}`} href="/project-group">
            <span className="nav-icon"><Icon name="group" /></span>
            <span className="nav-copy"><strong>Project Group</strong><small>Human · Shepherd · Agents</small></span>
          </Link>
        </nav>

        <div className="sidebar-agents-heading">
          <Link href="/agents">Your Agents</Link>
          <span>{agents.length}</span>
        </div>
        <nav className="agent-list" aria-label="Your Agents">
          {agents.map((agent) => (
            <Link
              className={`agent-card ${pathname.startsWith(`/agents/${agent.id}`) ? "selected" : ""}`}
              href={`/agents/${encodeURIComponent(agent.id)}`}
              key={agent.id}
            >
              <span className="agent-avatar">{agent.name.slice(0, 1).toUpperCase()}</span>
              <span className="agent-card-copy">
                <strong>{agent.name}</strong>
                <small>{agent.role ?? "Generalist"} Agent</small>
              </span>
              <span className={`mini-dot mini-${agent.status}`} title={agent.status} />
            </Link>
          ))}
          {agents.length === 0 ? (
            <Link className="empty-sidebar" href="/agents/new">Create your first Agent</Link>
          ) : null}
        </nav>

        <div className="sidebar-footer">
          <Link className={`settings-link ${isActive(pathname, "/settings") ? "active" : ""}`} href="/settings">
            <Icon name="settings" />
            <span>Settings</span>
          </Link>
          <div className="runtime-card">
            <span className="eyebrow">Runtime</span>
            <strong>{system?.runtime ?? "Connecting…"}</strong>
            <span>
              {system?.arkModel ?? "Model unavailable"}
              {system?.containerEngine ? ` · ${system.containerEngine}` : ""}
            </span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {system && (!system.arkConfigured || !system.codexAvailable) ? (
          <div className="config-banner" role="status">
            <Icon name="alert" />
            <div>
              <strong>Runtime configuration needed</strong>
              <p>
                {!system.arkConfigured
                  ? "Configure the Ark connection before starting live Agent work."
                  : "The configured Codex runtime is currently unavailable."}
              </p>
            </div>
          </div>
        ) : null}
        {globalError ? (
          <div className="error-banner" role="alert">
            <span>{globalError}</span>
            {onClearError ? <button aria-label="Dismiss error" onClick={onClearError}>×</button> : null}
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
