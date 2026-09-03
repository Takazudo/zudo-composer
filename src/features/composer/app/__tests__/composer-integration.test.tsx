/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
// Central integration tests (issue #251): every surface driven by ONE
// controller, one document snapshot. The canvas iframe is stood in for by the
// REAL #248 bridge over a recording frame (makeTestBridge), so canvas-originated
// events (select / request-add) and outbound snapshots are exercised for real.
// The tree/chooser/inspector/toolbar are the genuine components.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import type {
  CompositionDocument,
  CompositionRecord,
  ComposerReuseResolutionOptions,
  GlobalTemplateResolutionOutcome,
  InsertionTarget,
  ReuseCatalogOutcome,
  ReuseSelectionOutcome,
} from "../../../../composer/browser";
import { COMPOSITION_SCHEMA_VERSION, VIRTUAL_ROOT_SLOT_ID } from "../../../../composer/browser";
import {
  commitInlineEditMessage as protocolCommitInlineEditMessage,
  dropNodeMessage as protocolDropNodeMessage,
  readyMessage as protocolReadyMessage,
  requestAddMessage as protocolRequestAddMessage,
  requestInsertMenuMessage as protocolRequestInsertMenuMessage,
  requestHistoryMessage as protocolRequestHistoryMessage,
  requestNodeMenuMessage as protocolRequestNodeMenuMessage,
  selectMessage as protocolSelectMessage,
} from "../../preview/protocol";
import { INSPECTOR_COMMIT_DEBOUNCE_MS } from "../../chrome/use-composer-controller";
import { ChromeContext, createChromeStore } from "../../../../app/chrome-context";
import { ComposerIntegration } from "../composer-integration";
import { makeTestBridge } from "../test-support/preview-harness";
import { LS_COMPOSER_VIEWPORT } from "../viewport";
import {
  fixtureComponentProvider,
  fixtureDocument,
  fixtureNode,
  FIXTURE_IDS,
  makeAbcDocument,
  resetFixtureIds,
} from "../../ui/tree/__tests__/fixtures";
import { controllerOptions } from "../test-support/controller-fixtures";

function emptyDoc(): CompositionDocument {
  return { schemaVersion: COMPOSITION_SCHEMA_VERSION, id: "it-doc", name: "Integration Doc", root: [] };
}

const ROOT: InsertionTarget = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 };
const RECT = { x: 10, y: 20, width: 80, height: 24 };
const PREVIEW_PACK = fixtureComponentProvider.manifest;

const readyMessage = () => protocolReadyMessage(PREVIEW_PACK);
const requestAddMessage = (revision: number, target: InsertionTarget) =>
  protocolRequestAddMessage(PREVIEW_PACK, revision, target);
const requestHistoryMessage = (direction: "undo" | "redo") =>
  protocolRequestHistoryMessage(PREVIEW_PACK, direction);
const selectMessage = (revision: number, nodeId: string) => protocolSelectMessage(PREVIEW_PACK, revision, nodeId);
const commitInlineEditMessage = (nodeId: string, fieldKey: string, value: string, revision: number) =>
  protocolCommitInlineEditMessage(PREVIEW_PACK, nodeId, fieldKey, value, revision);
const requestNodeMenuMessage = (
  revision: number,
  nodeId: string,
  rect: typeof RECT,
  token: string,
) => protocolRequestNodeMenuMessage(PREVIEW_PACK, revision, nodeId, rect, token);
const requestInsertMenuMessage = (
  revision: number,
  target: InsertionTarget,
  rect: typeof RECT,
  token: string,
) => protocolRequestInsertMenuMessage(PREVIEW_PACK, revision, target, rect, token);
const dropNodeMessage = (sourceId: string, target: InsertionTarget, copy: boolean, revision: number) =>
  protocolDropNodeMessage(PREVIEW_PACK, sourceId, target, copy, revision);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asAny = (v: unknown) => v as any;

let rev = 1000;

