import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RunUsage } from "../types.js";
import type { ContractResultManifest } from "./domain.js";
import {
  AUTH_CLAIM_KEY,
  AUTH_BACKEND_CONTEXT_PATH,
  AUTH_FRONTEND_CONTEXT_PATH,
  BEARER_TRANSPORT,
  clientReadableForTransport,
  COOKIE_TRANSPORT,
  type AuthTransport,
} from "./auth-fixture.js";

export type DeterministicOperation =
  | {
      kind: "frontend_contract";
      contractId: string;
      targetTransport?: AuthTransport;
      deriveTransportFromScopedContext?: boolean;
    }
  | {
      kind: "backend_contract";
      contractId: string;
      targetTransport?: AuthTransport;
      deriveTransportFromScopedContext?: boolean;
    }
  | {
      kind: "resolution_candidate";
      candidateId: string;
      targetTransport: AuthTransport;
    }
  | {
      kind: "general_contract";
      contractId: string;
      artifactPaths: string[];
      requiredContent: string | null;
    };

export interface ShepherdExecutionRequest {
  executionId: string;
  workspacePath: string;
  operation: DeterministicOperation;
  /** Fully constructed, bounded control-plane prompt; required by live execution. */
  prompt?: string;
  timeoutMs: number;
}

export interface ShepherdExecutionResult {
  summary: string;
  changedFiles: string[];
  completedAt: string;
  /** Transient Runtime identifier. Callers must persist only a one-way fingerprint. */
  runtimeSessionId: string | null;
  usage: RunUsage | null;
}

export type ShepherdExecutorKind = "deterministic_fixture" | "codex_ephemeral";

export interface ShepherdExecutor {
  readonly kind: ShepherdExecutorKind;
  run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult>;
  cancel(executionId: string): Promise<boolean>;
  reconcileInterrupted?(): Promise<number>;
  /** Bounded, no-model-spend startup validation for live execution. */
  preflight?(): Promise<void>;
  isAvailable?(): Promise<boolean>;
}

function resolveInside(root: string, relativePath: string): string {
  const destination = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), destination);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Execution output escaped the Plane workspace");
  }
  return destination;
}

