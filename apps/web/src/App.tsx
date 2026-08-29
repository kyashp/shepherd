import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError, setAuthToken } from "./api";
import { Shell } from "./Shell";
import { AgentFormPage } from "./pages/AgentFormPage";
import { AgentPage } from "./pages/AgentPage";
import { AgentsPage } from "./pages/AgentsPage";
import { ProjectGroupPage } from "./pages/ProjectGroupPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ShepherdPage } from "./pages/ShepherdPage";
import { Link, navigate, routeAgentId, useLocation } from "./router";
import type { Agent, SystemInfo } from "./types";
import { EmptyState, Spinner } from "./ui";

function AuthScreen({
  required,
  onUnlock,
  error,
}: {
  required: boolean | null;
  onUnlock: (token: string) => Promise<void>;
  error: string | null;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await onUnlock(token);
      setToken("");
    } catch {
      // The parent owns the safe, user-facing authentication error state.
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-screen">
      {required ? (
        <form className="auth-card" onSubmit={submit}>
          <div className="brand-mark">A</div>
          <span className="eyebrow">Agent Launchpad</span>
          <h1>Enter the access token</h1>
          <p>This shared demo token is configured by the platform operator.</p>
          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          <label>Access token<input autoFocus type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" required /></label>
          <button className="button button-primary" disabled={busy || !token.trim()}>{busy ? <Spinner /> : "Open Launchpad"}</button>
        </form>
      ) : (
        <section className="auth-card" aria-live="polite">
          <div className="brand-mark">A</div>
          <span className="eyebrow">Agent Launchpad</span>
          <h1>Connecting to the control plane</h1>
          {error ? <div className="error-banner" role="alert">{error}</div> : <Spinner />}
        </section>
      )}
    </main>
  );
}

function NotFoundPage() {
  return (
    <div className="page not-found-page">
      <EmptyState
        icon="alert"
        title="This route does not exist"
        description="Return to Shepherd mission control or open an Agent from the sidebar."
        action={<Link className="button button-primary" href="/shepherd">Open Shepherd</Link>}
      />
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshAgents = useCallback(async () => {
    const result = await api.listAgents();
    setAgents(result.agents);
  }, []);

  const bootstrap = useCallback(async () => {
    setBootstrapping(true);
    setError(null);
    try {
      const [agentResult, systemResult] = await Promise.all([api.listAgents(), api.system()]);
      setAgents(agentResult.agents);
      setSystem(systemResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Launchpad could not be loaded");
      throw reason;
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api.auth().then(async ({ required }) => {
      if (!active) return;
      setAuthRequired(required);
      if (!required) await bootstrap();
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Authentication status unavailable");
    });
    return () => { active = false; };
  }, [bootstrap]);

  useEffect(() => {
    if (location.pathname === "/") navigate("/shepherd", true);
  }, [location.pathname]);

  useEffect(() => {
    const title = location.pathname === "/shepherd" ? "Shepherd"
      : location.pathname === "/project-group" ? "Project Group"
        : location.pathname === "/settings" ? "Settings"
          : location.pathname.startsWith("/agents") ? "Agents"
            : "Agent Launchpad";
    document.title = `${title} · Agent Launchpad`;
  }, [location.pathname]);

  const unlock = async (token: string) => {
    setAuthToken(token);
    setError(null);
    try {
      await bootstrap();
      setAuthRequired(false);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) setError("The access token is not valid.");
      else setError(reason instanceof Error ? reason.message : "Launchpad could not be unlocked");
      throw reason;
    }
  };

  const agentId = routeAgentId(location.pathname);
  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === agentId) ?? null, [agentId, agents]);

  let page: ReactNode;
  if (bootstrapping && agents.length === 0) {
    page = <Spinner />;
  } else if (location.pathname === "/" || location.pathname === "/shepherd") {
    page = <ShepherdPage agents={agents} search={location.search} />;
  } else if (location.pathname === "/project-group") {
    page = <ProjectGroupPage agents={agents} />;
  } else if (location.pathname === "/agents") {
    page = <AgentsPage agents={agents} />;
  } else if (location.pathname === "/agents/new") {
    page = <AgentFormPage onAgentsChanged={refreshAgents} />;
  } else if (agentId && location.pathname.endsWith("/edit")) {
    page = <AgentFormPage agent={selectedAgent} editMode loadingAgent={bootstrapping} onAgentsChanged={refreshAgents} />;
  } else if (agentId) {
    page = <AgentPage agent={selectedAgent} system={system} onAgentsChanged={refreshAgents} />;
  } else if (location.pathname === "/settings") {
    page = <SettingsPage system={system} />;
  } else {
    page = <NotFoundPage />;
  }

  if (authRequired === null || authRequired) {
    return <AuthScreen required={authRequired} onUnlock={unlock} error={error} />;
  }

  return (
    <Shell agents={agents} system={system} pathname={location.pathname} globalError={error} onClearError={() => setError(null)}>
      {bootstrapping && agents.length === 0 ? <div className="page"><Spinner /></div> : page}
    </Shell>
  );
}