function setup(
  seedViewport?: string,
  sample: CompositionDocument = emptyDoc(),
  getPublicationDependencies?: () => Promise<{ status: "ready"; dependentCount: number }>,
  patternCallbacks?: {
    listPatternCatalog?: () => Promise<ReuseCatalogOutcome>;
    loadPattern?: (ref: { providerId: "indexeddb" | "files"; recordId: string }) => Promise<ReuseSelectionOutcome>;
  },
) {
  if (seedViewport) localStorage.setItem(LS_COMPOSER_VIEWPORT, seedViewport);
  const bridge = makeTestBridge();
  // The editor publishes its save state through `useEditorStatus` rather than
  // drawing it, so the spec supplies the chrome store the app shell would.
  const chrome = createChromeStore();
  const utils = render(
    <ChromeContext.Provider value={chrome}>
      <ComposerIntegration
        componentProvider={fixtureComponentProvider}
        controllerOptions={controllerOptions(sample)}
        createBridge={bridge.createBridge}
        previewLocation={bridge.location}
        getPublicationDependencies={getPublicationDependencies}
        {...patternCallbacks}
      />
    </ChromeContext.Provider>,
  );
  act(() => bridge.deliver(readyMessage()));

  const region = (selector: string) => utils.container.querySelector(selector) as HTMLElement;
  const tree = () => region(".cms-editor__region--nav");
  const inspector = () => region(".cms-editor__region--insp");
  const chooser = () => utils.container.querySelector("dialog.sg-composer-chooser") as HTMLElement;
  const toolbar = () => region(".cms-editor__toolbar");
  const frame = () => region(".sg-composer-canvas-frame");
  const iframe = () => utils.container.querySelector("iframe") as HTMLIFrameElement;
  // The shared menu paints in a body-level portal, not inside the editor.
  const menu = () => document.querySelector(".cms-menu") as HTMLElement | null;

  /** Every outline row currently rendered, in visual order. */
  const treeRows = () => within(tree()).getAllByRole("treeitem");
  // An outline row's accessible name is its spans run together — title, hint,
  // slug and count with no separator between them ("BoxB", "Documentfixture(5)").
  // Every row query here anchors on that prefix rather than on a spaced label.
  const treeRow = (name: string) => within(tree()).getByRole("treeitem", { name: new RegExp(`^${name}`) });
  const treeRowsNamed = (name: string) => within(tree()).getAllByRole("treeitem", { name: new RegExp(`^${name}`) });
  const hasTreeRow = (name: string) =>
    within(tree()).queryByRole("treeitem", { name: new RegExp(`^${name}`) }) !== null;

  /** Open the inspector tab named `name`; Properties is what the panel opens on. */
  function inspectorTab(name: "Properties" | "Slots" | "Reuse") {
    fireEvent.click(within(inspector()).getByRole("tab", { name: new RegExp(`^${name}`) }));
  }

  const renders = () => bridge.posts.filter((p) => asAny(p.message).type === "render");
  const canvasDoc = (): CompositionDocument => asAny(renders().at(-1)!.message).document;
  const lastSentSession = () => asAny(bridge.posts.at(-1)!.message).session;

  /** Add via the shared chooser, opened for `target` from the canvas request-add path. */
  function addAt(target: InsertionTarget, cardName: string) {
    act(() => bridge.deliver(requestAddMessage(rev++, target)));
    fireEvent.click(within(chooser()).getByRole("button", { name: cardName }));
  }

  return {
    bridge,
    chrome,
    ...utils,
    tree,
    inspector,
    chooser,
    toolbar,
    frame,
    iframe,
    menu,
    canvasDoc,
    lastSentSession,
    addAt,
    inspectorTab,
    treeRows,
    treeRow,
    treeRowsNamed,
    hasTreeRow,
  };
}

beforeEach(() => localStorage.clear());

