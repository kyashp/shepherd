import { describe, expect, it } from "vitest";
import { parseProjectGroupMessage } from "../../../server/src/shepherd/group-routing.js";
import {
  formatProjectGroupMention,
  prependProjectGroupMention,
} from "./project-group-mention.js";

describe("formatProjectGroupMention", () => {
  it("quotes and JSON-escapes Agent names that are not safe mention tokens", () => {
    expect(formatProjectGroupMention("Frontend Agent", "agent-frontend")).toBe('@"Frontend Agent"');
    expect(formatProjectGroupMention('A "quoted" \\ Agent', "agent-quoted")).toBe(
      '@"A \\"quoted\\" \\\\ Agent"',
    );
  });

  it("keeps parser-safe Agent names concise", () => {
    expect(formatProjectGroupMention("Frontend", "agent-frontend")).toBe("@Frontend");
    expect(formatProjectGroupMention("工程師_2", "agent-unicode")).toBe("@工程師_2");
  });

  it("falls back to the Agent ID when message normalization would change the name", () => {
    const agents = [
      { id: "agent-frontend", name: "Frontend  Agent" },
      { id: "agent-safe-id", name: "Unsafe\u0000Agent" },
    ];

    for (const agent of agents) {
      const mention = formatProjectGroupMention(agent.name, agent.id);
      expect(mention).toBe(`@${agent.id}`);
      expect(parseProjectGroupMessage(`${mention} keep routing`, agents)).toMatchObject({
        kind: "agent",
        agentId: agent.id,
        content: "keep routing",
      });
    }
  });

  it("normalizes syntax-changing Unicode before quoting a safe Agent name", () => {
    const agent = { id: "agent-frontend", name: "Frontend ＂Agent＂" };
    const mention = formatProjectGroupMention(agent.name, agent.id);

    expect(mention).toBe('@"Frontend \\"Agent\\""');
    expect(parseProjectGroupMessage(`${mention} keep routing`, [agent])).toMatchObject({
      kind: "agent",
      agentId: agent.id,
      content: "keep routing",
    });
  });

  it("applies the parser directory's post-normalization trim before quoting", () => {
    const agent = { id: "agent-normalized-trim", name: "\u037A" };
    const mention = formatProjectGroupMention(agent.name, agent.id);

    expect(mention).toBe('@"\u0345"');
    expect(parseProjectGroupMessage(`${mention} keep routing`, [agent])).toMatchObject({
      kind: "agent",
      agentId: agent.id,
      content: "keep routing",
    });
  });
});

describe("prependProjectGroupMention", () => {
  it("prepends a formatted mention without replacing composer content", () => {
    expect(
      prependProjectGroupMention(
        "Frontend Agent",
        "agent-frontend",
        "Keep this draft\nincluding its second line",
      ),
    ).toBe('@"Frontend Agent" Keep this draft\nincluding its second line');
  });
});
