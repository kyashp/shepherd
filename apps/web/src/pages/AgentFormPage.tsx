import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "../api";
import { Link, navigate } from "../router";
import type {
  Agent,
  AgentInput,
  AgentRole,
  AuthorityPresetDefinition,
  AuthorityPresetId,
  ScopedAuthority,
} from "../types";
import { ErrorState, Icon, LoadingPanel, PageHeader, Spinner } from "../ui";

const roles: AgentRole[] = ["Generalist", "Frontend", "Backend", "Verification"];
const defaultInstructions = "Help me build and test software in this project. Keep changes small, respect scoped authority, and report evidence clearly.";

interface AgentFormState {
  name: string;
  description: string;
  instructions: string;
  role: AgentRole;
  preset: AuthorityPresetId;
  readable: string;
  writable: string;
  forbidden: string;
}

const defaultForm: AgentFormState = {
  name: "",
  description: "",
  instructions: defaultInstructions,
  role: "Generalist",
  preset: "generalist",
  readable: "",
  writable: "",
  forbidden: "",
};

const patternsToText = (patterns: string[]): string => patterns.join("\n");
const textToPatterns = (value: string): string[] => Array.from(new Set(value
  .split(/[,\n]/u)
  .map((pattern) => pattern.trim())
  .filter(Boolean)));

function samePatterns(left: string[], right: string[]): boolean {
  return [...left].sort().join("\n") === [...right].sort().join("\n");
}

function matchingPreset(agent: Agent, presets: AuthorityPresetDefinition[]): AuthorityPresetDefinition | null {
  if (!agent.role || !agent.authority) return null;
  const authority = agent.authority;
  return presets.find((preset) =>
    preset.recommendedRole === agent.role &&
    samePatterns(preset.authority.readable, authority.readable) &&
    samePatterns(preset.authority.writable, authority.writable) &&
    samePatterns(preset.authority.forbidden, authority.forbidden),
  ) ?? null;
}

function AuthorityFields({ form, setForm }: { form: AgentFormState; setForm: (form: AgentFormState) => void }) {
  return (
    <div className="authority-grid">
      <label>
        Read access
        <textarea rows={4} value={form.readable} onChange={(event) => setForm({ ...form, readable: event.target.value })} placeholder="src/**&#10;docs/**" required />
        <small>One project-relative pattern per line.</small>
      </label>
      <label>
        Write access
        <textarea rows={4} value={form.writable} onChange={(event) => setForm({ ...form, writable: event.target.value })} placeholder="src/frontend/**" required />
        <small>Must remain within this Agent’s readable scope.</small>
      </label>
      <label>
        Forbidden paths
        <textarea rows={4} value={form.forbidden} onChange={(event) => setForm({ ...form, forbidden: event.target.value })} placeholder="secrets/**&#10;.env*" />
        <small>Forbidden paths always override writable patterns.</small>
      </label>
    </div>
  );
}