describe("ComposerIntegration — cross-surface wiring (#251)", () => {
  it("publishes, reassigns, and reserves a Global template outlet through the shared controller", async () => {
    const dependencies = vi.fn(async () => ({ status: "ready" as const, dependentCount: 2 }));
    const source = fixtureDocument([
      fixtureNode(FIXTURE_IDS.split, {}, { left: [], right: [] }, "split"),
    ]);
    const s = setup(undefined, source, dependencies);

    // The outlet is published from the Reuse tab, for the slot selected in
    // Structure — one selection, read by both panes.
    fireEvent.click(s.treeRow("Left"));
    s.inspectorTab("Reuse");
    fireEvent.click(within(s.inspector()).getByRole("button", { name: "Use Left as outlet" }));
    fireEvent.input(within(s.inspector()).getByLabelText("Outlet label"), { target: { value: "Main content" } });
    fireEvent.click(within(s.inspector()).getByRole("button", { name: "Publish template" }));

    await waitFor(() => {
      expect(s.canvasDoc().publication).toMatchObject({
        kind: "global-template",
        outlet: { label: "Main content", target: { parentId: "split", slotId: "left" } },
      });
    });
    const publication = s.canvasDoc().publication;
    const stableOutletId = publication?.kind === "global-template"
      ? publication.outlet.id
      : "";
    expect(within(s.inspector()).getByText(/Current outlet: Main content/)).toBeInTheDocument();
    // A published outlet is reserved for its consumers, so Structure withdraws
    // the Add affordance from it.
    expect(within(s.tree()).queryByRole("button", { name: "Add component to Left" })).not.toBeInTheDocument();

    fireEvent.click(s.treeRow("Right"));
    s.inspectorTab("Reuse");
    fireEvent.click(within(s.inspector()).getByRole("button", { name: "Reassign outlet to Right" }));
    fireEvent.click(within(s.inspector()).getByRole("button", { name: "Save reassignment" }));
    await waitFor(() => {
      const publication = s.canvasDoc().publication;
      expect(publication).toMatchObject({
        kind: "global-template",
        outlet: { id: stableOutletId, target: { parentId: "split", slotId: "right" } },
      });
    });
    expect(dependencies).toHaveBeenCalledOnce();
    expect(s.inspector().querySelector("[data-sg-reuse-feedback]")).toHaveTextContent(/2 existing consumers keep/i);
  });

  it("does not clear a published Global template until the parent relationship query reports no consumers", async () => {
    const dependencies = vi.fn(async () => ({ status: "ready" as const, dependentCount: 1 }));
    const source = fixtureDocument([
      fixtureNode(FIXTURE_IDS.split, {}, { left: [], right: [] }, "split"),
    ]);
    source.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "split", slotId: "left" } },
    };
    const s = setup(undefined, source, dependencies);

    s.inspectorTab("Reuse");
    fireEvent.click(within(s.inspector()).getByRole("button", { name: "Unpublish Global template" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Unpublish Global template" }),
    );

    await waitFor(() => expect(dependencies).toHaveBeenCalledOnce());
    expect(s.canvasDoc().publication).toMatchObject({ kind: "global-template", outlet: { id: "outlet-main" } });
    await waitFor(() =>
      expect(s.inspector().querySelector("[data-sg-reuse-feedback]")).toHaveTextContent(/Cannot unpublish.*1 consumer/i),
    );
  });

  it("chooser add drives tree, canvas snapshot, inspector, and selection together", () => {
    const s = setup();
    s.addAt(ROOT, "Box");

    const doc = s.canvasDoc();
    expect(doc.root).toHaveLength(1);
    const boxId = doc.root[0]!.id;
    // Canvas snapshot + selection reflect the new node.
    expect(s.lastSentSession().selectedId).toBe(boxId);
    // Tree shows it, inspector selected it.
    expect(boxId).toBeTruthy();
    expect(s.hasTreeRow("Box")).toBe(true);
    expect(within(s.inspector()).getByText("Box")).toBeInTheDocument();
  });

  it("loads an active-provider Pattern on demand and inserts its full forest atomically", async () => {
    const patternDocument = fixtureDocument([
      fixtureNode(FIXTURE_IDS.stack, { gap: "lg" }, {}, "pattern-stack"),
      fixtureNode(FIXTURE_IDS.box, { label: "Pattern box" }, {}, "pattern-box"),
    ], "Feature Pattern");
    patternDocument.id = "feature-pattern";
    patternDocument.publication = { kind: "pattern" };
    const patternRecord: CompositionRecord = {
      id: "feature-pattern",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      document: patternDocument,
    };
    const listPatternCatalog = vi.fn(async (): Promise<ReuseCatalogOutcome> => ({
      status: "listed",
      entries: [
        {
          ref: { providerId: "indexeddb", recordId: patternRecord.id },
          kind: "pattern",
          summary: {
            id: patternRecord.id,
            name: patternDocument.name,
            createdAt: patternRecord.createdAt,
            updatedAt: patternRecord.updatedAt,
            nodeCount: 2,
            rootCount: 2,
            publicationKind: "pattern",
            reuseStatus: "eligible",
          },
        },
      ],
    }));
    const loadPattern = vi.fn(async (): Promise<ReuseSelectionOutcome> => ({
      status: "loaded",
      kind: "pattern",
      record: patternRecord,
    }));
    const s = setup(undefined, emptyDoc(), undefined, { listPatternCatalog, loadPattern });

    act(() => s.bridge.deliver(requestAddMessage(rev++, ROOT)));
    fireEvent.click(within(s.chooser()).getByRole("button", { name: "Patterns" }));

    const patternRow = await within(s.chooser()).findByRole("button", { name: /Feature Pattern/i });
    expect(listPatternCatalog).toHaveBeenCalledOnce();
    fireEvent.click(patternRow);

    await waitFor(() => expect(loadPattern).toHaveBeenCalledWith({ providerId: "indexeddb", recordId: "feature-pattern" }));
    const insert = await within(s.chooser()).findByRole("button", { name: "Insert Pattern" });
    expect((insert as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(insert);

    await waitFor(() => expect(s.canvasDoc().root.map((node) => node.componentId)).toEqual([FIXTURE_IDS.stack, FIXTURE_IDS.box]));
    expect(s.canvasDoc().root.map((node) => node.id)).not.toEqual(["pattern-stack", "pattern-box"]);
    await waitFor(() => expect(s.chooser().hasAttribute("open")).toBe(false));
  });

  it("derives one linked preview snapshot while the tree and inspector retain only local nodes", async () => {
    const sourceDocument = fixtureDocument([
      fixtureNode(FIXTURE_IDS.split, { ratio: "50-50" }, { left: [], right: [] }, "collision"),
    ], "Site shell");
    sourceDocument.id = "site-shell";
    sourceDocument.publication = {
      kind: "global-template",
      outlet: {
        id: "main",
        label: "Main content",
        target: { parentId: "collision", slotId: "right" },
      },
    };
    const consumer = fixtureDocument([
      fixtureNode(FIXTURE_IDS.box, { label: "Local content" }, {}, "collision"),
    ], "Bound page");
    consumer.id = "bound-page";
    consumer.binding = { sourceRecordId: "site-shell", outletId: "main" };
    const source: CompositionRecord = {
      id: "site-shell",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      document: sourceDocument,
    };
    const outcome: GlobalTemplateResolutionOutcome = {
      status: "resolved",
      binding: consumer.binding,
      localRoot: consumer.root,
      source,
      outlet: sourceDocument.publication.outlet,
      rootPolicy: { kind: "resolved", cardinality: "many" },
    };
    const resolver: ComposerReuseResolutionOptions["resolver"] = {
      resolve: vi.fn(async () => outcome),
    };
    const onOpenSource = vi.fn();
    const bridge = makeTestBridge();
    const view = render(
      <ComposerIntegration
        componentProvider={fixtureComponentProvider}
        controllerOptions={controllerOptions(consumer)}
        reuseResolution={{ ref: { providerId: "indexeddb", recordId: "bound-page" }, resolver }}
        linkedActions={{ onOpenSource, onDetach: vi.fn() }}
        createBridge={bridge.createBridge}
        previewLocation={bridge.location}
      />,
    );
    act(() => bridge.deliver(readyMessage()));

    await waitFor(() => {
      const renderMessage = bridge.posts
        .map((post) => post.message as { type?: string; document?: CompositionDocument; linked?: unknown })
        .filter((message) => message.type === "render")
        .at(-1)!;
      expect(renderMessage.document).toMatchObject({ id: "bound-page", root: [{ id: "collision" }] });
      expect(renderMessage.linked).toMatchObject({
        sourceRecordId: "site-shell",
        sourceDocument: { id: "site-shell", root: [{ id: "collision" }] },
        outlet: { id: "main" },
      });
    });
    const tree = view.container.querySelector(".cms-editor__region--nav") as HTMLElement;
    // Structure lists only the consumer's own node, never the source's.
    expect(within(tree).getAllByRole("treeitem", { name: /^Box/ })).toHaveLength(1);
    expect(within(tree).getByText(/Site shell/)).toBeInTheDocument();
    fireEvent.click(within(tree).getByRole("button", { name: "Open source" }));
    expect(onOpenSource).toHaveBeenCalledWith("site-shell");

    const inspector = view.container.querySelector(".cms-editor__region--insp") as HTMLElement;
    fireEvent.click(within(inspector).getByRole("tab", { name: /^Reuse/ }));
    expect(within(inspector).getByRole("button", { name: "Detach" })).toBeInTheDocument();
  });

  it("a canvas selection reveals + expands the node's ancestors in the tree", () => {
    const s = setup();
    s.addAt(ROOT, "Split Layout");
    const splitId = s.canvasDoc().root[0]!.id;
    s.addAt({ parentId: splitId, slotId: "left", index: 0 }, "Box");
    const boxId = s.canvasDoc().root[0]!.slots.left![0]!.id;

    // Collapse the split so the box row is not rendered.
    fireEvent.click(within(s.tree()).getByRole("button", { name: "Collapse Split Layout" }));
    expect(s.hasTreeRow("Box")).toBe(false);

    // A canvas click on the (hidden) box reveals it: selects + re-expands split.
    act(() => s.bridge.deliver(selectMessage(rev++, boxId)));
    expect(s.hasTreeRow("Box")).toBe(true);
    // And the selection is mirrored back to the canvas snapshot.
    expect(s.lastSentSession().selectedId).toBe(boxId);
  });

  it("a cross-frame Add opens the shared chooser for the exact target and restores focus to the iframe", () => {
    const s = setup();
    // Seed one box so we can target an explicit index.
    s.addAt(ROOT, "Box");
    // The canvas requests an add BEFORE the first child (index 0). The host
    // focuses the iframe first, so the chooser captures it as the restore
    // target (the chooser then moves focus to its own search field).
    act(() => s.bridge.deliver(requestAddMessage(rev++, { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 })));
    fireEvent.click(within(s.chooser()).getByRole("button", { name: "Stack" }));

    const doc = s.canvasDoc();
    expect(doc.root.map((n) => n.componentId)).toEqual([FIXTURE_IDS.stack, FIXTURE_IDS.box]);
    // Focus returned to the originating iframe control after the chooser closed.
    expect(document.activeElement).toBe(s.iframe());
  });

  it("a before-first insertion lands at index 0 identically in tree, canvas, and export order", () => {
    const s = setup();
    s.addAt(ROOT, "Stack");
    // Insert before the first child.
    s.addAt({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }, "Split Layout");

    // Canvas snapshot order.
    expect(s.canvasDoc().root.map((n) => n.componentId)).toEqual([FIXTURE_IDS.split, FIXTURE_IDS.stack]);
    // Tree order: the two roots follow the document row, in document order.
    const rowNames = s.treeRows().map((row) => row.textContent ?? "");
    expect(rowNames[0]).toContain("Document");
    const splitRow = rowNames.findIndex((name) => name.includes("Split Layout"));
    const stackRow = rowNames.findIndex((name) => name.includes("Stack"));
    expect(splitRow).toBeGreaterThan(0);
    expect(splitRow).toBeLessThan(stackRow);

    // Export order (same document/manifest source).
    fireEvent.click(within(s.toolbar()).getByRole("button", { name: "Export JSX" }));
    const code = screen.getByRole("dialog", { name: /^Export —/ }).querySelector("pre")!.textContent ?? "";
    expect(code).toContain("SplitLayout");
    expect(code).toContain("Stack");
    expect(code.indexOf("SplitLayout")).toBeLessThan(code.indexOf("Stack"));
  });
});

describe("ComposerIntegration — mutations reflect everywhere (#251)", () => {
  it("a prop edit updates the document, the canvas snapshot, and the save status", async () => {
    const s = setup();
    s.addAt(ROOT, "Box");
    const boxId = s.canvasDoc().root[0]!.id;

    const label = within(s.inspector()).getByLabelText("Label") as HTMLInputElement;
    // Keystream commits are debounced (#291) — advance to the trailing edge.
    // The dedicated flush/burst coverage lives in composer-integration-debounce.test.tsx.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      fireEvent.input(label, { target: { value: "Renamed" } });
      act(() => { vi.advanceTimersByTime(INSPECTOR_COMMIT_DEBOUNCE_MS); });
    } finally {
      vi.useRealTimers();
    }

    expect(s.canvasDoc().root[0]!.props.label).toBe("Renamed");
    expect(s.canvasDoc().root[0]!.id).toBe(boxId); // same stable node, not a remount
    await waitFor(() => expect(s.chrome.getSnapshot().editorStatus).toEqual({ state: "saved" }));
  });

  it("a canvas inline-edit commit routes through updateProps; the inspector reflects it live (#257)", () => {
    const s = setup();
    s.addAt(ROOT, "Box");
    const boxId = s.canvasDoc().root[0]!.id;

    const label = () => within(s.inspector()).getByLabelText("Label") as HTMLInputElement;
    expect(label().value).toBe("Box");

    // The revision the canvas is currently showing (its newest render).
    const currentRev = asAny(
      s.bridge.posts.filter((p) => asAny(p.message).type === "render").at(-1)!.message,
    ).revision as number;

    act(() => s.bridge.deliver(commitInlineEditMessage(boxId, "label", "Edited on canvas", currentRev)));

    // Routed through the ONE mutation path → document + canvas snapshot updated…
    expect(s.canvasDoc().root[0]!.props.label).toBe("Edited on canvas");
    expect(s.canvasDoc().root[0]!.id).toBe(boxId); // same stable node, not a remount
    // …and the inspector reflects the change with no extra wiring.
    expect(label().value).toBe("Edited on canvas");
  });

  it("a sibling move reorders the document across tree + canvas", () => {
    const s = setup();
    s.addAt({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 0 }, "Box");
    s.addAt({ parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 1 }, "Stack");
    const [firstId, secondId] = s.canvasDoc().root.map((n) => n.id);

    // Stack is selected (just added); move it up from its own row menu.
    fireEvent.click(within(s.tree()).getByRole("button", { name: "Open menu for Stack" }));
    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Move up" }));
    expect(s.canvasDoc().root.map((n) => n.id)).toEqual([secondId, firstId]);
  });

  it("removing a subtree clears it from the tree and the canvas snapshot", () => {
    const s = setup();
    s.addAt(ROOT, "Split Layout");
    const splitId = s.canvasDoc().root[0]!.id;
    s.addAt({ parentId: splitId, slotId: "left", index: 0 }, "Box");

    // Select the split's row, then delete it from the inspector's Node section.
    fireEvent.click(s.treeRow("Split Layout"));
    fireEvent.click(within(s.inspector()).getByRole("button", { name: "Delete" }));

    expect(s.canvasDoc().root).toHaveLength(0);
    expect(s.hasTreeRow("Split Layout")).toBe(false);
  });
});

