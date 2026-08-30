import type {
  Agent,
  AgentInput,
  AgentRole,
  AgentRun,
  AuthorityPresetDefinition,
  AuthorityPresetId,
  Message,
  Plane,
  ProjectGroupMessage,
  ResolutionCandidate,
  SemanticCollision,
  ShepherdEvent,
  ShepherdMissionDetail,
  ShepherdSettings,
  ShepherdState,
  SystemInfo,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

let authToken = "";

export function setAuthToken(token: string): void {
  authToken = token.trim();
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = {
    ...(options?.body ? { "Content-Type": "application/json" } : {}),
    ...(authToken ? { Authorization: "Bearer " + authToken } : {}),
    ...options?.headers,
  };
  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    throw new ApiError("The control plane is unavailable. Check the local server and try again.", 0);
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data;
}

const idPath = (id: string): string => encodeURIComponent(id);

type PresetWireValue = Partial<AuthorityPresetDefinition> & {
  recommendedRole: AgentRole;
  authority: AuthorityPresetDefinition["authority"];
};

const presetLabels: Record<AuthorityPresetId, string> = {
  frontend: "Frontend",
  backend: "Backend",
  verification: "Verification",
  generalist: "Generalist",
};

function normalizePresets(
  value:
    | AuthorityPresetDefinition[]
    | Record<string, PresetWireValue>,
): AuthorityPresetDefinition[] {
  if (Array.isArray(value)) return value;
  return Object.entries(value).flatMap(([id, preset]) => {
    if (!(id in presetLabels)) return [];
    const presetId = id as AuthorityPresetId;
    return [{
      id: presetId,
      label: preset.label ?? presetLabels[presetId],
      description: preset.description ?? `${presetLabels[presetId]} project authority`,
      recommendedRole: preset.recommendedRole,
      authority: preset.authority,
    }];
  });
}

function unwrapDetail<T>(value: T | Record<string, T>, key: string): T {
  if (typeof value === "object" && value !== null && key in value) {
    return (value as Record<string, T>)[key]!;
  }
  return value as T;
}

export const api = {
  auth: () => request<{ required: boolean }>("/api/auth"),
  system: () => request<SystemInfo>("/api/system"),
  listAgents: () => request<{ agents: Agent[] }>("/api/agents"),
  getAgent: (id: string) => request<{ agent: Agent }>(`/api/agents/${idPath(id)}`),
  authorityPresets: async () => {
    const result = await request<{
      presets: AuthorityPresetDefinition[] | Record<string, PresetWireValue>;
    }>("/api/agent-authority-presets");
    return { presets: normalizePresets(result.presets) };
  },
  createAgent: (body: AgentInput) =>
    request<{ agent: Agent }>("/api/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateAgent: (id: string, body: AgentInput) =>
    request<{ agent: Agent }>(`/api/agents/${idPath(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteAgent: (id: string) =>
    request<unknown>(`/api/agents/${idPath(id)}`, {
      method: "DELETE",
    }),
  startAgent: (id: string) =>
    request<{ agent: Agent }>(`/api/agents/${idPath(id)}/start`, {
      method: "POST",
    }),
  stopAgent: (id: string) =>
    request<{ agent: Agent }>(`/api/agents/${idPath(id)}/stop`, {
      method: "POST",
    }),
  messages: (id: string) =>
    request<{ messages: Message[] }>(`/api/agents/${idPath(id)}/messages`),
  runs: (id: string) =>
    request<{ runs: AgentRun[] }>(`/api/agents/${idPath(id)}/runs`),
  sendMessage: (id: string, content: string) =>
    request<{ run: AgentRun; message: Message }>(`/api/agents/${idPath(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  submitPrivateContractPrompt: (id: string, content: string) =>
    request<{
      status: "awaiting_peer" | "accepted";
      missionId: string | null;
      contractId: string | null;
      message: ProjectGroupMessage;
      executionMode: "live" | "deterministic";
    }>(`/api/shepherd/agents/${idPath(id)}/contracts`, {
      method: "POST",
      body: JSON.stringify({
        clientMessageId: crypto.randomUUID(),
        content,
        preset: "auth-demo-contract",
      }),
    }),
  run: (id: string) => request<{ run: AgentRun }>(`/api/runs/${idPath(id)}`),

  shepherdState: () => request<{ state: ShepherdState }>("/api/shepherd/state"),
  mission: (id: string) =>
    request<ShepherdMissionDetail>(`/api/shepherd/missions/${idPath(id)}`),
  events: (cursor: number, limit = 200) =>
    request<{ events: ShepherdEvent[]; nextCursor: number }>(
      `/api/shepherd/events?cursor=${cursor}&limit=${limit}`,
    ),
  sendShepherdMessage: (
    content: string,
    assignments?: {
      frontend: {
        agentId: string;
        transport: "bearer-jwt" | "http-only-session-cookie";
      };
      backend: {
        agentId: string;
        transport: "bearer-jwt" | "http-only-session-cookie";
      };
    },
  ) =>
    request<{
      status: "accepted";
      missionId: string;
      executionMode: "live" | "deterministic";
    }>("/api/shepherd/messages", {
      method: "POST",
      body: JSON.stringify({
        content,
        preset: "auth-demo",
        clientMessageId: crypto.randomUUID(),
        ...(assignments === undefined ? {} : { assignments }),
      }),
    }),
  groupMessages: (projectId: string, limit = 200) =>
    request<{ messages: ProjectGroupMessage[] }>(
      `/api/shepherd/projects/${idPath(projectId)}/group-messages?limit=${limit}`,
    ),
  sendGroupMessage: (
    projectId: string,
    body: {
      clientMessageId: string;
      content: string;
      assignmentPreset?: "auth-demo-contract";
    },
  ) =>
    request<{ message: ProjectGroupMessage; missionId?: string; contractId?: string }>(
      `/api/shepherd/projects/${idPath(projectId)}/group-messages`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  cancelMission: (id: string) =>
    request<unknown>(
      `/api/shepherd/missions/${idPath(id)}/cancel`,
      { method: "POST", body: "{}" },
    ),
  selectCandidate: (collisionId: string, candidateId: string) =>
    request<unknown>(
      `/api/shepherd/collisions/${idPath(collisionId)}/select`,
      { method: "POST", body: JSON.stringify({ candidateId }) },
    ),
  resetDemo: () =>
    request<unknown>("/api/shepherd/demo/reset", {
      method: "POST",
      body: "{}",
    }),
  settings: async () => {
    const value = await request<ShepherdSettings | { settings: ShepherdSettings }>(
      "/api/shepherd/settings",
    );
    return { settings: unwrapDetail(value, "settings") };
  },
  updateSettings: async (body: Partial<Omit<ShepherdSettings, "updatedAt">>) => {
    const value = await request<ShepherdSettings | { settings: ShepherdSettings }>(
      "/api/shepherd/settings",
      { method: "PATCH", body: JSON.stringify(body) },
    );
    return { settings: unwrapDetail(value, "settings") };
  },
  plane: async (id: string) => {
    const value = await request<Plane | { plane: Plane }>(
      `/api/shepherd/planes/${idPath(id)}`,
    );
    return { plane: unwrapDetail(value, "plane") };
  },
  collision: async (id: string) => {
    const value = await request<SemanticCollision | { collision: SemanticCollision }>(
      `/api/shepherd/collisions/${idPath(id)}`,
    );
    return { collision: unwrapDetail(value, "collision") };
  },
  candidate: async (id: string) => {
    const value = await request<ResolutionCandidate | { candidate: ResolutionCandidate }>(
      `/api/shepherd/candidates/${idPath(id)}`,
    );
    return { candidate: unwrapDetail(value, "candidate") };
  },
};