export function AgentFormPage({
  agent,
  editMode = false,
  loadingAgent = false,
  onAgentsChanged,
}: {
  agent?: Agent | null;
  editMode?: boolean;
  loadingAgent?: boolean;
  onAgentsChanged: () => Promise<void>;
}) {
  const editing = editMode || Boolean(agent);
  const [presets, setPresets] = useState<AuthorityPresetDefinition[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [form, setForm] = useState<AgentFormState>(defaultForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.authorityPresets().then(({ presets: next }) => {
      if (!active) return;
      setPresets(next);
      setPresetsError(null);
    }).catch((reason) => {
      if (active) setPresetsError(reason instanceof Error ? reason.message : "Authority presets unavailable");
    }).finally(() => {
      if (active) setPresetsLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!agent || presetsLoading) return;
    const match = matchingPreset(agent, presets);
    const role = agent.role ?? "Generalist";
    const fallback = presets.find((preset) => preset.recommendedRole === role) ?? presets.find((preset) => preset.id === "generalist") ?? null;
    const authority = agent.authority ?? fallback?.authority ?? { readable: [], writable: [], forbidden: [] };
    setAdvanced(Boolean(agent.authority) && !match);
    setForm({
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      role,
      preset: match?.id ?? fallback?.id ?? "generalist",
      readable: patternsToText(authority.readable),
      writable: patternsToText(authority.writable),
      forbidden: patternsToText(authority.forbidden),
    });
  }, [agent, presets, presetsLoading]);

  const selectedPreset = useMemo(() => presets.find((preset) => preset.id === form.preset) ?? null, [form.preset, presets]);

  const changeRole = (role: AgentRole) => {
    const nextPreset = presets.find((preset) => preset.recommendedRole === role);
    setForm({ ...form, role, ...(nextPreset ? { preset: nextPreset.id } : {}) });
  };

  const changePreset = (presetId: AuthorityPresetId) => {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) return;
    setForm({
      ...form,
      preset: presetId,
      role: preset.recommendedRole,
      readable: patternsToText(preset.authority.readable),
      writable: patternsToText(preset.authority.writable),
      forbidden: patternsToText(preset.authority.forbidden),
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const authority: ScopedAuthority = {
      readable: textToPatterns(form.readable),
      writable: textToPatterns(form.writable),
      forbidden: textToPatterns(form.forbidden),
    };
    const body: AgentInput = {
      name: form.name.trim(),
      description: form.description.trim(),
      instructions: form.instructions,
      role: form.role,
      ...(advanced ? { authority } : { authorityPreset: form.preset }),
    };
    try {
      const result = agent
        ? await api.updateAgent(agent.id, body)
        : await api.createAgent(body);
      await onAgentsChanged();
      navigate(`/agents/${encodeURIComponent(result.agent.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agent could not be saved");
    } finally {
      setBusy(false);
    }
  };

  if (loadingAgent) return <LoadingPanel label="Loading Agent configuration…" />;
  if (editing && !agent) return <ErrorState message="Agent not found." />;

  return (
    <div className="page agent-form-page">
      <PageHeader
        eyebrow={editing ? "Agent configuration" : "New workspace"}
        title={editing ? `Edit ${agent?.name ?? "Agent"}` : "Create Agent"}
        description={editing ? "Update identity, role, and bounded project authority." : "Configure a new coding Agent with safe defaults."}
      />
      <form className="agent-form-panel" onSubmit={submit}>
        {error ? <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div> : null}
        <section className="form-section">
          <div className="form-section-heading"><span>01</span><div><h2>Identity</h2><p>Name the Agent and make its remit easy to recognize.</p></div></div>
          <div className="form-grid two-column">
            <label>
              Agent name
              <input autoFocus={!editing} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Backend Agent" required maxLength={80} />
            </label>
            <label>
              Role
              <select value={form.role} onChange={(event) => changeRole(event.target.value as AgentRole)}>
                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
          </div>
          <label>
            Description
            <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="What will this Agent be responsible for?" rows={3} maxLength={500} />
          </label>
          <label>
            System instructions
            <textarea value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} rows={5} maxLength={10_000} />
          </label>
          <label>
            Base image / runtime
            <input value="Codex CLI (configured runtime)" readOnly aria-readonly="true" />
          </label>
        </section>

        <section className="form-section">
          <div className="form-section-heading"><span>02</span><div><h2>Scoped authority</h2><p>Choose a server-defined preset or inspect exact project-relative patterns.</p></div></div>
          {presetsLoading ? <LoadingPanel label="Loading authority presets…" /> : null}
          {presetsError ? <ErrorState message={presetsError} /> : null}
          {!presetsLoading && presets.length > 0 ? (
            <fieldset className="preset-grid">
              <legend className="sr-only">Authority preset</legend>
              {presets.map((preset) => (
                <label className={form.preset === preset.id && !advanced ? "selected" : ""} key={preset.id}>
                  <input type="radio" name="authority-preset" checked={form.preset === preset.id && !advanced} onChange={() => { setAdvanced(false); changePreset(preset.id); }} />
                  <span><strong>{preset.label}</strong><small>{preset.description}</small></span>
                  <Icon name="check" />
                </label>
              ))}
            </fieldset>
          ) : null}
          {selectedPreset && !advanced ? (
            <div className="preset-preview">
              <div><span>Read</span><strong>{selectedPreset.authority.readable.join(", ")}</strong></div>
              <div><span>Write</span><strong>{selectedPreset.authority.writable.join(", ")}</strong></div>
              <div><span>Forbidden</span><strong>{selectedPreset.authority.forbidden.join(", ") || "Server-protected defaults"}</strong></div>
            </div>
          ) : null}
          <button className="advanced-toggle" type="button" onClick={() => {
            if (!advanced && selectedPreset) {
              setForm({
                ...form,
                readable: patternsToText(selectedPreset.authority.readable),
                writable: patternsToText(selectedPreset.authority.writable),
                forbidden: patternsToText(selectedPreset.authority.forbidden),
              });
            }
            setAdvanced((value) => !value);
          }} aria-expanded={advanced}>
            <Icon name="settings" />
            {advanced ? "Use a recommended preset" : "Advanced authority patterns"}
          </button>
          {advanced ? <AuthorityFields form={form} setForm={setForm} /> : null}
        </section>

        <footer className="form-footer">
          <Link className="button button-ghost" href={agent ? `/agents/${encodeURIComponent(agent.id)}` : "/agents"}>Cancel</Link>
          <button className="button button-primary" disabled={busy || !form.name.trim() || presetsLoading || (!advanced && presets.length === 0)}>
            {busy ? <Spinner /> : editing ? "Save changes" : "Create Agent"}
          </button>
        </footer>
      </form>
    </div>
  );
}
