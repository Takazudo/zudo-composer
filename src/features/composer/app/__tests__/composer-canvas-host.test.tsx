/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
// Canvas host + REAL #248 bridge, wired through a recording frame / deliverable
// host (no live iframe). Proves the parent-side lifecycle: retain-until-ready,
// ready replay, document render vs. session-only update, inbound select /
// request-add (+ focus restoration seam) / recoverable error, and viewport
// sizing — issue #251 scope items 2, 3, 5.

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { fireEvent, render, screen } from "@testing-library/preact";
import { fixtureComponentProvider, createFixtureSampleDocument } from "../../test-support/fixture-pack";
import {
  commitInlineEditMessage as protocolCommitInlineEditMessage,
  dropNodeMessage as protocolDropNodeMessage,
  errorMessage as protocolErrorMessage,
  openSourceMessage as protocolOpenSourceMessage,
  readyMessage as protocolReadyMessage,
  requestAddMessage as protocolRequestAddMessage,
  requestInsertMenuMessage as protocolRequestInsertMenuMessage,
  requestNodeMenuMessage as protocolRequestNodeMenuMessage,
  selectMessage as protocolSelectMessage,
} from "../../preview/protocol";
import type { PreviewSession, SerializedRect } from "../../preview";
import { ComposerCanvasHost } from "../composer-canvas-host";
import { makeTestBridge } from "../test-support/preview-harness";

const EDIT: PreviewSession = { mode: "edit", theme: "light", selectedId: null };
const RECT: SerializedRect = { x: 10, y: 20, width: 100, height: 24 };
const PREVIEW_PACK = fixtureComponentProvider.manifest;

const readyMessage = () => protocolReadyMessage(PREVIEW_PACK);
const selectMessage = (revision: number, nodeId: string) => protocolSelectMessage(PREVIEW_PACK, revision, nodeId);
const openSourceMessage = (sourceRecordId: string) => protocolOpenSourceMessage(PREVIEW_PACK, sourceRecordId);
const requestAddMessage = (revision: number, target: Parameters<typeof protocolRequestAddMessage>[2]) =>
  protocolRequestAddMessage(PREVIEW_PACK, revision, target);
const errorMessage = (revision: number, message: string, recoverable: boolean) =>
  protocolErrorMessage(PREVIEW_PACK, revision, message, recoverable);
const commitInlineEditMessage = (nodeId: string, fieldKey: string, value: string, revision: number) =>
  protocolCommitInlineEditMessage(PREVIEW_PACK, nodeId, fieldKey, value, revision);
const requestNodeMenuMessage = (
  revision: number,
  nodeId: string,
  rect: SerializedRect,
  token: string,
) => protocolRequestNodeMenuMessage(PREVIEW_PACK, revision, nodeId, rect, token);
const requestInsertMenuMessage = (
  revision: number,
  target: Parameters<typeof protocolRequestInsertMenuMessage>[2],
  rect: SerializedRect,
  token: string,
) => protocolRequestInsertMenuMessage(PREVIEW_PACK, revision, target, rect, token);
const dropNodeMessage = (
  sourceId: string,
  target: Parameters<typeof protocolDropNodeMessage>[2],
  copy: boolean,
  revision: number,
) => protocolDropNodeMessage(PREVIEW_PACK, sourceId, target, copy, revision);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAny = (v: unknown) => v as any;

function mount(overrides: Partial<Parameters<typeof ComposerCanvasHost>[0]> = {}) {
  const bridge = makeTestBridge();
  const onSelect = vi.fn();
  const onRequestAdd = vi.fn();
  const onRequestNodeMenu = vi.fn();
  const onRequestInsertMenu = vi.fn();
  const onCommitInlineEdit = vi.fn();
  const onDropNode = vi.fn();
  const doc = createFixtureSampleDocument();
  doc.name = "first";
  const utils = render(
    <ComposerCanvasHost
      componentProvider={fixtureComponentProvider}
      document={doc}
      session={EDIT}
      viewport="fluid"
      onSelect={onSelect}
      onRequestAdd={onRequestAdd}
      onRequestNodeMenu={onRequestNodeMenu}
      onRequestInsertMenu={onRequestInsertMenu}
      onCommitInlineEdit={onCommitInlineEdit}
      onDropNode={onDropNode}
      createBridge={bridge.createBridge}
      location={bridge.location}
      {...overrides}
    />,
  );
  return {
    bridge,
    onSelect,
    onRequestAdd,
    onRequestNodeMenu,
    onRequestInsertMenu,
    onDropNode,
    onCommitInlineEdit,
    doc,
    ...utils,
  };
}

