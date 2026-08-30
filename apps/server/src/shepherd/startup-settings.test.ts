import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { JsonStore } from "../store.js";
import { ShepherdService } from "./service.js";
import { HostTrustedFixtureVerifier } from "./test-fixtures/host-trusted-verifier.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function caseRoot(): Promise<string> {
  const parent = path.resolve(process.cwd(), ".tmp", "startup-settings");
  const root = await mkdtemp(path.join(parent, "case-"));
  roots.push(root);
  return root;
}

async function service(root: string, options: Record<string, unknown>) {
  const store = new JsonStore(path.join(root, "state.json"));
  await store.initialize();
  return new ShepherdService({
    store,
    managedRoot: path.join(root, "managed"),
    agentWorkspaceRoot: path.join(root, "agent-workspaces"),
    verifier: new HostTrustedFixtureVerifier(),
    ...options,
  });
}

describe("startup settings composition", () => {
  it("seeds a pristine store with the startup auto-resolution setting", async () => {
    // SHEPHERD_AUTO_RESOLUTION is parsed by loadConfig and must actually govern
    // the service; otherwise the advertised control does nothing.
    const root = await caseRoot();
    const shepherd = await service(root, { autoResolution: false });

    await shepherd.initialize();

    expect(shepherd.settings().autoResolution).toBe(false);
  });

  it("seeds a pristine store with the startup Plane concurrency setting", async () => {
    const root = await caseRoot();
    const shepherd = await service(root, { maxConcurrentPlanes: 5 });

    await shepherd.initialize();

    expect(shepherd.settings().maxConcurrentPlanes).toBe(5);
  });

  it("leaves a persisted operator setting authoritative over startup configuration", async () => {
    // Startup config seeds only a pristine store. Once an operator has changed a
    // setting it must survive restart, or the Settings surface is a lie.
    const root = await caseRoot();
    const first = await service(root, { autoResolution: true, maxConcurrentPlanes: 4 });
    await first.initialize();
    await first.updateSettings({ autoResolution: false, maxConcurrentPlanes: 3 });

    const restarted = await service(root, { autoResolution: true, maxConcurrentPlanes: 4 });
    await restarted.initialize();

    expect(restarted.settings().autoResolution).toBe(false);
    expect(restarted.settings().maxConcurrentPlanes).toBe(3);
  });
});

describe("startup settings boundaries", () => {
  it("rejects a Plane concurrency below the floor every other layer enforces", () => {
    // database-schema, updateSettings and the API all require min 2. Accepting 1
    // here green-lights a value that fails schema validation on first write.
    expect(() => loadConfig({ SHEPHERD_MAX_PARALLEL_PLANES: "1" })).toThrow();
    expect(() => loadConfig({ SHEPHERD_MAX_PARALLEL_PLANES: "0" })).toThrow();
  });

  it("defaults Plane concurrency to the same value as the persisted defaults", async () => {
    const { defaultShepherdSettings } = await import("../database.js");
    expect(loadConfig({}).shepherdMaxParallelPlanes).toBe(
      defaultShepherdSettings().maxConcurrentPlanes,
    );
  });
});

describe("production composition", () => {
  /**
   * `index.ts` is the only production construction of ShepherdService, so nothing
   * else observes whether the parsed startup settings are actually passed. Pins the
   * composition text; PR #68 adds a shared `constructorArguments` helper that this
   * should adopt once merged.
   */
  async function serviceOptions(): Promise<string> {
    const source = await readFile(path.resolve(process.cwd(), "src/index.ts"), "utf8");
    const start = source.indexOf("new ShepherdService(");
    expect(start).toBeGreaterThan(-1);
    const close = /^\);|^\}\);/mu.exec(source.slice(start));
    expect(close).not.toBeNull();
    return source.slice(start, start + (close?.index ?? 0)).replace(/\/\/[^\n]*/gu, "");
  }

  it("passes the startup auto-resolution setting to the Shepherd service", async () => {
    expect(await serviceOptions()).toContain("autoResolution: config.shepherdAutoResolution");
  });

  it("passes the startup Plane concurrency setting to the Shepherd service", async () => {
    expect(await serviceOptions()).toContain(
      "maxConcurrentPlanes: config.shepherdMaxParallelPlanes",
    );
  });
});
