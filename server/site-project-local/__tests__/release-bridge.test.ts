import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import releaseApiPlugin from "../../../plugins/release-api-plugin";

function harness() {
  const plugin = releaseApiPlugin();
  (plugin.configResolved as (value: unknown) => void)({ command: "serve" });
  const source = (plugin.load as (id: string) => string)("\0virtual:release-config");
  const config = JSON.parse(source.slice("export default ".length, -1));
  const events = new Map<string, (data: unknown, client: unknown) => void>();
  let middleware!: (req: unknown, res: unknown, next: () => void) => Promise<void>;
  const client = { socket: Object.assign(new EventEmitter(), { readyState: 1 }), send: vi.fn() };
  const service = vi.fn((options: { isWorkingCurrent(project: unknown, token: unknown): Promise<boolean> }) => ({ handle: async () => ({ ok: await options.isWorkingCurrent({ id: "A" }, { workspaceId: "one" }) }) }));
  (plugin.configureServer as (value: unknown) => void)({ config: { server: {} }, ws: { on: (key: string, listener: (data: unknown, client: unknown) => void) => events.set(key, listener), send: vi.fn() }, middlewares: { use: (value: typeof middleware) => { middleware = value; } }, ssrLoadModule: async () => ({ createLocalSiteProjectApiService: service }) });
  const clientId = "a".repeat(36), requestId = "b".repeat(36);
  events.get("release:bind")!({ clientId, capability: config.capability }, client);
  client.send.mockClear();
  const request = async (origin = "http://localhost:5173", capability = config.capability) => {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({ clientId, requestId, request: { protocolVersion: 2, operation: "apply" } }))]), { url: "/__zudo-release", method: "POST", headers: { origin, host: "localhost:5173", "x-zudo-release-capability": capability, "content-type": "application/json" } });
    const res = Object.assign(new EventEmitter(), { destroyed: false, statusCode: 200, setHeader: vi.fn(), end: vi.fn() });
    const done = middleware(req, res, vi.fn()); return { res, done };
  };
  return { plugin, request, client, events, requestId, service };
}
describe("local release capability bridge", () => {
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
