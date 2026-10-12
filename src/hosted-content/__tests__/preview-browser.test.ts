import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostedSnapshot } from "../types";
import {
  hostedReadyMessage, hostedRenderedMessage, hostedDocumentErrorMessage,
  hostedRenderMessage, type HostedDocumentRender, type HostedPreviewBinding, type MessageEventLike,
  type MessageTarget, type MessagePoster,
} from "../preview";
import {
  createHostedPreviewController, createHostedPreviewHost, createHostedPreviewFullscreen, buildHostedPreviewLocation,
  type HostedPreviewController, type HostedPreviewControllerOptions,
} from "../preview-browser";
const pack = { packId: "pack", packVersion: "1" };
const renderer = { rendererId: "real-host-renderer", rendererVersion: "2" };
const origin = "https://host.example";
class Bus implements MessageTarget {
  listeners = new Set<(event: MessageEventLike) => void>();
  addEventListener(_type: "message", listener: (event: MessageEventLike) => void) { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: (event: MessageEventLike) => void) { this.listeners.delete(listener); }
  emit(data: unknown, source: unknown, from = origin) { for (const listener of this.listeners) listener({ data, source, origin: from }); }
}
function snapshot(id = "A"): HostedSnapshot { return {
  id, digest: `digest-${id}`, draftRevision: `r-${id}`, baseline: { gitSha: "g0", contentDigest: "c0" }, definition: "d1",
  providers: [], assets: [], diagnostics: [], renderData: { title: id, order: ["faq-2", "faq-1"] },
}; }
const controllers: HostedPreviewController[] = [];
afterEach(() => { for (const controller of controllers) controller.dispose(); controllers.length = 0; vi.useRealTimers(); });
function harness(extra: Partial<HostedPreviewControllerOptions> = {}) {
  const bus = new Bus();
  const posted: HostedDocumentRender[] = [];
  const window: MessagePoster = { postMessage(message, targetOrigin) { expect(targetOrigin).toBe(origin); posted.push(message as HostedDocumentRender); } };
  const controller = createHostedPreviewController({ hostWindow: bus, frame: { contentWindow: window },
    location: buildHostedPreviewLocation("/private-preview", origin), documentOrigin: origin, pack, renderer, ...extra });
  controllers.push(controller);
  return { controller, bus, window, posted, ready: (boot = "boot-1") => bus.emit(hostedReadyMessage(pack, renderer, boot), window),
    ack: (request = posted.at(-1)!) => bus.emit(hostedRenderedMessage(request), window) };
}

