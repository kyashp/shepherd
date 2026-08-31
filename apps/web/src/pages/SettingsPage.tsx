import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import type { ShepherdSettings, SystemInfo } from "../types";
import { ErrorState, Icon, LoadingPanel, PageHeader, Spinner, StatePill, titleCase } from "../ui";

type SettingsTab = "general" | "execution" | "security" | "notifications";

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "execution", label: "Execution" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
];

type SettingsTabKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

function selectAdjacentTab(current: SettingsTab, key: SettingsTabKey): SettingsTab {
  if (key === "Home") return tabs[0]?.id ?? current;
  if (key === "End") return tabs.at(-1)?.id ?? current;
  const currentIndex = tabs.findIndex((item) => item.id === current);
  const offset = key === "ArrowRight" ? 1 : -1;
  const nextIndex = (currentIndex + offset + tabs.length) % tabs.length;
  return tabs[nextIndex]?.id ?? current;
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div><strong>{label}</strong><p>{description}</p></div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span aria-hidden="true" />
      <b className="sr-only">{label}</b>
    </label>
  );
}

export function NotificationSettingsSection({
  notifications,
}: {
  notifications: ShepherdSettings["notifications"];
}) {
  return (
    <>
      <SettingRow
        label="Notification preferences"
        description="Reserved for a future release. Shepherd does not deliver or show notifications yet."
      >
        <span className="locked-value"><Icon name="stop" />Unavailable</span>
      </SettingRow>
      <SettingRow label="Mission completed" description="Stored preference for future trusted-promotion notifications.">
        <div className="locked-toggle">
          <Toggle checked={notifications.missionCompleted} onChange={() => undefined} label="Mission completed notifications" disabled />
          <span>Reserved</span>
        </div>
      </SettingRow>
      <SettingRow label="Attention required" description="Stored preference for future human-review notifications.">
        <div className="locked-toggle">
          <Toggle checked={notifications.attentionRequired} onChange={() => undefined} label="Attention required notifications" disabled />
          <span>Reserved</span>
        </div>
      </SettingRow>
      <SettingRow label="Collision detected" description="Stored preference for future semantic-collision notifications.">
        <div className="locked-toggle">
          <Toggle checked={notifications.collisionDetected} onChange={() => undefined} label="Collision detected notifications" disabled />
          <span>Reserved</span>
        </div>
      </SettingRow>
    </>
  );
}

export function ModelReviewSettingsSection({
  configured,
  enabled,
  onChange,
}: {
  configured: boolean;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <SettingRow
      label="Bounded model review"
      description={configured
        ? "Run advisory structured semantic review. Deterministic detection remains authoritative."
        : "Stored preference reserved because a model reviewer is not configured for this running process. Deterministic detection remains authoritative."}
    >
      {configured ? (
        <Toggle checked={enabled} onChange={onChange} label="Bounded model review" />
      ) : (
        <div className="locked-toggle">
          <Toggle checked={enabled} onChange={() => undefined} label="Bounded model review" disabled />
          <span role="status">Unavailable</span>
        </div>
      )}
    </SettingRow>
  );
}

