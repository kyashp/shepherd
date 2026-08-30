import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseProjectGroupMessage } from "../../../server/src/shepherd/group-routing.js";
import { InitializeProjectGroupButton, ProjectGroupMentionButton } from "./ProjectGroupPage.js";
import {
  MAX_PROJECT_GROUP_MESSAGE_LENGTH,
  formatProjectGroupMention,
  prependProjectGroupMention,
  prependProjectGroupMentionWithinLimit,
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

  it("accepts an exact-boundary insertion and rejects one character over it", () => {
    const mentionLength = '@"Frontend Agent" '.length;
    const exactDraft = "x".repeat(MAX_PROJECT_GROUP_MESSAGE_LENGTH - mentionLength);

    expect(
      prependProjectGroupMentionWithinLimit("Frontend Agent", "agent-frontend", exactDraft),
    ).toHaveLength(MAX_PROJECT_GROUP_MESSAGE_LENGTH);
    expect(
      prependProjectGroupMentionWithinLimit("Frontend Agent", "agent-frontend", `${exactDraft}x`),
    ).toBeNull();
  });
});

describe("ProjectGroupMentionButton", () => {
  it("is natively disabled while a message submission is in flight", () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectGroupMentionButton, {
        agentName: "Frontend Agent",
        sending: true,
        onActivate: () => undefined,
      }),
    );

    expect(markup).toContain('disabled=""');
    expect(markup).toContain("@Frontend Agent");
  });
});

describe("InitializeProjectGroupButton", () => {
  it("offers the explicit safe initialization action without implying Mission execution", () => {
    const markup = renderToStaticMarkup(
      createElement(InitializeProjectGroupButton, {
        initializing: false,
        onInitialize: () => undefined,
      }),
    );

    expect(markup).toContain("Initialize Project Group");
    expect(markup).not.toContain("Start Mission");
    expect(markup).not.toContain("disabled");
  });
});
