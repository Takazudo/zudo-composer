/** Browser lifecycle for the shared Composer guarded document protocol. */
import type { HostedSnapshot } from "./types";
import {
  hostedReadyMessage, hostedRenderMessage, hostedRenderedMessage, hostedDocumentErrorMessage,
  matchesHostedPreviewBinding, readHostedPreviewRequest, readHostedPreviewResponse,
  type HostedDocumentRender, type HostedDocumentRendered, type HostedDocumentError,
  type HostedRendererIdentity, type HostedPreviewGuardFailure, type MessageEventLike,
  type MessagePoster, type MessageTarget, type PreviewPackIdentity,
} from "./preview";

export interface HostedPreviewLocation { src: string; targetOrigin: string }
/** Preview URL is host configuration. Editable content never selects it. */
export function buildHostedPreviewLocation(previewUrl: string, documentOrigin: string): HostedPreviewLocation {
  const parent = new URL(documentOrigin);
  const preview = new URL(previewUrl, parent);
  if (!["http:", "https:"].includes(parent.protocol) || preview.origin !== parent.origin
    || preview.username || preview.password) throw new Error("Preview requires a same-origin HTTP(S) host URL");
  return { src: preview.href, targetOrigin: preview.origin };
}
export type HostedPreviewState =
  | { status: "idle" | "stale" | "disposed" }
  | { status: "pending"; snapshotId: string; routeId: string }
  | { status: "rendered"; result: HostedDocumentRendered }
  | { status: "error"; error: HostedPreviewError };