export function SettingsPage({ system }: { system: SystemInfo | null }) {
  const [settings, setSettings] = useState<ShepherdSettings | null>(null);
  const [draft, setDraft] = useState<ShepherdSettings | null>(null);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.settings();
      setSettings(result.settings);
      setDraft(result.settings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settings unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.updateSettings({
        contractTimeoutMs: draft.contractTimeoutMs,
        candidateTimeoutMs: draft.candidateTimeoutMs,
        autoResolution: draft.autoResolution,
        maxConcurrentPlanes: draft.maxConcurrentPlanes,
        modelReviewEnabled: draft.modelReviewEnabled,
        notifications: draft.notifications,
      });
      setSettings(result.settings);
      setDraft(result.settings);
      setNotice("Settings saved to the Shepherd control plane.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settings could not be saved");
    } finally {
      setBusy(false);
    }
  };

  const resetDemo = async () => {
    if (!window.confirm("Reset only Shepherd demo state? Existing Launchpad Agents and Playground messages are preserved.")) return;
    setResetting(true);
    setError(null);
    setNotice(null);
    try {
      await api.resetDemo();
      setNotice("Shepherd demo state was reset safely.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Demo reset failed");
    } finally {
      setResetting(false);
    }
  };

  if (loading && !draft) return <LoadingPanel label="Loading Shepherd settings…" />;
  if (!draft) return <ErrorState message={error ?? "Settings unavailable."} onRetry={() => void load()} />;
  const hasChanges = settings !== null && JSON.stringify(settings) !== JSON.stringify(draft);

  return (
    <div className="page settings-page">
      <PageHeader title="Settings" description="Configure verified Shepherd kernel behavior and system preferences." />
      <form className="settings-panel" onSubmit={save}>
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          {tabs.map((item) => (
            <button
              type="button"
              role="tab"
              id={`settings-tab-${item.id}`}
              aria-controls={`settings-panel-${item.id}`}
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              className={tab === item.id ? "active" : ""}
              key={item.id}
              ref={(element) => { tabRefs.current[item.id] = element; }}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => {
                const key = event.key;
                if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return;
                event.preventDefault();
                const nextTab = selectAdjacentTab(item.id, key);
                setTab(nextTab);
                tabRefs.current[nextTab]?.focus();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error ? <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div> : null}
        {notice ? <div className="success-banner" role="status"><Icon name="check" />{notice}</div> : null}

        <div
          className="settings-body"
          role="tabpanel"
          id={`settings-panel-${tab}`}
          aria-labelledby={`settings-tab-${tab}`}
        >
          {tab === "general" ? (
            <>
              <SettingRow label="Kernel mode" description="The configured server mode is locked for this running process.">
                <span className="locked-value"><Icon name="stop" />{titleCase(draft.mode)}</span>
              </SettingRow>
              <SettingRow label="Execution mode" description="Live or deterministic execution is selected at server startup.">
                <span className="locked-value"><Icon name="stop" />{system?.shepherdExecutionMode ? titleCase(system.shepherdExecutionMode) : "Unavailable"}</span>
              </SettingRow>
              <SettingRow label="Retain completed Planes" description="Locked on so losing and completed Plane evidence remains inspectable.">
                <div className="locked-toggle"><Toggle checked={draft.retainCompletedPlanes} onChange={() => undefined} label="Retain completed Planes" disabled /><span>Locked</span></div>
              </SettingRow>
              <SettingRow label="Demo data" description="Safely recreate only the known Shepherd demo fixture and remove its stale managed Planes.">
                <button type="button" className="button button-danger" disabled={resetting} onClick={() => void resetDemo()}>{resetting ? <Spinner /> : "Reset demo state"}</button>
              </SettingRow>
            </>
          ) : null}

          {tab === "execution" ? (
            <>
              <SettingRow label="Contract timeout" description="Maximum execution time for one contract before Shepherd fails it closed.">
                <label className="number-control"><input aria-label="Contract timeout in seconds" type="number" min={1} max={3600} step={1} value={draft.contractTimeoutMs / 1_000} onChange={(event) => setDraft({ ...draft, contractTimeoutMs: Math.round(Number(event.target.value) * 1_000) })} /><span>seconds</span></label>
              </SettingRow>
              <SettingRow label="Candidate timeout" description="Maximum execution time for one speculative resolution candidate.">
                <label className="number-control"><input aria-label="Candidate timeout in seconds" type="number" min={1} max={3600} step={1} value={draft.candidateTimeoutMs / 1_000} onChange={(event) => setDraft({ ...draft, candidateTimeoutMs: Math.round(Number(event.target.value) * 1_000) })} /><span>seconds</span></label>
              </SettingRow>
              <SettingRow label="Maximum parallel Planes" description="Bound the number of isolated Agent execution Planes admitted concurrently.">
                <input aria-label="Maximum parallel Planes" className="small-number" type="number" min={2} max={16} step={1} value={draft.maxConcurrentPlanes} onChange={(event) => setDraft({ ...draft, maxConcurrentPlanes: Number(event.target.value) })} />
              </SettingRow>
              <SettingRow label="Automatic resolution" description="Automatically select and promote the objectively eligible candidate. Off still verifies both futures, then pauses before selection and promotion.">
                <Toggle checked={draft.autoResolution} onChange={(autoResolution) => setDraft({ ...draft, autoResolution })} label="Automatic resolution" />
              </SettingRow>
            </>
          ) : null}

          {tab === "security" ? (
            <>
              <ModelReviewSettingsSection
                configured={system?.shepherdModelReviewConfigured === true}
                enabled={draft.modelReviewEnabled}
                onChange={(modelReviewEnabled) => setDraft({ ...draft, modelReviewEnabled })}
              />
              <SettingRow label="Authority enforcement" description="Trusted diff inspection and protected-path checks cannot be disabled from the browser.">
                <span className="locked-value"><Icon name="check" />Enforced</span>
              </SettingRow>
              <SettingRow label="Independent verification" description="Mandatory checks run outside Agent execution and cannot be self-certified.">
                <span className="locked-value"><Icon name="check" />Enforced</span>
              </SettingRow>
            </>
          ) : null}

          {tab === "notifications" ? (
            <NotificationSettingsSection notifications={draft.notifications} />
          ) : null}
        </div>
        <footer className="settings-footer">
          <span>{hasChanges ? "Unsaved changes" : "All changes saved"}</span>
          <div>
            <button type="button" className="button button-ghost" disabled={!settings || busy || !hasChanges} onClick={() => { setDraft(settings); setNotice(null); }}>Discard changes</button>
            <button className="button button-primary" disabled={busy || !hasChanges}>{busy ? <Spinner /> : "Save settings"}</button>
          </div>
        </footer>
      </form>
    </div>
  );
}
