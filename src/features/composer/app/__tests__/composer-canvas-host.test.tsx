import "../../test-support/cleanup";
// Canvas host + REAL #248 bridge, wired through a recording frame / deliverable
// host (no live iframe). Proves the parent-side lifecycle: retain-until-ready,
// ready replay, document render vs. session-only update, inbound select /
// request-add (+ focus restoration seam) / recoverable error, and viewport
// sizing — issue #251 scope items 2, 3, 5.

import { describe, expect, it, vi } from "vitest";
import { signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle, within } from "../../../../test/render";
import { fixtureComponentProvider, createFixtureSampleDocument } from "../../test-support/fixture-pack";
import {
  commitInlineEditMessage as protocolCommitInlineEditMessage,
  dropNodeMessage as protocolDropNodeMessage,
  errorMessage as protocolErrorMessage,
  openSourceMessage as protocolOpenSourceMessage,
  readyMessage as protocolReadyMessage,
  requestAddMessage as protocolRequestAddMessage,
  requestInsertMenuMessage as protocolRequestInsertMenuMessage,
  requestHistoryMessage as protocolRequestHistoryMessage,
  requestNodeMenuMessage as protocolRequestNodeMenuMessage,
  selectMessage as protocolSelectMessage,
} from "../../preview/protocol";
import type { PreviewSession, SerializedRect } from "../../preview";
import type { CompositionDocument } from "../../../../composer/browser";
import type { ComposerCanvasViewport } from "../../chrome/controller-model";
import { ComposerCanvasHost } from "../composer-canvas-host";
import { makeTestBridge } from "../test-support/preview-harness";
import { h } from "@takazudo/zfb/zudo-react";
import { defineComponentPack, type ComponentManifest } from "@zudo-composer/component-contract";
import { createChromeStore } from "../../../../app/chrome-context";
import { createComposerComponentProvider } from "../../component-provider";
import { ComposerIntegration } from "../composer-integration";
import { controllerOptions } from "../test-support/controller-fixtures";
import { FIXTURE_IDS, fixtureCatalog, fixtureDocument, fixtureNode, resetFixtureIds } from "../../ui/tree/__tests__/fixtures";

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
const requestHistoryMessage = (direction: "undo" | "redo") =>
  protocolRequestHistoryMessage(PREVIEW_PACK, direction);

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
  const onRequestUndo = vi.fn();
  const onRequestRedo = vi.fn();
  const doc = createFixtureSampleDocument();
  doc.name = "first";
  const documentSignal = signal(doc);
  const sessionSignal = signal<PreviewSession>(EDIT);
  const viewportSignal = signal<ComposerCanvasViewport>("fluid");
  const utils = render(
    <ComposerCanvasHost
      componentProvider={fixtureComponentProvider}
      document={documentSignal}
      session={sessionSignal}
      viewport={viewportSignal}
      onSelect={onSelect}
      onRequestAdd={onRequestAdd}
      onRequestNodeMenu={onRequestNodeMenu}
      onRequestInsertMenu={onRequestInsertMenu}
      onCommitInlineEdit={onCommitInlineEdit}
      onDropNode={onDropNode}
      onRequestUndo={onRequestUndo}
      onRequestRedo={onRequestRedo}
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
    onRequestUndo,
    onRequestRedo,
    onCommitInlineEdit,
    doc,
    /** Replaces `rerender`: assign the changed inputs, then let the host settle. */
    async update(next: { document?: CompositionDocument; session?: PreviewSession; viewport?: ComposerCanvasViewport }) {
      if (next.document !== undefined) documentSignal.value = next.document;
      if (next.session !== undefined) sessionSignal.value = next.session;
      if (next.viewport !== undefined) viewportSignal.value = next.viewport;
      await settle();
    },
    ...utils,
  };
}