describe("ComposerCanvasHost — bridge lifecycle (#251)", () => {
  it("holds the initial snapshot until ready, then replays it to the exact origin", () => {
    const { bridge, doc } = mount();
    expect(bridge.posts).toHaveLength(0);

    act(() => bridge.deliver(readyMessage()));

    expect(bridge.posts).toHaveLength(1);
    expect(asAny(bridge.posts[0].message).type).toBe("render");
    expect(asAny(bridge.posts[0].message).document.name).toBe("first");
    expect(asAny(bridge.posts[0].message).localRecordId).toBe(doc.id);
    expect(bridge.posts[0].targetOrigin).toBe(bridge.location.targetOrigin);
  });

  it("a document change re-renders; a session-only change is a lighter update", () => {
    const { bridge, doc, rerender, onSelect, onRequestAdd, onRequestNodeMenu, onRequestInsertMenu, onCommitInlineEdit, onDropNode } =
      mount();
    act(() => bridge.deliver(readyMessage()));
    bridge.posts.length = 0;

    const doc2 = createFixtureSampleDocument();
    doc2.name = "second";
    rerender(
      <ComposerCanvasHost
        componentProvider={fixtureComponentProvider}
        document={doc2}
        session={EDIT}
        viewport="fluid"
        onSelect={onSelect}
        onRequestAdd={onRequestAdd}
        onRequestNodeMenu={onRequestNodeMenu}
        onRequestInsertMenu={onRequestInsertMenu}
        onCommitInlineEdit={onCommitInlineEdit}
        onDropNode={onDropNode}
        createBridge={bridge.createBridge}
        location={bridge.location}
      />,
    );
    expect(asAny(bridge.posts.at(-1)!.message).type).toBe("render");
    expect(asAny(bridge.posts.at(-1)!.message).document.name).toBe("second");

    // Same document reference, new session object → updateSession (mode msg).
    rerender(
      <ComposerCanvasHost
        componentProvider={fixtureComponentProvider}
        document={doc2}
        session={{ mode: "preview", theme: "light", selectedId: null }}
        viewport="fluid"
        onSelect={onSelect}
        onRequestAdd={onRequestAdd}
        onRequestNodeMenu={onRequestNodeMenu}
        onRequestInsertMenu={onRequestInsertMenu}
        onCommitInlineEdit={onCommitInlineEdit}
        onDropNode={onDropNode}
        createBridge={bridge.createBridge}
        location={bridge.location}
      />,
    );
    expect(asAny(bridge.posts.at(-1)!.message).type).toBe("mode");
    expect(asAny(bridge.posts.at(-1)!.message).session.mode).toBe("preview");
    expect(doc).toBeDefined();
  });

  it("routes an inbound canvas selection to onSelect", () => {
    const { bridge, onSelect } = mount();
    act(() => bridge.deliver(readyMessage()));
    act(() => bridge.deliver(selectMessage(3, "node-x")));
    expect(onSelect).toHaveBeenCalledWith("node-x");
  });

  it("routes the explicit linked-source affordance without reusing local selection", () => {
    const onOpenSource = vi.fn();
    const { bridge, onSelect } = mount({ onOpenSource });
    act(() => bridge.deliver(readyMessage()));
    act(() => bridge.deliver(openSourceMessage("source-record")));
    expect(onOpenSource).toHaveBeenCalledWith("source-record");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("on request-add focuses the iframe (focus-return seam) and forwards the target", () => {
    const { bridge, onRequestAdd, container } = mount();
    act(() => bridge.deliver(readyMessage()));
    const target = { parentId: null, slotId: "root", index: 0 };
    act(() => bridge.deliver(requestAddMessage(4, target)));
    expect(onRequestAdd).toHaveBeenCalledWith(target);
    expect(document.activeElement).toBe(container.querySelector("iframe"));
  });

  it("surfaces a recoverable renderer error as a dismissible banner", () => {
    const { bridge } = mount();
    act(() => bridge.deliver(readyMessage()));
    act(() => bridge.deliver(errorMessage(5, "node threw", true)));
    expect(screen.getByText(/Preview error: node threw/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Preview error/)).not.toBeInTheDocument();
  });

  it("sizes the frame to the chosen viewport width (preview width only)", () => {
    const {
      bridge,
      container,
      rerender,
      onSelect,
      onRequestAdd,
      onRequestNodeMenu,
      onRequestInsertMenu,
      onCommitInlineEdit,
      onDropNode,
      doc,
    } = mount();
    const frame = () => container.querySelector(".sg-composer-canvas-frame") as HTMLElement;
    // fluid → no fixed width
    expect(frame().style.width).toBe("");
    rerender(
      <ComposerCanvasHost
        componentProvider={fixtureComponentProvider}
        document={doc}
        session={EDIT}
        viewport="tablet"
        onSelect={onSelect}
        onRequestAdd={onRequestAdd}
        onRequestNodeMenu={onRequestNodeMenu}
        onRequestInsertMenu={onRequestInsertMenu}
        onCommitInlineEdit={onCommitInlineEdit}
        onDropNode={onDropNode}
        createBridge={bridge.createBridge}
        location={bridge.location}
      />,
    );
    expect(frame().style.width).toBe("768px");
    expect(frame().style.maxWidth).toBe("100%");
  });

  it("ignores an error the renderer marked non-recoverable (no false banner)", () => {
    const { bridge } = mount();
    act(() => bridge.deliver(readyMessage()));
    act(() => bridge.deliver(errorMessage(6, "fatal", false)));
    expect(screen.queryByText(/Preview error/)).not.toBeInTheDocument();
  });
});

describe("ComposerCanvasHost — inline-edit revision validation (issue #257)", () => {
  /** Advance to a NEWER document so an old commit becomes stale, and return the current revision. */
  function advanceDocument(bridge: ReturnType<typeof makeTestBridge>, base: ReturnType<typeof mount>) {
    const doc2 = createFixtureSampleDocument();
    doc2.name = "second";
    base.rerender(
      <ComposerCanvasHost
        componentProvider={fixtureComponentProvider}
        document={doc2}
        session={EDIT}
        viewport="fluid"
        onSelect={base.onSelect}
        onRequestAdd={base.onRequestAdd}
        onRequestNodeMenu={base.onRequestNodeMenu}
        onRequestInsertMenu={base.onRequestInsertMenu}
        onCommitInlineEdit={base.onCommitInlineEdit}
        onDropNode={base.onDropNode}
        createBridge={bridge.createBridge}
        location={bridge.location}
      />,
    );
    return asAny(bridge.posts.at(-1)!.message).revision as number;
  }

  it("routes a FRESH commit (current revision) straight through to onCommitInlineEdit", () => {
    const base = mount();
    const { bridge, onCommitInlineEdit } = base;
    act(() => bridge.deliver(readyMessage()));
    const currentRev = advanceDocument(bridge, base);

    act(() => bridge.deliver(commitInlineEditMessage("box-1", "children", "Fresh copy", currentRev)));

    expect(onCommitInlineEdit).toHaveBeenCalledWith("box-1", "children", "Fresh copy");
  });

  it("DROPS a stale commit (older revision) with an honest status, never calling updateProps", () => {
    const base = mount();
    const { bridge, onCommitInlineEdit } = base;
    act(() => bridge.deliver(readyMessage()));
    const currentRev = advanceDocument(bridge, base);

    act(() => bridge.deliver(commitInlineEditMessage("box-1", "children", "Stale copy", currentRev - 1)));

    expect(onCommitInlineEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/not applied/i)).toBeInTheDocument();
  });

  it("clears the stale notice once a fresh commit lands", () => {
    const base = mount();
    const { bridge, onCommitInlineEdit } = base;
    act(() => bridge.deliver(readyMessage()));
    const currentRev = advanceDocument(bridge, base);

    act(() => bridge.deliver(commitInlineEditMessage("box-1", "children", "Stale", currentRev - 1)));
    expect(screen.getByText(/not applied/i)).toBeInTheDocument();

    act(() => bridge.deliver(commitInlineEditMessage("box-1", "children", "Fresh", currentRev)));
    expect(onCommitInlineEdit).toHaveBeenCalledWith("box-1", "children", "Fresh");
    expect(screen.queryByText(/not applied/i)).not.toBeInTheDocument();
  });
});

describe("ComposerCanvasHost — menu relay (issue #256)", () => {
  it("translates a request-node-menu rect by the iframe's own offset before forwarding it", () => {
    const { bridge, onRequestNodeMenu, container } = mount();
    act(() => bridge.deliver(readyMessage()));
    const iframe = container.querySelector("iframe")!;
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
      x: 200,
      y: 50,
      width: 600,
      height: 400,
      top: 50,
      left: 200,
      right: 800,
      bottom: 450,
      toJSON: () => ({}),
    });

    act(() => bridge.deliver(requestNodeMenuMessage(4, "box-1", RECT, "node-menu:box-1")));

    expect(onRequestNodeMenu).toHaveBeenCalledTimes(1);
    const [nodeId, translated, restoreFocus] = onRequestNodeMenu.mock.calls[0]!;
    expect(nodeId).toBe("box-1");
    expect(translated).toEqual({ x: RECT.x + 200, y: RECT.y + 50, width: RECT.width, height: RECT.height });
    expect(typeof restoreFocus).toBe("function");
  });

  it("invoking the returned restoreFocus posts restore-focus with the SAME focusToken", () => {
    const { bridge, onRequestNodeMenu } = mount();
    act(() => bridge.deliver(readyMessage()));
    act(() => bridge.deliver(requestNodeMenuMessage(4, "box-1", RECT, "node-menu:box-1")));
    bridge.posts.length = 0;

    const [, , restoreFocus] = onRequestNodeMenu.mock.calls[0]!;
    act(() => restoreFocus());

    expect(bridge.posts).toHaveLength(1);
    expect(asAny(bridge.posts[0]!.message)).toMatchObject({
      type: "restore-focus",
      focusToken: "node-menu:box-1",
    });
  });

  it("translates a request-insert-menu rect and forwards the exact InsertionTarget", () => {
    const { bridge, onRequestInsertMenu, container } = mount();
    act(() => bridge.deliver(readyMessage()));
    const iframe = container.querySelector("iframe")!;
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 5,
      width: 600,
      height: 400,
      top: 5,
      left: 10,
      right: 610,
      bottom: 405,
      toJSON: () => ({}),
    });
    const target = { parentId: "stack-1", slotId: "content", index: 1 };

    act(() => bridge.deliver(requestInsertMenuMessage(4, target, RECT, "insert-menu:x")));

    expect(onRequestInsertMenu).toHaveBeenCalledTimes(1);
    const [forwardedTarget, translated, restoreFocus, addComponent] = onRequestInsertMenu.mock.calls[0]!;
    expect(forwardedTarget).toEqual(target);
    expect(translated).toEqual({ x: RECT.x + 10, y: RECT.y + 5, width: RECT.width, height: RECT.height });
    expect(typeof restoreFocus).toBe("function");
    expect(typeof addComponent).toBe("function");
  });

  it("the insert-menu's addComponent thunk focuses the iframe THEN forwards onRequestAdd — same sequence as a direct request-add", () => {
    const { bridge, onRequestAdd, onRequestInsertMenu, container } = mount();
    act(() => bridge.deliver(readyMessage()));
    const target = { parentId: null, slotId: "root", index: 0 };
    act(() => bridge.deliver(requestInsertMenuMessage(4, target, RECT, "insert-menu:root:0")));

    const [, , , addComponent] = onRequestInsertMenu.mock.calls[0]!;
    act(() => addComponent());

    expect(onRequestAdd).toHaveBeenCalledWith(target);
    expect(document.activeElement).toBe(container.querySelector("iframe"));
  });

  it("falls back to an untranslated rect when the iframe has not measured yet", () => {
    const { bridge, onRequestNodeMenu } = mount();
    act(() => bridge.deliver(readyMessage()));
    act(() => bridge.deliver(requestNodeMenuMessage(4, "box-1", RECT, "node-menu:box-1")));
    // happy-dom's default getBoundingClientRect() is all zeros — the
    // translation is a no-op, not a thrown error.
    const [, translated] = onRequestNodeMenu.mock.calls[0]!;
    expect(translated.x).toBe(RECT.x);
    expect(translated.y).toBe(RECT.y);
  });
});

