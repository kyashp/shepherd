import { execFile } from "node:child_process";
import type { VerificationCheckResult, VerificationEvidence } from "../domain.js";
import {
  AUTH_BACKEND_PROFILE_ID,
  AUTH_FRONTEND_PROFILE_ID,
  AUTH_PROJECT_PROFILE_ID,
  type ShepherdIndependentVerifier,
} from "../service.js";
import type { VerificationRequest } from "../verifier.js";

/**
 * Runs the real trusted fixture checks in-process so a Mission can be driven
 * end to end without a container runtime. Test-support only: it deliberately
 * has no container isolation and must never be composed in production.
 */
export class HostTrustedFixtureVerifier implements ShepherdIndependentVerifier {
  private sequence = 0;

  constructor(private readonly checkTimeoutMs = 15_000) {}

  async verify(request: VerificationRequest): Promise<VerificationEvidence> {
    const startedAt = new Date();
    const scripts: Record<string, string> = {
      [AUTH_FRONTEND_PROFILE_ID]: "checks/frontend.cjs",
      [AUTH_BACKEND_PROFILE_ID]: "checks/backend.cjs",
      [AUTH_PROJECT_PROFILE_ID]: "checks/project-security.cjs",
    };
    const checks: VerificationCheckResult[] = [];
    for (const check of request.checks) {
      const script = scripts[check.profileId];
      if (!script) {
        checks.push({
          id: check.id,
          name: check.name,
          profileId: check.profileId,
          mandatory: check.mandatory,
          status: "infrastructure_error",
          passed: false,
          exitCode: null,
          durationMs: 0,
          stdout: "",
          stderr: "",
          error: "Unknown trusted fixture profile",
        });
        continue;
      }
      const result = await this.executeNodeScript(request.planePath, script);
      const passed = result.exitCode === 0;
      checks.push({
        id: check.id,
        name: check.name,
        profileId: check.profileId,
        mandatory: check.mandatory,
        status: passed ? "passed" : "failed",
        passed,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        error: passed ? null : "Trusted fixture check exited non-zero",
      });
    }
    const completedAt = new Date();
    const mandatory = checks.filter((check) => check.mandatory);
    const mandatoryPassed = mandatory.filter((check) => check.passed).length;
    return {
      id: `host-evidence-${++this.sequence}`,
      targetType: request.targetType,
      targetId: request.targetId,
      runner: "independent",
      passed: mandatoryPassed === mandatory.length,
      checks,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
      changedFiles: [...request.changedFiles],
      summary: `${mandatoryPassed}/${mandatory.length} mandatory checks passed`,
    };
  }

  async reconcileInterrupted(): Promise<void> {}

  private executeNodeScript(
    cwd: string,
    script: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [script],
        {
          cwd,
          env: {
            PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
            HOME: cwd,
            LANG: "C",
            LC_ALL: "C",
            CI: "1",
          },
          encoding: "utf8",
          timeout: this.checkTimeoutMs,
          maxBuffer: 262_144,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          const candidate = error as
            | (NodeJS.ErrnoException & { code?: number | string })
            | null;
          resolve({
            exitCode:
              candidate === null
                ? 0
                : typeof candidate.code === "number"
                  ? candidate.code
                  : 1,
            stdout,
            stderr,
            durationMs: Math.max(0, Date.now() - startedAt),
          });
        },
      );
    });
  }
}
