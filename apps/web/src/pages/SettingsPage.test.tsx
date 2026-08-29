import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelReviewSettingsSection, NotificationSettingsSection } from "./SettingsPage";

describe("NotificationSettingsSection", () => {
  it("shows stored preferences as reserved and unavailable controls", () => {
    const markup = renderToStaticMarkup(
      <NotificationSettingsSection
        notifications={{
          missionCompleted: true,
          attentionRequired: false,
          collisionDetected: true,
        }}
      />,
    );
    const checkboxes = markup.match(/<input[^>]+type="checkbox"[^>]*>/gu) ?? [];

    expect(markup).toContain("Reserved for a future release");
    expect(markup).toContain("Unavailable");
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes.every((checkbox) => checkbox.includes("disabled=\"\""))).toBe(true);
    expect(checkboxes.filter((checkbox) => checkbox.includes("checked=\"\"")).length).toBe(2);
  });
});

describe("ModelReviewSettingsSection", () => {
  it.each([true, false])("preserves stored preference %s in an unavailable native control", (enabled) => {
    const markup = renderToStaticMarkup(
      <ModelReviewSettingsSection
        configured={false}
        enabled={enabled}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain("Unavailable");
    expect(markup).toContain("not configured for this running process");
    expect(markup).toContain('disabled=""');
    expect(markup.includes('checked=""')).toBe(enabled);
  });

  it.each([true, false])("keeps stored preference %s editable when the reviewer is configured", (enabled) => {
    const markup = renderToStaticMarkup(
      <ModelReviewSettingsSection
        configured
        enabled={enabled}
        onChange={() => undefined}
      />,
    );

    expect(markup).not.toContain("Unavailable");
    expect(markup).not.toContain('disabled=""');
    expect(markup.includes('checked=""')).toBe(enabled);
  });
});