describe("exact hosted preview lifecycle", () => {
  it("publishes replay readiness to subscribers and clears them on disposal", async () => {
    const h = harness(); const states: string[] = [];
    h.controller.subscribe(state => states.push(state.status));
    h.ready(); const a = h.controller.render(snapshot(), "course"); h.ack(); await a;
    expect(states.at(-1)).toBe("rendered");
    h.controller.reload(); expect(states.at(-1)).toBe("pending");
    h.ready("boot-2"); h.ack(); expect(states.at(-1)).toBe("rendered");
    const other = vi.fn(); const unsubscribe = h.controller.subscribe(other); unsubscribe();
    h.controller.dispose(); expect(states.at(-1)).toBe("disposed");
    expect(other).toHaveBeenCalledTimes(1);
  });
  it("registers before frame initialization; handshake is never rendered", async () => {
    const h = harness(); expect(h.bus.listeners.size).toBe(1);
    const promise = h.controller.render(snapshot(), "course");
    expect(h.posted).toHaveLength(0);
    h.ready(); expect(h.controller.state.status).toBe("pending");
    h.ack(); await expect(promise).resolves.toMatchObject({ snapshotId: "A", routeId: "course" });
    expect(h.controller.state.status).toBe("rendered");
  });
  it.each([
    { frameSession: "wrong" }, { frameGeneration: 99 }, { requestId: 99 }, { snapshotId: "B" },
    { snapshotDigest: "other" }, { draftRevision: "r-B" }, { baseline: { gitSha: "g-other", contentDigest: "c0" } },
    { baseline: { gitSha: "g0", contentDigest: "c-other" } }, { definition: "other" }, { routeId: "other" },
  ])("ignores a result with wrong current binding %j", async (change) => {
    const h = harness(); h.ready();
    const promise = h.controller.render(snapshot(), "course");
    h.bus.emit({ ...hostedRenderedMessage(h.posted[0]), ...change }, h.window);
    expect(h.controller.state.status).toBe("pending");
    h.ack(); await promise;
  });
  it("drops foreign origin/window and malformed results", async () => {
    const h = harness(); h.ready(); const promise = h.controller.render(snapshot(), "course");
    const result = hostedRenderedMessage(h.posted[0]);
    h.bus.emit(result, {}, origin); h.bus.emit(result, h.window, "https://foreign.example");
    h.bus.emit({ ...result, extra: "smuggled" }, h.window);
    expect(h.controller.state.status).toBe("pending"); h.ack(); await promise;
  });
  it("makes identity mismatch terminal, never permitting a later success", async () => {
    const h = harness(); const promise = h.controller.render(snapshot(), "course");
    h.bus.emit(hostedReadyMessage(pack, { ...renderer, rendererVersion: "bad" }, "boot"), h.window);
    await expect(promise).rejects.toMatchObject({ code: "identity-mismatch" });
    h.ready(); expect(h.posted).toHaveLength(0);
  });
  it("supersedes A, rejects its late ack/error, and detaches mutable input", async () => {
    const h = harness(); h.ready();
    const a = h.controller.render(snapshot(), "course"); const aRejected = expect(a).rejects.toMatchObject({ code: "superseded" });
    const requestA = h.posted[0]; const input = snapshot("B");
    const b = h.controller.render(input, "course"); await aRejected;
    (input.renderData as { title: string }).title = "mutated";
    expect(h.posted[1].renderData).toMatchObject({ title: "B" });
    h.ack(requestA); h.bus.emit(hostedDocumentErrorMessage(requestA, "render-failed", "Late error"), h.window);
    expect(h.controller.state.status).toBe("pending"); h.ack(); await b;
  });
  it("invalidates prior review after edits and does not replay obsolete work", async () => {
    const h = harness(); h.ready(); const a = h.controller.render(snapshot(), "course"); h.ack(); await a;
    const old = h.posted[0]; h.controller.invalidate();
    h.ack(old); h.ready("boot-2");
    expect(h.controller.state.status).toBe("stale"); expect(h.posted).toHaveLength(1);
  });
  it("replays only latest after reload, advances generation, ignores retired/duplicate readiness", async () => {
    const h = harness(); h.ready(); const a = h.controller.render(snapshot(), "course");
    const aRejected = expect(a).rejects.toMatchObject({ code: "superseded" });
    const b = h.controller.render(snapshot("B"), "course"); await aRejected;
    const old = h.posted.at(-1)!; h.controller.reload();
    h.ack(old); h.ready("boot-1"); expect(h.posted).toHaveLength(2);
    h.ready("boot-2"); h.ready("boot-2"); expect(h.posted).toHaveLength(3);
    expect(h.posted[2]).toMatchObject({ snapshotId: "B", frameSession: "boot-2" });
    expect(h.posted[2].frameGeneration).toBeGreaterThan(old.frameGeneration);
    expect(h.posted[2].requestId).toBeGreaterThan(old.requestId);
    h.ack(); await b;
    h.ack(old); expect(h.controller.state.status).toBe("rendered");
  });
  it("observes native iframe load without retiring a live early-handshake token", async () => {
    const load = new Set<() => void>();
    const posted: HostedDocumentRender[] = [];
    const frame = { contentWindow: { postMessage(message: unknown) { posted.push(message as HostedDocumentRender); } },
      addEventListener(_type: "load", listener: () => void) { load.add(listener); },
      removeEventListener(_type: "load", listener: () => void) { load.delete(listener); } };
    const h = harness({ frame });
    const a = h.controller.render(snapshot(), "course");
    h.bus.emit(hostedReadyMessage(pack, renderer, "early-boot"), frame.contentWindow);
    const early = posted[0];
    for (const listener of load) listener();
    expect(posted).toHaveLength(2);
    expect(posted[1].frameSession).toBe("early-boot");
    expect(posted[1].frameGeneration).toBeGreaterThan(early.frameGeneration);
    h.bus.emit(hostedRenderedMessage(early), frame.contentWindow); expect(h.controller.state.status).toBe("pending");
    h.bus.emit(hostedRenderedMessage(posted[1]), frame.contentWindow); await a;
    h.controller.dispose(); expect(load.size).toBe(0);
  });
  it("marks an already rendered snapshot pending again on unsolicited new boot", async () => {
    const h = harness(); h.ready(); const a = h.controller.render(snapshot(), "course"); h.ack(); await a;
    h.ready("boot-2"); expect(h.controller.state.status).toBe("pending");
    h.ack(); expect(h.controller.state.status).toBe("rendered");
  });
  it("bounds handshake/render waits; late success cannot revive timeout", async () => {
    vi.useFakeTimers(); const h = harness({ timeoutMs: 50 });
    const a = h.controller.render(snapshot(), "course"); const rejected = expect(a).rejects.toMatchObject({ code: "timeout" });
    h.ready(); const request = h.posted[0];
    vi.advanceTimersByTime(50); await rejected;
    expect(h.controller.state.status).toBe("error");
    h.ack(request);
    expect(h.controller.state).toMatchObject({ status: "error", error: { code: "timeout" } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not resend or publish a timed-out attempt on a later boot", async () => {
    vi.useFakeTimers(); const h = harness({ timeoutMs: 50 });
    const a = h.controller.render(snapshot(), "course"); const rejected = expect(a).rejects.toMatchObject({ code: "timeout" });
    vi.advanceTimersByTime(50); await rejected;
    h.ready(); expect(h.posted).toHaveLength(0);
    expect(h.controller.state).toMatchObject({ status: "error", error: { code: "timeout" } }); expect(vi.getTimerCount()).toBe(0);
    const b = h.controller.render(snapshot("B"), "course"); h.ack(); await expect(b).resolves.toMatchObject({ snapshotId: "B" });
  });
  it("returns a rejected promise for render data that cannot cross the wire", async () => {
    const h = harness(); h.ready();
    const invalid = { ...snapshot(), renderData: { run: () => undefined } } as unknown as HostedSnapshot;
    let result: Promise<unknown> | undefined;
    expect(() => { result = h.controller.render(invalid, "course"); }).not.toThrow();
    await expect(result).rejects.toThrow();
  });
  it("surfaces typed renderer failure and clears timers", async () => {
    vi.useFakeTimers(); const h = harness(); h.ready(); const a = h.controller.render(snapshot(), "course");
    h.bus.emit(hostedDocumentErrorMessage(h.posted[0], "missing-dependency", "Image unavailable"), h.window);
    await expect(a).rejects.toMatchObject({ code: "missing-dependency", message: "Image unavailable" });
    h.ack(); expect(h.controller.state.status).toBe("error"); expect(vi.getTimerCount()).toBe(0);
  });
  it("isolates simultaneous instances and disposes listeners/timers/pending work", async () => {
    vi.useFakeTimers(); const h1 = harness(); const h2 = harness({ hostWindow: h1.bus });
    h1.ready(); h1.bus.emit(hostedReadyMessage(pack, renderer, "boot-2"), h2.window);
    const a = h1.controller.render(snapshot(), "course"); const b = h2.controller.render(snapshot("B"), "course");
    h1.ack(); await a; expect(h2.controller.state.status).toBe("pending");
    h2.controller.dispose(); await expect(b).rejects.toMatchObject({ code: "disposed" });
    expect(h1.bus.listeners.size).toBe(1); expect(vi.getTimerCount()).toBe(0);
    h1.bus.emit(hostedRenderedMessage(h2.posted[0]), h2.window);
    expect(h2.controller.state.status).toBe("disposed");
    h1.controller.dispose(); expect(h1.bus.listeners.size).toBe(0);
  });
});

describe("host renderer completion and focus", () => {
  const binding: HostedPreviewBinding = { frameSession: "boot", frameGeneration: 1, requestId: 1,
    snapshotId: "A", snapshotDigest: "dA", draftRevision: "r1", baseline: { gitSha: "g", contentDigest: "c" }, definition: "d", routeId: "course" };
  it("acks only after actual render completion, aborts obsolete work and ignores duplicate requests", async () => {
    const bus = new Bus(); const postMessage = vi.fn(); const parent = { postMessage };
    const completions: (() => void)[] = []; const contexts: { signal: AbortSignal; isCurrent(): boolean }[] = [];
    const render = vi.fn((_request, context) => { contexts.push(context); return new Promise<void>(resolve => completions.push(resolve)); });
    const host = createHostedPreviewHost({ hostWindow: bus, parent, origin, pack, renderer, frameSession: "boot", render });
    host.ready(); expect(postMessage.mock.calls[0][0].type).toBe("host-ready");
    const a = hostedRenderMessage(pack, renderer, binding, { title: "A" });
    bus.emit(a, parent); await Promise.resolve(); expect(postMessage).toHaveBeenCalledTimes(1);
    bus.emit(a, parent); expect(render).toHaveBeenCalledTimes(1);
    const b = hostedRenderMessage(pack, renderer, { ...binding, requestId: 2, snapshotId: "B" }, { title: "B" });
    bus.emit(b, parent); await Promise.resolve();
    expect(contexts[0].signal.aborted).toBe(true); expect(contexts[0].isCurrent()).toBe(false);
    completions[0](); await Promise.resolve(); expect(postMessage).toHaveBeenCalledTimes(1);
    completions[1](); await Promise.resolve();
    expect(postMessage.mock.calls[1]).toEqual([hostedRenderedMessage(b), origin]);
    host.dispose(); expect(bus.listeners.size).toBe(0); expect(contexts[1].signal.aborted).toBe(true);
  });
  it("drops wrong owning window/origin/session and aborts on dispose before asynchronous commit", async () => {
    const bus = new Bus(); const postMessage = vi.fn(); const parent = { postMessage }; const render = vi.fn();
    const host = createHostedPreviewHost({ hostWindow: bus, parent, origin, pack, renderer, frameSession: "boot", render });
    const a = hostedRenderMessage(pack, renderer, binding, null);
    bus.emit(a, {}); bus.emit(a, parent, "https://foreign.example"); bus.emit({ ...a, frameSession: "old-boot" }, parent);
    await Promise.resolve(); expect(render).not.toHaveBeenCalled();
    bus.emit(a, parent); host.dispose(); await Promise.resolve();
    expect(render).not.toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
  });
  it("restores trigger focus on fullscreen close while updates preserve form focus", async () => {
    const input = document.createElement("input"); document.body.append(input); input.focus();
    const h = harness(); h.ready(); const promise = h.controller.render(snapshot(), "course"); h.ack(); await promise;
    expect(document.activeElement).toBe(input);
    const show = vi.fn(); const hide = vi.fn(); const trigger = { focus: vi.fn() };
    const fullscreen = createHostedPreviewFullscreen({ show, hide });
    fullscreen.open(trigger); fullscreen.open(trigger); fullscreen.close(); fullscreen.close();
    expect(show).toHaveBeenCalledTimes(1); expect(hide).toHaveBeenCalledTimes(1); expect(trigger.focus).toHaveBeenCalledTimes(1);
    fullscreen.open(trigger); fullscreen.dispose(); expect(trigger.focus).toHaveBeenCalledTimes(2); input.remove();
  });
  it("rejects cross-origin and wildcard preview configuration", () => {
    expect(() => buildHostedPreviewLocation("https://foreign.example/preview", origin)).toThrow("same-origin");
    expect(() => buildHostedPreviewLocation("/preview", "*")).toThrow();
    expect(() => harness({ documentOrigin: "https://foreign.example" })).toThrow("same-origin");
  });
});