export class HostedPreviewError extends Error {
  constructor(readonly code: HostedDocumentError["code"] | "timeout" | "superseded" | "disposed" | "identity-mismatch" | "transport-error", message: string) {
    super(message); this.name = "HostedPreviewError";
  }
}
export interface HostedPreviewControllerOptions {
  frame: {
    readonly contentWindow: MessagePoster | null;
    addEventListener?(type: "load", listener: () => void): void;
    removeEventListener?(type: "load", listener: () => void): void;
  };
  location: HostedPreviewLocation;
  hostWindow: MessageTarget;
  /** Defaults to the browser document origin; explicit for structural test hosts. */
  documentOrigin?: string;
  pack: PreviewPackIdentity;
  renderer: HostedRendererIdentity;
  /** Total wait includes transport readiness. Defaults to 10 seconds. */
  timeoutMs?: number;
  onState?(state: HostedPreviewState): void;
  onRejected?(reason: HostedPreviewGuardFailure, detail?: string): void;
}
export interface HostedPreviewController {
  readonly state: HostedPreviewState;
  subscribe(listener: (state: HostedPreviewState) => void): () => void;
  render(snapshot: HostedSnapshot, routeId: string): Promise<HostedDocumentRendered>;
  /** A local change invalidates approval, including any in-flight completion. */
  invalidate(): void;
  /** Call before setting/reloading iframe src; old boot messages become obsolete. */
  reload(): void;
  dispose(): void;
}
interface Retained {
  snapshot: Pick<HostedSnapshot, "id" | "digest" | "draftRevision" | "baseline" | "definition" | "renderData">;
  routeId: string;
  request: HostedDocumentRender | null;
  resolve?: (result: HostedDocumentRendered) => void;
  reject?: (error: HostedPreviewError) => void;
}
export function createHostedPreviewController(options: HostedPreviewControllerOptions): HostedPreviewController {
  // Validate the complete location before registering anything; exact outbound
  // origin is immutable for this connection (never a wildcard).
  const documentOrigin = options.documentOrigin ?? globalThis.location?.origin;
  if (!documentOrigin) throw new Error("Preview controller requires the hosting document origin");
  const location = buildHostedPreviewLocation(options.location.src, documentOrigin);
  if (location.targetOrigin !== options.location.targetOrigin) throw new Error("Preview target origin does not match its host URL");
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Preview timeout must be positive and finite");
  let state: HostedPreviewState = { status: "idle" };
  let retained: Retained | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let session: string | null = null;
  let generation = 0;
  let sequence = 0;
  let disposed = false;
  let terminal = false;
  const retired = new Set<string>();
  const subscribers = new Set<(state: HostedPreviewState) => void>();
  const publish = (next: HostedPreviewState) => {
    state = next; options.onState?.(next);
    for (const listener of subscribers) listener(next);
  };
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const rejectPending = (error: HostedPreviewError) => {
    clearTimer();
    const reject = retained?.reject;
    if (retained) { retained.reject = undefined; retained.resolve = undefined; }
    reject?.(error);
  };
  const fail = (error: HostedPreviewError) => {
    rejectPending(error);
    // A late result or later boot cannot revive a timed-out/failed attempt.
    retained = null;
    publish({ status: "error", error });
  };
  const arm = () => {
    clearTimer();
    timer = setTimeout(() => fail(new HostedPreviewError("timeout", "Preview did not finish within the configured timeout")), timeoutMs);
  };
  const send = () => {
    if (!session || !retained || disposed || terminal) return;
    const snapshot = retained.snapshot;
    retained.request = hostedRenderMessage(options.pack, options.renderer, {
      frameSession: session, frameGeneration: generation, requestId: ++sequence,
      snapshotId: snapshot.id, snapshotDigest: snapshot.digest, draftRevision: snapshot.draftRevision,
      baseline: snapshot.baseline, definition: snapshot.definition, routeId: retained.routeId,
    }, snapshot.renderData);
    publish({ status: "pending", snapshotId: snapshot.id, routeId: retained.routeId });
    arm();
    try { options.frame.contentWindow?.postMessage(retained.request, location.targetOrigin); }
    catch { fail(new HostedPreviewError("transport-error", "Preview message could not be delivered")); }
  };
  const onMessage = (event: MessageEventLike) => {
    if (disposed || terminal) return;
    const result = readHostedPreviewResponse(event, {
      source: options.frame.contentWindow, origin: location.targetOrigin, pack: options.pack, renderer: options.renderer,
    });
    if (!result.ok) {
      options.onRejected?.(result.reason, result.detail);
      if (result.reason === "pack-mismatch" || result.reason === "renderer-mismatch") {
        terminal = true;
        fail(new HostedPreviewError("identity-mismatch", result.detail ?? "Preview identity does not match"));
      }
      return;
    }
    const message = result.message;
    if (message.type === "host-ready") {
      if (message.frameSession === session || retired.has(message.frameSession)) return;
      if (session) retired.add(session);
      session = message.frameSession;
      ++generation;
      send();
      return;
    }
    if (!retained?.request || !matchesHostedPreviewBinding(message, retained.request)) return;
    if (message.type === "document-error") { fail(new HostedPreviewError(message.code, message.message)); return; }
    const resolve = retained.resolve;
    retained.resolve = undefined; retained.reject = undefined;
    retained.request = null;
    clearTimer();
    publish({ status: "rendered", result: message });
    resolve?.(message);
  };
  const onLoad = () => {
    if (disposed || terminal) return;
    // A host-ready may arrive before the native load event. Keep that boot token
    // and mint a fresh generation/request rather than retiring a live session.
    ++generation;
    if (retained) {
      retained.request = null;
      publish({ status: "pending", snapshotId: retained.snapshot.id, routeId: retained.routeId });
      arm();
      send();
    }
  };
  // Caller initializes src only after this returns, so no boot handshake is lost.
  options.hostWindow.addEventListener("message", onMessage);
  options.frame.addEventListener?.("load", onLoad);
  return {
    get state() { return state; },
    subscribe(listener) {
      if (!disposed) subscribers.add(listener);
      listener(state);
      return () => { subscribers.delete(listener); };
    },
    render(snapshot, routeId) {
      if (disposed || terminal) return Promise.reject(new HostedPreviewError(disposed ? "disposed" : "identity-mismatch", "Preview connection is unavailable"));
      // Parse and detach before invalidating the old valid request. Only neutral
      // projection/identity crosses the wire, never model records or functions.
      let detached: HostedDocumentRender;
      try {
        detached = hostedRenderMessage(options.pack, options.renderer, {
          frameSession: session ?? "awaiting-host", frameGeneration: generation, requestId: sequence + 1,
          snapshotId: snapshot.id, snapshotDigest: snapshot.digest, draftRevision: snapshot.draftRevision,
          baseline: snapshot.baseline, definition: snapshot.definition, routeId,
        }, snapshot.renderData);
      } catch (error) { return Promise.reject(error); }
      rejectPending(new HostedPreviewError("superseded", "A newer preview request replaced this request"));
      return new Promise((resolve, reject) => {
        retained = { snapshot: { id: detached.snapshotId, digest: detached.snapshotDigest, draftRevision: detached.draftRevision,
          baseline: detached.baseline, definition: detached.definition, renderData: detached.renderData }, routeId, request: null, resolve, reject };
        publish({ status: "pending", snapshotId: snapshot.id, routeId });
        arm();
        send();
      });
    },
    invalidate() {
      if (disposed) return;
      rejectPending(new HostedPreviewError("superseded", "The draft changed after preview was requested"));
      retained = null;
      publish({ status: "stale" });
    },
    reload() {
      if (disposed || terminal) return;
      if (session) retired.add(session);
      session = null;
      ++generation;
      if (retained) {
        retained.request = null;
        publish({ status: "pending", snapshotId: retained.snapshot.id, routeId: retained.routeId });
        arm();
      } else publish({ status: "idle" });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.hostWindow.removeEventListener("message", onMessage);
      options.frame.removeEventListener?.("load", onLoad);
      rejectPending(new HostedPreviewError("disposed", "Preview connection was disposed"));
      retained = null;
      publish({ status: "disposed" });
      subscribers.clear();
    },
  };
}

