import { useMemo, useState } from "react";
import { Link } from "../router";
import type { Agent } from "../types";
import { EmptyState, Icon, PageHeader, StatePill, formatDateTime, shortId } from "../ui";

type SortKey = "name" | "updated" | "status";

export function AgentsPage({ agents }: { agents: Agent[] }) {
  const [sort, setSort] = useState<SortKey>("name");
  const sorted = useMemo(() => [...agents].sort((left, right) => {
    if (sort === "updated") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (sort === "status") return left.status.localeCompare(right.status) || left.name.localeCompare(right.name);
    return left.name.localeCompare(right.name);
  }), [agents, sort]);

  return (
    <div className="page agents-page">
      <PageHeader
        title="Your Agents"
        description="Manage individual coding Agents, their roles, scoped authority, and active contracts."
        actions={
          <>
            <label className="compact-select">
              <span className="sr-only">Sort Agents</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                <option value="name">Sort: Name</option>
                <option value="updated">Sort: Last active</option>
                <option value="status">Sort: Status</option>
              </select>
            </label>
            <Link className="button button-primary" href="/agents/new"><Icon name="add" />Create Agent</Link>
          </>
        }
      />
      <section className="table-panel" aria-label="Agents">
        {agents.length === 0 ? (
          <EmptyState
            icon="agents"
            title="No Agents yet"
            description="Create an Agent with a role and bounded project authority."
            action={<Link className="button button-primary" href="/agents/new">Create Agent</Link>}
          />
        ) : (
          <div className="responsive-table">
            <table>
              <thead><tr><th>Agent</th><th>Status</th><th>Last active</th><th>Current contract</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {sorted.map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <Link className="table-agent" href={`/agents/${encodeURIComponent(agent.id)}`}>
                        <span className="agent-avatar light">{agent.name.slice(0, 1).toUpperCase()}</span>
                        <span><strong>{agent.name}</strong><small>{agent.role ?? "Generalist"} Agent</small></span>
                      </Link>
                    </td>
                    <td><StatePill value={agent.status} /></td>
                    <td><time dateTime={agent.updatedAt}>{formatDateTime(agent.updatedAt)}</time></td>
                    <td>
                      {agent.currentContractId ? (
                        <Link className="contract-link" href="/shepherd">{shortId(agent.currentContractId, 15)}<Icon name="arrow" /></Link>
                      ) : <span className="muted-value">None</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link href={`/agents/${encodeURIComponent(agent.id)}`} aria-label={`Open ${agent.name}`}>Open</Link>
                        <Link href={`/agents/${encodeURIComponent(agent.id)}/edit`} aria-label={`Edit ${agent.name}`}><Icon name="edit" /></Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
