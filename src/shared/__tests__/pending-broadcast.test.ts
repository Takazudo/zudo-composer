import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_QUERY_TIMEOUT_MS, publishPendingState, subscribePendingState } from "../pending-broadcast";
import type { PendingSource } from "../pending-broadcast";

// Mirrors the private `CHANNEL_NAME` in ../pending-broadcast.
const CHANNEL_NAME = "zudo-workspace-pending-v1";

/** A same-origin `BroadcastChannel` stand-in: peers sharing a name see each other's posts, never their own. */
class FakeBroadcastChannel {
  static registry = new Map<string, Set<FakeBroadcastChannel>>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    const peers = FakeBroadcastChannel.registry.get(name) ?? new Set<FakeBroadcastChannel>();
    peers.add(this);
    FakeBroadcastChannel.registry.set(name, peers);
  }
  postMessage(data: unknown) {
    for (const peer of FakeBroadcastChannel.registry.get(this.name) ?? []) {
      if (peer !== this) peer.onmessage?.({ data });
    }
  }
  close() {
    FakeBroadcastChannel.registry.get(this.name)?.delete(this);
  }
  static reset() { FakeBroadcastChannel.registry.clear(); }
}

function messageType(data: unknown): string | undefined {
  return data && typeof data === "object" ? (data as { type?: string }).type : undefined;
}

function fakeEditor(workspaceId: string | undefined, initial = false): { source: PendingSource; setPending(value: boolean): void } {
  let pending = initial;
  const listeners = new Set<() => void>();
  return {
    source: {
      workspaceId,
      getPending: () => pending,
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    },
    setPending(value) { pending = value; for (const listener of listeners) listener(); },
  };
}

