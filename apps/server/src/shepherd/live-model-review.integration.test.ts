import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, isShepherdModelReviewConfigured } from "../config.js";
import { JsonStore } from "../store.js";
import { BEARER_TRANSPORT, COOKIE_TRANSPORT } from "./auth-fixture.js";
import {
  ArkModelReviewer,
  type ModelReviewResult,
  type ModelReviewer,
} from "./model-reviewer.js";
import { ShepherdService } from "./service.js";
import { HostTrustedFixtureVerifier } from "./test-fixtures/host-trusted-verifier.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const liveRoot = path.join(repositoryRoot, ".tmp", "shepherd-live-model-review");
const liveRootSentinel = path.join(liveRoot, ".live-model-review-root");
const liveRootSentinelValue = "shepherd live model review gate only\n";
const liveEvidencePath = path.join(
  repositoryRoot,
  ".tmp",
  "shepherd-live-model-review-outcome.txt",
);

/**
 * Double gate. `npm run test:shepherd:live` sets only SHEPHERD_LIVE_TEST and
 * targets one file by path; the second variable keeps this suite out of any
 * future broadening of that glob so model capacity is never spent implicitly.
 */
const liveEnabled =
  process.env.SHEPHERD_LIVE_TEST === "true" &&
  process.env.SHEPHERD_LIVE_MODEL_REVIEW === "true";

/** Degradation is designed behaviour, so it must not fail this gate. */
const ACCEPTABLE_DEGRADED_REASONS = new Set([
  "timeout",
  "rate_limited",
  "provider_error",
  "invalid_response",
  "incomplete_response",
]);

/** A real misconfiguration must fail loudly rather than read as a soft degrade. */
const FATAL_DEGRADED_REASONS = new Set([
  "authentication_error",
  "configuration_error",
  "invalid_input",
  "storage_contract_violation",
]);

class CountingReviewer implements ModelReviewer {
  calls = 0;
  lastResult: ModelReviewResult | null = null;

  constructor(private readonly inner: ModelReviewer) {}

  async review(input: unknown, signal?: AbortSignal): Promise<ModelReviewResult> {
    this.calls += 1;
    this.lastResult = await this.inner.review(input, signal);
    return this.lastResult;
  }
}

async function entryExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function isStrictChild(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

async function prepareLiveRoot(): Promise<void> {
  const expectedRelative = path.join(".tmp", "shepherd-live-model-review");
  if (path.relative(repositoryRoot, liveRoot) !== expectedRelative) {
    throw new Error("Live model-review root is not the exact repository-local target");
  }
  if (await entryExists(liveRoot)) {
    const metadata = await lstat(liveRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Live model-review root is not a real directory");
    }
    if ((await readFile(liveRootSentinel, "utf8")) !== liveRootSentinelValue) {
      throw new Error("Live model-review root sentinel mismatch");
    }
    const canonicalRoot = await realpath(liveRoot);
    if (!isStrictChild(repositoryRoot, canonicalRoot)) {
      throw new Error("Live model-review cleanup target escaped the repository");
    }
    await rm(canonicalRoot, { recursive: true, force: true });
  }
  await mkdir(liveRoot, { recursive: true, mode: 0o700 });
  await writeFile(liveRootSentinel, liveRootSentinelValue, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function gitOutput(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: "/nonexistent",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
          LANG: "C",
          LC_ALL: "C",
        },
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 262_144,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      },
    );
  });
}

