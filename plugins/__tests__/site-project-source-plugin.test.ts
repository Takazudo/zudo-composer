import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RESOLVED_SITE_PROJECT_SOURCE_ID, SITE_PROJECT_SOURCE_ID, siteProjectSourcePlugin } from "../site-project-source-plugin.mjs";

describe("siteProjectSourcePlugin", () => {
  it("requires and exclusively serializes the injected bundled project in build mode", async () => {
    expect(() => siteProjectSourcePlugin(undefined as never)).toThrow(/bundled delivery source/);
    const readDevRelease = vi.fn();
    const bundledRevision = "b".repeat(64), bundledSource = { status: "ready", artifact: { project: { marker: "bundled-only" }, identity: { revision: bundledRevision } } };
    const plugin = siteProjectSourcePlugin({ bundledSource: bundledSource as never, readDevRelease });
    (plugin.configResolved as (config: unknown) => void)({ command: "build" });
    expect(plugin.resolveId?.call({} as never, SITE_PROJECT_SOURCE_ID, undefined, {} as never)).toBe(RESOLVED_SITE_PROJECT_SOURCE_ID);
    const source = await plugin.load?.call({} as never, RESOLVED_SITE_PROJECT_SOURCE_ID, {} as never);
    expect(source).toContain('"bundled-only"');
    expect(source).toContain(`siteProjectRevision = "${bundledRevision}"`);
    for (const forbidden of [".zudo-site-project", "virtual:site-project-source", "node:fs", "node:path", "readActivatedSiteProject", "readActivatedSiteRelease", "readActivatedSiteMedia"]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain("deliverySource");
    expect(readDevRelease).not.toHaveBeenCalled();
  });

  it("invalidates activated delivery with a scoped event without reloading working editors", async () => {
    const watcher = new EventEmitter() as EventEmitter & { add: ReturnType<typeof vi.fn>; unwatch: ReturnType<typeof vi.fn> };
    watcher.add = vi.fn(); watcher.unwatch = vi.fn();
    const invalidateModule = vi.fn(); const send = vi.fn(); const reloadModule = vi.fn();
    const identity = { projectId: "demo", revision: "a".repeat(64), buildId: "c".repeat(64) };
    const readDevRelease = vi.fn().mockResolvedValue({ project: { id: "demo" }, release: { identity, build: { projectId: "demo" }, completionDigest: "d".repeat(64), files: {}, stage: { mediaLock: null } } });
    const plugin = siteProjectSourcePlugin({ bundledSource: { status: "no-active" } as never, readDevRelease });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({
      config: { root: "/repo" }, watcher,
      moduleGraph: { getModuleById: vi.fn(() => ({ id: RESOLVED_SITE_PROJECT_SOURCE_ID })), invalidateModule }, reloadModule,
      ws: { send }, ssrLoadModule: vi.fn(),
    });
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith(`/repo/.zudo-site-project/projects/demo/${identity.revision}.json`));
    expect(watcher.add).toHaveBeenCalledWith(`/repo/.zudo-site-project/builds/${identity.buildId}/complete.json`);
    const source = await plugin.load?.call({} as never, RESOLVED_SITE_PROJECT_SOURCE_ID, {} as never);
    expect(source).toContain('"id":"demo"');
    expect(source).toContain(`siteProjectRevision = "${identity.revision}"`);
    watcher.emit("unlink", "/repo/.zudo-site-project/active.json");
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "custom", event: "release:changed", data: { source: "activated-release" } }));
    expect(send.mock.calls.some(([message]) => message.type === "full-reload")).toBe(false);
    expect(invalidateModule).toHaveBeenCalledTimes(1);
    expect(reloadModule).toHaveBeenCalledTimes(1);
  });

  it("serves only exact activated pinned media and never falls through on missing or corrupt bytes", async () => {
    let mode: "one" | "two" | "missing" | "error" = "one";
    const readDevMedia = vi.fn(async () => mode === "missing" ? null : mode === "error" ? Promise.reject(new Error("digest")) : ({ bytes: Uint8Array.from([mode === "one" ? 1 : 2]), mediaType: "image/png", identity: {} }));
    const plugin = siteProjectSourcePlugin({ bundledSource: { status: "no-active" } as never, readDevRelease: async () => null, readDevMedia });
    let middleware!: (req: { url: string }, res: Record<string, unknown>, next: () => void) => Promise<void>;
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({ config: { root: "/repo" }, watcher, moduleGraph: { getModuleById: vi.fn() }, ws: { send: vi.fn() }, middlewares: { use: (value: typeof middleware) => { middleware = value; } } });
    const pathname = `/uploaded-media/sha256-${"a".repeat(64)}.png`;
    const call = async () => { const next = vi.fn(), end = vi.fn(), setHeader = vi.fn(), res = { statusCode: 0, end, setHeader }; await middleware({ url: pathname }, res, next); return { res, next, end, setHeader }; };
    expect(Array.from((await call()).end.mock.calls[0]![0])).toEqual([1]);
    mode = "two"; expect(Array.from((await call()).end.mock.calls[0]![0])).toEqual([2]);
    mode = "missing"; const missing = await call(); expect(missing.res.statusCode).toBe(404); expect(missing.next).not.toHaveBeenCalled();
    mode = "error"; const error = await call(); expect(error.res.statusCode).toBe(503); expect(error.next).not.toHaveBeenCalled();
  });
});