describe("ComposerCanvasHost — bridge lifecycle (#251)", () => {
  it("holds the initial snapshot until ready, then replays it to the exact origin", async () => {
    const { bridge, doc } = mount();
    expect(bridge.posts).toHaveLength(0);

    bridge.deliver(readyMessage());

    await settle();

    expect(bridge.posts).toHaveLength(1);
    expect(asAny(bridge.posts[0].message).type).toBe("render");
    expect(asAny(bridge.posts[0].message).document.name).toBe("first");
    expect(asAny(bridge.posts[0].message).localRecordId).toBe(doc.id);
    expect(bridge.posts[0].targetOrigin).toBe(bridge.location.targetOrigin);
  });

  it("a document change re-renders; a session-only change is a lighter update", async () => {
    const { bridge, doc, update } = mount();
    bridge.deliver(readyMessage());
    await settle();
    bridge.posts.length = 0;

    const doc2 = createFixtureSampleDocument();
    doc2.name = "second";
    await update({ document: doc2, session: EDIT, viewport: "fluid" });
    expect(asAny(bridge.posts.at(-1)!.message).type).toBe("render");
    expect(asAny(bridge.posts.at(-1)!.message).document.name).toBe("second");

    // Same document reference, new session object → updateSession (mode msg).
    await update({ document: doc2, session: { mode: "preview", theme: "light", selectedId: null }, viewport: "fluid" });
    expect(asAny(bridge.posts.at(-1)!.message).type).toBe("mode");
    expect(asAny(bridge.posts.at(-1)!.message).session.mode).toBe("preview");
    expect(doc).toBeDefined();
  });

  it("routes an inbound canvas selection to onSelect", async () => {
    const { bridge, onSelect } = mount();
    bridge.deliver(readyMessage());
    await settle();
    bridge.deliver(selectMessage(3, "node-x"));
    await settle();
    expect(onSelect).toHaveBeenCalledWith("node-x");
  });

  it("routes the explicit linked-source affordance without reusing local selection", async () => {
    const onOpenSource = vi.fn();
    const { bridge, onSelect } = mount({ onOpenSource });
    bridge.deliver(readyMessage());
    await settle();
    bridge.deliver(openSourceMessage("source-record"));
    await settle();
    expect(onOpenSource).toHaveBeenCalledWith("source-record");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("on request-add focuses the iframe (focus-return seam) and forwards the target", async () => {
    const { bridge, onRequestAdd, container } = mount();
    bridge.deliver(readyMessage());
    await settle();
    const target = { parentId: null, slotId: "root", index: 0 };
    bridge.deliver(requestAddMessage(4, target));
    await settle();
    expect(onRequestAdd).toHaveBeenCalledWith(target);
    expect(document.activeElement).toBe(container.querySelector("iframe"));
  });

  it("surfaces a recoverable renderer error as a dismissible banner", async () => {
    const { bridge } = mount();
    bridge.deliver(readyMessage());
    await settle();
    bridge.deliver(errorMessage(5, "node threw", true));
    await settle();
    expect(screen.getByText(/Preview error: node threw/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await settle();
    expect(screen.queryByText(/Preview error/)).not.toBeInTheDocument();
  });

  it("sizes the frame to the chosen viewport width (preview width only)", async () => {
    const { container, update, doc } = mount();
    const frame = () => container.querySelector(".sg-composer-canvas-frame") as HTMLElement;
    // fluid → no fixed width
    expect(frame().style.width).toBe("");
    await update({ document: doc, session: EDIT, viewport: "tablet" });
    expect(frame().style.width).toBe("768px");
    expect(frame().style.maxWidth).toBe("100%");
  });

  it("ignores an error the renderer marked non-recoverable (no false banner)", async () => {
    const { bridge } = mount();
    bridge.deliver(readyMessage());
    await settle();
    bridge.deliver(errorMessage(6, "fatal", false));
    await settle();
    expect(screen.queryByText(/Preview error/)).not.toBeInTheDocument();
  });
});

describe("ComposerCanvasHost — iframe history shortcut relay (issue #73)", () => {
  it("forwards validated undo and redo requests in edit mode", async () => {
    const { bridge, onRequestUndo, onRequestRedo } = mount();
    bridge.deliver(readyMessage());
    await settle();

    bridge.deliver(requestHistoryMessage("undo"));
    await settle();
    bridge.deliver(requestHistoryMessage("redo"));
    await settle();

    expect(onRequestUndo).toHaveBeenCalledOnce();
    expect(onRequestRedo).toHaveBeenCalledOnce();
  });

  it("suppresses a valid request after the host changes to preview mode", async () => {
    const base = mount();
    base.bridge.deliver(readyMessage());
    await settle();
    await base.update({ document: base.doc, session: { ...EDIT, mode: "preview" }, viewport: "fluid" });

    base.bridge.deliver(requestHistoryMessage("undo"));

    await settle();
    base.bridge.deliver(requestHistoryMessage("redo"));
    await settle();

    expect(base.onRequestUndo).not.toHaveBeenCalled();
    expect(base.onRequestRedo).not.toHaveBeenCalled();
  });
});

describe("ComposerCanvasHost — inline-edit revision validation (issue #257)", () => {
  /** Advance to a NEWER document so an old commit becomes stale, and return the current revision. */
  async function advanceDocument(bridge: ReturnType<typeof makeTestBridge>, base: ReturnType<typeof mount>) {
    const doc2 = createFixtureSampleDocument();
    doc2.name = "second";
    await base.update({ document: doc2, session: EDIT, viewport: "fluid" });
    return asAny(bridge.posts.at(-1)!.message).revision as number;
  }

  it("routes a FRESH commit (current revision) straight through to onCommitInlineEdit", async () => {
    const base = mount();
    const { bridge, onCommitInlineEdit } = base;
    bridge.deliver(readyMessage());
    await settle();
    const currentRev = await await advanceDocument(bridge, base);

    bridge.deliver(commitInlineEditMessage("box-1", "children", "Fresh copy", currentRev));

    await settle();

    expect(onCommitInlineEdit).toHaveBeenCalledWith("box-1", "children", "Fresh copy");
  });

  it("DROPS a stale commit (older revision) with an honest status, never calling updateProps", async () => {
    const base = mount();
    const { bridge, onCommitInlineEdit } = base;
    bridge.deliver(readyMessage());
    await settle();
    const currentRev = await await advanceDocument(bridge, base);

    bridge.deliver(commitInlineEditMessage("box-1", "children", "Stale copy", currentRev - 1));

    await settle();

    expect(onCommitInlineEdit).not.toHaveBeenCalled();
    expect(screen.getByText(/not applied/i)).toBeInTheDocument();
  });

  it("clears the stale notice once a fresh commit lands", async () => {
    const base = mount();
    const { bridge, onCommitInlineEdit } = base;
    bridge.deliver(readyMessage());
    await settle();
    const currentRev = await await advanceDocument(bridge, base);

    bridge.deliver(commitInlineEditMessage("box-1", "children", "Stale", currentRev - 1));

    await settle();
    expect(screen.getByText(/not applied/i)).toBeInTheDocument();

    bridge.deliver(commitInlineEditMessage("box-1", "children", "Fresh", currentRev));

    await settle();
    expect(onCommitInlineEdit).toHaveBeenCalledWith("box-1", "children", "Fresh");
    expect(screen.queryByText(/not applied/i)).not.toBeInTheDocument();
  });
});

describe("ComposerCanvasHost — menu relay (issue #256)", () => {
  it("translates a request-node-menu rect by the iframe's own offset before forwarding it", async () => {
    const { bridge, onRequestNodeMenu, container } = mount();
    bridge.deliver(readyMessage());
    await settle();
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

    bridge.deliver(requestNodeMenuMessage(4, "box-1", RECT, "node-menu:box-1"));

    await settle();

    expect(onRequestNodeMenu).toHaveBeenCalledTimes(1);
    const [nodeId, translated, restoreFocus] = onRequestNodeMenu.mock.calls[0]!;
    expect(nodeId).toBe("box-1");
    expect(translated).toEqual({ x: RECT.x + 200, y: RECT.y + 50, width: RECT.width, height: RECT.height });
    expect(typeof restoreFocus).toBe("function");
  });

  it("invoking the returned restoreFocus posts restore-focus with the SAME focusToken", async () => {
    const { bridge, onRequestNodeMenu } = mount();
    bridge.deliver(readyMessage());
    await settle();
    bridge.deliver(requestNodeMenuMessage(4, "box-1", RECT, "node-menu:box-1"));
    await settle();
    bridge.posts.length = 0;

    const [, , restoreFocus] = onRequestNodeMenu.mock.calls[0]!;
    restoreFocus();
    await settle();

    expect(bridge.posts).toHaveLength(1);
    expect(asAny(bridge.posts[0]!.message)).toMatchObject({
      type: "restore-focus",
      focusToken: "node-menu:box-1",
    });
  });

  it("translates a request-insert-menu rect and forwards the exact InsertionTarget", async () => {
    const { bridge, onRequestInsertMenu, container } = mount();
    bridge.deliver(readyMessage());
    await settle();
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

    bridge.deliver(requestInsertMenuMessage(4, target, RECT, "insert-menu:x"));

    await settle();

    expect(onRequestInsertMenu).toHaveBeenCalledTimes(1);
    const [forwardedTarget, translated, restoreFocus, addComponent] = onRequestInsertMenu.mock.calls[0]!;
    expect(forwardedTarget).toEqual(target);
    expect(translated).toEqual({ x: RECT.x + 10, y: RECT.y + 5, width: RECT.width, height: RECT.height });
    expect(typeof restoreFocus).toBe("function");
    expect(typeof addComponent).toBe("function");
  });

  it("the insert-menu's addComponent thunk focuses the iframe THEN forwards onRequestAdd — same sequence as a direct request-add", async () => {
    const { bridge, onRequestAdd, onRequestInsertMenu, container } = mount();
    bridge.deliver(readyMessage());
    await settle();
    const target = { parentId: null, slotId: "root", index: 0 };
    bridge.deliver(requestInsertMenuMessage(4, target, RECT, "insert-menu:root:0"));
    await settle();

    const [, , , addComponent] = onRequestInsertMenu.mock.calls[0]!;
    addComponent();
    await settle();

    expect(onRequestAdd).toHaveBeenCalledWith(target);
    expect(document.activeElement).toBe(container.querySelector("iframe"));
  });

  it("falls back to an untranslated rect when the iframe has not measured yet", async () => {
    const { bridge, onRequestNodeMenu } = mount();
    bridge.deliver(readyMessage());
    await settle();
    bridge.deliver(requestNodeMenuMessage(4, "box-1", RECT, "node-menu:box-1"));
    await settle();
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
  async function advanceDocument(bridge: ReturnType<typeof makeTestBridge>, base: ReturnType<typeof mount>) {
    const doc2 = createFixtureSampleDocument();
    doc2.name = "second";
    await base.update({ document: doc2, session: EDIT, viewport: "fluid" });
    return asAny(bridge.posts.at(-1)!.message).revision as number;
  }

  it("routes a FRESH drop (current revision) straight through to onDropNode", async () => {
    const base = mount();
    const { bridge, onDropNode } = base;
    bridge.deliver(readyMessage());
    await settle();
    const currentRev = await await advanceDocument(bridge, base);

    bridge.deliver(dropNodeMessage("box-1", TARGET, false, currentRev));

    await settle();

    expect(onDropNode).toHaveBeenCalledWith("box-1", TARGET, false);
  });

  it("forwards the copy flag (Alt held at drop)", async () => {
    const base = mount();
    const { bridge, onDropNode } = base;
    bridge.deliver(readyMessage());
    await settle();
    const currentRev = await await advanceDocument(bridge, base);

    bridge.deliver(dropNodeMessage("box-1", TARGET, true, currentRev));

    await settle();

    expect(onDropNode).toHaveBeenCalledWith("box-1", TARGET, true);
  });

  it("DROPS a stale drop (older revision) with an honest status, never calling onDropNode", async () => {
    const base = mount();
    const { bridge, onDropNode } = base;
    bridge.deliver(readyMessage());
    await settle();
    const currentRev = await await advanceDocument(bridge, base);

    bridge.deliver(dropNodeMessage("box-1", TARGET, false, currentRev - 1));

    await settle();

    expect(onDropNode).not.toHaveBeenCalled();
    expect(screen.getByText(/not applied/i)).toBeInTheDocument();
  });

  it("clears the stale notice once a fresh drop lands", async () => {
    const base = mount();
    const { bridge, onDropNode } = base;
    bridge.deliver(readyMessage());
    await settle();
    const currentRev = await await advanceDocument(bridge, base);

    bridge.deliver(dropNodeMessage("box-1", TARGET, false, currentRev - 1));

    await settle();
    expect(screen.getByText(/not applied/i)).toBeInTheDocument();

    bridge.deliver(dropNodeMessage("box-1", TARGET, false, currentRev));

    await settle();
    expect(onDropNode).toHaveBeenCalledWith("box-1", TARGET, false);
    expect(screen.queryByText(/not applied/i)).not.toBeInTheDocument();
  });
});

describe("ComposerCanvasHost — quick insert routing (#639)", () => {
  const TARGET = { parentId: "gallery-1", slotId: "items", index: 0 };
  const addWithRect = (revision: number) => protocolRequestAddMessage(PREVIEW_PACK, revision, TARGET, RECT);

  it("offers a direct Add with its rect to onRequestQuickInsert; a handled request never opens the chooser", async () => {
    const onRequestQuickInsert = vi.fn(() => true);
    const { bridge, onRequestAdd, container } = mount({ onRequestQuickInsert });
    bridge.deliver(readyMessage());
    await settle();

    bridge.deliver(addWithRect(4));
    await settle();

    expect(onRequestAdd).not.toHaveBeenCalled();
    const [request] = onRequestQuickInsert.mock.calls[0]! as unknown as [
      { target: unknown; rect: SerializedRect; restoreFocus: () => void; openChooser: (tab?: string) => void },
    ];
    expect(request.target).toEqual(TARGET);
    expect(request.rect).toEqual(RECT);

    request.restoreFocus();

    await settle();
    expect(document.activeElement).toBe(container.querySelector("iframe"));

    request.openChooser("patterns");

    await settle();
    expect(onRequestAdd).toHaveBeenCalledWith(TARGET, "patterns");
  });

  it("falls through to the chooser when onRequestQuickInsert declines", async () => {
    const onRequestQuickInsert = vi.fn(() => false);
    const { bridge, onRequestAdd, container } = mount({ onRequestQuickInsert });
    bridge.deliver(readyMessage());
    await settle();

    bridge.deliver(addWithRect(4));
    await settle();

    expect(onRequestQuickInsert).toHaveBeenCalledTimes(1);
    expect(onRequestAdd).toHaveBeenCalledWith(TARGET);
    expect(document.activeElement).toBe(container.querySelector("iframe"));
  });

  it("a request-add without a rect has nothing to anchor to and opens the chooser as before", async () => {
    const onRequestQuickInsert = vi.fn(() => true);
    const { bridge, onRequestAdd } = mount({ onRequestQuickInsert });
    bridge.deliver(readyMessage());
    await settle();

    bridge.deliver(requestAddMessage(4, TARGET));
    await settle();

    expect(onRequestQuickInsert).not.toHaveBeenCalled();
    expect(onRequestAdd).toHaveBeenCalledWith(TARGET);
  });

  it("the insert menu's addComponent offers quick insert with the menu rect and restores focus through its focusToken", async () => {
    const onRequestQuickInsert = vi.fn(() => true);
    const { bridge, onRequestAdd, onRequestInsertMenu } = mount({ onRequestQuickInsert });
    bridge.deliver(readyMessage());
    await settle();
    bridge.deliver(requestInsertMenuMessage(4, TARGET, RECT, "insert-menu:gallery-1:items:0"));
    await settle();
    const [, , , addComponent] = onRequestInsertMenu.mock.calls[0]!;

    addComponent();

    await settle();

    expect(onRequestAdd).not.toHaveBeenCalled();
    const [request] = onRequestQuickInsert.mock.calls[0]! as unknown as [{ rect: SerializedRect; restoreFocus: () => void }];
    expect(request.rect).toEqual(RECT);
    bridge.posts.length = 0;
    request.restoreFocus();
    await settle();
    expect(asAny(bridge.posts.at(-1)!.message)).toMatchObject({
      type: "restore-focus",
      focusToken: "insert-menu:gallery-1:items:0",
    });
  });
});

describe("ComposerIntegration — quick insert routing by slot rule (#639)", () => {
  const REGION_ID = "test.region";
  const regionDefinition: ComponentManifest = {
    id: REGION_ID,
    schemaVersion: 1,
    title: "Region",
    category: "Layout",
    description: "A rule container with a narrow and a wide restricted slot.",
    source: { module: "@fixtures/region", exportKind: "named", exportName: "Region" },
    defaults: {},
    fields: [],
    slots: [
      { id: "few", prop: "few", label: "Few", cardinality: "many", accepts: [FIXTURE_IDS.box, FIXTURE_IDS.text], max: 2 },
      {
        id: "wide",
        prop: "children",
        label: "Wide",
        cardinality: "many",
        accepts: [...fixtureCatalog.map((entry) => entry.id), REGION_ID],
      },
    ],
  };
  const pack = defineComponentPack({
    packId: "@zudo-composer/quick-insert-fixtures",
    packVersion: "1.0.0",
    components: [...fixtureCatalog, regionDefinition].map((entry) => ({
      ...entry,
      component: (props: Record<string, unknown>) => h("div", props),
    })),
  });
  const provider = createComposerComponentProvider(pack);

  async function setup(fewChildren = 0) {
    resetFixtureIds();
    const few = Array.from({ length: fewChildren }, () => fixtureNode(FIXTURE_IDS.box));
    const sample = fixtureDocument([fixtureNode(REGION_ID, {}, { few, wide: [] }, "region")]);
    const bridge = makeTestBridge();
    const utils = render(
      <ComposerIntegration
          appChrome={createChromeStore()}
          componentProvider={provider}
          controllerOptions={controllerOptions(sample)}
          createBridge={bridge.createBridge}
          previewLocation={bridge.location}
        />,
    );
    bridge.deliver(protocolReadyMessage(pack.manifest));
    await settle();
    let revision = 100;
    const add = async (target: { parentId: string | null; slotId: string; index: number }) => {
      bridge.deliver(protocolRequestAddMessage(pack.manifest, revision++, target, RECT));
      await settle();
    };
    const menu = () => document.querySelector(".cms-menu") as HTMLElement | null;
    const chooser = () => utils.container.querySelector("dialog.sg-composer-chooser[open]") as HTMLElement | null;
    const renders = () => bridge.posts.filter((post) => asAny(post.message).type === "render");
    const canvasDoc = () => asAny(renders().at(-1)!.message).document;
    return { ...utils, bridge, add, menu, chooser, canvasDoc };
  }

  it("a restricted slot with at most six kinds opens the quick-insert popover, not the chooser", async () => {
    const s = await setup();
    await s.add({ parentId: "region", slotId: "few", index: 0 });

    expect(s.chooser()).toBeNull();
    const menu = s.menu()!;
    expect(menu).toHaveAccessibleName("Few accepts");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Box",
      "Text",
      "Pattern…",
      "More… (search, 5 hidden)",
    ]);
    expect(menu).toHaveTextContent("rule: Region › Few");
  });

  it("a chip inserts at the target, selects the new node and restores iframe focus", async () => {
    const s = await setup();
    await s.add({ parentId: "region", slotId: "few", index: 0 });

    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Text" }));

    await settle();

    expect(s.menu()).toBeNull();
    const inserted = s.canvasDoc().root[0].slots.few[0];
    expect(inserted.componentId).toBe(FIXTURE_IDS.text);
    expect(asAny(s.bridge.posts.at(-1)!.message).session.selectedId).toBe(inserted.id);
    expect(document.activeElement).toBe(s.container.querySelector("iframe"));
  });

  it("Pattern… opens the chooser on its Patterns tab and More… on Components, both for the same target", async () => {
    const s = await setup();
    await s.add({ parentId: "region", slotId: "few", index: 0 });
    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Pattern…" }));
    await settle();

    expect(s.menu()).toBeNull();
    expect(within(s.chooser()!).getByRole("button", { name: "Patterns" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(s.chooser()!).getByRole("button", { name: "Cancel" }));
    await settle();

    await s.add({ parentId: "region", slotId: "few", index: 0 });
    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: /^More…/ }));
    await settle();
    expect(within(s.chooser()!).getByRole("button", { name: "Components" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(s.chooser()!).getByRole("button", { name: "Text" }));
    await settle();
    expect(s.canvasDoc().root[0].slots.few[0].componentId).toBe(FIXTURE_IDS.text);
  });

  it("the insert menu's Add component… hands off to the popover; Escape closes it and restores focus through the focusToken", async () => {
    const s = await setup();
    const target = { parentId: "region", slotId: "few", index: 0 };
    s.bridge.deliver(protocolRequestInsertMenuMessage(pack.manifest, 200, target, RECT, "insert-menu:region:few:0"));
    await settle();
    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Add component…" }));
    await settle();

    const menu = s.menu()!;
    expect(menu).toHaveAccessibleName("Few accepts");
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Box" }));
    s.bridge.posts.length = 0;

    fireEvent.keyDown(menu, { key: "Escape" });

    await settle();

    expect(s.menu()).toBeNull();
    expect(s.chooser()).toBeNull();
    const restores = s.bridge.posts.filter((post) => asAny(post.message).type === "restore-focus");
    expect(restores.map((post) => asAny(post.message).focusToken)).toEqual(["insert-menu:region:few:0"]);
  });

  it("a restricted slot with more than six kinds opens the chooser", async () => {
    const s = await setup();
    await s.add({ parentId: "region", slotId: "wide", index: 0 });
    expect(s.menu()).toBeNull();
    expect(s.chooser()).not.toBeNull();
  });

  it("an open document root opens the chooser", async () => {
    const s = await setup();
    await s.add({ parentId: null, slotId: "root", index: 1 });
    expect(s.menu()).toBeNull();
    expect(s.chooser()).not.toBeNull();
  });

  it("a full restricted slot opens the chooser's blocked state as before", async () => {
    const s = await setup(2);
    await s.add({ parentId: "region", slotId: "few", index: 2 });
    expect(s.menu()).toBeNull();
    expect(s.chooser()).toHaveTextContent("This slot is full");
  });
});
