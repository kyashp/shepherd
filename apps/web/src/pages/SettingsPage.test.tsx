import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotificationSettingsSection } from "./SettingsPage";

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
