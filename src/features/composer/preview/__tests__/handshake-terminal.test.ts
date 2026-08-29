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
    dispatch: (data: unknown, source: unknown) => listener?.({ data, source, origin }),
  };
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
    const parentMessages = [
      renderMessage(bad, 1, snapshot(), session),
      modeMessage(bad, 2, session),
      restoreFocusMessage(bad, "focus"),
    ];
    const previewMessages = [
      readyMessage(bad),
      selectMessage(bad, 1, "node"),
      requestAddMessage(bad, 1, target),
      openSourceMessage(bad, "source"),
      requestNodeMenuMessage(bad, 1, "node", rect, "focus"),
      requestInsertMenuMessage(bad, 1, target, rect, "focus"),
      commitInlineEditMessage(bad, "node", "text", "value", 1),
      dropNodeMessage(bad, "node", target, false, 1),
      errorMessage(bad, 1, "failure", true),
    ];
    const source = {};
    for (const message of parentMessages) {
      expect(readParentToPreview({ data: message, source, origin }, { source, origin, pack }))
        .toMatchObject({ ok: false, reason: "pack-mismatch" });
    }
    for (const message of previewMessages) {
      expect(readPreviewToParent({ data: message, source, origin }, { source, origin, pack }))
        .toMatchObject({ ok: false, reason: "pack-mismatch" });
    }
  });

  it("locks the parent bridge after an initial mismatch and cannot revive", () => {
    const host = messageTarget();
    const posts: unknown[] = [];
    const frameWindow = { postMessage: (message: unknown) => posts.push(message) };
    const rejected = vi.fn();
    const bridge = createComposerPreviewBridge({
      frame: { contentWindow: frameWindow },
      location: { src: "/composer/preview", targetOrigin: origin },
      hostWindow: host,
      pack,
      onRejected: rejected,
    });
    bridge.render(snapshot(), session);
    host.dispatch(readyMessage(wrongPack), frameWindow);
    expect(bridge.terminal).toBe(true);
    expect(bridge.ready).toBe(false);
    host.dispatch(readyMessage(pack), frameWindow);
    expect(bridge.render(snapshot(), session)).toBe(-1);
    bridge.updateSession(session);
    bridge.restoreFocus("focus");
    expect(posts).toEqual([]);
    expect(rejected).toHaveBeenCalledWith("pack-mismatch", expect.any(String));
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
    bridge.updateSession(session);
    expect(posts).toHaveLength(1);
  });

  it("locks the iframe client after a trusted-parent mismatch and suppresses every action", () => {
    const host = messageTarget();
    const posts: unknown[] = [];
    const parentWindow = { postMessage: (message: unknown) => posts.push(message) };
    const source = {};
    const rejected = vi.fn();
    const client = createPreviewClient({
      hostWindow: host,
      parentWindow,
      expectedSource: source,
      expectedOrigin: origin,
      targetOrigin: origin,
      pack,
      onState: vi.fn(),
      onRejected: rejected,
    });
    client.emitReady();
    expect(posts).toHaveLength(1);
    host.dispatch(renderMessage(wrongPack, 1, snapshot(), session), source);
    expect(client.terminal).toBe(true);
    client.emitSelect("node");
    client.emitRequestAdd(target);
    client.emitOpenSource("source");
    client.emitRequestNodeMenu("node", rect, "focus");
    client.emitRequestInsertMenu(target, rect, "focus");
    client.emitCommitInlineEdit("node", "text", "value", 1);
    client.emitDropNode("node", target, false);
    client.emitError("failure");
    host.dispatch(renderMessage(pack, 2, snapshot(), session), source);
    expect(posts).toHaveLength(1);
    expect(rejected).toHaveBeenCalledWith("pack-mismatch", expect.any(String));
  });
});
