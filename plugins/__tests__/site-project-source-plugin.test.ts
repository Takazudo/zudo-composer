import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RESOLVED_SITE_PROJECT_SOURCE_ID, SITE_PROJECT_SOURCE_ID, assertBundledToolchain, siteProjectSourcePlugin } from "../site-project-source-plugin.mjs";

const toolchain = { compiler: "compiler/2", componentPack: { packId: "pack", packVersion: "1", contractVersion: 2 }, providerCommit: "a".repeat(40), providerTree: "b".repeat(40), installedProviderDigest: "c".repeat(64), contractDigest: "d".repeat(64) };
const bundledSource = { status: "ready", artifact: { toolchain, project: { marker: "bundled-only" }, identity: { revision: "e".repeat(64) } } };

describe("siteProjectSourcePlugin", () => {
  it("requires and exclusively serializes the injected bundled project in build mode", async () => {
    expect(() => siteProjectSourcePlugin(undefined as never)).toThrow(/bundled delivery source/);
    const readDevRelease = vi.fn();
    const bundledRevision = bundledSource.artifact.identity.revision;
    const plugin = siteProjectSourcePlugin({ bundledSource: bundledSource as never, currentToolchain: toolchain, readDevRelease });
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

  it("rejects a bundled release when installed runtime bytes differ despite equal public metadata", () => {
    expect(() => assertBundledToolchain(bundledSource, { ...toolchain, installedProviderDigest: "f".repeat(64) })).toThrow(/current installed runtime/);
    expect(() => siteProjectSourcePlugin({ bundledSource, currentToolchain: { ...toolchain, installedProviderDigest: "f".repeat(64) } } as never)).toThrow(/current installed runtime/);
  });

  it("invalidates activated delivery with a scoped event without reloading working editors", async () => {
    const watcher = new EventEmitter() as EventEmitter & { add: ReturnType<typeof vi.fn>; unwatch: ReturnType<typeof vi.fn> };
    watcher.add = vi.fn(); watcher.unwatch = vi.fn();
    const invalidateModule = vi.fn(); const send = vi.fn(); const reloadModule = vi.fn();
    const identity = { projectId: "demo", revision: "a".repeat(64), buildId: "c".repeat(64) };
    const files = { "build.json": "1".repeat(64), "stage.json": "2".repeat(64), "module-0000.mjs": "3".repeat(64), [`media-sha256-${"4".repeat(64)}.png`]: "4".repeat(64) };
    const readDevRelease = vi.fn().mockResolvedValue({ project: { id: "demo" }, release: { identity, build: { projectId: "demo" }, completionDigest: "d".repeat(64), files, stage: { mediaLock: null, toolchain } } });
    const plugin = siteProjectSourcePlugin({ bundledSource: bundledSource as never, currentToolchain: toolchain, readDevRelease });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({
      config: { root: "/repo" }, watcher,
      moduleGraph: { getModuleById: vi.fn(() => ({ id: RESOLVED_SITE_PROJECT_SOURCE_ID })), invalidateModule }, reloadModule,
      ws: { send }, ssrLoadModule: vi.fn(),
    });
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith(`/repo/.zudo-site-project/projects/demo/${identity.revision}.json`));
    for (const name of ["stage.json", "build.json", "complete.json", "module-0000.mjs", `media-sha256-${"4".repeat(64)}.png`]) expect(watcher.add).toHaveBeenCalledWith(`/repo/.zudo-site-project/builds/${identity.buildId}/${name}`);
    const source = await plugin.load?.call({} as never, RESOLVED_SITE_PROJECT_SOURCE_ID, {} as never);
    expect(source).toContain('"id":"demo"');
    expect(source).toContain(`siteProjectRevision = "${identity.revision}"`);
    watcher.emit("change", `/repo/.zudo-site-project/builds/${identity.buildId}/module-0000.mjs`);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "custom", event: "release:changed", data: { source: "activated-release" } }));
    expect(send.mock.calls.some(([message]) => message.type === "full-reload")).toBe(false);
    expect(invalidateModule).toHaveBeenCalledTimes(1);
    expect(reloadModule).toHaveBeenCalledTimes(1);
  });

  it("publishes an activated-release change only after its virtual source reload completes", async () => {
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    let finishReload!: () => void;
    const reloadModule = vi.fn(() => new Promise<void>((resolve) => { finishReload = resolve; }));
    const send = vi.fn();
    const identity = { projectId: "ordered", revision: "6".repeat(64), buildId: "7".repeat(64) };
    const readDevRelease = vi.fn().mockResolvedValue({ project: { id: identity.projectId }, release: { identity, build: {}, completionDigest: "8".repeat(64), files: { "build.json": "9".repeat(64) }, stage: { mediaLock: null, toolchain } } });
    const plugin = siteProjectSourcePlugin({ bundledSource: bundledSource as never, currentToolchain: toolchain, readDevRelease });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({ config: { root: "/repo" }, watcher, moduleGraph: { getModuleById: vi.fn(() => ({ id: RESOLVED_SITE_PROJECT_SOURCE_ID })), invalidateModule: vi.fn() }, reloadModule, ws: { send } });
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith("/repo/.zudo-site-project/active.json"));
    watcher.emit("change", "/repo/.zudo-site-project/active.json");
    await vi.waitFor(() => expect(reloadModule).toHaveBeenCalledTimes(1));
    expect(send).not.toHaveBeenCalled();
    finishReload();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "custom", event: "release:changed", data: { source: "activated-release" } }));
  });

  it("retries a failed virtual-source reload before publishing the change", async () => {
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    const reloadModule = vi.fn().mockRejectedValueOnce(new Error("transform busy")).mockResolvedValue(undefined);
    const send = vi.fn();
    const identity = { projectId: "retry", revision: "a".repeat(64), buildId: "b".repeat(64) };
    const readDevRelease = vi.fn().mockResolvedValue({ project: { id: identity.projectId }, release: { identity, build: {}, completionDigest: "c".repeat(64), files: { "build.json": "d".repeat(64) }, stage: { mediaLock: null, toolchain } } });
    const plugin = siteProjectSourcePlugin({ bundledSource: bundledSource as never, currentToolchain: toolchain, readDevRelease });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({ config: { root: "/repo" }, watcher, moduleGraph: { getModuleById: vi.fn(() => ({ id: RESOLVED_SITE_PROJECT_SOURCE_ID })), invalidateModule: vi.fn() }, reloadModule, ws: { send } });
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith("/repo/.zudo-site-project/active.json"));
    watcher.emit("change", "/repo/.zudo-site-project/active.json");
    await vi.waitFor(() => expect(reloadModule).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retains verified watches across bounded transient retries and converges after recovery", async () => {
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    const send = vi.fn(), oldIdentity = { projectId: "old", revision: "1".repeat(64), buildId: "1".repeat(64) }, nextIdentity = { projectId: "next", revision: "2".repeat(64), buildId: "2".repeat(64) };
    const loaded = (identity: typeof oldIdentity) => ({ project: { id: identity.projectId }, release: { identity, files: { "build.json": identity.buildId, "module-0000.mjs": identity.buildId }, stage: { mediaLock: null, toolchain } } });
    const readDevRelease = vi.fn().mockResolvedValue(loaded(oldIdentity));
    const plugin = siteProjectSourcePlugin({ bundledSource: bundledSource as never, currentToolchain: toolchain, readDevRelease });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({ config: { root: "/repo" }, watcher, moduleGraph: { getModuleById: vi.fn() }, ws: { send } });
    const oldModule = `/repo/.zudo-site-project/builds/${oldIdentity.buildId}/module-0000.mjs`, active = "/repo/.zudo-site-project/active.json";
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith(oldModule));
    let rejectFirst!: (error: Error) => void, rejectSecond!: (error: Error) => void;
    readDevRelease.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; })).mockImplementationOnce(() => new Promise((_, reject) => { rejectSecond = reject; })).mockResolvedValue(loaded(nextIdentity));
    watcher.emit("change", oldModule);
    await vi.waitFor(() => expect(rejectFirst).toBeTypeOf("function"));
    watcher.emit("change", active); rejectFirst(new Error("activation settling"));
    await vi.waitFor(() => expect(readDevRelease).toHaveBeenCalledTimes(3));
    expect(watcher.unwatch).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    rejectSecond(new Error("writer lock busy"));
    await vi.waitFor(() => expect(readDevRelease).toHaveBeenCalledTimes(4), { timeout: 1000 });
    const nextModule = `/repo/.zudo-site-project/builds/${nextIdentity.buildId}/module-0000.mjs`;
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith(nextModule));
    expect(watcher.unwatch.mock.invocationCallOrder[0]).toBeGreaterThan(watcher.add.mock.invocationCallOrder.at(-1)!);
    expect(watcher.unwatch).toHaveBeenCalledWith(oldModule);
    expect(send).toHaveBeenCalledTimes(1);
    expect(readDevRelease).toHaveBeenCalledTimes(4);
  });

  it("does no queued refresh work after the development server closes", async () => {
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() }), httpServer = new EventEmitter();
    const readDevRelease = vi.fn(), send = vi.fn();
    const plugin = siteProjectSourcePlugin({ bundledSource: bundledSource as never, currentToolchain: toolchain, readDevRelease });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({ config: { root: "/repo" }, watcher, httpServer, moduleGraph: { getModuleById: vi.fn() }, ws: { send } });
    watcher.add.mockClear(); httpServer.emit("close");
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    expect(readDevRelease).not.toHaveBeenCalled(); expect(watcher.add).not.toHaveBeenCalled(); expect(watcher.unwatch).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it("coalesces refresh races without losing dirty events or publishing stale watched identities", async () => {
    type Loaded = { project: { id: string }; release: { identity: { projectId: string; revision: string; buildId: string }; files: Record<string, string>; stage: { mediaLock: null; toolchain: typeof toolchain } } };
    const deferred: { resolve(value: Loaded): void; promise: Promise<Loaded> }[] = [];
    const next = () => { let resolve!: (value: Loaded) => void; const promise = new Promise<Loaded>((done) => { resolve = done; }); deferred.push({ resolve, promise }); return promise; };
    const readDevRelease = vi.fn(() => next());
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    const send = vi.fn(), active = "/repo/.zudo-site-project/active.json";
    const plugin = siteProjectSourcePlugin({ bundledSource: bundledSource as never, currentToolchain: toolchain, readDevRelease });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({ config: { root: "/repo" }, watcher, moduleGraph: { getModuleById: vi.fn() }, ws: { send } });
    await vi.waitFor(() => expect(deferred).toHaveLength(1));
    watcher.emit("change", active);
    const loaded = (name: string, digit: string): Loaded => ({ project: { id: name }, release: { identity: { projectId: name, revision: digit.repeat(64), buildId: digit.repeat(64) }, files: { "build.json": digit.repeat(64), "module-0000.mjs": digit.repeat(64) }, stage: { mediaLock: null, toolchain } } });
    deferred[0]!.resolve(loaded("stale", "1"));
    await vi.waitFor(() => expect(deferred).toHaveLength(2));
    deferred[1]!.resolve(loaded("current", "2"));
    const modulePath = `/repo/.zudo-site-project/builds/${"2".repeat(64)}/module-0000.mjs`;
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith(modulePath));
    expect(watcher.add).not.toHaveBeenCalledWith(`/repo/.zudo-site-project/projects/stale/${"1".repeat(64)}.json`);
    expect(send).toHaveBeenCalledTimes(1);
    watcher.emit("change", modulePath);
    await vi.waitFor(() => expect(deferred).toHaveLength(3));
    watcher.emit("unlink", modulePath);
    deferred[2]!.resolve(loaded("current", "2"));
    await vi.waitFor(() => expect(deferred).toHaveLength(4));
    deferred[3]!.resolve(loaded("current", "2"));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });

  it("gives active pins precedence, delegates unpinned authoring bytes, and fails release-read errors closed", async () => {
    let mode: "one" | "two" | "missing" | "error" = "one";
    const readDevMedia = vi.fn(async () => mode === "missing" ? null : mode === "error" ? Promise.reject(new Error("digest")) : ({ bytes: Uint8Array.from([mode === "one" ? 1 : 2]), mediaType: "image/png", identity: {} }));
    const plugin = siteProjectSourcePlugin({ bundledSource: bundledSource as never, currentToolchain: toolchain, readDevRelease: async () => null, readDevMedia });
    let middleware!: (req: { url: string }, res: Record<string, unknown>, next: () => void) => Promise<void>;
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    (plugin.configResolved as (config: unknown) => void)({ command: "serve" });
    (plugin.configureServer as (server: unknown) => void)({ config: { root: "/repo" }, watcher, moduleGraph: { getModuleById: vi.fn() }, ws: { send: vi.fn() }, middlewares: { use: (value: typeof middleware) => { middleware = value; } } });
    const pathname = `/uploaded-media/sha256-${"a".repeat(64)}.png`;
    const call = async (live = true) => { const end = vi.fn(), setHeader = vi.fn(), res = { statusCode: 0, end, setHeader }; const next = vi.fn(() => { res.statusCode = live ? 200 : 404; end(live ? Uint8Array.from([9]) : "Media not found."); }); await middleware({ url: pathname }, res, next); return { res, next, end, setHeader }; };
    const active = await call(); expect(Array.from(active.end.mock.calls[0]![0])).toEqual([1]); expect(active.next).not.toHaveBeenCalled();
    mode = "two"; const switched = await call(); expect(Array.from(switched.end.mock.calls[0]![0])).toEqual([2]); expect(switched.next).not.toHaveBeenCalled();
    mode = "missing"; const live = await call(); expect(live.res.statusCode).toBe(200); expect(Array.from(live.end.mock.calls[0]![0])).toEqual([9]); expect(live.next).toHaveBeenCalledTimes(1);
    const absent = await call(false); expect(absent.res.statusCode).toBe(404); expect(absent.next).toHaveBeenCalledTimes(1);
    mode = "error"; const error = await call(); expect(error.res.statusCode).toBe(503); expect(error.next).not.toHaveBeenCalled();
  });
});
