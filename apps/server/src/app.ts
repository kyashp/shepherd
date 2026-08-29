import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { HttpError } from "./errors.js";
import type { AgentService } from "./agent-service.js";
import type {
  Plane,
  ShepherdDatabase,
  ShepherdEvent,
  ShepherdProject,
} from "./shepherd/domain.js";
import type {
  ShepherdMissionDetail,
  ShepherdService,
} from "./shepherd/service.js";
import { redactText } from "./shepherd/redaction.js";
import type { Agent } from "./types.js";

export type { ShepherdMissionDetail } from "./shepherd/service.js";

export type ShepherdHttpService = Pick<
  ShepherdService,
  "state" | "missionDetail" | "eventsAfter" | "startDeterministicDemo"
>;

type PublicShepherdProject = Omit<ShepherdProject, "repositoryPath">;
type PublicPlane = Omit<
  Plane,
  "worktreePath" | "runtimeSessionFingerprint"
> & {
  runtimeSessionEstablished: boolean;
};
export type PublicAgent = Pick<
  Agent,
  | "id"
  | "name"
  | "description"
  | "instructions"
  | "status"
  | "codexThreadId"
  | "lastError"
  | "role"
  | "authority"
  | "currentContractId"
  | "createdAt"
  | "updatedAt"
>;

export type PublicShepherdState = Omit<ShepherdDatabase, "projects" | "planes"> & {
  projects: PublicShepherdProject[];
  planes: PublicPlane[];
};

export type PublicShepherdMissionDetail = Omit<
  ShepherdMissionDetail,
  "project" | "agents" | "planes"
> & {
  project: PublicShepherdProject;
  agents: PublicAgent[];
  planes: PublicPlane[];
};

const withoutProjectPath = (project: ShepherdProject): PublicShepherdProject => {
  const { repositoryPath, ...publicProject } = project;
  void repositoryPath;
  return publicProject;
};

const withoutPlanePath = (plane: Plane): PublicPlane => {
  const { worktreePath, runtimeSessionFingerprint, ...publicPlane } = plane;
  void worktreePath;
  return {
    ...publicPlane,
    runtimeSessionEstablished: Boolean(runtimeSessionFingerprint),
  };
};

export const toPublicAgent = (agent: Agent): PublicAgent => {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    status: agent.status,
    codexThreadId: agent.codexThreadId,
    lastError: agent.lastError,
    ...(agent.role === undefined ? {} : { role: agent.role }),
    ...(agent.authority === undefined ? {} : { authority: agent.authority }),
    ...(agent.currentContractId === undefined
      ? {}
      : { currentContractId: agent.currentContractId }),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
};

export const toPublicShepherdState = (
  state: ShepherdDatabase,
): PublicShepherdState => ({
  ...state,
  projects: state.projects.map(withoutProjectPath),
  planes: state.planes.map(withoutPlanePath),
});

export const toPublicMissionDetail = (
  detail: ShepherdMissionDetail,
): PublicShepherdMissionDetail => ({
  ...detail,
  project: withoutProjectPath(detail.project),
  agents: detail.agents.map(toPublicAgent),
  planes: detail.planes.map(withoutPlanePath),
});

const filesystemPathPattern =
  /(?:[A-Za-z]:[\\/]|\/)(?:[^\s\\/]+[\\/])*[^\s,;:)}\]'"`]*/gu;

const internalErrorForLog = (
  error: Error,
  secrets: readonly string[],
): { errorName: string; errorMessage: string } => ({
  errorName: redactText(error.name, { secrets, maxStringLength: 80 }),
  errorMessage: redactText(error.message, {
    secrets,
    maxStringLength: 500,
  }).replace(filesystemPathPattern, "[PATH]"),
});

const agentIdParams = z.object({ id: z.string().uuid() });
const runIdParams = z.object({ id: z.string().uuid() });
const createAgentBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  instructions: z.string().max(10_000).optional(),
});
const updateAgentBody = createAgentBody.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required",
);
const messageBody = z.object({
  content: z.string().trim().min(1).max(50_000),
});
const missionIdParams = z
  .object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/) })
  .strict();
const decimalInteger = (name: string, minimum: number, maximum: number) =>
  z
    .string()
    .regex(/^\d+$/, `${name} must be a decimal integer`)
    .transform((value) => Number(value))
    .refine(
      (value) => Number.isSafeInteger(value) && value >= minimum && value <= maximum,
      `${name} must be between ${minimum} and ${maximum}`,
    );
const eventQuery = z
  .object({
    cursor: decimalInteger("cursor", 0, Number.MAX_SAFE_INTEGER).optional(),
    limit: decimalInteger("limit", 1, 200).optional(),
  })
  .strict();
const emptyDemoBody = z.object({}).strict();

