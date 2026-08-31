import { describe, expect, it } from "vitest";
import {
  buildCodexArgs,
  CodexRunner,
  parseCodexEventLine,
  requireEphemeralThreadId,
  resolveRunnerTimeoutMs,
} from "./codex-runner.js";
import { loadConfig } from "./config.js";

describe("Codex runner protocol", () => {
  it("builds a new-session invocation", () => {
    const args = buildCodexArgs(
      {
        agentId: "agent",
        workspacePath: "/tmp/workspace",
        prompt: "build a calculator",
        threadId: null,
      },
      "workspace-write",
    );
    expect(args).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-C",
      "/tmp/workspace",
      "--",
      "build a calculator",
    ]);
  });

  it("resumes a stored Codex thread", () => {
    const args = buildCodexArgs(
      {
        agentId: "agent",
        workspacePath: "/tmp/workspace",
        prompt: "add tests",
        threadId: "thread-123",
      },
      "workspace-write",
    );
    // `--` separates the operands: without it a prompt or thread id beginning with
    // `-` is parsed by the Codex CLI as an option on the same argv as `--sandbox`.
    expect(args.slice(-4)).toEqual(["resume", "--", "thread-123", "add tests"]);
  });

  it("builds the pinned fresh invocation without placing the prompt in argv", () => {
    const prompt = "sensitive structured execution prompt";
    const request = {
      mode: "fresh-ephemeral" as const,
      agentId: "plane-execution-1",
      workspacePath: "/tmp/execution-workspace",
      prompt,
      threadId: null,
      codexHome: "/tmp/private-codex-home",
      timeoutMs: 12_345,
    };
    expect(buildCodexArgs(request, "workspace-write", "/workspace")).toEqual([
      "exec",
      "--ephemeral",
      "--json",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "-C",
      "/workspace",
      "-",
    ]);
    expect(buildCodexArgs(request, "workspace-write")).not.toContain(prompt);
    expect(resolveRunnerTimeoutMs(request, 999_999)).toBe(12_345);
  });

  it("extracts the session, final message and usage", () => {
    const parsed = {
      messages: [] as string[],
      threadId: null as string | null,
      usage: null as {
        inputTokens?: number;
        cachedInputTokens?: number;
        outputTokens?: number;
      } | null,
      errors: [] as string[],
    };
    parseCodexEventLine(
      JSON.stringify({ type: "thread.started", thread_id: "thread-123" }),
      parsed,
    );
    parseCodexEventLine(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Done." },
      }),
      parsed,
    );
    parseCodexEventLine(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, output_tokens: 4 },
      }),
      parsed,
    );
    expect(parsed.threadId).toBe("thread-123");
    expect(parsed.messages).toEqual(["Done."]);
    expect(parsed.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
  });

  it("rejects missing, duplicate, or malformed ephemeral thread events", () => {
    const parsed = {
      messages: [],
      threadId: null,
      usage: null,
      errors: [],
      threadIds: [] as string[],
    };
    expect(() => requireEphemeralThreadId(parsed)).toThrow("did not emit");
    parsed.threadIds.push("thread-1", "thread-1");
    expect(() => requireEphemeralThreadId(parsed)).toThrow("duplicate");
    parsed.threadIds.splice(0, 2, "thread-1\n");
    expect(() => requireEphemeralThreadId(parsed)).toThrow("invalid thread ID");
  });

  it("ignores malformed events and bounds every optional event field", () => {
    const parsed = {
      messages: [] as string[],
      threadId: null as string | null,
      usage: null as Record<string, number> | null,
      errors: [] as string[],
      threadIds: [] as string[],
    };
    for (const event of [
      "not-json",
      JSON.stringify({ type: "thread.started", thread_id: 42 }),
      JSON.stringify({ type: "item.completed", item: null }),
      JSON.stringify({ type: "item.completed", item: { type: "tool", text: "private" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: 42 } }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: -1, cached_input_tokens: 2, output_tokens: -1 },
      }),
      JSON.stringify({ type: "error", message: "primary" }),
      JSON.stringify({ type: "error", error: "fallback" }),
      JSON.stringify({ type: "error" }),
    ]) {
      parseCodexEventLine(event, parsed);
    }
    expect(parsed.messages).toEqual([]);
    expect(parsed.usage).toEqual({ cachedInputTokens: 2 });
    expect(parsed.errors).toEqual([
      "primary",
      "fallback",
      "Codex reported an unknown error",
    ]);
  });

  it("rejects invalid fresh requests, timeouts, and thread identifiers", () => {
    const invalidFresh = {
      mode: "fresh-ephemeral" as const,
      agentId: "plane",
      workspacePath: "/tmp/workspace",
      prompt: "bounded",
      threadId: "must-not-resume",
      codexHome: "/tmp/codex-home",
      timeoutMs: 999,
    };
    const malformedFresh = invalidFresh as unknown as Parameters<typeof buildCodexArgs>[0];
    expect(() => buildCodexArgs(malformedFresh, "workspace-write")).toThrow(
      "cannot resume",
    );
    expect(() => resolveRunnerTimeoutMs(malformedFresh, 2_000)).toThrow(
      "at least 1000",
    );
    expect(() => resolveRunnerTimeoutMs({
      agentId: "agent",
      workspacePath: "/tmp/workspace",
      prompt: "bounded",
      threadId: null,
    }, Number.NaN)).toThrow("at least 1000");

    const parsed = {
      messages: [],
      threadId: null,
      usage: null,
      errors: [],
      threadIds: ["x".repeat(513)],
    };
    expect(() => requireEphemeralThreadId(parsed)).toThrow("invalid thread ID");
    parsed.threadIds = [" thread-id"];
    expect(() => requireEphemeralThreadId(parsed)).toThrow("invalid thread ID");
    parsed.threadIds = ["thread-id"];
    expect(requireEphemeralThreadId(parsed)).toBe("thread-id");
    expect(() => requireEphemeralThreadId({
      messages: [],
      threadId: null,
      usage: null,
      errors: [],
    })).toThrow("did not emit");
  });

  it("rejects duplicate local runs and treats cancellation of an idle Agent as a no-op", async () => {
    const runner = new CodexRunner(loadConfig({
      NODE_ENV: "test",
      CODEX_BIN: "/definitely/missing/codex",
    }));
    await expect(runner.cancel("idle-agent")).resolves.toBe(false);
    const internals = runner as unknown as { active: Map<string, unknown> };
    internals.active.set("busy-agent", {});
    await expect(runner.run({
      agentId: "busy-agent",
      workspacePath: "/tmp/workspace",
      prompt: "bounded",
      threadId: null,
    })).rejects.toThrow("already has an active Codex process");
  });
});
