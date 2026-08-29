/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { h } from "preact";
import { defineComponentPack, type ComponentManifest } from "@zudo-composer/component-contract";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../../composer/browser";
import type { CompositionDocument, InsertionTarget, ReuseCatalogOutcome } from "../../../../../composer/browser";
import { createComposerComponentProvider } from "../../../active-pack";
import type { ComposerPreviewLocation } from "../../../preview";
import { ComposerChooser } from "../composer-chooser";
import { CHOOSER_PREVIEW_PLACEHOLDER_ID } from "../chooser-preview-host";
import {
  FIXTURE_IDS,
  fixtureCatalog,
  fixtureComponentProvider,
  fixtureDocument,
  fixtureNode,
  makeAbcDocument,
  resetFixtureIds,
} from "../../tree/__tests__/fixtures";
import { makeChooserPreviewBridgeHarness } from "./preview-bridge-test-harness";

const rightTarget: InsertionTarget = { parentId: "split", slotId: "right", index: 2 };
const rootTarget: InsertionTarget = { parentId: null, slotId: VIRTUAL_ROOT_SLOT_ID, index: 1 };

// `ChooserPreviewHost` (issue #254) mounts unconditionally whenever the
// dialog has eligible content — tests that don't care about its own bridge
// still render it. Defaulting `previewLocation` to `about:blank` (like
// `app/test-support/preview-harness.ts`'s own harness) keeps happy-dom from
// attempting a real network fetch for `/composer/preview` in every one of
// #250's pre-existing tests below.
const INERT_PREVIEW_LOCATION: ComposerPreviewLocation = {
  src: "about:blank",
  targetOrigin: "https://composer-chooser-inert.test",
};

// The shared tree/chooser fixture catalog (issue #250) is intentionally
// generic and carries no `ui.placeholder-box`-shaped entry — this issue's
// preview pane needs one, so it's appended locally rather than editing that
// shared fixture (owned by `ui/tree/**`, outside this issue's scope).
const placeholderFixtureEntry: ComponentManifest = {
  id: CHOOSER_PREVIEW_PLACEHOLDER_ID,
  schemaVersion: 1,
  title: "Placeholder Box",
  category: "Media",
  description: "Labeled image stand-in.",
  source: { module: "@fixtures/placeholder-box", exportKind: "named", exportName: "PlaceholderBox" },
  defaults: { label: "hero-image.png" },
  fields: [],
  slots: [],
};
const catalogWithPlaceholder: ComponentManifest[] = [...fixtureCatalog, placeholderFixtureEntry];

// One shared catalog derivation per pack variant — tests pass this pre-derived catalog
// alongside the raw entries array, rather than re-deriving inside
// `ComposerChooser` itself.
const fixtureManifest = fixtureComponentProvider.catalog;
const placeholderComponentPack = defineComponentPack({
  packId: "@zudo-composer/test-chooser-placeholder",
  packVersion: "1.0.0",
  components: catalogWithPlaceholder.map((entry) => ({
    ...entry,
    component: (props: Record<string, unknown>) => h("div", props),
  })),
});
const placeholderComponentProvider = createComposerComponentProvider(placeholderComponentPack);
const manifestWithPlaceholder = placeholderComponentProvider.catalog;

function baseProps(overrides: Partial<Parameters<typeof ComposerChooser>[0]> = {}) {
  resetFixtureIds();
  return {
    open: true,
    target: rightTarget,
    document: makeAbcDocument(),
    componentProvider: fixtureComponentProvider,
    manifest: fixtureManifest,
    entries: fixtureCatalog,
    onAdd: vi.fn(),
    onExpandAncestors: vi.fn(),
    onClose: vi.fn(),
    previewLocation: INERT_PREVIEW_LOCATION,
    ...overrides,
  };
}

function savedPattern(name = "Feature row"): CompositionDocument {
  const document = fixtureDocument([
    fixtureNode(FIXTURE_IDS.box, { label: "Pattern lead" }, {}, "pattern-lead"),
    fixtureNode(FIXTURE_IDS.text, { children: "Pattern detail" }, {}, "pattern-detail"),
  ], name);
  document.id = "feature-pattern";
  document.publication = { kind: "pattern" };
  return document;
}

