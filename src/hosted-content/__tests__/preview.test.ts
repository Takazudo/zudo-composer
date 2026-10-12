import { describe, expect, it, vi } from "vitest";
import { createHostPreviewBridge, type HostPreviewState } from "../preview-bridge";
import {
  HOST_PREVIEW_PROTOCOL_VERSION,
  hostRenderMessage,
  previewErrorMessage,
  previewReadyMessage,
  previewRenderedMessage,
  readHostToPreview,
  readPreviewToHost,
  type HostPreviewRequest,
  type MessageEventLike,
} from "../preview-protocol";

const pack = { packId: "@pinsel/ui", packVersion: "1.0.0" };
const origin = "https://editor.example";
const snapshotId = "a".repeat(64);
const request: HostPreviewRequest = { snapshotId, revision: 3, route: "/about", frameLoadId: "load-1" };

function frameAndWindow() {
  const posted: [unknown, string][] = [];
  const contentWindow = { postMessage: (message: unknown, targetOrigin: string) => { posted.push([message, targetOrigin]); } };
  let listener: ((event: MessageEventLike) => void) | null = null;
  const hostWindow = {
    addEventListener: (_: "message", next: (event: MessageEventLike) => void) => { listener = next; },
    removeEventListener: () => { listener = null; },
  };
  const dispatch = (data: unknown, source: unknown = contentWindow, eventOrigin = origin) => listener?.({ data, source, origin: eventOrigin });
  return { frame: { contentWindow }, hostWindow, posted, dispatch, contentWindow };
}

describe("host preview protocol guard", () => {
  const source = {};
  const expected = { source, origin, pack };
  const event = (data: unknown, overrides: Partial<MessageEventLike> = {}) => ({ data, source, origin, ...overrides });

  it("accepts well-formed messages in both directions", () => {
    expect(readHostToPreview(event(hostRenderMessage(pack, request)), expected)).toMatchObject({ ok: true, message: { type: "render", ...request, v: HOST_PREVIEW_PROTOCOL_VERSION } });
    expect(readPreviewToHost(event(previewReadyMessage(pack, "load-1")), expected)).toMatchObject({ ok: true, message: { type: "ready", frameLoadId: "load-1" } });
    expect(readPreviewToHost(event(previewRenderedMessage(pack, request)), expected)).toMatchObject({ ok: true });
    expect(readPreviewToHost(event(previewErrorMessage(pack, "load-1", "boom", { request, recoverable: false })), expected)).toMatchObject({ ok: true, message: { type: "error", snapshotId, revision: 3, route: "/about", recoverable: false } });
    expect(readPreviewToHost(event(previewErrorMessage(pack, "load-1", "boot failed")), expected)).toMatchObject({ ok: true, message: { snapshotId: null, revision: null, route: null, recoverable: true } });
  });

  it("rejects the wrong source, origin, protocol, pack and shape before dispatch", () => {
    const ready = previewReadyMessage(pack, "load-1");
    expect(readPreviewToHost(event(ready, { source: {} }), expected)).toMatchObject({ ok: false, reason: "wrong-source" });
    expect(readPreviewToHost(event(ready, { source: null }), { ...expected, source: null })).toMatchObject({ ok: false, reason: "wrong-source" });
    expect(readPreviewToHost(event(ready, { origin: "https://evil.example" }), expected)).toMatchObject({ ok: false, reason: "wrong-origin" });
    expect(readPreviewToHost(event({ ...ready, v: 2 }), expected)).toMatchObject({ ok: false, reason: "invalid-payload" });
    expect(readPreviewToHost(event({ ...ready, channel: "composer-preview" }), expected)).toMatchObject({ ok: false, reason: "invalid-payload" });
    expect(readPreviewToHost(event({ ...ready, extra: 1 }), expected)).toMatchObject({ ok: false, reason: "invalid-payload" });
    expect(readPreviewToHost(event({ ...ready, packVersion: "9.9.9" }), expected)).toMatchObject({ ok: false, reason: "pack-mismatch" });
    expect(readHostToPreview(event({ ...hostRenderMessage(pack, request), document: { root: [] } }), expected)).toMatchObject({ ok: false, reason: "invalid-payload" });
    expect(readHostToPreview(event({ ...hostRenderMessage(pack, request), route: "https://evil.example/" }), expected)).toMatchObject({ ok: false, reason: "invalid-payload" });
    expect(readHostToPreview(event({ ...hostRenderMessage(pack, request), snapshotId: "short" }), expected)).toMatchObject({ ok: false, reason: "invalid-payload" });
    expect(readHostToPreview(event("render"), expected)).toMatchObject({ ok: false, reason: "invalid-payload" });
  });
});