describe("ComposerIntegration — mode, viewport, persistence, export (#251)", () => {
  it("Preview mode removes structural affordances and read-only-locks the inspector", () => {
    const s = setup();
    s.addAt(ROOT, "Box");
    // Edit mode: the tree offers an Add affordance.
    expect(within(s.tree()).getByRole("button", { name: "Add component to the document" })).toBeInTheDocument();

    fireEvent.click(within(s.toolbar()).getByRole("radio", { name: "Preview" }));

    expect(s.lastSentSession().mode).toBe("preview");
    expect(within(s.tree()).queryByRole("button", { name: "Add component to the document" })).toBeNull();
    // Inspector controls are disabled but the selection/values are preserved.
    expect((within(s.inspector()).getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(s.inspector()).getByText("Box")).toBeInTheDocument();
  });

  it("switching Edit → Preview → Edit preserves the document and selection", () => {
    const s = setup();
    s.addAt(ROOT, "Box");
    const boxId = s.canvasDoc().root[0]!.id;
    fireEvent.click(within(s.toolbar()).getByRole("radio", { name: "Preview" }));
    fireEvent.click(within(s.toolbar()).getByRole("radio", { name: "Edit" }));
    expect(s.lastSentSession().mode).toBe("edit");
    expect(s.lastSentSession().selectedId).toBe(boxId);
    expect(s.canvasDoc().root).toHaveLength(1);
  });

  it("the viewport control resizes only the preview frame and persists the choice", () => {
    const s = setup();
    expect(s.frame().style.width).toBe(""); // fluid
    fireEvent.click(
      within(within(s.toolbar()).getByRole("radiogroup", { name: "Canvas viewport" })).getByRole("radio", { name: "768" }),
    );
    expect(s.frame().style.width).toBe("768px");
    expect(localStorage.getItem(LS_COMPOSER_VIEWPORT)).toBe("tablet");
  });

  it("restores a persisted viewport on load", () => {
    const s = setup("mobile");
    expect(s.frame().style.width).toBe("390px");
  });

  it("export renders exactly the generator output for the current document/manifest", () => {
    const s = setup();
    s.addAt(ROOT, "Box");
    fireEvent.click(within(s.toolbar()).getByRole("button", { name: "Export JSX" }));
    const dialog = screen.getByRole("dialog", { name: "Export — Integration Doc" });
    expect(dialog.querySelector("pre")!.textContent).toContain("Box");
  });
});

describe("ComposerIntegration — replay + guarded keyboard (#251)", () => {
  it("replays the newest document to a reloaded iframe at a fresh revision", () => {
    const s = setup();
    s.addAt(ROOT, "Box");
    const before = s.bridge.posts.length;

    // The iframe reloads and re-announces ready — the newest snapshot replays.
    act(() => s.bridge.deliver(readyMessage()));
    const replay = s.bridge.posts[before]!;
    expect(asAny(replay.message).type).toBe("render");
    expect(asAny(replay.message).document.root).toHaveLength(1);
  });

  it("Delete removes the selected node, but is guarded in inputs and in Preview", () => {
    const s = setup();
    s.addAt(ROOT, "Box");
    expect(s.canvasDoc().root).toHaveLength(1);

    // Guard 1: a keystroke aimed at an editable control does NOT delete.
    const label = within(s.inspector()).getByLabelText("Label");
    fireEvent.keyDown(label, { key: "Delete" });
    expect(s.canvasDoc().root).toHaveLength(1);

    // Guard 2: Preview mode never mutates.
    fireEvent.click(within(s.toolbar()).getByRole("radio", { name: "Preview" }));
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(s.canvasDoc().root).toHaveLength(1);

    // Edit mode, focus outside an input → the selected node is removed.
    fireEvent.click(within(s.toolbar()).getByRole("radio", { name: "Edit" }));
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(s.canvasDoc().root).toHaveLength(0);
  });
});

describe("ComposerIntegration — undo/redo app wiring (#74)", () => {
  it("row-menu removal is one action and remains undoable by keyboard shortcut", () => {
    const s = setup(undefined, makeAbcDocument());

    fireEvent.click(within(s.tree()).getByRole("button", { name: "Open menu for Split Layout" }));
    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Delete" }));
    expect(s.canvasDoc().root).toHaveLength(0);

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(s.canvasDoc().root).toHaveLength(1);
  });

  it("drives one controller from toolbar, parent shortcuts, and canvas relay", () => {
    const s = setup();
    const undo = () => within(s.toolbar()).getByRole("button", { name: "Undo" });
    const redo = () => within(s.toolbar()).getByRole("button", { name: "Redo" });

    expect(undo()).toBeDisabled();
    expect(redo()).toBeDisabled();

    s.addAt(ROOT, "Box");
    expect(s.canvasDoc().root).toHaveLength(1);
    expect(undo()).toBeEnabled();
    expect(redo()).toBeDisabled();

    // Toolbar actions are wired directly to the mounted controller.
    fireEvent.click(undo());
    expect(s.canvasDoc().root).toHaveLength(0);
    expect(undo()).toBeDisabled();
    expect(redo()).toBeEnabled();
    fireEvent.click(redo());
    expect(s.canvasDoc().root).toHaveLength(1);

    // Parent-document shortcuts use the same callbacks and capability flags.
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(s.canvasDoc().root).toHaveLength(0);
    expect(undo()).toBeDisabled();
    expect(redo()).toBeEnabled();

    // Canvas-relayed shortcuts reach that same controller as well.
    act(() => s.bridge.deliver(requestHistoryMessage("redo")));
    expect(s.canvasDoc().root).toHaveLength(1);
    act(() => s.bridge.deliver(requestHistoryMessage("undo")));
    expect(s.canvasDoc().root).toHaveLength(0);
    expect(undo()).toBeDisabled();
    expect(redo()).toBeEnabled();
  });

  it("tracks disabled history buttons through mutation, undo, and Preview mode", () => {
    const s = setup();
    const undo = () => within(s.toolbar()).getByRole("button", { name: "Undo" });
    const redo = () => within(s.toolbar()).getByRole("button", { name: "Redo" });

    s.addAt(ROOT, "Box");
    fireEvent.click(within(s.toolbar()).getByRole("radio", { name: "Preview" }));

    expect(undo()).toBeDisabled();
    expect(redo()).toBeDisabled();
    expect(s.canvasDoc().root).toHaveLength(1);

    // Preview's controller capability flags disable both affordances and its
    // keyboard/canvas guards leave the document untouched.
    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    act(() => s.bridge.deliver(requestHistoryMessage("undo")));
    expect(s.canvasDoc().root).toHaveLength(1);

    fireEvent.click(within(s.toolbar()).getByRole("radio", { name: "Edit" }));
    expect(undo()).toBeEnabled();
    expect(redo()).toBeDisabled();
    fireEvent.click(undo());
    expect(undo()).toBeDisabled();
    expect(redo()).toBeEnabled();
  });

  it("drops an inline commit stamped before undo and shows the existing stale notice", () => {
    const s = setup();
    s.addAt(ROOT, "Box");
    const boxId = s.canvasDoc().root[0]!.id;
    const beforeUndoRevision = asAny(
      s.bridge.posts.filter((p) => asAny(p.message).type === "render").at(-1)!.message,
    ).revision as number;

    fireEvent.click(within(s.toolbar()).getByRole("button", { name: "Undo" }));
    expect(s.canvasDoc().root).toHaveLength(0);
    const afterUndoRevision = asAny(
      s.bridge.posts.filter((p) => asAny(p.message).type === "render").at(-1)!.message,
    ).revision as number;
    expect(afterUndoRevision).toBeGreaterThan(beforeUndoRevision);

    act(() =>
      s.bridge.deliver(commitInlineEditMessage(boxId, "label", "Late canvas edit", beforeUndoRevision)),
    );

    expect(s.canvasDoc().root).toHaveLength(0);
    expect(screen.getByText(/Your inline edit was not applied/)).toBeInTheDocument();
  });
});

describe("ComposerIntegration — context menus + menu bridge (#256)", () => {
  beforeEach(() => resetFixtureIds());

  it("structure node menu: Copy/Cut/Duplicate/Move/Delete, Delete danger-styled, and closing restores focus to the trigger", () => {
    const s = setup(undefined, makeAbcDocument());
    const trigger = within(s.tree()).getByRole("button", { name: "Open menu for Box B" });

    fireEvent.click(trigger);
    expect(within(s.menu()!).getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Copy",
      "Cut",
      "Duplicate",
      "Move up",
      "Move down",
      "Delete",
    ]);
    expect(within(s.menu()!).getByRole("menuitem", { name: "Delete" }).className).toContain(
      "cms-menu__item--danger",
    );

    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Copy" }));
    expect(within(s.toolbar()).getByText("Box", { exact: false })).toBeInTheDocument();
    expect(s.menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("opaque nodes show NO Copy/Cut/Duplicate in the node menu — reorder and Delete remain", () => {
    const doc = makeAbcDocument();
    doc.root.push({ id: "ghost", componentId: "ghost.unknown", componentVersion: 1, props: {}, slots: {} });
    const s = setup(undefined, doc);
    const trigger = within(s.tree()).getByRole("button", { name: /open menu for ghost.unknown/i });
    fireEvent.click(trigger);
    expect(within(s.menu()!).getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Move up",
      "Move down",
      "Delete",
    ]);
  });

  it("Delete on a populated subtree removes in one action and remains undoable from the toolbar", () => {
    const s = setup(undefined, makeAbcDocument());
    fireEvent.click(within(s.tree()).getByRole("button", { name: "Open menu for Split Layout" }));
    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Delete" }));

    expect(s.canvasDoc().root).toHaveLength(0);
    expect(s.menu()).toBeNull();

    fireEvent.click(within(s.toolbar()).getByRole("button", { name: "Undo" }));
    expect(s.canvasDoc().root).toHaveLength(1);
  });

  it("insert menu always offers BOTH Add component… and Paste here; paste disabled while clipboard is empty", () => {
    const s = setup(undefined, makeAbcDocument());
    fireEvent.click(within(s.tree()).getByRole("button", { name: "Insert options for the document" }));
    const items = within(s.menu()!).getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual(["Add component…", "Paste here"]);
    expect((within(s.menu()!).getByRole("menuitem", { name: "Paste here" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("PASTE INTO A NAMED SLOT end-to-end through the insert menu — the B/C right-slot fixture", () => {
    const s = setup(undefined, makeAbcDocument());

    // Copy B via its node menu.
    fireEvent.click(within(s.tree()).getByRole("button", { name: "Open menu for Box B" }));
    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Copy" }));
    expect(s.menu()).toBeNull();

    // Open the RIGHT slot's insert menu (the companion "⋯" beside its own "+Add").
    fireEvent.click(within(s.tree()).getByRole("button", { name: "Insert options for Right" }));
    const paste = within(s.menu()!).getByRole("menuitem", { name: 'Paste "Box" here' });
    expect((paste as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(paste);

    const right = s.canvasDoc().root[0]!.slots.right as { id: string; componentId: string }[];
    expect(right.map((node) => node.id).slice(0, 2)).toEqual(["B", "C"]);
    expect(right).toHaveLength(3);
    const pastedId = right[2]!.id;
    expect(pastedId).not.toBe("B");
    expect(right[2]!.componentId).toBe(FIXTURE_IDS.box);
    // And the structure rail shows the third copy — one document, everywhere.
    expect(s.treeRowsNamed("BoxB")).toHaveLength(2);
    expect(s.menu()).toBeNull();
  });

  it("Escape closes the tree-origin menu and returns focus to its trigger", () => {
    const s = setup(undefined, makeAbcDocument());
    const trigger = within(s.tree()).getByRole("button", { name: "Insert options for the document" });
    fireEvent.click(trigger);
    expect(s.menu()).not.toBeNull();
    fireEvent.keyDown(s.menu()!, { key: "Escape" });
    expect(s.menu()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("cross-frame: request-node-menu opens the SAME menu, and closing posts restore-focus with the exact focusToken", () => {
    const s = setup(undefined, makeAbcDocument());
    act(() => s.bridge.deliver(requestNodeMenuMessage(rev++, "B", RECT, "node-menu:B")));

    expect(s.menu()).not.toBeNull();
    expect(within(s.menu()!).getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Copy",
      "Cut",
      "Duplicate",
      "Move up",
      "Move down",
      "Delete",
    ]);

    s.bridge.posts.length = 0;
    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Cut" }));

    expect(s.menu()).toBeNull();
    // Cutting B also re-renders the canvas snapshot (a document mutation) —
    // the restore-focus response is ONE of possibly several posts.
    const restoreFocusPosts = s.bridge.posts.filter((p) => asAny(p.message).type === "restore-focus");
    expect(restoreFocusPosts).toHaveLength(1);
    expect(asAny(restoreFocusPosts[0]!.message)).toMatchObject({ type: "restore-focus", focusToken: "node-menu:B" });
  });

  it("cross-frame insert menu: Add component… focuses the iframe and opens the shared chooser for the exact target (no restore-focus round trip)", () => {
    const s = setup(undefined, makeAbcDocument());
    const target = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 1 };
    act(() => s.bridge.deliver(requestInsertMenuMessage(rev++, target, RECT, "insert-menu:root:1")));
    s.bridge.posts.length = 0;

    fireEvent.click(within(s.menu()!).getByRole("menuitem", { name: "Add component…" }));

    // No restore-focus round trip for the "Add" hand-off — the iframe was
    // focused directly (so the chooser captures IT as its own trigger), and
    // the chooser immediately moves focus on to its own search field.
    expect(s.bridge.posts.filter((p) => asAny(p.message).type === "restore-focus")).toHaveLength(0);
    expect(s.chooser()).not.toBeNull();
    fireEvent.click(within(s.chooser()).getByRole("button", { name: "Box" }));
    expect(s.canvasDoc().root.map((n) => n.componentId)[1]).toBe(FIXTURE_IDS.box);
    // The chooser's OWN close-focus-restore returns focus to its captured
    // trigger — the iframe, matching the existing #251 request-add contract.
    expect(document.activeElement).toBe(s.iframe());
  });

  it("cross-frame: request-insert-menu translates the rect by the iframe's own offset", () => {
    const s = setup(undefined, makeAbcDocument());
    vi.spyOn(s.iframe(), "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 40,
      width: 500,
      height: 300,
      top: 40,
      left: 100,
      right: 600,
      bottom: 340,
      toJSON: () => ({}),
    });
    act(() =>
      s.bridge.deliver(
        requestInsertMenuMessage(rev++, { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 1 }, RECT, "t"),
      ),
    );
    // The host translates the iframe-local rect and parks the menu's anchor
    // there; where the panel then lands is the shared menu's own contract.
    const anchor = s.container.querySelector(".sg-composer-menu-anchor") as HTMLElement;
    expect(anchor.style.left).toBe(`${RECT.x + 100}px`);
    expect(anchor.style.top).toBe(`${RECT.y + 40}px`);
    expect(anchor.style.width).toBe(`${RECT.width}px`);
    expect(anchor.style.height).toBe(`${RECT.height}px`);
  });
});

describe("ComposerIntegration — canvas drag & drop end-to-end (#258)", () => {
  it("a canvas MOVE mutates the document, mirrors selection, and reveals the node", () => {
    const s = setup(undefined, makeAbcDocument());
    // Move B to the end of split.right → [C, B], with B selected.
    act(() =>
      s.bridge.deliver(
        dropNodeMessage("B", { parentId: "split", slotId: "right", index: 2 }, false, rev++),
      ),
    );

    const doc = s.canvasDoc();
    expect(doc.root[0]!.slots.right!.map((n) => n.id)).toEqual(["C", "B"]);
    expect(s.lastSentSession().selectedId).toBe("B");
    // The moved node is present + revealed in the tree.
    expect(s.hasTreeRow("BoxB")).toBe(true);
  });

  it("an Alt-COPY keeps the source and selects the fully re-ID'd clone", () => {
    const s = setup(undefined, makeAbcDocument());
    act(() =>
      s.bridge.deliver(
        dropNodeMessage("B", { parentId: "split", slotId: "right", index: 0 }, true, rev++),
      ),
    );

    const right = s.canvasDoc().root[0]!.slots.right!;
    // Source B kept; a distinct clone inserted at index 0.
    expect(right.some((n) => n.id === "B")).toBe(true);
    expect(right[0]!.id).not.toBe("B");
    expect(right[0]!.props.label).toBe("B");
    // The new node is selected + revealed.
    expect(s.lastSentSession().selectedId).toBe(right[0]!.id);
    expect(s.treeRowsNamed("BoxB")).toHaveLength(2);
  });

  it("an invalid drop (cycle) is rejected: no document change and an error surfaces", () => {
    const s = setup(undefined, makeAbcDocument());
    const before = s.canvasDoc();
    act(() =>
      s.bridge.deliver(
        dropNodeMessage("split", { parentId: "split", slotId: "right", index: 0 }, false, rev++),
      ),
    );
    // The document is unchanged (the last render is still the pre-drop one).
    expect(s.canvasDoc()).toEqual(before);
  });
});