const patternCatalog: ReuseCatalogOutcome = {
  status: "listed",
  entries: [
    {
      ref: { providerId: "files", recordId: "feature-pattern" },
      summary: {
        id: "feature-pattern",
        name: "Feature row",
        createdAt: "2026-07-14T01:00:00.000Z",
        updatedAt: "2026-07-14T02:00:00.000Z",
        nodeCount: 2,
        rootCount: 2,
        publicationKind: "pattern",
        reuseStatus: "eligible",
      },
      kind: "pattern",
    },
  ],
};

describe("ComposerChooser — modal behavior", () => {
  it("shows as an open, labelled dialog with an accessible title", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    const dialog = screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(screen.getByRole("heading", { name: "Add to Split Layout › Right" })).toBeInTheDocument();
  });

  it("focuses the search input on open", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    expect(screen.getByPlaceholderText("Search components…")).toHaveFocus();
  });

  it("Escape closes without adding anything, and fires onClose", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    fireEvent.keyDown(screen.getByRole("dialog", { hidden: true }), { key: "Escape" });
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes without adding anything", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the trigger element after closing", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Add";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const props = baseProps();
    render(<ComposerChooser {...props} />);
    expect(trigger).not.toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("wraps Tab from the last focusable element back to the first, and Shift+Tab from first to last", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    const focusable = dialog.querySelectorAll("button, input");
    const firstFocusable = focusable[0] as HTMLElement;
    const lastFocusable = focusable[focusable.length - 1] as HTMLElement;

    lastFocusable.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(firstFocusable).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(lastFocusable).toHaveFocus();
  });
});

describe("ComposerChooser — target capture survives a selection change", () => {
  it("keeps adding to the target captured at open time even after the target prop changes while open", () => {
    resetFixtureIds();
    const onAdd = vi.fn();
    const document = makeAbcDocument();

    function Harness() {
      const [target, setTarget] = useState<InsertionTarget>(rightTarget);
      return (
        <>
          <button type="button" onClick={() => setTarget(rootTarget)}>
            Simulate selection change
          </button>
          <ComposerChooser
            componentProvider={fixtureComponentProvider}
            open
            target={target}
            document={document}
            manifest={fixtureManifest}
            entries={fixtureCatalog}
            onAdd={onAdd}
            onExpandAncestors={vi.fn()}
            onClose={vi.fn()}
            previewLocation={INERT_PREVIEW_LOCATION}
          />
        </>
      );
    }

    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Add to Split Layout › Right" })).toBeInTheDocument();

    // Simulate a selection change elsewhere in the app redirecting the live
    // `target` prop WHILE the dialog is still open.
    fireEvent.click(screen.getByRole("button", { name: "Simulate selection change" }));
    expect(screen.getByRole("heading", { name: "Add to Split Layout › Right" })).toBeInTheDocument();
    expect(screen.queryByText("Document root")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Box/ }));
    expect(onAdd).toHaveBeenCalledWith(rightTarget, FIXTURE_IDS.box);
    expect(onAdd).not.toHaveBeenCalledWith(rootTarget, expect.anything());
  });
});

describe("ComposerChooser — search / category / constraint filters", () => {
  it("shows the destination label and every eligible component with a result count", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    expect(screen.getByRole("heading", { name: "Add to Split Layout › Right" })).toBeInTheDocument();
    expect(screen.getByText(/\d+ of \d+ components?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Box/ })).toBeInTheDocument();
  });

  it("filters the accepts-restricted gallery slot down to Box only", () => {
    const document = makeAbcDocument();
    document.root.push({
      id: "gallery",
      componentId: FIXTURE_IDS.gallery,
      componentVersion: 1,
      props: {},
      slots: { items: [] },
    });
    const props = baseProps({ document, target: { parentId: "gallery", slotId: "items", index: 0 } });
    render(<ComposerChooser {...props} />);
    expect(screen.getByRole("button", { name: /^Box/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Stack/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Button/ })).not.toBeInTheDocument();
  });

  it("blocks a chooser opened on an already-occupied single-cardinality slot", () => {
    const props = baseProps({ target: { parentId: "split", slotId: "left", index: 1 } });
    render(<ComposerChooser {...props} />);
    expect(screen.getByText(/already has a component/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Box/ })).not.toBeInTheDocument();
  });

  it("search narrows the result list and shows an empty state with a clear-filters action for no matches", () => {
    const props = baseProps({ target: rootTarget });
    render(<ComposerChooser {...props} />);
    const search = screen.getByPlaceholderText("Search components…");

    fireEvent.input(search, { target: { value: "box" } });
    expect(screen.getByRole("button", { name: /^Box/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Button/ })).not.toBeInTheDocument();

    fireEvent.input(search, { target: { value: "zzz-no-match" } });
    expect(screen.getByText(/No matching components/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: /^Box/ })).toBeInTheDocument();
  });

  it("category filters narrow the list and are keyboard-activatable buttons", () => {
    const props = baseProps({ target: rootTarget });
    render(<ComposerChooser {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("button", { name: /^Button/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Box/ })).not.toBeInTheDocument();
  });
});

