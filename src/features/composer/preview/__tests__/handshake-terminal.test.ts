import { describe, expect, it, vi } from "vitest";
import { activeComponentManifest, createActiveSampleDocument } from "../../active-pack";
import { createComposerPreviewBridge } from "../bridge";
import { createPreviewClient } from "../client";
import {
  commitInlineEditMessage,
  dropNodeMessage,
  errorMessage,
  modeMessage,
  openSourceMessage,
  readParentToPreview,
  readPreviewToParent,
  readyMessage,
  renderMessage,
  requestAddMessage,
  requestInsertMenuMessage,
  requestNodeMenuMessage,
  restoreFocusMessage,
  selectMessage,
  type MessageEventLike,
  type PreviewPackIdentity,
} from "../protocol";

const pack: PreviewPackIdentity = {
  packId: activeComponentManifest.packId,
  packVersion: activeComponentManifest.packVersion,
};
const wrongPack: PreviewPackIdentity = { packId: "@test/wrong", packVersion: "9.0.0" };
const origin = "https://composer.test";
const session = { mode: "edit", theme: "light", selectedId: null } as const;
const target = { parentId: null, slotId: "$root", index: 0 } as const;
const rect = { x: 1, y: 2, width: 3, height: 4 };

function snapshot() {
  const document = createActiveSampleDocument();
  return { document, localRecordId: document.id };
}

function messageTarget() {
  let listener: ((event: MessageEventLike) => void) | null = null;
  return {
    addEventListener: (_: "message", next: (event: MessageEventLike) => void) => { listener = next; },
    removeEventListener: () => { listener = null; },
    dispatch: (data: unknown, source: unknown, eventOrigin = origin) => listener?.({ data, source, origin: eventOrigin }),
  };
}

function parentMessages(identity: PreviewPackIdentity) {
  return [
    renderMessage(identity, 1, snapshot(), session),
    modeMessage(identity, 2, session),
    restoreFocusMessage(identity, "focus"),
  ];
}

function previewMessages(identity: PreviewPackIdentity) {
  return [
    readyMessage(identity),
    selectMessage(identity, 1, "node"),
    requestAddMessage(identity, 1, target),
    openSourceMessage(identity, "source"),
    requestNodeMenuMessage(identity, 1, "node", rect, "focus"),
    requestInsertMenuMessage(identity, 1, target, rect, "focus"),
    commitInlineEditMessage(identity, "node", "text", "value", 1),
    dropNodeMessage(identity, "node", target, false, 1),
    errorMessage(identity, 1, "failure", true),
  ];
}

