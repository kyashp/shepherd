import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContractResultManifest } from "./domain.js";
import {
  AUTH_CLAIM_KEY,
  BEARER_TRANSPORT,
  clientReadableForTransport,
  COOKIE_TRANSPORT,
  type AuthTransport,
} from "./auth-fixture.js";

export type DeterministicOperation =
  | { kind: "frontend_contract"; contractId: string }
  | { kind: "backend_contract"; contractId: string }
  | {
      kind: "resolution_candidate";
      candidateId: string;
      targetTransport: AuthTransport;
    };

export interface ShepherdExecutionRequest {
  executionId: string;
  workspacePath: string;
  operation: DeterministicOperation;
}

export interface ShepherdExecutionResult {
  summary: string;
  changedFiles: string[];
  completedAt: string;
}

export interface ShepherdExecutor {
  run(request: ShepherdExecutionRequest): Promise<ShepherdExecutionResult>;
  cancel(executionId: string): Promise<boolean>;
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

export class DeterministicFixtureExecutor implements ShepherdExecutor {
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
          return await this.writeContract(
            request.workspacePath,
            request.operation.contractId,
            "src/frontend/auth.json",
            BEARER_TRANSPORT,
            "Frontend auth client uses a bearer JWT.",
          );
        case "backend_contract":
          return await this.writeContract(
            request.workspacePath,
            request.operation.contractId,
            "src/backend/auth.json",
            COOKIE_TRANSPORT,
            "Backend auth service uses an HttpOnly session cookie.",
          );
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
          };
        }
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
    };
  }
}