describe("ComposerChooser — Enter / Escape and successful add", () => {
  it("Enter in the search field adds the sole matching result", () => {
    const props = baseProps({ target: rootTarget });
    render(<ComposerChooser {...props} />);
    const search = screen.getByPlaceholderText("Search components…");
    fireEvent.input(search, { target: { value: "gallery" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(props.onAdd).toHaveBeenCalledWith(rootTarget, FIXTURE_IDS.gallery);
  });

  it("choosing a component adds to the captured target, expands ancestors, and closes", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^Box/ }));
    expect(props.onAdd).toHaveBeenCalledWith(rightTarget, FIXTURE_IDS.box);
    expect(props.onExpandAncestors).toHaveBeenCalledWith(["split"]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("announces a status message after a successful add", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^Box/ }));
    expect(screen.getByRole("status")).toHaveTextContent(/Box added to Split Layout › Right/);
  });
});

describe("ComposerChooser — published Pattern insertion", () => {
  it("keeps Components as the default, then loads a full multi-root Pattern for the isolated preview", async () => {
    const source = savedPattern();
    const loadPattern = vi.fn(async () => ({
      status: "loaded" as const,
      kind: "pattern" as const,
      record: {
        id: "feature-pattern",
        createdAt: "2026-07-14T01:00:00.000Z",
        updatedAt: "2026-07-14T02:00:00.000Z",
        document: source,
      },
    }));
    const props = baseProps({
      patternCatalog,
      loadPattern,
      onInsertPattern: vi.fn(() => ({ status: "inserted" as const })),
    });
    render(<ComposerChooser {...props} />);

    expect(screen.getByRole("tab", { name: "Components" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Patterns" }));
    expect(screen.getByRole("tab", { name: "Patterns" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /^Feature row/ })).toHaveTextContent("2 roots · 2 nodes");

    fireEvent.click(screen.getByRole("button", { name: /^Feature row/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Insert Pattern" })).toBeEnabled());
    expect(loadPattern).toHaveBeenCalledWith({ providerId: "files", recordId: "feature-pattern" });
    expect(screen.getByText("Pattern preview")).toBeInTheDocument();
  });

  it("preserves the captured target, selected Pattern, search, and dialog after an atomic insertion rejection", async () => {
    const source = savedPattern();
    const onInsertPattern = vi.fn(() => ({ status: "rejected" as const, message: "The destination changed." }));
    const props = baseProps({
      patternCatalog,
      loadPattern: async () => ({
        status: "loaded" as const,
        kind: "pattern" as const,
        record: {
          id: "feature-pattern",
          createdAt: "2026-07-14T01:00:00.000Z",
          updatedAt: "2026-07-14T02:00:00.000Z",
          document: source,
        },
      }),
      onInsertPattern,
    });
    render(<ComposerChooser {...props} />);

    fireEvent.click(screen.getByRole("tab", { name: "Patterns" }));
    const search = screen.getByPlaceholderText("Search Patterns…") as HTMLInputElement;
    fireEvent.input(search, { target: { value: "feature" } });
    fireEvent.click(screen.getByRole("button", { name: /^Feature row/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Insert Pattern" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Insert Pattern" }));

    await waitFor(() => expect(screen.getByText("The destination changed.")).toBeInTheDocument());
    expect(onInsertPattern).toHaveBeenCalledWith(rightTarget, source.root);
    expect(search.value).toBe("feature");
    expect(screen.getByRole("dialog", { hidden: true })).toHaveProperty("open", true);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("keeps an unavailable or changed Pattern source actionable without closing the dialog", async () => {
    const props = baseProps({
      patternCatalog,
      loadPattern: async () => ({ status: "invalid" as const, reason: "not-reusable" as const }),
      onInsertPattern: vi.fn(() => ({ status: "inserted" as const })),
    });
    render(<ComposerChooser {...props} />);

    fireEvent.click(screen.getByRole("tab", { name: "Patterns" }));
    fireEvent.click(screen.getByRole("button", { name: /^Feature row/ }));
    await waitFor(() => expect(screen.getByText(/no longer published as a Pattern/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Insert Pattern" })).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe("ComposerChooser — live preview pane (issue #254)", () => {
  it("shows an empty-state hint before the first hover/focus", () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({ previewCreateBridge: harness.createBridge, previewLocation: harness.location });
    render(<ComposerChooser {...props} />);
    expect(screen.getByText(/Hover or focus a component to preview it here/)).toBeInTheDocument();
    act(() => harness.deliverReady());
    expect(harness.posts).toHaveLength(0);
  });

  it("hovering a catalog card renders it (defaults) in the SECOND, dedicated preview iframe", () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({ previewCreateBridge: harness.createBridge, previewLocation: harness.location });
    render(<ComposerChooser {...props} />);
    act(() => harness.deliverReady());

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Box/ }));
    expect(harness.posts).toHaveLength(1);
    const message = harness.posts[0]!.message as {
      type: string;
      document: { root: { componentId: string }[] };
      session: { mode: string };
    };
    expect(message.type).toBe("render");
    expect(message.document.root[0]!.componentId).toBe(FIXTURE_IDS.box);
    // Non-interactive: the preview never enters "edit" session mode.
    expect(message.session.mode).toBe("preview");
    expect(screen.queryByText(/Hover or focus a component/)).not.toBeInTheDocument();
  });

  it("keyboard-focusing a catalog card ALSO updates the preview target", () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({
      target: rootTarget,
      previewCreateBridge: harness.createBridge,
      previewLocation: harness.location,
    });
    render(<ComposerChooser {...props} />);
    act(() => harness.deliverReady());

    fireEvent.focus(screen.getByRole("button", { name: /^Text/ }));
    expect(harness.posts).toHaveLength(1);
    const message = harness.posts[0]!.message as { document: { root: { componentId: string }[] } };
    expect(message.document.root[0]!.componentId).toBe(FIXTURE_IDS.text);
  });

  it("is sticky: the previewed entry survives mouseleave, and is only replaced by the NEXT hover/focus", () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({
      target: rootTarget,
      previewCreateBridge: harness.createBridge,
      previewLocation: harness.location,
    });
    render(<ComposerChooser {...props} />);
    act(() => harness.deliverReady());

    const boxCard = screen.getByRole("button", { name: /^Box/ });
    fireEvent.mouseEnter(boxCard);
    expect(harness.posts).toHaveLength(1);

    fireEvent.mouseLeave(boxCard);
    expect(harness.posts).toHaveLength(1); // no clear-on-leave

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Button/ }));
    expect(harness.posts).toHaveLength(2);
    const latest = harness.posts.at(-1)!.message as { document: { root: { componentId: string }[] } };
    expect(latest.document.root[0]!.componentId).toBe(FIXTURE_IDS.button);
  });

  it("a hovered CONTAINER entry's preview includes a PlaceholderBox child in every declared slot", () => {
    const harness = makeChooserPreviewBridgeHarness(placeholderComponentProvider.manifest);
    const props = baseProps({
      target: rootTarget,
      manifest: manifestWithPlaceholder,
      componentProvider: placeholderComponentProvider,
      entries: catalogWithPlaceholder,
      previewCreateBridge: harness.createBridge,
      previewLocation: harness.location,
    });
    render(<ComposerChooser {...props} />);
    act(() => harness.deliverReady());

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Split Layout/ }));
    expect(harness.posts).toHaveLength(1);
    const message = harness.posts[0]!.message as {
      document: { root: { componentId: string; slots: Record<string, { componentId: string }[]> }[] };
    };
    const root = message.document.root[0]!;
    expect(root.componentId).toBe(FIXTURE_IDS.split);
    expect(root.slots.left).toHaveLength(1);
    expect(root.slots.left![0]!.componentId).toBe(CHOOSER_PREVIEW_PLACEHOLDER_ID);
    expect(root.slots.right).toHaveLength(1);
    expect(root.slots.right![0]!.componentId).toBe(CHOOSER_PREVIEW_PLACEHOLDER_ID);
  });

  it("a leaf entry's preview carries no slot children", () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({ previewCreateBridge: harness.createBridge, previewLocation: harness.location });
    render(<ComposerChooser {...props} />);
    act(() => harness.deliverReady());

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Box/ }));
    const message = harness.posts[0]!.message as { document: { root: { slots: Record<string, unknown> }[] } };
    expect(message.document.root[0]!.slots).toEqual({});
  });
});

