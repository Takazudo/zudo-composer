// Parent-side half of the host preview bridge. Instance-scoped, like the
// Composer preview bridge: readiness, the outstanding request, the retained
// newest request and the listener all live in one closure per call.
//
// ── Request + replay contract ────────────────────────────────────────────────
// - `preview()` retains the newest request. If the iframe has not announced
//   `ready` for its current load, the request is held, not queued: a newer
//   request REPLACES the held one, so an older identity is never sent after a
//   newer one.
// - Every `ready` carries the iframe's own `frameLoadId`. The bridge adopts
//   it and replays only the retained newest request under that id, so a
//   reload (which cannot be observed from here) is answered with the current
//   content rather than left blank.
// - A `rendered` acknowledgement is accepted only if its `snapshotId`,
//   `revision`, `route` and `frameLoadId` all equal the outstanding request.
//   Anything else is reported as stale and changes nothing.
// - `error` with the outstanding identity moves the state to `error`; an
//   error about an older identity is reported but does not alter the state.

import {
  hostRenderMessage,
  readPreviewToHost,
  sameHostPreviewRequest,
  type HostPreviewGuardFailure,
  type HostPreviewPackIdentity,
  type HostPreviewRequest,
  type MessageEventLike,
  type MessagePoster,
  type MessageTarget,
} from "./preview-protocol";

export interface HostPreviewFrameLike {
  readonly contentWindow: MessagePoster | null;
}

export interface HostPreviewTarget {
  readonly snapshotId: string;
  readonly revision: number;
  readonly route: string;
}

export type HostPreviewState =
  | { status: "idle" }
  | { status: "pending"; request: HostPreviewRequest }
  | { status: "rendered"; request: HostPreviewRequest }
  | { status: "error"; request: HostPreviewRequest; message: string; recoverable: boolean };

export interface HostPreviewBridgeOptions {
  frame: HostPreviewFrameLike;
  /** Exact origin of the iframe document; used for every post and required of every inbound message. */
  origin: string;
  /** Window hosting the `message` listener — normally the parent `window`. */
  hostWindow: MessageTarget;
  pack: HostPreviewPackIdentity;
  onReady?: (frameLoadId: string) => void;
  onRendered?: (request: HostPreviewRequest) => void;
  onError?: (message: string, recoverable: boolean, request: HostPreviewRequest | null) => void;
  /** An acknowledgement or error that did not match the outstanding request was DROPPED. */
  onStale?: (received: HostPreviewRequest, outstanding: HostPreviewRequest | null) => void;
  /** A message that failed source/origin/schema validation was DROPPED. */
  onRejected?: (reason: HostPreviewGuardFailure, detail?: string) => void;
  onStateChange?: (state: HostPreviewState) => void;
}

export interface HostPreviewBridge {
  /** Request a preview of `target`; sends immediately when the frame is ready, else holds it. */
  preview(target: HostPreviewTarget): HostPreviewRequest | null;
  readonly state: HostPreviewState;
  readonly ready: boolean;
  readonly frameLoadId: string | null;
  readonly terminal: boolean;
  dispose(): void;
}

export function createHostPreviewBridge(options: HostPreviewBridgeOptions): HostPreviewBridge {
  const { frame, origin, hostWindow, pack } = options;
  let frameLoadId: string | null = null;
  let retained: HostPreviewTarget | null = null;
  let state: HostPreviewState = { status: "idle" };
  let disposed = false;
  let terminal = false;

  const setState = (next: HostPreviewState): void => {
    state = next;
    options.onStateChange?.(next);
  };

  const send = (): HostPreviewRequest | null => {
    if (!retained || frameLoadId === null || terminal) return null;
    const request: HostPreviewRequest = { ...retained, frameLoadId };
    setState({ status: "pending", request });
    frame.contentWindow?.postMessage(hostRenderMessage(pack, request), origin);
    return request;
  };

  const outstanding = (): HostPreviewRequest | null => state.status === "idle" ? null : state.request;

  const onMessage = (event: MessageEventLike): void => {
    if (disposed || terminal) return;
    const result = readPreviewToHost(event, { source: frame.contentWindow, origin, pack });
    if (!result.ok) {
      if (result.reason === "pack-mismatch") { terminal = true; frameLoadId = null; retained = null; setState({ status: "idle" }); }
      options.onRejected?.(result.reason, result.detail);
      return;
    }
    const message = result.message;
    switch (message.type) {
      case "ready":
        frameLoadId = message.frameLoadId;
        options.onReady?.(message.frameLoadId);
        if (retained) send();
        else setState({ status: "idle" });
        return;
      case "rendered": {
        const received: HostPreviewRequest = { snapshotId: message.snapshotId, revision: message.revision, route: message.route, frameLoadId: message.frameLoadId };
        const current = outstanding();
        if (state.status !== "pending" || !current || !sameHostPreviewRequest(received, current)) { options.onStale?.(received, current); return; }
        setState({ status: "rendered", request: current });
        options.onRendered?.(current);
        return;
      }
      case "error": {
        const current = outstanding();
        const names = message.snapshotId !== null && message.revision !== null && message.route !== null
          ? { snapshotId: message.snapshotId, revision: message.revision, route: message.route, frameLoadId: message.frameLoadId }
          : null;
        if (current && names && sameHostPreviewRequest(names, current)) {
          setState({ status: "error", request: current, message: message.message, recoverable: message.recoverable });
          options.onError?.(message.message, message.recoverable, current);
          return;
        }
        if (names) options.onStale?.(names, current);
        options.onError?.(message.message, message.recoverable, names);
        return;
      }
      default: {
        const unhandled: never = message;
        options.onRejected?.("invalid-payload", `unhandled message type: ${String((unhandled as { type?: unknown }).type)}`);
      }
    }
  };

  hostWindow.addEventListener("message", onMessage);

  return {
    preview(target) {
      if (terminal) return null;
      retained = { snapshotId: target.snapshotId, revision: target.revision, route: target.route };
      return send();
    },
    get state() { return state; },
    get ready() { return frameLoadId !== null; },
    get frameLoadId() { return frameLoadId; },
    get terminal() { return terminal; },
    dispose() {
      disposed = true;
      hostWindow.removeEventListener("message", onMessage);
    },
  };
}