describe("ComposerCanvasHost — drop-node revision validation (issue #258)", () => {
  const TARGET = { parentId: null, slotId: "root", index: 0 };

  /** Advance to a NEWER document so an old drop becomes stale; return the current revision. */
  function advanceDocument(bridge: ReturnType<typeof makeTestBridge>, base: ReturnType<typeof mount>) {
    const doc2 = createFixtureSampleDocument();
    doc2.name = "second";
    base.rerender(
      <ComposerCanvasHost
        componentProvider={fixtureComponentProvider}
        document={doc2}
        session={EDIT}
        viewport="fluid"
        onSelect={base.onSelect}
        onRequestAdd={base.onRequestAdd}
        onRequestNodeMenu={base.onRequestNodeMenu}
        onRequestInsertMenu={base.onRequestInsertMenu}
        onCommitInlineEdit={base.onCommitInlineEdit}
        onDropNode={base.onDropNode}
        createBridge={bridge.createBridge}
        location={bridge.location}
      />,
    );
    return asAny(bridge.posts.at(-1)!.message).revision as number;
  }

  it("routes a FRESH drop (current revision) straight through to onDropNode", () => {
    const base = mount();
    const { bridge, onDropNode } = base;
    act(() => bridge.deliver(readyMessage()));
    const currentRev = advanceDocument(bridge, base);

    act(() => bridge.deliver(dropNodeMessage("box-1", TARGET, false, currentRev)));

    expect(onDropNode).toHaveBeenCalledWith("box-1", TARGET, false);
  });

  it("forwards the copy flag (Alt held at drop)", () => {
    const base = mount();
    const { bridge, onDropNode } = base;
    act(() => bridge.deliver(readyMessage()));
    const currentRev = advanceDocument(bridge, base);

    act(() => bridge.deliver(dropNodeMessage("box-1", TARGET, true, currentRev)));

    expect(onDropNode).toHaveBeenCalledWith("box-1", TARGET, true);
  });

  it("DROPS a stale drop (older revision) with an honest status, never calling onDropNode", () => {
    const base = mount();
    const { bridge, onDropNode } = base;
    act(() => bridge.deliver(readyMessage()));
    const currentRev = advanceDocument(bridge, base);

    act(() => bridge.deliver(dropNodeMessage("box-1", TARGET, false, currentRev - 1)));

    expect(onDropNode).not.toHaveBeenCalled();
    expect(screen.getByText(/not applied/i)).toBeInTheDocument();
  });

  it("clears the stale notice once a fresh drop lands", () => {
    const base = mount();
    const { bridge, onDropNode } = base;
    act(() => bridge.deliver(readyMessage()));
    const currentRev = advanceDocument(bridge, base);

    act(() => bridge.deliver(dropNodeMessage("box-1", TARGET, false, currentRev - 1)));
    expect(screen.getByText(/not applied/i)).toBeInTheDocument();

    act(() => bridge.deliver(dropNodeMessage("box-1", TARGET, false, currentRev)));
    expect(onDropNode).toHaveBeenCalledWith("box-1", TARGET, false);
    expect(screen.queryByText(/not applied/i)).not.toBeInTheDocument();
  });
});
