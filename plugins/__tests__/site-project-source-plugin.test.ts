import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RESOLVED_SITE_PROJECT_SOURCE_ID, SITE_PROJECT_SOURCE_ID, siteProjectSourcePlugin } from "../site-project-source-plugin.mjs";

describe("siteProjectSourcePlugin", () => {
  it("requires and exclusively serializes the injected bundled project in build mode", async () => {
    expect(() => siteProjectSourcePlugin(undefined as never)).toThrow(/requires bundledProject/);
    const readDevProject = vi.fn();
    const plugin = siteProjectSourcePlugin({ bundledProject: { marker: "bundled-only" } as never, readDevProject });
    (plugin.configResolved as (config: unknown) => void)({ command: "build" });
    expect(plugin.resolveId?.call({} as never, SITE_PROJECT_SOURCE_ID, undefined, {} as never)).toBe(RESOLVED_SITE_PROJECT_SOURCE_ID);
    const source = await plugin.load?.call({} as never, RESOLVED_SITE_PROJECT_SOURCE_ID, {} as never);
    expect(source).toContain('"bundled-only"');
    for (const forbidden of [".zudo-site-project", "virtual:site-project-source", "node:fs", "node:path", "readActivatedSiteProject", "revision"]) {
      expect(source).not.toContain(forbidden);
    }
    expect(readDevProject).not.toHaveBeenCalled();
  });

  it("loads activated data in dev and invalidates with one deterministic full reload on active add/change/unlink", async () => {
    const watcher = new EventEmitter() as EventEmitter & { add: ReturnType<typeof vi.fn>; unwatch: ReturnType<typeof vi.fn> };
    watcher.add = vi.fn(); watcher.unwatch = vi.fn();
    const invalidateModule = vi.fn(); const send = vi.fn();
    const readDevProject = vi.fn().mockResolvedValue({ project: { id: "demo" }, revision: "a".repeat(64) });
    const plugin = siteProjectSourcePlugin({ bundledProject: null as never, readDevProject });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({
      config: { root: "/repo" }, watcher,
      moduleGraph: { getModuleById: vi.fn(() => ({ id: RESOLVED_SITE_PROJECT_SOURCE_ID })), invalidateModule },
      ws: { send }, ssrLoadModule: vi.fn(),
    });
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith("/repo/.zudo-site-project/projects/demo.site-project.json"));
    const source = await plugin.load?.call({} as never, RESOLVED_SITE_PROJECT_SOURCE_ID, {} as never);
    expect(source).toContain('"id":"demo"');
    expect(source).not.toContain("revision");
    watcher.emit("unlink", "/repo/.zudo-site-project/active.json");
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "full-reload", path: "*" }));
    expect(invalidateModule).toHaveBeenCalledTimes(1);
  });
});