async function writeJson(
  root: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  const destination = resolveInside(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function authValue(transport: AuthTransport) {
  return {
    transport,
    clientReadableCredential: clientReadableForTransport(transport),
  };
}

async function transportFromScopedContext(
  workspacePath: string,
  role: "Frontend" | "Backend",
): Promise<AuthTransport> {
  const relativePath =
    role === "Frontend" ? AUTH_FRONTEND_CONTEXT_PATH : AUTH_BACKEND_CONTEXT_PATH;
  const parsed = JSON.parse(
    await readFile(resolveInside(workspacePath, relativePath), "utf8"),
  ) as Record<string, unknown>;
  if (
    role === "Frontend" &&
    parsed.surface === "browser-client" &&
    parsed.requestConvention === "include ambient browser credentials" &&
    parsed.credentialVisibility ===
      "credential material must not be readable by client JavaScript"
  ) {
    return COOKIE_TRANSPORT;
  }
  if (
    role === "Backend" &&
    parsed.surface === "stateless-api" &&
    parsed.deploymentConvention ===
      "requests may land on any horizontally scaled instance" &&
    parsed.credentialIngress ===
      "signed request-carried claims arrive in the Authorization header"
  ) {
    return BEARER_TRANSPORT;
  }
  throw new Error("Scoped authentication context is missing or unsupported");
}

export class DeterministicFixtureExecutor implements ShepherdExecutor {
  readonly kind = "deterministic_fixture" as const;
  private readonly active = new Map<string, AbortController>();

  async run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult> {
    if (this.active.has(request.executionId)) {
      throw new Error("Execution identity is already active");
    }
    const controller = new AbortController();
    this.active.set(request.executionId, controller);
    try {
      if (controller.signal.aborted) throw new Error("Execution cancelled");
      switch (request.operation.kind) {
        case "frontend_contract":
          {
            const transport = request.operation.deriveTransportFromScopedContext
              ? await transportFromScopedContext(request.workspacePath, "Frontend")
              : request.operation.targetTransport ?? BEARER_TRANSPORT;
          return await this.writeContract(
            request.workspacePath,
            request.operation.contractId,
            "src/frontend/auth.json",
            transport,
            transport === BEARER_TRANSPORT
              ? "Frontend auth client uses a bearer JWT."
              : "Frontend auth client uses an HttpOnly session cookie.",
          );
          }
        case "backend_contract":
          {
            const transport = request.operation.deriveTransportFromScopedContext
              ? await transportFromScopedContext(request.workspacePath, "Backend")
              : request.operation.targetTransport ?? COOKIE_TRANSPORT;
          return await this.writeContract(
            request.workspacePath,
            request.operation.contractId,
            "src/backend/auth.json",
            transport,
            transport === BEARER_TRANSPORT
              ? "Backend auth service uses a bearer JWT."
              : "Backend auth service uses an HttpOnly session cookie.",
          );
          }
        case "resolution_candidate": {
          const value = authValue(request.operation.targetTransport);
          await Promise.all([
            writeJson(request.workspacePath, "src/frontend/auth.json", value),
            writeJson(request.workspacePath, "src/backend/auth.json", value),
          ]);
          return {
            summary:
              "Reconciled authentication transport to " +
              request.operation.targetTransport,
            changedFiles: ["src/frontend/auth.json", "src/backend/auth.json"],
            completedAt: new Date().toISOString(),
            runtimeSessionId: null,
            usage: null,
          };
        }
        case "general_contract":
          return await this.writeGeneralContract(
            request.workspacePath,
            request.operation.contractId,
            request.operation.artifactPaths,
            request.operation.requiredContent,
          );
      }
    } finally {
      this.active.delete(request.executionId);
    }
  }

  async cancel(executionId: string): Promise<boolean> {
    const controller = this.active.get(executionId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  private async writeContract(
    workspacePath: string,
    contractId: string,
    artifactPath: string,
    transport: AuthTransport,
    summary: string,
  ): Promise<ShepherdExecutionResult> {
    await writeJson(workspacePath, artifactPath, authValue(transport));
    const manifest: ContractResultManifest = {
      schemaVersion: 1,
      contractId,
      summary,
      artifacts: [
        {
          path: artifactPath,
          kind: "changed",
          description: "Authentication transport implementation",
        },
      ],
      semanticClaims: [
        {
          key: AUTH_CLAIM_KEY,
          value: transport,
          scope: "authentication",
          mode: "exclusive",
          evidence: [
            {
              path: artifactPath,
              description: "Transport and credential exposure behavior",
            },
          ],
        },
      ],
      agentDeclaredTests: [
        {
          name: "local contract check",
          passed: true,
          summary: "Informational only; Shepherd independently verifies it.",
        },
      ],
      notes: "Deterministic fixture output",
    };
    await writeJson(workspacePath, ".shepherd/result.json", manifest);
    return {
      summary,
      changedFiles: [artifactPath, ".shepherd/result.json"],
      completedAt: new Date().toISOString(),
      runtimeSessionId: null,
      usage: null,
    };
  }

  private async writeGeneralContract(
    workspacePath: string,
    contractId: string,
    artifactPaths: readonly string[],
    requiredContent: string | null,
  ): Promise<ShepherdExecutionResult> {
    const content = (requiredContent ?? "Completed general Shepherd Contract") + "\n";
    for (const artifactPath of artifactPaths) {
      const destination = resolveInside(workspacePath, artifactPath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }
    const manifest: ContractResultManifest = {
      schemaVersion: 1,
      contractId,
      summary: "Completed the bounded general Shepherd Contract.",
      artifacts: artifactPaths.map((artifactPath) => ({
        path: artifactPath,
        kind: "changed" as const,
        description: "Required artifact from the confirmed Contract",
      })),
      semanticClaims: [],
      agentDeclaredTests: [
        {
          name: "general Contract output",
          passed: true,
          summary: "Informational only; Shepherd independently verifies it.",
        },
      ],
      notes: "Deterministic fixture output",
    };
    await writeJson(workspacePath, ".shepherd/result.json", manifest);
    return {
      summary: manifest.summary,
      changedFiles: [...artifactPaths, ".shepherd/result.json"],
      completedAt: new Date().toISOString(),
      runtimeSessionId: null,
      usage: null,
    };
  }
}
