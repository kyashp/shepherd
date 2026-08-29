import { describe, expect, it } from "vitest";
import {
  buildCodexArgs,
  parseCodexEventLine,
  requireEphemeralThreadId,
  resolveRunnerTimeoutMs,
} from "./codex-runner.js";

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
    expect(args.slice(-3)).toEqual(["resume", "thread-123", "add tests"]);
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
});