describe.skipIf(!liveEnabled)("Shepherd live SHEPHERD_MODEL advisory review", () => {
  beforeAll(async () => {
    await prepareLiveRoot();
  });

  afterAll(async () => {
    if (!(await entryExists(liveRoot))) return;
    const canonicalRoot = await realpath(liveRoot);
    if (!isStrictChild(repositoryRoot, canonicalRoot)) return;
    await rm(canonicalRoot, { recursive: true, force: true });
  });

  it(
    "runs exactly one bounded live review without changing the deterministic outcome",
    async () => {
      const config = loadConfig();
      // Fail loudly rather than silently passing an unconfigured no-op.
      expect(isShepherdModelReviewConfigured(config)).toBe(true);

      const caseRoot = await mkdtemp(path.join(liveRoot, "case-"));
      const storePath = path.join(caseRoot, "state.json");
      const secrets = [config.arkApiKey, config.authToken].filter(
        (value) => value.length >= 4,
      );
      const store = new JsonStore(storePath, { sensitiveValues: secrets });
      await store.initialize();

      // Only SHEPHERD_MODEL is live. The Mission itself stays deterministic and
      // container-free, so this gate costs exactly one provider request.
      const reviewer = new CountingReviewer(
        new ArkModelReviewer({
          enabled: true,
          baseUrl: config.arkBaseUrl,
          apiKey: config.arkApiKey,
          model: config.shepherdModel,
          timeoutMs: 30_000,
          sensitiveValues: secrets,
        }),
      );
      const service = new ShepherdService({
        store,
        managedRoot: path.join(caseRoot, "managed"),
        agentWorkspaceRoot: path.join(caseRoot, "agent-workspaces"),
        verifier: new HostTrustedFixtureVerifier(),
        sensitiveValues: secrets,
        reviewer,
      });
      await service.initialize();

      const result = await service.runDeterministicDemo();

      // Exactly one live request per Mission.
      expect(reviewer.calls).toBe(1);
      const status = reviewer.lastResult?.status;
      expect(status).toBeDefined();

      // Bounded, credential-free evidence line. Closed enums and a count only:
      // no model prose, no finding text, no configuration values.
      const observed =
        reviewer.lastResult?.status === "completed"
          ? `completed findings=${reviewer.lastResult.findings.length}`
          : reviewer.lastResult?.status === "degraded"
            ? `degraded reason=${reviewer.lastResult.reason} retryable=${reviewer.lastResult.retryable}`
            : String(reviewer.lastResult?.status);
      console.log(`[live-model-review] observed outcome: ${observed}`);
      // Durable, credential-free evidence for the build log. Written beside the
      // live root so the root's safety cleanup cannot remove it.
      await writeFile(liveEvidencePath, `${observed}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      if (reviewer.lastResult?.status === "degraded") {
        const reason = reviewer.lastResult.reason;
        expect(FATAL_DEGRADED_REASONS.has(reason)).toBe(false);
        expect(ACCEPTABLE_DEGRADED_REASONS.has(reason)).toBe(true);
      }

      // The live model changed nothing that carries authority.
      const detail = service.missionDetail(result.mission.id);
      expect(detail).not.toBeNull();
      if (!detail) throw new Error("Mission detail was not persisted");
      expect(detail.mission.state).toBe("completed");
      expect(detail.collisions).toHaveLength(1);
      expect(detail.collisions[0]?.key).toBe("auth.transport");
      expect(detail.collisions[0]?.detectionMechanism).toBe("deterministic");
      const selected = detail.candidates.find(
        (candidate) => candidate.selectionState === "selected",
      );
      expect(selected?.targetValue).toBe(COOKIE_TRANSPORT);
      expect(selected?.promotionState).toBe("promoted");
      expect(
        detail.candidates.find((candidate) => candidate.selectionState === "rejected")
          ?.targetValue,
      ).toBe(BEARER_TRANSPORT);
      expect(result.promotedHead).toBe(
        await gitOutput(detail.project.repositoryPath, ["rev-parse", "HEAD"]),
      );

      // Exactly one advisory event, matching the observed live outcome.
      const advisory = detail.events.filter((event) =>
        event.type.startsWith("model_review_"),
      );
      expect(advisory).toHaveLength(1);
      expect(advisory[0]?.type).toBe(
        reviewer.lastResult?.status === "completed"
          ? "model_review_completed"
          : "model_review_degraded",
      );

      // Boolean assertions only: a failure diff must never echo a credential.
      const persisted = await readFile(storePath, "utf8");
      for (const secret of secrets) {
        expect(persisted.includes(secret)).toBe(false);
        expect(JSON.stringify(service.state()).includes(secret)).toBe(false);
      }
    },
    600_000,
  );
});