export interface HostedPreviewRenderContext { signal: AbortSignal; isCurrent(): boolean }
export interface HostedPreviewHostOptions {
  hostWindow: MessageTarget;
  parent: MessagePoster;
  origin: string;
  pack: PreviewPackIdentity;
  renderer: HostedRendererIdentity;
  /** Host generates a fresh opaque token for each document boot. */
  frameSession: string;
  /** Resolve only after actual visitor commit and declared asset/dependency work.
   * Check context before committing asynchronous work; obsolete work is aborted. */
  render(request: HostedDocumentRender, context: HostedPreviewRenderContext): void | Promise<void>;
  onRejected?(reason: HostedPreviewGuardFailure, detail?: string): void;
}
/** No framework dependency: a host mounts its own real renderer and styles. */
export function createHostedPreviewHost(options: HostedPreviewHostOptions): { ready(): void; dispose(): void } {
  const location = buildHostedPreviewLocation(options.origin, options.origin);
  const ready = hostedReadyMessage(options.pack, options.renderer, options.frameSession);
  let disposed = false;
  let current: HostedDocumentRender | null = null;
  let abort: AbortController | null = null;
  const post = (message: unknown) => {
    try { options.parent.postMessage(message, location.targetOrigin); }
    catch { /* The parent observes transport loss through its bounded timeout. */ }
  };
  const onMessage = (event: MessageEventLike) => {
    if (disposed) return;
    const result = readHostedPreviewRequest(event, { source: options.parent, origin: location.targetOrigin, pack: options.pack, renderer: options.renderer });
    if (!result.ok) { options.onRejected?.(result.reason, result.detail); return; }
    const request = result.message;
    if (request.frameSession !== options.frameSession) return;
    if (current && (request.frameGeneration < current.frameGeneration || request.requestId <= current.requestId)) return;
    abort?.abort();
    const taskAbort = new AbortController();
    abort = taskAbort;
    current = request;
    const isCurrent = () => !disposed && current === request && !taskAbort.signal.aborted;
    // Enter the callback in a microtask, enabling synchronous supersession to
    // cancel work before the obsolete render even begins.
    void Promise.resolve().then(async () => {
      if (!isCurrent()) return;
      try {
        await options.render(request, { signal: taskAbort.signal, isCurrent });
        if (isCurrent()) post(hostedRenderedMessage(request));
      } catch (error) {
        if (!isCurrent()) return;
        const code = error instanceof HostedPreviewError && ["missing-dependency", "unsupported-route", "invalid-document"].includes(error.code)
          ? error.code as HostedDocumentError["code"] : "render-failed";
        post(hostedDocumentErrorMessage(request, code,
          error instanceof Error && error.message ? error.message : "Visitor document could not be rendered"));
      }
    });
  };
  options.hostWindow.addEventListener("message", onMessage);
  return {
    ready() { if (!disposed) post(ready); },
    dispose() {
      if (disposed) return;
      disposed = true; abort?.abort(); current = null;
      options.hostWindow.removeEventListener("message", onMessage);
    },
  };
}

/** Fullscreen presentation retains the same iframe and never touches its src.
 * The host owns dialog/layout; this helper owns the trigger focus contract. */
export function createHostedPreviewFullscreen(options: { show(): void; hide(): void }): {
  open(trigger: { focus(): void }): void; close(): void; dispose(): void;
} {
  let trigger: { focus(): void } | null = null;
  let disposed = false;
  const close = () => {
    if (!trigger) return;
    const restore = trigger; trigger = null;
    try { options.hide(); } finally { restore.focus(); }
  };
  return {
    open(next) { if (disposed || trigger) return; trigger = next; options.show(); },
    close,
    dispose() { if (disposed) return; disposed = true; close(); },
  };
}
