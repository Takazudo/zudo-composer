import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import releaseApiPlugin, { RELEASE_LIMITS, trustedReleaseRequest } from "../../../plugins/release-api-plugin";
import { fixture, stageFor, catalog, call, pack, toolchain, PNG, review } from "./release-fixture";
import { createLocalSiteProjectApiService } from "../service";
import { readFile } from "node:fs/promises";
import { project } from "../../../src/site-project/compiler/__tests__/fixtures";
import { compileSiteProject } from "../../../src/site-project/compiler";
import { createSiteProjectApiService } from "../../../src/site-project/api/service";
import type { SiteProjectApiDependencies, SiteProjectApiService } from "../../../src/site-project/api/types";
import { spawn } from "node:child_process";
import { join } from "node:path";

function harness(concurrentChecks = false, makeService?: (callbacks: Pick<SiteProjectApiDependencies, "isWorkingCurrent" | "reconcilePublication">) => SiteProjectApiService, mediaStoreRoot?: string) {
  const plugin = releaseApiPlugin({ mediaStoreRoot });
  (plugin.configResolved as (value: unknown) => void)({ command: "serve" });
  const source = (plugin.load as (id: string) => string)("\0virtual:release-config");
  const config = JSON.parse(source.slice("export default ".length, -1));
  const events = new Map<string, (data: unknown, client: unknown) => void>();
  let middleware!: (req: unknown, res: unknown, next: () => void) => Promise<void>;
  const client = { socket: Object.assign(new EventEmitter(), { readyState: 1 }), send: vi.fn() };
  const service = vi.fn((options: { isWorkingCurrent(project: unknown, token: unknown): Promise<boolean> }) => makeService ? makeService(options) : ({ handle: async () => concurrentChecks ? { checks: await Promise.all([options.isWorkingCurrent({ id: "A" }, { workspaceId: "one" }), options.isWorkingCurrent({ id: "B" }, { workspaceId: "one" })]) } : { ok: await options.isWorkingCurrent({ id: "A" }, { workspaceId: "one" }) } }));
  const httpServer = new EventEmitter();
  (plugin.configureServer as (value: unknown) => void)({ httpServer, config: { server: {} }, ws: { on: (key: string, listener: (data: unknown, client: unknown) => void) => events.set(key, listener), send: vi.fn() }, middlewares: { use: (value: typeof middleware) => { middleware = value; } }, ssrLoadModule: async () => ({ createLocalSiteProjectApiService: service }) });
  const clientId = "a".repeat(36), requestId = "b".repeat(36);
  const socket = { remoteAddress: "127.0.0.1", localPort: 5173 };
  events.get("connection")!(client.socket, { socket, headers: { origin: "http://localhost:5173", host: "localhost:5173" } });
  events.get("release:bind")!({ clientId, capability: config.capability }, client);
  client.send.mockClear();
  const request = async (origin = "http://localhost:5173", capability = config.capability, options: { peer?: string; host?: string; headers?: Record<string, string | undefined>; stream?: Readable; id?: string; apiRequest?: unknown } = {}) => {
    const id = options.id ?? clientId;
    const req = Object.assign(options.stream ?? Readable.from([Buffer.from(JSON.stringify({ clientId: id, requestId, request: options.apiRequest ?? { protocolVersion: 2, operation: "apply" } }))]), { socket: { ...socket, remoteAddress: options.peer ?? socket.remoteAddress }, url: "/__zudo-release", method: "POST", headers: { origin, host: options.host ?? "localhost:5173", "x-zudo-release-capability": capability, "content-type": "application/json", "x-zudo-release-client": id, "x-zudo-release-request": requestId, ...options.headers } });
    const res = Object.assign(new EventEmitter(), { destroyed: false, statusCode: 200, setHeader: vi.fn(), end: vi.fn() });
    const done = middleware(req, res, vi.fn()); return { req, res, done };
  };
  const bind = (id: string, peer = "127.0.0.1", host = "localhost:5173", headers = {}) => { const other = { socket: Object.assign(new EventEmitter(), { readyState: 1 }), send: vi.fn() }; events.get("connection")!(other.socket, { socket: { ...socket, remoteAddress: peer }, headers: { origin: `http://${host}`, host, ...headers } }); events.get("release:bind")!({ clientId: id, capability: config.capability }, other); return other; };
  return { plugin, request, client, events, requestId, service, bind, httpServer };
}
describe("local release capability bridge", () => {
  it("production review and pinned build read bytes from the explicit isolated Media root", async () => {
    const context = await fixture({ media: true });
    const asset = await context.media!.upload({ fileName: "isolated.png", declaredMediaType: "image/png", bytes: PNG });
    const value = project();
    value.providers.compositions[0]!.records[0]!.document.root[0]!.props.href = `/uploaded-media/asset-${asset.id}`;
    const service = createLocalSiteProjectApiService({ pack, testRoot: context.testRoot, mediaStoreRoot: context.mediaRoot,
      toolchain: { ...toolchain, componentPack: value.componentPack } });
    const plan = await review(service, value, { selection: value.providers.content.flatMap((provider) => provider.entries.map((entry) => ({
      ref: { providerId: provider.id, modelId: entry.modelId, recordId: entry.id }, action: "publish",
    }))) });
    expect(plan.mediaLock!.pins[0]!.checksum).toBe(asset.document.versions[0]!.checksum);
    const applied = await call<{ buildId: string }>(service, "apply", { plan });
    await call(service, "build", { projectId: value.id, buildId: applied.buildId });
    expect(await readFile(join(context.testRoot, "builds", applied.buildId, `media-${plan.mediaLock!.pins[0]!.url.split("/").at(-1)}`))).toEqual(Buffer.from(PNG));
  });
  it("passes the isolated Media root to the release service without exposing a client path", async () => {
    const mediaStoreRoot = "/tmp/release-bridge-isolated/media";
    const h = harness(false, undefined, mediaStoreRoot);
    const { done } = await h.request();
    await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled());
    expect(h.service.mock.calls[0]![0]).toMatchObject({ mediaStoreRoot });
    expect((h.plugin.load as (id: string) => string)("\0virtual:release-config")).not.toContain(mediaStoreRoot);
    h.client.socket.emit("close"); await done;
    expect(() => releaseApiPlugin({ mediaStoreRoot: "relative" })).toThrow("absolute resolved");
  });
  it.each(["late-settle", "disconnect", "dispose"])("quarantines timed-out A against a separate activation process until %s", async (finish) => {
    const context = await fixture(), a = project(), b = { ...project(), name: "B" }, sa = stageFor(a), sb = stageFor(b);
    for (const [index, value] of [a, b].entries()) { const stage = index === 0 ? sa : sb; await context.store.apply({ project: value, stage, expectedRevision: index === 0 ? null : sa.revision, expectedActive: null, expectedGeneration: index }); const build = await compileSiteProject(value, { componentCatalog: catalog }); if (build.status !== "ready") throw new Error("Fixture blocked"); await context.store.complete({ stage, build: build.build }); }
    const target = (stage: typeof sa) => ({ projectId: stage.projectId, revision: stage.revision, buildId: stage.buildId });
    const activateB = () => new Promise<{ status: string; value?: { activationGeneration: number } }>((resolve, reject) => { const child = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "server/site-project-local/__tests__/activation-worker.ts"), context.testRoot, JSON.stringify(target(sb)), JSON.stringify(target(sa))], { stdio: ["ignore", "pipe", "pipe"] }); let out = "", error = ""; child.stdout.on("data", (part) => { out += part; }); child.stderr.on("data", (part) => { error += part; }); child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(error))); });
    const h = harness(false, (callbacks) => createSiteProjectApiService({ ...context.dependencies, ...callbacks }));
    vi.useFakeTimers();
    try {
      const request = await h.request(undefined, undefined, { apiRequest: { protocolVersion: 2, operation: "activate", ...target(sa), expectedActive: null } });
      await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled()); const challenge = h.client.send.mock.calls[0]![1]; expect(challenge.payload.activationGeneration).toBe(1);
      await vi.advanceTimersByTimeAsync(RELEASE_LIMITS.challengeMs); expect(JSON.parse(request.res.end.mock.calls[0]![0])).toMatchObject({ ok: false, error: { code: "commit-uncertain", message: expect.stringContaining("quarantined") } });
      request.res.emit("close"); expect((await activateB()).status).toBe("unavailable");
      if (finish === "late-settle") h.events.get("release:answer")!({ ...challenge, result: "applied" }, h.client);
      else if (finish === "disconnect") h.client.socket.emit("close"); else h.httpServer.emit("close");
      await request.done; expect(request.res.end).toHaveBeenCalledTimes(1);
      expect(await activateB()).toMatchObject({ status: "ok", value: { activationGeneration: 2 } });
    } finally { vi.useRealTimers(); h.client.socket.emit("close"); }
  });
  it.each(["127.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::1", "0:0:0:0:0:0:0:1"])("accepts canonical loopback operator peer %s", (peer) => { expect(trustedReleaseRequest({ socket: { remoteAddress: peer, localPort: 5173 }, headers: { host: "[::1]:5173", origin: "http://[::1]:5173" } } as never, false)).toBe(true); });
  it.each([
    { peer: "192.0.2.20" }, { peer: "::ffff:192.0.2.20" }, { host: "attacker.example:5173" }, { host: "localhost:6666" }, { headers: { "x-forwarded-host": "localhost:5173" } }, { headers: { forwarded: "for=127.0.0.1" } },
  ])("denies remote/operator spoofing before body collection %j", async (options) => { const h = harness(); const stream = new Readable({ read: vi.fn() }); const read = vi.spyOn(stream, Symbol.asyncIterator); const { res, done } = await h.request(options.host ? `http://${options.host}` : undefined, undefined, { ...options, stream }); await done; expect(res.statusCode).toBe(403); expect(read).not.toHaveBeenCalled(); expect(h.service).not.toHaveBeenCalled(); stream.destroy(); });
  it("does not bind or self-challenge a remote client that knows the served capability", async () => { const h = harness(); const remote = h.bind("c".repeat(36), "192.0.2.4"); expect(remote.send).not.toHaveBeenCalled(); const { res, done } = await h.request(undefined, undefined, { peer: "192.0.2.4", id: "c".repeat(36) }); await done; expect(res.statusCode).toBe(403); expect(h.service).not.toHaveBeenCalled(); });
  it("rejects WS binding with forwarded authority or a non-operator origin", () => { const h = harness(); expect(h.bind("c".repeat(36), "127.0.0.1", "localhost:5173", { "x-forwarded-host": "localhost:5173" }).send).not.toHaveBeenCalled(); expect(h.bind("d".repeat(36), "127.0.0.1", "attacker.example:5173").send).not.toHaveBeenCalled(); });
  it("rejects excess bodies globally and per client, then recovers capacity on close", async () => {
    const h = harness(); const held = [];
    for (let i = 0; i < RELEASE_LIMITS.requests; i++) { const id = String(i).repeat(36); h.bind(id); held.push(await h.request(undefined, undefined, { id, stream: new Readable({ read() {} }) })); }
    const id = "f".repeat(36); h.bind(id); const rejected = await h.request(undefined, undefined, { id }); await rejected.done; expect(rejected.res.statusCode).toBe(429);
    const same = await h.request(undefined, undefined, { id: "0".repeat(36) }); await same.done; expect(same.res.statusCode).toBe(429);
    for (const item of held) item.res.emit("close"); await Promise.all(held.map(({ done }) => done));
    const accepted = await h.request(); await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled()); h.client.socket.emit("close"); await accepted.done; expect(accepted.res.statusCode).toBe(200);
  });
  it("times out stalled body collection and frees the client slot", async () => {
    vi.useFakeTimers(); try { const h = harness(); const held = await h.request(undefined, undefined, { stream: new Readable({ read() {} }) }); await vi.advanceTimersByTimeAsync(RELEASE_LIMITS.bodyMs); await held.done; expect(held.req.destroyed).toBe(true); const retry = await h.request(); await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled()); h.client.socket.emit("close"); await retry.done; expect(retry.res.statusCode).toBe(200); } finally { vi.useRealTimers(); }
  });
  it("allows only one active request and one outstanding challenge per client", async () => { const h = harness(true), first = await h.request(); await vi.waitFor(() => expect(h.client.send).toHaveBeenCalledTimes(1)); const second = await h.request(); await second.done; expect(second.res.statusCode).toBe(429); const challenge = h.client.send.mock.calls[0]![1]; h.events.get("release:answer")!({ ...challenge, result: true }, h.client); await first.done; expect(JSON.parse(first.res.end.mock.calls[0]![0])).toEqual({ checks: [true, false] }); });
  it("rejects a declared oversized body before invoking its iterator", async () => { const h = harness(), stream = new Readable({ read() {} }), iterator = vi.spyOn(stream, Symbol.asyncIterator); const result = await h.request(undefined, undefined, { stream, headers: { "content-length": String(RELEASE_LIMITS.bodyBytes + 1) } }); await result.done; expect(result.res.statusCode).toBe(413); expect(iterator).not.toHaveBeenCalled(); stream.destroy(); });
  it("bounds registered operator channels and frees registration on unbind", () => { const h = harness(); for (let i = 0; i < RELEASE_LIMITS.clients - 1; i++) expect(h.bind(String(i).padStart(36, "0")).send).toHaveBeenCalledTimes(1); const id = "f".repeat(36); expect(h.bind(id).send).not.toHaveBeenCalled(); h.events.get("release:unbind")!({ clientId: "a".repeat(36) }, h.client); expect(h.bind(id).send).toHaveBeenCalledTimes(1); });
  it("emits no capability or endpoint in production", () => { const { plugin } = harness(); (plugin.configResolved as (value: unknown) => void)({ command: "build" }); expect((plugin.load as (id: string) => string)("\0virtual:release-config")).toBe("export default null;"); });
  it.each([["https://evil.example", undefined], ["http://localhost:5173", "wrong"]])("rejects wrong origin/capability before service access", async (origin, capability) => { const h = harness(); const { res, done } = await h.request(origin, capability); await done; expect(res.statusCode).toBe(403); expect(h.service).not.toHaveBeenCalled(); });
  it("requires a single-use challenge from the exact request and connection", async () => {
    const h = harness(); const { res, done } = await h.request();
    await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled());
    const message = h.client.send.mock.calls[0]![1]; const answer = h.events.get("release:answer")!;
    answer({ ...message, result: true }, {}); answer({ ...message, requestId: "other", result: true }, h.client);
    expect(res.end).not.toHaveBeenCalled();
    answer({ ...message, result: false }, h.client); answer({ ...message, result: true }, h.client);
    await done; expect(JSON.parse(res.end.mock.calls[0]![0])).toEqual({ ok: false });
  });
  it("fails closed when the validating browser disconnects", async () => { const h = harness(); const { res, done } = await h.request(); await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled()); h.client.socket.emit("close"); await done; expect(JSON.parse(res.end.mock.calls[0]![0])).toEqual({ ok: false }); });
  it("accepts only the correlated live challenge answer", async () => { const h = harness(); const { res, done } = await h.request(); await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled()); const message = h.client.send.mock.calls[0]![1]; expect(message.payload).toEqual({ kind: "current", project: { id: "A" }, precondition: { workspaceId: "one" } }); h.events.get("release:answer")!({ ...message, result: true }, h.client); await done; expect(JSON.parse(res.end.mock.calls[0]![0])).toEqual({ ok: true }); });
  it("retains one API recovery owner but never reuses its request challenges", async () => {
    const h = harness(), first = await h.request(); await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled()); const old = h.client.send.mock.calls[0]![1]; h.events.get("release:answer")!({ ...old, result: true }, h.client); await first.done;
    h.client.send.mockClear(); const second = await h.request(); await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled()); const current = h.client.send.mock.calls[0]![1]; expect(current.challenge).not.toBe(old.challenge);
    h.events.get("release:answer")!({ ...old, result: true }, h.client); expect(second.res.end).not.toHaveBeenCalled();
    h.events.get("release:answer")!({ ...current, result: false }, h.client); await second.done; expect(h.service).toHaveBeenCalledTimes(1);
  });
  it("expires an unanswered challenge instead of accepting a delayed success", async () => {
    vi.useFakeTimers();
    try { const h = harness(); const { res, done } = await h.request(); await vi.waitFor(() => expect(h.client.send).toHaveBeenCalled()); const message = h.client.send.mock.calls[0]![1]; await vi.advanceTimersByTimeAsync(10_000); h.events.get("release:answer")!({ ...message, result: true }, h.client); await done; expect(JSON.parse(res.end.mock.calls[0]![0])).toEqual({ ok: false }); }
    finally { vi.useRealTimers(); }
  });
});
