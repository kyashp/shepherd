import { describe, expect, it } from "vitest";
import {
  formatProjectGroupMention,
  prependProjectGroupMention,
} from "./project-group-mention.js";

describe("formatProjectGroupMention", () => {
  it("quotes and JSON-escapes Agent names that are not safe mention tokens", () => {
    expect(formatProjectGroupMention("Frontend Agent")).toBe('@"Frontend Agent"');
    expect(formatProjectGroupMention('A "quoted" \\ Agent')).toBe(
      '@"A \\"quoted\\" \\\\ Agent"',
    );
  });

  it("keeps parser-safe Agent names concise", () => {
    expect(formatProjectGroupMention("Frontend")).toBe("@Frontend");
    expect(formatProjectGroupMention("工程師_2")).toBe("@工程師_2");
  });
});

describe("prependProjectGroupMention", () => {
  it("prepends a formatted mention without replacing composer content", () => {
    expect(
      prependProjectGroupMention(
        "Frontend Agent",
        "Keep this draft\nincluding its second line",
      ),
    ).toBe('@"Frontend Agent" Keep this draft\nincluding its second line');
  });
});