describe("ComposerChooser — movable tool-dialog geometry (issue #315)", () => {
  it("opens at a stable explicit 24px-inset rect without an enlarge control", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);

    const dialog = screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
    expect(dialog.style.left).toBe("24px");
    expect(dialog.style.top).toBe("24px");
    expect(dialog.style.width).toBe("976px");
    expect(dialog.style.height).toBe("720px");
    expect(dialog).not.toHaveAttribute("data-sg-enlarged");
    expect(screen.queryByRole("button", { name: /enlarge|restore/i })).not.toBeInTheDocument();
  });

  it("labels and documents the six-dot move grip, then supports keyboard movement and Home reset", () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);

    const dialog = screen.getByRole("dialog", { hidden: true });
    const grip = screen.getByRole("button", { name: "Move dialog" });
    expect(grip).toHaveAttribute("aria-keyshortcuts", expect.stringContaining("Shift+ArrowRight"));
    expect(screen.getByText(/Shift plus Arrow keys to move it 48 pixels/)).toBeInTheDocument();

    fireEvent.keyDown(grip, { key: "ArrowRight" });
    fireEvent.keyDown(grip, { key: "ArrowDown", shiftKey: true });
    expect(dialog.style.left).toBe("40px");
    expect(dialog.style.top).toBe("48px");
    expect(dialog.style.width).toBe("976px");
    expect(dialog.style.height).toBe("720px");

    fireEvent.keyDown(grip, { key: "Home" });
    expect(dialog.style.left).toBe("24px");
    expect(dialog.style.top).toBe("24px");
    expect(dialog.style.width).toBe("976px");
    expect(dialog.style.height).toBe("720px");
  });

  it("uses pointer capture to drag only the position and resets the rect on a fresh open", () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            close
          </button>
          <button type="button" onClick={() => setOpen(true)}>
            open
          </button>
          <ComposerChooser
            componentProvider={fixtureComponentProvider}
            open={open}
            target={rootTarget}
            document={makeAbcDocument()}
            manifest={fixtureManifest}
            entries={fixtureCatalog}
            onAdd={vi.fn()}
            onExpandAncestors={vi.fn()}
            onClose={() => setOpen(false)}
            previewLocation={INERT_PREVIEW_LOCATION}
          />
        </>
      );
    }

    resetFixtureIds();
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    const grip = screen.getByRole("button", { name: "Move dialog" });
    const capture = vi.fn();
    Object.defineProperty(grip, "setPointerCapture", { configurable: true, value: capture });

    fireEvent.pointerDown(grip, { button: 0, pointerId: 7, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(grip, { pointerId: 7, clientX: 140, clientY: 80 });
    fireEvent.pointerUp(grip, { pointerId: 7 });
    expect(capture).toHaveBeenCalledWith(7);
    expect(dialog.style.left).toBe("48px");
    expect(dialog.style.top).toBe("48px");
    expect(dialog.style.width).toBe("976px");
    expect(dialog.style.height).toBe("720px");

    fireEvent.click(screen.getByText("close"));
    fireEvent.click(screen.getByText("open"));
    const reopened = screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
    expect(reopened.style.left).toBe("24px");
    expect(reopened.style.top).toBe("24px");
    expect(reopened.style.width).toBe("976px");
    expect(reopened.style.height).toBe("720px");
  });

  it("clamps a moved chooser after a viewport resize so the grip and close control stay reachable", () => {
    const width = vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024);
    const height = vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    const props = baseProps();
    render(<ComposerChooser {...props} />);

    const dialog = screen.getByRole("dialog", { hidden: true });
    const grip = screen.getByRole("button", { name: "Move dialog" });
    fireEvent.keyDown(grip, { key: "ArrowLeft" });
    fireEvent.keyDown(grip, { key: "ArrowUp" });
    width.mockReturnValue(390);
    height.mockReturnValue(300);
    act(() => { window.dispatchEvent(new Event("resize")); });

    expect(dialog.style.left).toBe("8px");
    expect(dialog.style.top).toBe("8px");
    expect(dialog.style.width).toBe("374px");
    expect(dialog.style.height).toBe("284px");
    width.mockRestore();
    height.mockRestore();
  });
});