describe("createHostPreviewBridge", () => {
  it("holds the newest request until ready, replays it under the frame's load id and accepts only an exact acknowledgement", () => {
    const { frame, hostWindow, posted, dispatch } = frameAndWindow();
    const states: HostPreviewState[] = [];
    const onRendered = vi.fn();
    const onStale = vi.fn();
    const bridge = createHostPreviewBridge({ frame, origin, hostWindow, pack, onRendered, onStale, onStateChange: (state) => states.push(state) });
    expect(bridge.preview({ snapshotId, revision: 1, route: "/" })).toBeNull();
    expect(bridge.preview({ snapshotId, revision: 2, route: "/about" })).toBeNull();
    expect(posted).toEqual([]);
    dispatch(previewReadyMessage(pack, "load-1"));
    expect(bridge.ready).toBe(true);
    expect(bridge.frameLoadId).toBe("load-1");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual([hostRenderMessage(pack, { snapshotId, revision: 2, route: "/about", frameLoadId: "load-1" }), origin]);
    expect(bridge.state).toEqual({ status: "pending", request: { snapshotId, revision: 2, route: "/about", frameLoadId: "load-1" } });

    dispatch(previewRenderedMessage(pack, { snapshotId, revision: 1, route: "/", frameLoadId: "load-1" }));
    dispatch(previewRenderedMessage(pack, { snapshotId, revision: 2, route: "/", frameLoadId: "load-1" }));
    dispatch(previewRenderedMessage(pack, { snapshotId, revision: 2, route: "/about", frameLoadId: "load-0" }));
    dispatch(previewRenderedMessage(pack, { snapshotId: "b".repeat(64), revision: 2, route: "/about", frameLoadId: "load-1" }));
    expect(onRendered).not.toHaveBeenCalled();
    expect(onStale).toHaveBeenCalledTimes(4);
    expect(bridge.state.status).toBe("pending");

    dispatch(previewRenderedMessage(pack, { snapshotId, revision: 2, route: "/about", frameLoadId: "load-1" }));
    expect(onRendered).toHaveBeenCalledWith({ snapshotId, revision: 2, route: "/about", frameLoadId: "load-1" });
    expect(bridge.state.status).toBe("rendered");
    // A duplicate acknowledgement after completion is stale, not a second render.
    dispatch(previewRenderedMessage(pack, { snapshotId, revision: 2, route: "/about", frameLoadId: "load-1" }));
    expect(onRendered).toHaveBeenCalledTimes(1);
    expect(states.map(({ status }) => status)).toEqual(["pending", "rendered"]);
  });

  it("answers a reload with a fresh load id by replaying the newest request, and a late ack from the old load cannot complete it", () => {
    const { frame, hostWindow, posted, dispatch } = frameAndWindow();
    const onRendered = vi.fn();
    const bridge = createHostPreviewBridge({ frame, origin, hostWindow, pack, onRendered });
    dispatch(previewReadyMessage(pack, "load-1"));
    bridge.preview({ snapshotId, revision: 5, route: "/" });
    dispatch(previewReadyMessage(pack, "load-2"));
    expect(posted.map(([message]) => (message as HostPreviewRequest).frameLoadId)).toEqual(["load-1", "load-2"]);
    dispatch(previewRenderedMessage(pack, { snapshotId, revision: 5, route: "/", frameLoadId: "load-1" }));
    expect(onRendered).not.toHaveBeenCalled();
    expect(bridge.state.status).toBe("pending");
    dispatch(previewRenderedMessage(pack, { snapshotId, revision: 5, route: "/", frameLoadId: "load-2" }));
    expect(onRendered).toHaveBeenCalledTimes(1);
  });

  it("supersedes an outstanding request so a late acknowledgement of the older one never marks the newer edit previewed", () => {
    const { frame, hostWindow, dispatch } = frameAndWindow();
    const onRendered = vi.fn();
    const bridge = createHostPreviewBridge({ frame, origin, hostWindow, pack, onRendered });
    dispatch(previewReadyMessage(pack, "load-1"));
    bridge.preview({ snapshotId, revision: 1, route: "/" });
    bridge.preview({ snapshotId, revision: 2, route: "/" });
    dispatch(previewRenderedMessage(pack, { snapshotId, revision: 1, route: "/", frameLoadId: "load-1" }));
    expect(onRendered).not.toHaveBeenCalled();
    expect(bridge.state).toEqual({ status: "pending", request: { snapshotId, revision: 2, route: "/", frameLoadId: "load-1" } });
  });

  it("surfaces errors truthfully: a matching error fails the outstanding request, an older one is reported but changes nothing", () => {
    const { frame, hostWindow, dispatch } = frameAndWindow();
    const onError = vi.fn();
    const onStale = vi.fn();
    const bridge = createHostPreviewBridge({ frame, origin, hostWindow, pack, onError, onStale });
    dispatch(previewReadyMessage(pack, "load-1"));
    bridge.preview({ snapshotId, revision: 2, route: "/" });
    dispatch(previewErrorMessage(pack, "load-1", "old", { request: { snapshotId, revision: 1, route: "/" } }));
    expect(bridge.state.status).toBe("pending");
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("old", true, { snapshotId, revision: 1, route: "/", frameLoadId: "load-1" });
    dispatch(previewErrorMessage(pack, "load-1", "boot", {}));
    expect(bridge.state.status).toBe("pending");
    dispatch(previewErrorMessage(pack, "load-1", "render failed", { request: { snapshotId, revision: 2, route: "/" }, recoverable: false }));
    expect(bridge.state).toEqual({ status: "error", request: { snapshotId, revision: 2, route: "/", frameLoadId: "load-1" }, message: "render failed", recoverable: false });
    dispatch(previewRenderedMessage(pack, { snapshotId, revision: 2, route: "/", frameLoadId: "load-1" }));
    expect(bridge.state.status).toBe("error");
  });

  it("drops foreign messages, goes terminal on a pack mismatch and stops after dispose", () => {
    const { frame, hostWindow, posted, dispatch } = frameAndWindow();
    const onRejected = vi.fn();
    const bridge = createHostPreviewBridge({ frame, origin, hostWindow, pack, onRejected });
    dispatch(previewReadyMessage(pack, "load-1"), {});
    dispatch(previewReadyMessage(pack, "load-1"), frame.contentWindow, "https://evil.example");
    dispatch({ channel: "composer-preview", v: 2, ...pack, type: "ready" });
    expect(bridge.ready).toBe(false);
    expect(onRejected.mock.calls.map(([reason]) => reason)).toEqual(["wrong-source", "wrong-origin", "invalid-payload"]);
    dispatch(previewReadyMessage({ ...pack, packVersion: "2.0.0" }, "load-1"));
    expect(bridge.terminal).toBe(true);
    expect(bridge.preview({ snapshotId, revision: 1, route: "/" })).toBeNull();
    dispatch(previewReadyMessage(pack, "load-2"));
    expect(posted).toEqual([]);
    bridge.dispose();
    dispatch(previewReadyMessage(pack, "load-3"));
    expect(bridge.ready).toBe(false);
  });
});
