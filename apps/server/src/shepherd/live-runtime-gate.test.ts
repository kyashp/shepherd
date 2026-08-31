import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveLiveRuntimeLayout } from "./live-runtime-gate.js";

describe("live Runtime gate layout", () => {
  it("keeps every mutable root inside the wrapper-provided named volume", () => {
    const layout = resolveLiveRuntimeLayout(
      {
        SHEPHERD_LIVE_GATE_ROOT: "/app/state/live-gate",
        CONTAINER_STATE_ROOT: "/app/state",
        CONTAINER_STATE_VOLUME: "shepherd-live-state-unit",
      },
      "/app",
    );

    expect(layout.containerStateRoot).toBe("/app/state");
    expect(layout.containerStateVolume).toBe("shepherd-live-state-unit");
    for (const root of [
      layout.liveRoot,
      layout.dataDirectory,
      layout.workspaceRoot,
      layout.codexHome,
      layout.shepherdRoot,
      layout.shepherdCodexHomeRoot,
    ]) {
      expect(path.relative("/app/state", root)).toMatch(/^(?!\.\.)[^/]/u);
    }
  });

  it("rejects a partial or escaping wrapper volume contract", () => {
    expect(() => resolveLiveRuntimeLayout({
      SHEPHERD_LIVE_GATE_ROOT: "/app/state/live-gate",
      CONTAINER_STATE_ROOT: "/app/state",
    }, "/app")).toThrow(/must be provided together/u);
    expect(() => resolveLiveRuntimeLayout({
      SHEPHERD_LIVE_GATE_ROOT: "/app/escape",
      CONTAINER_STATE_ROOT: "/app/state",
      CONTAINER_STATE_VOLUME: "shepherd-live-state-unit",
    }, "/app")).toThrow(/inside CONTAINER_STATE_ROOT/u);
  });
});