describe("terminal component-pack handshake", () => {
  it("keeps every envelope strict structured-cloneable JSON data", () => {
    const messages = [
      renderMessage(pack, 1, snapshot(), session),
      modeMessage(pack, 2, session),
      restoreFocusMessage(pack, "focus"),
      readyMessage(pack),
      selectMessage(pack, 1, "node"),
      requestAddMessage(pack, 1, target),
      openSourceMessage(pack, "source"),
      requestNodeMenuMessage(pack, 1, "node", rect, "focus"),
      requestInsertMenuMessage(pack, 1, target, rect, "focus"),
      commitInlineEditMessage(pack, "node", "text", "value", 1),
      dropNodeMessage(pack, "node", target, false, 1),
      errorMessage(pack, 1, "failure", true),
    ];
    for (const message of messages) {
      expect(structuredClone(message)).toEqual(message);
      expect(JSON.parse(JSON.stringify(message))).toEqual(message);
      expect(JSON.stringify(message)).not.toMatch(/adapter|sourceText|capability|vnode/i);
    }
  });

  it.each(["packId", "packVersion"] as const)("rejects wrong %s for every message type", (key) => {
    const bad = { ...pack, [key]: "wrong" };
    const source = {};
    for (const message of parentMessages(bad)) {
      expect(readParentToPreview({ data: message, source, origin }, { source, origin, pack }))
        .toMatchObject({ ok: false, reason: "pack-mismatch" });
    }
    for (const message of previewMessages(bad)) {
      expect(readPreviewToParent({ data: message, source, origin }, { source, origin, pack }))
        .toMatchObject({ ok: false, reason: "pack-mismatch" });
    }
  });

  it.each([
    ["wrong source", "wrong-source", (message: object) => ({ data: message, source: {}, origin })],
    ["wrong origin", "wrong-origin", (message: object, source: object) => ({ data: message, source, origin: "https://foreign.test" })],
    ["missing packId", "invalid-payload", (message: Record<string, unknown>, source: object) => {
      const data = { ...message }; delete data.packId; return { data, source, origin };
    }],
    ["missing packVersion", "invalid-payload", (message: Record<string, unknown>, source: object) => {
      const data = { ...message }; delete data.packVersion; return { data, source, origin };
    }],
    ["extra envelope key", "invalid-payload", (message: object, source: object) => ({ data: { ...message, extra: true }, source, origin })],
    ["function value", "invalid-payload", (message: object, source: object) => ({ data: { ...message, packId: () => "tainted" }, source, origin })],
    ["VNode-like value", "invalid-payload", (message: object, source: object) => ({ data: { ...message, packVersion: { type: "div", props: {} } }, source, origin })],
    ["generated source", "invalid-payload", (message: object, source: object) => ({ data: { ...message, sourceText: "export default 1" }, source, origin })],
    ["provider capability", "invalid-payload", (message: object, source: object) => ({ data: { ...message, provider: { get: () => undefined } }, source, origin })],
  ] as const)("rejects %s in both directions", (_label, reason, makeEvent) => {
    const source = {};
    const expected = { source, origin, pack };
    expect(readParentToPreview(makeEvent(parentMessages(pack)[0]!, source), expected))
      .toMatchObject({ ok: false, reason });
    expect(readPreviewToParent(makeEvent(previewMessages(pack)[0]!, source), expected))
      .toMatchObject({ ok: false, reason });
  });

  it("locks the parent bridge after an initial mismatch and cannot revive", () => {
    const host = messageTarget();
    const posts: unknown[] = [];
    const frameWindow = { postMessage: (message: unknown) => posts.push(message) };
    const rejected = vi.fn();
    const callbacks = {
      onReady: vi.fn(), onSelect: vi.fn(), onRequestAdd: vi.fn(), onOpenSource: vi.fn(),
      onRequestNodeMenu: vi.fn(), onRequestInsertMenu: vi.fn(), onCommitInlineEdit: vi.fn(),
      onDropNode: vi.fn(), onError: vi.fn(),
    };
    const bridge = createComposerPreviewBridge({
      frame: { contentWindow: frameWindow },
      location: { src: "/composer/preview", targetOrigin: origin },
      hostWindow: host,
      pack,
      onRejected: rejected,
      ...callbacks,
    });
    bridge.render(snapshot(), session);
    host.dispatch(readyMessage(wrongPack), frameWindow);
    expect(bridge.terminal).toBe(true);
    expect(bridge.ready).toBe(false);
    expect(bridge.revision).toBe(-1);
    for (const message of previewMessages(pack)) host.dispatch(message, frameWindow);
    expect(bridge.render(snapshot(), session)).toBe(-1);
    expect(bridge.updateSession(session)).toBe(-1);
    bridge.restoreFocus("focus");
    expect(bridge.ready).toBe(false);
    expect(bridge.revision).toBe(-1);
    expect(posts).toEqual([]);
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
    expect(rejected).toHaveBeenCalledWith("pack-mismatch", expect.any(String));
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("treats wrong-source and wrong-origin noise as nonterminal", () => {
    const host = messageTarget();
    const posts: unknown[] = [];
    const frameWindow = { postMessage: (message: unknown) => posts.push(message) };
    const ready = vi.fn();
    const bridge = createComposerPreviewBridge({
      frame: { contentWindow: frameWindow },
      location: { src: "/composer/preview", targetOrigin: origin },
      hostWindow: host,
      pack,
      onReady: ready,
    });
    bridge.render(snapshot(), session);
    host.dispatch(readyMessage(pack), {}, origin);
    host.dispatch(readyMessage(pack), frameWindow, "https://foreign.test");
    expect(bridge.terminal).toBe(false);
    expect(bridge.ready).toBe(false);
    host.dispatch(readyMessage(pack), frameWindow);
    expect(bridge.terminal).toBe(false);
    expect(bridge.ready).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(posts).toHaveLength(1);
  });

  it("keeps independent bridges isolated and replays only each newest snapshot on reload", () => {
    const make = () => {
      const host = messageTarget();
      const posts: Array<{ revision?: number; localRecordId?: string }> = [];
      const frameWindow = { postMessage: (message: unknown) => posts.push(message as typeof posts[number]) };
      const bridge = createComposerPreviewBridge({
        frame: { contentWindow: frameWindow },
        location: { src: "/composer/preview", targetOrigin: origin },
        hostWindow: host,
        pack,
      });
      return { host, posts, frameWindow, bridge };
    };
    const canvas = make();
    const chooser = make();
    const first = snapshot();
    const newest = { ...snapshot(), localRecordId: "newest" };
    canvas.bridge.render(first, session);
    canvas.bridge.render(newest, session);
    chooser.bridge.render(first, session);
    canvas.host.dispatch(readyMessage(pack), canvas.frameWindow);
    chooser.host.dispatch(readyMessage(pack), chooser.frameWindow);
    canvas.host.dispatch(readyMessage(pack), canvas.frameWindow);
    expect(canvas.posts.map((message) => message.localRecordId)).toEqual(["newest", "newest"]);
    expect(canvas.posts[1]!.revision).toBeGreaterThan(canvas.posts[0]!.revision!);
    expect(chooser.posts).toHaveLength(1);
  });

  it("turns a mismatched reload into a terminal bridge failure", () => {
    const host = messageTarget();
    const posts: unknown[] = [];
    const frameWindow = { postMessage: (message: unknown) => posts.push(message) };
    const bridge = createComposerPreviewBridge({
      frame: { contentWindow: frameWindow },
      location: { src: "/composer/preview", targetOrigin: origin },
      hostWindow: host,
      pack,
    });
    bridge.render(snapshot(), session);
    host.dispatch(readyMessage(pack), frameWindow);
    expect(posts).toHaveLength(1);
    host.dispatch(readyMessage(wrongPack), frameWindow);
    expect(bridge.terminal).toBe(true);
    expect(bridge.ready).toBe(false);
    host.dispatch(readyMessage(pack), frameWindow);
    expect(bridge.updateSession(session)).toBe(-1);
    expect(bridge.revision).toBe(-1);
    expect(posts).toHaveLength(1);
  });

  it("locks the iframe client after a trusted-parent mismatch and suppresses every action", () => {
    const host = messageTarget();
    const posts: unknown[] = [];
    const postMessage = vi.fn((message: unknown) => posts.push(message));
    const parentWindow = { postMessage };
    const source = {};
    const rejected = vi.fn();
    const onState = vi.fn();
    const onRestoreFocus = vi.fn();
    const client = createPreviewClient({
      hostWindow: host,
      parentWindow,
      expectedSource: source,
      expectedOrigin: origin,
      targetOrigin: origin,
      pack,
      onState,
      onRestoreFocus,
      onRejected: rejected,
    });
    client.emitReady();
    expect(posts).toHaveLength(1);
    host.dispatch(renderMessage(wrongPack, 1, snapshot(), session), source);
    expect(client.terminal).toBe(true);
    expect(client.state).toMatchObject({ document: null, localRecordId: null, revision: -1 });
    const terminalState = client.state;
    client.emitReady();
    client.emitSelect("node");
    client.emitRequestAdd(target);
    client.emitOpenSource("source");
    client.emitRequestNodeMenu("node", rect, "focus");
    client.emitRequestInsertMenu(target, rect, "focus");
    client.emitCommitInlineEdit("node", "text", "value", 1);
    client.emitDropNode("node", target, false);
    client.emitError("failure");
    host.dispatch(renderMessage(pack, 2, snapshot(), session), source);
    host.dispatch(restoreFocusMessage(pack, "focus"), source);
    expect(client.state).toBe(terminalState);
    expect(onState).not.toHaveBeenCalled();
    expect(onRestoreFocus).not.toHaveBeenCalled();
    expect(posts).toHaveLength(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(rejected).toHaveBeenCalledWith("pack-mismatch", expect.any(String));
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("keeps iframe source/origin noise nonterminal before a valid render", () => {
    const host = messageTarget();
    const source = {};
    const onState = vi.fn();
    const client = createPreviewClient({
      hostWindow: host,
      parentWindow: { postMessage: vi.fn() },
      expectedSource: source,
      expectedOrigin: origin,
      targetOrigin: origin,
      pack,
      onState,
    });
    const render = renderMessage(pack, 1, snapshot(), session);
    host.dispatch(render, {}, origin);
    host.dispatch(render, source, "https://foreign.test");
    expect(client.terminal).toBe(false);
    expect(onState).not.toHaveBeenCalled();
    host.dispatch(render, source);
    expect(client.terminal).toBe(false);
    expect(client.state.revision).toBe(1);
    expect(onState).toHaveBeenCalledTimes(1);
  });
});