describe("workspace pending-state broadcast", () => {
  beforeEach(() => {
    FakeBroadcastChannel.reset();
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("announces every hasPending transition to a live reader", () => {
    const editor = fakeEditor("ws-a");
    const stopPublish = publishPendingState(editor.source);
    const received: boolean[] = [];
    const stopRead = subscribePendingState("ws-a", (pending) => received.push(pending));

    editor.setPending(true);
    editor.setPending(false);
    expect(received).toEqual([true, false]);

    stopRead();
    stopPublish();
  });

  it("answers a reader's query with the editor's current state, not just future transitions", () => {
    // The preview tab opens after the writes already went pending, so the
    // transition itself never reaches it — only the query on start does.
    const editor = fakeEditor("ws-a");
    const stopPublish = publishPendingState(editor.source);
    editor.setPending(true);

    const received: boolean[] = [];
    const stopRead = subscribePendingState("ws-a", (pending) => received.push(pending));
    expect(received).toEqual([true]);

    stopRead();
    stopPublish();
  });

  it("keeps state true while any sender is true; one sender's false cannot clear another's true", () => {
    const editorA = fakeEditor("ws-a");
    const editorB = fakeEditor("ws-a");
    const stopA = publishPendingState(editorA.source);
    const stopB = publishPendingState(editorB.source);
    const received: boolean[] = [];
    const stopRead = subscribePendingState("ws-a", (pending) => received.push(pending));

    editorA.setPending(true);
    editorB.setPending(true);
    expect(received).toEqual([true]);

    editorB.setPending(false);
    expect(received).toEqual([true]); // A is still true

    editorA.setPending(false);
    expect(received).toEqual([true, false]); // both false now

    stopRead();
    stopA();
    stopB();
  });

  it("posts false on pagehide", () => {
    const editor = fakeEditor("ws-a");
    const stopPublish = publishPendingState(editor.source);
    editor.setPending(true);

    const received: boolean[] = [];
    const stopRead = subscribePendingState("ws-a", (pending) => received.push(pending));
    expect(received).toEqual([true]);

    window.dispatchEvent(new Event("pagehide"));
    expect(received).toEqual([true, false]);

    stopRead();
    stopPublish();
  });

  it("drops a silently-dead sender after a re-query goes unanswered", () => {
    vi.useFakeTimers();
    // A raw channel standing in for an editor tab that crashed without firing
    // `pagehide`: it answers the first query, then goes silent.
    const deadEditor = new FakeBroadcastChannel(CHANNEL_NAME);
    deadEditor.onmessage = ({ data }) => {
      if (messageType(data) === "query") {
        deadEditor.postMessage({ type: "pending", sender: "dead-editor", workspaceId: "ws-a", value: true });
      }
    };

    const received: boolean[] = [];
    const stopRead = subscribePendingState("ws-a", (pending) => received.push(pending));
    expect(received).toEqual([true]);

    deadEditor.close(); // the tab is gone; it can no longer hear or answer queries
    window.dispatchEvent(new Event("focus")); // reader re-queries
    expect(received).toEqual([true]); // not dropped yet; the timeout hasn't elapsed

    vi.advanceTimersByTime(PENDING_QUERY_TIMEOUT_MS);
    expect(received).toEqual([true, false]);

    stopRead();
  });

  it("re-queries only when becoming visible, not when becoming hidden", () => {
    // Real background tabs can be frozen and miss message events entirely, so
    // a reader that only trusts transitions can go stale; re-querying on
    // visibility is what catches it back up. Verified here at the protocol
    // level (a fresh `query` goes out) since a fake bus always delivers.
    const editor = fakeEditor("ws-a", true);
    const stopPublish = publishPendingState(editor.source);
    let queries = 0;
    const spy = new FakeBroadcastChannel(CHANNEL_NAME);
    spy.onmessage = ({ data }) => { if (messageType(data) === "query") queries++; };

    const stopRead = subscribePendingState("ws-a", () => {});
    expect(queries).toBe(1); // the initial query on start

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(queries).toBe(1); // no re-query while hidden

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(queries).toBe(2);

    stopRead();
    stopPublish();
    spy.close();
  });

  it("ignores another workspace's pending state", () => {
    // The whole point of the scoping: the reader renders this sentence to the
    // user, so another workspace's unsaved edits must not raise it here.
    const editorB = fakeEditor("ws-b");
    const stopPublish = publishPendingState(editorB.source);
    const received: boolean[] = [];
    const stopRead = subscribePendingState("ws-a", (pending) => received.push(pending));

    editorB.setPending(true);
    expect(received).toEqual([]);

    stopRead();
    stopPublish();
  });

  it("answers only its own workspace's query", () => {
    const editor = fakeEditor("ws-a", true);
    const stopPublish = publishPendingState(editor.source);
    const answers: unknown[] = [];
    const spy = new FakeBroadcastChannel(CHANNEL_NAME);
    spy.onmessage = ({ data }) => { if (messageType(data) === "pending") answers.push(data); };

    spy.postMessage({ type: "query", workspaceId: "ws-b" });
    expect(answers).toEqual([]);

    spy.postMessage({ type: "query" }); // old format, no workspace id
    expect(answers).toEqual([]);

    spy.postMessage({ type: "query", workspaceId: "ws-a" });
    expect(answers).toEqual([{ type: "pending", sender: expect.any(String), workspaceId: "ws-a", value: true }]);

    stopPublish();
    spy.close();
  });

  it("drops a known sender that starts reporting for another workspace", () => {
    vi.useFakeTimers();
    // A tab that switched workspace keeps its sender id but now speaks for
    // another workspace; leaving it in the set would latch this reader on
    // until its expiry window elapsed.
    const mover = new FakeBroadcastChannel(CHANNEL_NAME);
    let moverWorkspace = "ws-a";
    mover.onmessage = ({ data }) => {
      if (messageType(data) !== "query") return;
      if ((data as { workspaceId?: string }).workspaceId !== moverWorkspace) return;
      mover.postMessage({ type: "pending", sender: "mover", workspaceId: moverWorkspace, value: true });
    };

    const received: boolean[] = [];
    const stopRead = subscribePendingState("ws-a", (pending) => received.push(pending));
    expect(received).toEqual([true]);

    // An old-format message carries no workspace at all: dropped outright,
    // never read as "some other workspace" and used to evict this sender.
    mover.postMessage({ type: "pending", sender: "mover", value: true });
    expect(received).toEqual([true]);

    moverWorkspace = "ws-b";
    window.dispatchEvent(new Event("focus")); // re-query; the mover no longer answers for ws-a
    mover.postMessage({ type: "pending", sender: "mover", workspaceId: "ws-b", value: true });
    expect(received).toEqual([true, false]); // dropped now, not at expiry

    vi.advanceTimersByTime(PENDING_QUERY_TIMEOUT_MS); // the pending re-query timer was cleared with it
    expect(received).toEqual([true, false]);

    stopRead();
    mover.close();
  });

  it("posts nothing while the publisher has no workspace id yet", () => {
    const editor = fakeEditor(undefined, true);
    const posts: unknown[] = [];
    const spy = new FakeBroadcastChannel(CHANNEL_NAME);
    spy.onmessage = ({ data }) => posts.push(data);

    const stopPublish = publishPendingState(editor.source);
    editor.setPending(false);
    editor.setPending(true);
    window.dispatchEvent(new Event("pagehide"));
    spy.postMessage({ type: "query", workspaceId: "ws-a" });
    expect(posts).toEqual([]);

    expect(() => stopPublish()).not.toThrow();
    spy.close();
  });

  it("delivers nothing and answers nothing while the reader has no workspace id yet", () => {
    const editor = fakeEditor("ws-a", true);
    const stopPublish = publishPendingState(editor.source);
    const queries: unknown[] = [];
    const spy = new FakeBroadcastChannel(CHANNEL_NAME);
    spy.onmessage = ({ data }) => { if (messageType(data) === "query") queries.push(data); };

    const received: boolean[] = [];
    const stopRead = subscribePendingState(undefined, (pending) => received.push(pending));
    expect(received).toEqual([]); // not even the `false` the no-channel path reports
    expect(queries).toEqual([]);

    editor.setPending(false);
    expect(received).toEqual([]);

    expect(() => stopRead()).not.toThrow();
    stopPublish();
    spy.close();
  });

  it("is a silent no-op with no BroadcastChannel: the reader reports false", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const editor = fakeEditor("ws-a");
    const stopPublish = publishPendingState(editor.source);
    const received: boolean[] = [];
    const stopRead = subscribePendingState("ws-a", (pending) => received.push(pending));
    expect(received).toEqual([false]);

    expect(() => editor.setPending(true)).not.toThrow();
    expect(received).toEqual([false]);

    expect(() => stopPublish()).not.toThrow();
    expect(() => stopRead()).not.toThrow();
  });

  it("is a silent no-op when the channel constructor throws", () => {
    vi.stubGlobal("BroadcastChannel", class { constructor() { throw new Error("blocked"); } });
    const editor = fakeEditor("ws-a");
    expect(() => publishPendingState(editor.source)).not.toThrow();
    const received: boolean[] = [];
    expect(() => subscribePendingState("ws-a", (pending) => received.push(pending))).not.toThrow();
    expect(received).toEqual([false]);
  });
});
