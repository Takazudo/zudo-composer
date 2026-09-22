// Broadcasts an editor tab's pending-save state to other tabs — most notably
// the working preview — as a hint. Never load-bearing: save coherence always
// rests on persisted mutation tokens and `persistence-generation`'s own
// change notifications. With no `BroadcastChannel` (or a throwing one), both
// sides are silent no-ops and a reader reports `false`.
//
// Every message carries the workspace it speaks for, and both sides drop
// anything from another workspace. The channel name stays shared because the
// workspace id resolves late (it is `undefined` until initialization lands),
// so a per-workspace channel could not be opened at subscribe time. Unlike
// `persistence-generation` — whose false positives only cost a re-capture —
// this value is rendered verbatim to the user ("The editor has unsaved
// changes…"), so another workspace's pending state is a false statement about
// this one, not a cheap retry.

import { createUuidIdFactory } from "./id-factory";

export interface PendingSource {
  /** `undefined` until the workspace resolves; publishing is a no-op until then. */
  readonly workspaceId: string | undefined;
  getPending(): boolean;
  subscribe(listener: () => void): () => void;
}

type PendingMessage =
  | { readonly type: "pending"; readonly sender: string; readonly workspaceId: string; readonly value: boolean }
  | { readonly type: "query"; readonly workspaceId: string };

const CHANNEL_NAME = "zudo-workspace-pending-v1";

/**
 * A reader drops a sender that does not answer a re-query within this long.
 * Keeps a dead editor tab (one that closed without firing `pagehide`) from
 * latching the indicator on forever.
 */
export const PENDING_QUERY_TIMEOUT_MS = 2000;

function isPendingMessage(data: unknown): data is PendingMessage {
  if (!data || typeof data !== "object") return false;
  if (typeof (data as { workspaceId?: unknown }).workspaceId !== "string") return false;
  const type = (data as { type?: unknown }).type;
  if (type === "query") return true;
  return type === "pending"
    && typeof (data as { sender?: unknown }).sender === "string"
    && typeof (data as { value?: unknown }).value === "boolean";
}

function openChannel(): BroadcastChannel | undefined {
  if (!("window" in globalThis) || typeof BroadcastChannel === "undefined") return undefined;
  try { return new BroadcastChannel(CHANNEL_NAME); } catch { return undefined; }
}

/** Editor side: answers this workspace's `query` messages and announces every `getPending()` transition. */
export function publishPendingState({ workspaceId, getPending, subscribe }: PendingSource): () => void {
  if (workspaceId === undefined) return () => { /* no workspace yet: silent no-op */ };
  const channel = openChannel();
  if (!channel) return () => { /* no BroadcastChannel: silent no-op */ };
  const sender = createUuidIdFactory()("pending-sender");
  let last = getPending();
  const post = (value: boolean) => {
    try { channel.postMessage({ type: "pending", sender, workspaceId, value } satisfies PendingMessage); } catch { /* hint only */ }
  };
  channel.onmessage = ({ data }) => {
    if (isPendingMessage(data) && data.type === "query" && data.workspaceId === workspaceId) post(last);
  };
  const unsubscribe = subscribe(() => {
    const value = getPending();
    if (value === last) return;
    last = value;
    post(value);
  });
  const pagehide = () => post(false);
  window.addEventListener("pagehide", pagehide);
  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", pagehide);
    channel.onmessage = null;
    channel.close();
  };
}

/**
 * Reader side. State is "any sender for this workspace currently true" so one
 * tab's `false` cannot clear another tab's `true`. Queries on start, on
 * becoming visible, and on focus, since the query is the only way a preview
 * opened after writes went pending ever learns about them.
 */
export function subscribePendingState(workspaceId: string | undefined, listener: (pending: boolean) => void): () => void {
  if (workspaceId === undefined) return () => { /* no workspace yet: silent no-op */ };
  const channel = openChannel();
  if (!channel) { listener(false); return () => { /* no BroadcastChannel: silent no-op */ }; }
  const senders = new Set<string>();
  const awaiting = new Map<string, ReturnType<typeof setTimeout>>();
  let notified = false;
  const notify = () => {
    const pending = senders.size > 0;
    if (pending === notified) return;
    notified = pending;
    listener(pending);
  };
  const clearAwait = (sender: string) => {
    const timer = awaiting.get(sender);
    if (timer !== undefined) { clearTimeout(timer); awaiting.delete(sender); }
  };
  const query = () => {
    for (const timer of awaiting.values()) clearTimeout(timer);
    awaiting.clear();
    // Every sender must reanswer within the window or it is presumed gone.
    for (const sender of senders) {
      awaiting.set(sender, setTimeout(() => { senders.delete(sender); awaiting.delete(sender); notify(); }, PENDING_QUERY_TIMEOUT_MS));
    }
    try { channel.postMessage({ type: "query", workspaceId } satisfies PendingMessage); } catch { /* hint only */ }
  };
  channel.onmessage = ({ data }) => {
    if (!isPendingMessage(data) || data.type !== "pending") return;
    if (data.workspaceId !== workspaceId) {
      // A sender we were counting now speaks for another workspace: that tab
      // switched, so drop it now instead of letting it latch until expiry.
      if (!senders.has(data.sender)) return;
      clearAwait(data.sender);
      senders.delete(data.sender);
      notify();
      return;
    }
    clearAwait(data.sender);
    if (data.value) senders.add(data.sender); else senders.delete(data.sender);
    notify();
  };
  const visibility = () => { if (document.visibilityState === "visible") query(); };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("focus", query);
  query();
  return () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("focus", query);
    for (const timer of awaiting.values()) clearTimeout(timer);
    channel.onmessage = null;
    channel.close();
  };
}