export async function createApp(
  config: AppConfig,
  service: AgentService,
  shepherdService?: ShepherdHttpService,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin:
      config.nodeEnv === "development"
        ? ["http://localhost:5173", "http://127.0.0.1:5173"]
        : false,
  });

  app.addHook("onRequest", async (request, reply) => {
    if (
      !config.authToken ||
      !request.url.startsWith("/api/") ||
      request.url === "/api/health" ||
      request.url === "/api/auth"
    ) {
      return;
    }
    const header = request.headers.authorization ?? "";
    const candidate = header.startsWith("Bearer ") ? header.slice(7) : "";
    const expectedBuffer = Buffer.from(config.authToken);
    const candidateBuffer = Buffer.from(candidate);
    const valid =
      candidateBuffer.length === expectedBuffer.length &&
      timingSafeEqual(candidateBuffer, expectedBuffer);
    if (!valid) {
      return reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    service: "volc-agent-launchpad",
  }));

  app.get("/api/auth", async () => ({ required: config.authToken.length > 0 }));

  app.get("/api/system", async () => service.systemInfo());

  app.get("/api/agents", async () => ({
    agents: service.listAgents().map(toPublicAgent),
  }));

  app.post("/api/agents", async (request, reply) => {
    const body = createAgentBody.parse(request.body);
    const agent = await service.createAgent(body);
    return reply.code(201).send({ agent: toPublicAgent(agent) });
  });

  app.get("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: toPublicAgent(service.getAgent(id)) };
  });

  app.patch("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    const body = updateAgentBody.parse(request.body);
    return { agent: toPublicAgent(await service.updateAgent(id, body)) };
  });

  app.delete("/api/agents/:id", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return service.deleteAgent(id);
  });

  app.post("/api/agents/:id/start", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: toPublicAgent(await service.startAgent(id)) };
  });

  app.post("/api/agents/:id/stop", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { agent: toPublicAgent(await service.stopAgent(id)) };
  });

  app.get("/api/agents/:id/messages", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { messages: service.getMessages(id) };
  });

  app.get("/api/agents/:id/runs", async (request) => {
    const { id } = agentIdParams.parse(request.params);
    return { runs: service.getRuns(id) };
  });

  app.post("/api/agents/:id/messages", async (request, reply) => {
    const { id } = agentIdParams.parse(request.params);
    const body = messageBody.parse(request.body);
    const result = await service.sendMessage(id, body.content);
    return reply.code(202).send(result);
  });

  app.get("/api/runs/:id", async (request) => {
    const { id } = runIdParams.parse(request.params);
    return { run: service.getRun(id) };
  });

  if (shepherdService) {
    app.get("/api/shepherd/state", async () => ({
      state: toPublicShepherdState(shepherdService.state()),
    }));

    app.get("/api/shepherd/missions/:id", async (request) => {
      const { id } = missionIdParams.parse(request.params);
      const detail = shepherdService.missionDetail(id);
      if (!detail) {
        throw new HttpError(404, "Mission not found");
      }
      return toPublicMissionDetail(detail);
    });

    app.get("/api/shepherd/events", async (request) => {
      const query = eventQuery.parse(request.query);
      const cursor = query.cursor ?? 0;
      const events = shepherdService.eventsAfter(cursor, query.limit ?? 100);
      return {
        events,
        nextCursor: events.at(-1)?.sequence ?? cursor,
      };
    });

    app.post("/api/shepherd/demo/missions", async (request, reply) => {
      if (!config.shepherdDemoMode) {
        throw new HttpError(403, "Shepherd demo mode is disabled");
      }
      emptyDemoBody.parse(request.body ?? {});
      const accepted = await shepherdService.startDeterministicDemo({});
      return reply.code(202).send({
        status: "accepted",
        missionId: accepted.missionId,
        executionMode: config.shepherdExecutionMode,
      });
    });
  }

  if (config.nodeEnv === "production") {
    const webRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "API route not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const appError = error instanceof Error ? error : new Error(String(error));
    const validationError = error instanceof z.ZodError;
    const frameworkStatus =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : null;
    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : validationError
          ? 400
          : frameworkStatus && frameworkStatus >= 400 && frameworkStatus <= 599
            ? frameworkStatus
            : 500;
    if (statusCode >= 500) {
      request.log.error(
        internalErrorForLog(appError, [config.authToken, config.arkApiKey]),
        "Unhandled request error",
      );
    }
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : appError.message.slice(0, 500),
      ...(validationError
        ? {
            details: error.issues.slice(0, 20).map((issue) => ({
              code: issue.code,
              path: issue.path.slice(0, 12).map((part) => String(part).slice(0, 80)),
              message: issue.message.slice(0, 300),
            })),
          }
        : {}),
    });
  });

  return app;
}
