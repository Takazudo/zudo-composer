import { hookHandler, strictFixture } from "./test-helpers";
import { loadSampleSiteProject } from "../../src/test/site-project-fixture";
import { activeSiteProjectValidationContext } from "../../src/app/site-project-manifest";
import type { SiteProjectSourcePluginOptions } from "../site-project-source-plugin.mjs";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RESOLVED_SITE_PROJECT_SOURCE_ID, SITE_PROJECT_SOURCE_ID, siteProjectSourcePlugin } from "../site-project-source-plugin.mjs";

const toolchain = { compiler: "compiler/2", componentPack: { packId: "pack", packVersion: "1", contractVersion: 2 }, packSpecifier: "@fixture/pack/composer-pack", packSource: "workspace:*", installedPackDigest: "c".repeat(64), contractDigest: "d".repeat(64) };

describe("siteProjectSourcePlugin", () => {
  it("serializes the activated release without leaking any local reader marker", async () => {
    const identity = { projectId: "demo", revision: "e".repeat(64), buildId: "f".repeat(64) };
    const readDevRelease = vi.fn().mockResolvedValue({ project: { id: "demo", marker: "activated-only" }, release: { identity, build: { projectId: "demo" }, completionDigest: "d".repeat(64), files: { "build.json": "1".repeat(64) }, stage: { assetLock: null, toolchain } } });
    const plugin = siteProjectSourcePlugin({ readDevRelease });
    expect(hookHandler(plugin.resolveId).call(strictFixture({}), SITE_PROJECT_SOURCE_ID, undefined, { isEntry: false })).toBe(RESOLVED_SITE_PROJECT_SOURCE_ID);
    const source = await hookHandler(plugin.load).call(strictFixture({}), RESOLVED_SITE_PROJECT_SOURCE_ID);
    expect(source).toContain('"activated-only"');
    expect(source).toContain(`siteProjectRevision = "${identity.revision}"`);
    for (const forbidden of [".zudo-site-project", "virtual:site-project-source", "node:fs", "node:path", "readActivatedSiteProject", "readActivatedSiteRelease", "readActivatedSiteAssets"]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain("deliverySource");
    expect(readDevRelease).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable activated release instead of falling back to any other source", async () => {
    const plugin = siteProjectSourcePlugin({ readDevRelease: vi.fn().mockRejectedValue(new Error("reader offline")) });
    const source = await hookHandler(plugin.load).call(strictFixture({}), RESOLVED_SITE_PROJECT_SOURCE_ID);
    expect(source).toContain('"error"');
    expect(source).toContain("reader offline");
    expect(source).toContain("siteProject = null");
  });

  it("invalidates activated delivery with a scoped event without reloading working editors", async () => {
    const watcher = new EventEmitter() as EventEmitter & { add: ReturnType<typeof vi.fn>; unwatch: ReturnType<typeof vi.fn> };
    watcher.add = vi.fn(); watcher.unwatch = vi.fn();
    const invalidateModule = vi.fn(); const send = vi.fn(); const reloadModule = vi.fn();
    const identity = { projectId: "demo", revision: "a".repeat(64), buildId: "c".repeat(64) };
    const files = { "build.json": "1".repeat(64), "stage.json": "2".repeat(64), "module-0000.mjs": "3".repeat(64), [`asset-sha256-${"4".repeat(64)}.png`]: "4".repeat(64) };
    const readDevRelease = vi.fn().mockResolvedValue({ project: { id: "demo" }, release: { identity, build: { projectId: "demo" }, completionDigest: "d".repeat(64), files, stage: { assetLock: null, toolchain } } });
    const plugin = siteProjectSourcePlugin({ readDevRelease, workspaceRoot: "/repo" });
    (plugin.configureServer as (server: unknown) => void)({
      watcher,
      moduleGraph: { getModuleById: vi.fn(() => ({ id: RESOLVED_SITE_PROJECT_SOURCE_ID })), invalidateModule }, reloadModule,
      ws: { send }, ssrLoadModule: vi.fn(),
    });
    expect(watcher.add).toHaveBeenCalledWith("/repo/.zudo-site-project");
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith(`/repo/.zudo-site-project/projects/demo/${identity.revision}.json`));
    for (const name of ["stage.json", "build.json", "complete.json", "module-0000.mjs", `asset-sha256-${"4".repeat(64)}.png`]) expect(watcher.add).toHaveBeenCalledWith(`/repo/.zudo-site-project/builds/${identity.buildId}/${name}`);
    const source = await hookHandler(plugin.load).call(strictFixture({}), RESOLVED_SITE_PROJECT_SOURCE_ID);
    expect(source).toContain('"id":"demo"');
    expect(source).toContain(`siteProjectRevision = "${identity.revision}"`);
    watcher.emit("change", `/repo/.zudo-site-project/builds/${identity.buildId}/module-0000.mjs`);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "custom", event: "release:changed", data: { source: "activated-release", deliverySource: expect.objectContaining({ status: "ready", artifact: expect.objectContaining({ identity }) }) } }));
    expect(send.mock.calls.some(([message]) => message.type === "full-reload")).toBe(false);
    expect(invalidateModule).toHaveBeenCalledTimes(1);
    expect(reloadModule).not.toHaveBeenCalled();
  });

  it("publishes verified source data when the invalidated virtual module has no backing file", async () => {
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    const send = vi.fn();
    const identity = { projectId: "ordered", revision: "6".repeat(64), buildId: "7".repeat(64) };
    const readDevRelease = vi.fn().mockResolvedValue({ project: { id: identity.projectId }, release: { identity, build: {}, completionDigest: "8".repeat(64), files: { "build.json": "9".repeat(64) }, stage: { assetLock: null, toolchain } } });
    const plugin = siteProjectSourcePlugin({ readDevRelease, workspaceRoot: "/repo" });
    (plugin.configureServer as (server: unknown) => void)({ watcher, moduleGraph: { getModuleById: vi.fn(() => ({ id: RESOLVED_SITE_PROJECT_SOURCE_ID, file: null })), invalidateModule: vi.fn() }, ws: { send } });
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith("/repo/.zudo-site-project/active.json"));
    watcher.emit("change", "/repo/.zudo-site-project/active.json");
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "custom", event: "release:changed", data: { source: "activated-release", deliverySource: expect.objectContaining({ status: "ready", artifact: expect.objectContaining({ project: { id: "ordered" }, identity }) }) } }));
  });

  it("retries failed virtual-source invalidation before publishing the change", async () => {
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    const invalidateModule = vi.fn().mockImplementationOnce(() => { throw new Error("graph busy"); });
    const send = vi.fn();
    const identity = { projectId: "retry", revision: "a".repeat(64), buildId: "b".repeat(64) };
    const readDevRelease = vi.fn().mockResolvedValue({ project: { id: identity.projectId }, release: { identity, build: {}, completionDigest: "c".repeat(64), files: { "build.json": "d".repeat(64) }, stage: { assetLock: null, toolchain } } });
    const plugin = siteProjectSourcePlugin({ readDevRelease, workspaceRoot: "/repo" });
    (plugin.configureServer as (server: unknown) => void)({ watcher, moduleGraph: { getModuleById: vi.fn(() => ({ id: RESOLVED_SITE_PROJECT_SOURCE_ID, file: null })), invalidateModule }, ws: { send } });
    await vi.waitFor(() => expect(watcher.add).toHaveBeenCalledWith("/repo/.zudo-site-project/active.json"));
    watcher.emit("change", "/repo/.zudo-site-project/active.json");
    await vi.waitFor(() => expect(invalidateModule).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retains verified watches across bounded transient retries and converges after recovery", async () => {
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    const send = vi.fn(), oldIdentity = { projectId: "old", revision: "1".repeat(64), buildId: "1".repeat(64) }, nextIdentity = { projectId: "next", revision: "2".repeat(64), buildId: "2".repeat(64) };
    const loaded = (identity: typeof oldIdentity) => ({ project: { id: identity.projectId }, release: { identity, files: { "build.json": identity.buildId, "module-0000.mjs": identity.buildId }, stage: { assetLock: null, toolchain } } });
    const readDevRelease = vi.fn().mockResolvedValue(loaded(oldIdentity));
    const plugin = siteProjectSourcePlugin({ readDevRelease, workspaceRoot: "/repo" });
    (plugin.configureServer as (server: unknown) => void)({ watcher, moduleGraph: { getModuleById: vi.fn() }, ws: { send } });
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
    expect(watcher.unwatch).not.toHaveBeenCalledWith("/repo/.zudo-site-project");
    expect(send).toHaveBeenCalledTimes(1);
    expect(readDevRelease).toHaveBeenCalledTimes(4);
  });

  it("does no queued refresh work after the development server closes", async () => {
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() }), httpServer = new EventEmitter();
    const readDevRelease = vi.fn(), send = vi.fn();
    const plugin = siteProjectSourcePlugin({ readDevRelease, workspaceRoot: "/repo" });
    (plugin.configureServer as (server: unknown) => void)({ watcher, httpServer, moduleGraph: { getModuleById: vi.fn() }, ws: { send } });
    watcher.add.mockClear(); httpServer.emit("close");
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    expect(readDevRelease).not.toHaveBeenCalled(); expect(watcher.add).not.toHaveBeenCalled(); expect(watcher.unwatch).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it.each([false, true])("drains an in-flight SSR refresh before closing its transport in middleware mode (reader fails: %s)", async (fails) => {
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    const send = vi.fn();
    let resolveReader!: (module: { readActivatedSiteRelease: ReturnType<typeof vi.fn> }) => void;
    const reader = new Promise<{ readActivatedSiteRelease: ReturnType<typeof vi.fn> }>((resolve) => { resolveReader = resolve; });
    const readActivatedSiteRelease = fails ? vi.fn().mockRejectedValue(new Error("reader unavailable")) : vi.fn().mockResolvedValue(null);
    const close = vi.fn().mockResolvedValue(undefined);
    const ssrLoadModule = vi.fn().mockReturnValueOnce(reader).mockResolvedValue({ componentPack: {} });
    const server = { watcher, close, ssrLoadModule, moduleGraph: { getModuleById: vi.fn() }, ws: { send } };
    const plugin = siteProjectSourcePlugin({ workspaceRoot: "/repo" });
    (plugin.configureServer as (server: unknown) => void)(server);
    await vi.waitFor(() => expect(ssrLoadModule).toHaveBeenCalledTimes(1));
    watcher.emit("change", "/repo/.zudo-site-project/active.json");
    watcher.add.mockClear();
    const closing = server.close();
    expect(close).not.toHaveBeenCalled();
    resolveReader({ readActivatedSiteRelease });
    await closing;
    expect(ssrLoadModule).toHaveBeenCalledTimes(2);
    expect(readActivatedSiteRelease).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close.mock.invocationCallOrder[0]).toBeGreaterThan(readActivatedSiteRelease.mock.invocationCallOrder[0]!);
    watcher.emit("change", "/repo/.zudo-site-project/active.json");
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    expect(ssrLoadModule).toHaveBeenCalledTimes(2);
    expect(watcher.add).not.toHaveBeenCalled();
    expect(watcher.unwatch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("coalesces refresh races without losing dirty events or publishing stale watched identities", async () => {
    type Loaded = NonNullable<Awaited<ReturnType<NonNullable<SiteProjectSourcePluginOptions["readDevRelease"]>>>>;
    const deferred: { resolve(value: Loaded): void; promise: Promise<Loaded> }[] = [];
    const next = () => { let resolve!: (value: Loaded) => void; const promise = new Promise<Loaded>((done) => { resolve = done; }); deferred.push({ resolve, promise }); return promise; };
    const readDevRelease = vi.fn(() => next());
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    const send = vi.fn(), active = "/repo/.zudo-site-project/active.json";
    const plugin = siteProjectSourcePlugin({ readDevRelease, workspaceRoot: "/repo" });
    (plugin.configureServer as (server: unknown) => void)({ watcher, moduleGraph: { getModuleById: vi.fn() }, ws: { send } });
    await vi.waitFor(() => expect(deferred).toHaveLength(1));
    watcher.emit("change", active);
    const loaded = (name: string, digit: string): Loaded => {
      const project = { ...loadSampleSiteProject(activeSiteProjectValidationContext), id: name };
      const identity = { projectId: name, revision: digit.repeat(64), buildId: digit.repeat(64) };
      return { project, release: { identity, completionDigest: digit.repeat(64), build: { projectId: name, activeSitemap: project.activeSitemap, navigation: { primary: [], footer: [], diagnostics: [] }, routes: [], modules: [] }, files: { "build.json": digit.repeat(64), "module-0000.mjs": digit.repeat(64) }, stage: { ...identity, schemaVersion: 2, planDigest: digit.repeat(64), publication: [], assetLock: null, toolchain } } };
    };
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
    const readDevAsset = vi.fn(async () => mode === "missing" ? null : mode === "error" ? Promise.reject(new Error("digest")) : ({ bytes: Uint8Array.from([mode === "one" ? 1 : 2]), mimeType: "image/png" as const, identity: { projectId: "demo", revision: "a".repeat(64), buildId: "b".repeat(64) } }));
    const plugin = siteProjectSourcePlugin({ readDevRelease: async () => null, readDevAsset, workspaceRoot: "/repo" });
    let middleware!: (req: { url: string }, res: Record<string, unknown>, next: () => void) => Promise<void>;
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn(), unwatch: vi.fn() });
    (plugin.configureServer as (server: unknown) => void)({ watcher, moduleGraph: { getModuleById: vi.fn() }, ws: { send: vi.fn() }, middlewares: { use: (value: typeof middleware) => { middleware = value; } } });
    const pathname = `/uploaded-assets/sha256-${"a".repeat(64)}.png`;
    const call = async (live = true) => { const end = vi.fn(), setHeader = vi.fn(), res = { statusCode: 0, end, setHeader }; const next = vi.fn(() => { res.statusCode = live ? 200 : 404; end(live ? Uint8Array.from([9]) : "Assets not found."); }); await middleware({ url: pathname }, res, next); return { res, next, end, setHeader }; };
    const active = await call(); expect(Array.from(active.end.mock.calls[0]![0])).toEqual([1]); expect(active.next).not.toHaveBeenCalled();
    mode = "two"; const switched = await call(); expect(Array.from(switched.end.mock.calls[0]![0])).toEqual([2]); expect(switched.next).not.toHaveBeenCalled();
    mode = "missing"; const live = await call(); expect(live.res.statusCode).toBe(200); expect(Array.from(live.end.mock.calls[0]![0])).toEqual([9]); expect(live.next).toHaveBeenCalledTimes(1);
    const absent = await call(false); expect(absent.res.statusCode).toBe(404); expect(absent.next).toHaveBeenCalledTimes(1);
    mode = "error"; const error = await call(); expect(error.res.statusCode).toBe(503); expect(error.next).not.toHaveBeenCalled();
  });
});
