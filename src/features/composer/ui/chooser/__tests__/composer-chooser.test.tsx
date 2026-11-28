import "../../../test-support/cleanup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, signal } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle, waitFor, within } from "../../../../../test/render";
import { defineComponentPack, type ComponentManifest } from "@zudo-composer/component-contract";
import { VIRTUAL_ROOT_SLOT_ID } from "../../../../../composer/browser";
import type { CompositionDocument, InsertionTarget, ReuseCatalogOutcome, RootPolicy } from "../../../../../composer/browser";
import { createComposerComponentProvider } from "../../../component-provider";
import type { ComposerPreviewLocation } from "../../../preview";
import { activeComponentProvider } from "../../../active-pack";
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
  staticProps: [{ prop: "label", reason: "Fixed chooser-preview fixture label." }],
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
  it("uses the full-screen dialog size", async () => {
    render(<ComposerChooser {...baseProps()} />);
    await settle();
    expect(screen.getByRole("dialog")).toHaveClass("cms-dialog--full");
  });

  it("shows as an open, labelled dialog with an accessible title", async () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    await settle();
    const dialog = screen.getByRole("dialog", { hidden: true }) as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(screen.getByRole("heading", { name: "Add to Split Layout › Right" })).toBeInTheDocument();
  });

  it("focuses the search input on open", async () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    await settle();
    expect(screen.getByPlaceholderText("Search components…")).toHaveFocus();
  });

  it("Escape closes without adding anything, and fires onClose", async () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    await settle();
    fireEvent.keyDown(screen.getByRole("dialog", { hidden: true }), { key: "Escape" });
    await settle();
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes without adding anything", async () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(props.onAdd).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the trigger element after closing", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Add";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const open = signal(true);
    const props = baseProps({ open });
    render(<ComposerChooser {...props} />);
    await settle();
    await settle();
    expect(trigger).not.toHaveFocus();

    // The dialog is controlled: Cancel asks the owner to close, and focus comes
    // back when the owner actually does.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(props.onClose).toHaveBeenCalledTimes(1);
    open.value = false;
    await settle();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("wraps Tab from the last focusable element back to the first, and Shift+Tab from first to last", async () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    await settle();
    const dialog = screen.getByRole("dialog", { hidden: true });
    const focusable = dialog.querySelectorAll("button, input");
    const firstFocusable = focusable[0] as HTMLElement;
    const lastFocusable = focusable[focusable.length - 1] as HTMLElement;

    lastFocusable.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    await settle();
    expect(firstFocusable).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

    await settle();
    expect(lastFocusable).toHaveFocus();
  });
});

describe("ComposerChooser — target capture survives a selection change", () => {
  it("keeps adding to the target captured at open time even after the target prop changes while open", async () => {
    resetFixtureIds();
    const onAdd = vi.fn();
    const document = makeAbcDocument();

    function Harness() {
      const target = signal<InsertionTarget>(rightTarget);
      return (
        <>
          <button type="button" on:click={() => { target.value = rootTarget; }}>
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

    await settle();
    expect(screen.getByRole("heading", { name: "Add to Split Layout › Right" })).toBeInTheDocument();

    // Simulate a selection change elsewhere in the app redirecting the live
    // `target` prop WHILE the dialog is still open.
    fireEvent.click(screen.getByRole("button", { name: "Simulate selection change" }));
    await settle();
    expect(screen.getByRole("heading", { name: "Add to Split Layout › Right" })).toBeInTheDocument();
    expect(screen.queryByText("Document root")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Box/ }));

    await settle();
    expect(onAdd).toHaveBeenCalledWith(rightTarget, FIXTURE_IDS.box);
    expect(onAdd).not.toHaveBeenCalledWith(rootTarget, expect.anything());
  });

  it("uses a shared terminal session's freshly resolved end target and completes with the inserted id", async () => {
    const currentEnd = { ...rightTarget, index: 3 };
    const onAdd = vi.fn(() => ({ status: "inserted" as const, nodeId: "new-node" }));
    const onComplete = vi.fn();
    render(<ComposerChooser {...baseProps({ onAdd, onComplete, resolveTarget: () => currentEnd })} />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /^Box/ }));

    await settle();

    expect(onAdd).toHaveBeenCalledWith(currentEnd, FIXTURE_IDS.box);
    expect(onComplete).toHaveBeenCalledWith("new-node");
  });
});

describe("ComposerChooser — search / category / constraint filters", () => {
  it("shows the destination label and every eligible component with a result count", async () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    await settle();
    expect(screen.getByRole("heading", { name: "Add to Split Layout › Right" })).toBeInTheDocument();
    expect(screen.getByText(/\d+ of \d+ components?/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Box/ })).toBeInTheDocument();
  });

  it("filters the accepts-restricted gallery slot down to Box only", async () => {
    const document = makeAbcDocument();
    document.root.push({
      id: "gallery",
      componentId: FIXTURE_IDS.gallery,
      componentVersion: 1,
      props: {},
      slots: { items: [] },
    });
    const props = baseProps({ document, target: { parentId: "gallery", slotId: "items", index: 0 } });
    const { container } = render(<ComposerChooser {...props} />);
    await settle();
    const allowed = within(container.ownerDocument.querySelector<HTMLElement>(".sg-composer-chooser-grid")!);
    expect(allowed.getByRole("button", { name: /^Box/ })).toBeInTheDocument();
    expect(allowed.queryByRole("button", { name: /^Stack/ })).not.toBeInTheDocument();
    expect(allowed.queryByRole("button", { name: /^Button/ })).not.toBeInTheDocument();
  });

  it("blocks a chooser opened on an already-occupied single-cardinality slot", async () => {
    const props = baseProps({ target: { parentId: "split", slotId: "left", index: 1 } });
    render(<ComposerChooser {...props} />);
    await settle();
    expect(screen.getByText(/already has a component/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Box/ })).not.toBeInTheDocument();
  });

  it("search narrows the result list and shows an empty state with a clear-filters action for no matches", async () => {
    const props = baseProps({ target: rootTarget });
    render(<ComposerChooser {...props} />);
    await settle();
    const search = screen.getByPlaceholderText("Search components…");

    fireEvent.input(search, { target: { value: "box" } });

    await settle();
    expect(screen.getByRole("button", { name: /^Box/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Button/ })).not.toBeInTheDocument();

    fireEvent.input(search, { target: { value: "zzz-no-match" } });

    await settle();
    expect(screen.getByText(/No matching components/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await settle();
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: /^Box/ })).toBeInTheDocument();
  });

  it("category filters narrow the list and are keyboard-activatable buttons", async () => {
    const props = baseProps({ target: rootTarget });
    render(<ComposerChooser {...props} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    await settle();
    expect(screen.getByRole("button", { name: /^Button/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Box/ })).not.toBeInTheDocument();
  });
});

const categoryRootPolicy: RootPolicy = {
  kind: "resolved",
  accepts: [FIXTURE_IDS.gallery, FIXTURE_IDS.box, FIXTURE_IDS.text],
  cardinality: "many",
  max: 2,
  origin: {
    componentId: FIXTURE_IDS.stack,
    componentTitle: "Stack",
    slotId: "content",
    slotLabel: "Content",
    viaTemplate: { sourceName: "Site shell", outletLabel: "Main content" },
  },
};

function boundProps(rootCount = 0) {
  const nodes = Array.from({ length: rootCount }, (_, index) => fixtureNode(FIXTURE_IDS.box, {}, {}, `root-${index}`));
  const document = { ...fixtureDocument(nodes), binding: { sourceRecordId: "source-template", outletId: "main" } };
  return baseProps({ document, target: { ...rootTarget, index: rootCount }, rootPolicy: categoryRootPolicy });
}

function hiddenDisclosure(): HTMLDetailsElement | null {
  return document.querySelector<HTMLDetailsElement>(".sg-composer-chooser-hidden");
}

describe("ComposerChooser — restricted target rule", () => {
  it("renders no rule header, allowed section, disclosure, or footer note for an open target", async () => {
    render(<ComposerChooser {...baseProps()} />);
    await settle();
    expect(document.querySelector("[data-chooser-rule]")).toBeNull();
    expect(screen.queryByText("Allowed here")).not.toBeInTheDocument();
    expect(hiddenDisclosure()).toBeNull();
    expect(screen.queryByText(/Rule applies because/)).not.toBeInTheDocument();
    expect(document.querySelector(".sg-composer-chooser-rule-badge")).toBeNull();
  });

  it("shows the rule header with one chip per allowed kind in rule order and its source", async () => {
    render(<ComposerChooser {...boundProps()} />);
    await settle();
    expect(screen.getByRole("heading", { name: "Add to Main content" })).toBeInTheDocument();
    const header = document.querySelector<HTMLElement>("[data-chooser-rule]")!;
    expect(header).toHaveTextContent("This region accepts 3 kinds");
    const chips = within(within(header).getByRole("list", { name: "Allowed components" })).getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Gallery", "Box", "Text"]);
    expect(header).toHaveTextContent("rule from Stack › Content · template Site shell");
    expect(screen.getByText("Rule applies because this page is bound to the Site shell template.")).toBeInTheDocument();
  });

  it("lists allowed cards with a count badge, badges kinds with their own rule, and discloses the hidden rest", async () => {
    render(<ComposerChooser {...boundProps()} />);
    await settle();
    expect(screen.getByText("Allowed here").querySelector(".cms-count-badge")).toHaveTextContent("3");
    const badges = [...document.querySelectorAll(".sg-composer-chooser-rule-badge")];
    expect(badges).toHaveLength(1);
    expect(badges[0]!.closest("li")).toHaveTextContent("Gallery");

    const disclosure = hiddenDisclosure()!;
    expect(disclosure.open).toBe(false);
    // The rule's own container (Stack) is never listed as hidden.
    expect(disclosure.querySelector("summary")).toHaveTextContent(
      "2 hidden by this region's rule — shown so you know they exist, not offered",
    );
    const rows = within(disclosure).getAllByRole("button");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["Split Layout", "Button"]);
    expect(rows[0]).toHaveTextContent("not in Stack › Content");
  });

  it("falls search through to hidden rows by opening the disclosure instead of an empty state", async () => {
    render(<ComposerChooser {...boundProps()} />);
    await settle();
    const search = screen.getByPlaceholderText("Search components…");
    fireEvent.input(search, { target: { value: "button" } });
    await settle();
    expect(hiddenDisclosure()!.open).toBe(true);
    expect(within(hiddenDisclosure()!).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/No matching components/)).not.toBeInTheDocument();

    fireEvent.input(search, { target: { value: "zzz-no-match" } });

    await settle();
    expect(hiddenDisclosure()).toBeNull();
    expect(screen.getByText(/No matching components/)).toBeInTheDocument();
  });

  it("previews a selected hidden row with the not-offered note while Insert stays disabled", async () => {
    const props = boundProps();
    render(<ComposerChooser {...props} />);
    await settle();
    fireEvent.click(within(hiddenDisclosure()!).getByRole("button", { name: "Button" }));
    await settle();

    expect(screen.getByRole("heading", { name: "Button", level: 3 })).toBeInTheDocument();
    expect(screen.getByText(/^Not offered here\./)).toHaveTextContent(
      "Not offered here. Main content is Stack › Content, which accepts Gallery, Box, Text. "
        + "To allow Button on Site shell pages, add `test.button` to that slot's `accepts` in the host's component source.",
    );
    expect(screen.getByRole("button", { name: "Insert" })).toBeDisabled();
    expect(props.onAdd).not.toHaveBeenCalled();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Box" }));

    await settle();
    expect(screen.queryByText(/^Not offered here\./)).not.toBeInTheDocument();
  });

  it("keeps the blocked banner for a full slot, naming its bound", async () => {
    render(<ComposerChooser {...boundProps(2)} />);
    await settle();
    expect(screen.getByText("This slot is full (max 2).")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Box" })).not.toBeInTheDocument();
    expect(hiddenDisclosure()).toBeNull();
  });
});

describe("ComposerChooser — Enter / Escape and successful add", () => {
  it("Enter in the search field adds the sole matching result", async () => {
    const props = baseProps({ target: rootTarget });
    render(<ComposerChooser {...props} />);
    await settle();
    const search = screen.getByPlaceholderText("Search components…");
    fireEvent.input(search, { target: { value: "gallery" } });
    await settle();
    fireEvent.keyDown(search, { key: "Enter" });
    await settle();
    expect(props.onAdd).toHaveBeenCalledWith(rootTarget, FIXTURE_IDS.gallery);
  });

  it("choosing a component adds to the captured target, expands ancestors, and closes", async () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Box/ }));
    await settle();
    expect(props.onAdd).toHaveBeenCalledWith(rightTarget, FIXTURE_IDS.box);
    expect(props.onExpandAncestors).toHaveBeenCalledWith(["split"]);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("announces a status message after a successful add", async () => {
    const props = baseProps();
    render(<ComposerChooser {...props} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Box/ }));
    await settle();
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
    await settle();

    expect(screen.getByRole("button", { name: "Components" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Patterns" }));
    await settle();
    expect(screen.getByRole("button", { name: "Patterns" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Feature row/ })).toHaveTextContent("2 roots · 2 nodes");

    fireEvent.click(screen.getByRole("button", { name: /^Feature row/ }));

    await settle();
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
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Patterns" }));

    await settle();
    const search = screen.getByPlaceholderText("Search Patterns…") as HTMLInputElement;
    fireEvent.input(search, { target: { value: "feature" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Feature row/ }));
    await settle();
    await waitFor(() => expect(screen.getByRole("button", { name: "Insert Pattern" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Insert Pattern" }));
    await settle();

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
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Patterns" }));

    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Feature row/ }));
    await settle();
    await waitFor(() => expect(screen.getByText(/no longer published as a Pattern/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Insert Pattern" })).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe("ComposerChooser — live preview pane (issue #254)", () => {
  it("shows an empty-state hint before the first hover/focus", async () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({ previewCreateBridge: harness.createBridge, previewLocation: harness.location });
    render(<ComposerChooser {...props} />);
    await settle();
    expect(screen.getByText(/Hover or focus a component to preview it here/)).toBeInTheDocument();
    harness.deliverReady();
    await settle();
    expect(harness.posts).toHaveLength(0);
  });

  it("hovering a catalog card renders it (defaults) in the SECOND, dedicated preview iframe", async () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({ previewCreateBridge: harness.createBridge, previewLocation: harness.location });
    render(<ComposerChooser {...props} />);
    await settle();
    harness.deliverReady();
    await settle();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Box/ }));

    await settle();
    expect(harness.posts).toHaveLength(1);
    const message = harness.posts[0]!.message as {
      type: string;
      document: { root: { componentId: string }[] };
      session: { mode: string };
    };
    expect(message.type).toBe("render");
    expect(message.document.root[0]!.componentId).toBe(FIXTURE_IDS.box);
    const previewTitle = screen.getByRole("heading", { name: "Box", level: 3 });
    expect(previewTitle.closest(".sg-composer-chooser-preview-stage")).toBeNull();
    expect(previewTitle.parentElement?.querySelector(".sg-composer-chooser-preview-description"))
      .toHaveTextContent(fixtureCatalog.find((entry) => entry.id === FIXTURE_IDS.box)!.description);
    // Non-interactive: the preview never enters "edit" session mode.
    expect(message.session.mode).toBe("preview");
    expect(screen.queryByText(/Hover or focus a component/)).not.toBeInTheDocument();
  });

  it("keyboard-focusing a catalog card ALSO updates the preview target", async () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({
      target: rootTarget,
      previewCreateBridge: harness.createBridge,
      previewLocation: harness.location,
    });
    render(<ComposerChooser {...props} />);
    await settle();
    harness.deliverReady();
    await settle();

    fireEvent.focus(screen.getByRole("button", { name: /^Text/ }));

    await settle();
    expect(harness.posts).toHaveLength(1);
    const message = harness.posts[0]!.message as { document: { root: { componentId: string }[] } };
    expect(message.document.root[0]!.componentId).toBe(FIXTURE_IDS.text);
    expect(screen.getByRole("heading", { name: "Text", level: 3 })).toBeInTheDocument();
  });

  it("is sticky: the previewed entry survives mouseleave, and is only replaced by the NEXT hover/focus", async () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({
      target: rootTarget,
      previewCreateBridge: harness.createBridge,
      previewLocation: harness.location,
    });
    render(<ComposerChooser {...props} />);
    await settle();
    harness.deliverReady();
    await settle();

    const boxCard = screen.getByRole("button", { name: /^Box/ });
    fireEvent.mouseEnter(boxCard);
    await settle();
    expect(harness.posts).toHaveLength(1);

    fireEvent.mouseLeave(boxCard);

    await settle();
    expect(harness.posts).toHaveLength(1); // no clear-on-leave
    expect(screen.getByRole("heading", { name: "Box", level: 3 })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Button/ }));

    await settle();
    expect(harness.posts).toHaveLength(2);
    const latest = harness.posts.at(-1)!.message as { document: { root: { componentId: string }[] } };
    expect(latest.document.root[0]!.componentId).toBe(FIXTURE_IDS.button);
  });

  it("a hovered CONTAINER entry's preview includes a PlaceholderBox child in every declared slot", async () => {
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
    await settle();
    harness.deliverReady();
    await settle();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Split Layout/ }));

    await settle();
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

  it("a leaf entry's preview carries no slot children", async () => {
    const harness = makeChooserPreviewBridgeHarness(fixtureComponentProvider.manifest);
    const props = baseProps({ previewCreateBridge: harness.createBridge, previewLocation: harness.location });
    render(<ComposerChooser {...props} />);
    await settle();
    harness.deliverReady();
    await settle();

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Box/ }));

    await settle();
    const message = harness.posts[0]!.message as { document: { root: { slots: Record<string, unknown> }[] } };
    expect(message.document.root[0]!.slots).toEqual({});
  });
});


describe("chooser card and list views", () => {
  beforeEach(() => localStorage.removeItem("zudo-composer.chooser.view"));
  afterEach(() => { vi.restoreAllMocks(); localStorage.removeItem("zudo-composer.chooser.view"); });

  it("defaults to cards and persists list across mounts", async () => {
    const first = render(<ComposerChooser {...baseProps()} />);
    await settle();
    expect(screen.getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    await settle();
    expect(first.container.querySelector(".sg-composer-chooser-grid")).toBeNull();
    expect(localStorage.getItem("zudo-composer.chooser.view")).toBe("list");
    first.unmount();
    render(<ComposerChooser {...baseProps()} />);
    await settle();
    expect(screen.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
  });

  it("defaults invalid storage to cards and tolerates denied reads and writes", async () => {
    localStorage.setItem("zudo-composer.chooser.view", "unknown");
    const first = render(<ComposerChooser {...baseProps()} />);
    await settle();
    expect(screen.getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
    first.unmount();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    render(<ComposerChooser {...baseProps()} />);
    await settle();
    expect(screen.getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    await settle();
    expect(screen.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps exact result names and truthful counts in both views", async () => {
    render(<ComposerChooser {...baseProps({ target: rootTarget, document: fixtureDocument([]), componentProvider: activeComponentProvider, manifest: activeComponentProvider.catalog, entries: activeComponentProvider.manifest.components })} />);
    await settle();
    for (const view of ["Cards", "List", "Cards"]) {
      fireEvent.click(screen.getByRole("radio", { name: view }));
      await settle();
      for (const entry of activeComponentProvider.manifest.components) expect(screen.getAllByRole("button", { name: entry.title })).toHaveLength(1);
      expect(screen.getByText("12 of 12 components")).toBeInTheDocument();
    }
  });

  it("preserves search, category, target, and sticky preview across toggles and empty states", async () => {
    const supplied = baseProps();
    render(<ComposerChooser {...supplied} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Content" }));
    await settle();
    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "Box" } });
    await settle();
    fireEvent.focus(screen.getByRole("button", { name: "Box" }));
    await settle();
    const heading = screen.getByRole("dialog").getAttribute("aria-labelledby");
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    await settle();
    expect(screen.getByRole("searchbox")).toHaveValue("Box");
    expect(screen.getByRole("button", { name: "Content" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Box" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-labelledby", heading);
    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "no matches" } });
    await settle();
    fireEvent.click(screen.getByRole("radio", { name: "Cards" }));
    await settle();
    expect(screen.getByText("0 of 6 components")).toBeInTheDocument();
    expect(screen.getByText("No matching components")).toBeInTheDocument();
    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "Box" } });
    await settle();
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    await settle();
    expect(supplied.onAdd).toHaveBeenCalledWith(rightTarget, FIXTURE_IDS.box);
  });

  it("routes search arrows to scoped results and updates the sticky preview in either view", async () => {
    render(<ComposerChooser {...baseProps()} />);
    await settle();
    for (const view of ["Cards", "List"]) {
      fireEvent.click(screen.getByRole("radio", { name: view }));
      await settle();
      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowDown" });
      await settle();
      expect(screen.getByRole("button", { name: "Split Layout" })).toHaveFocus();
      expect(screen.getByRole("heading", { name: "Split Layout" })).toBeInTheDocument();
      fireEvent.mouseEnter(screen.getByRole("button", { name: "Box" }));
      await settle();
      fireEvent.mouseLeave(screen.getByRole("button", { name: "Box" }));
      await settle();
      expect(screen.getByRole("heading", { name: "Box" })).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("searchbox"), { key: "ArrowUp" });
      await settle();
      expect(screen.getByRole("button", { name: "Button" })).toHaveFocus();
    }
  });

  it("unmounts all thumbnails on list, Patterns, and close", async () => {
    const open = signal(true);
    const supplied = baseProps({ open });
    const { container } = render(<ComposerChooser {...supplied} />);
    await settle();
    const thumbs = () => container.querySelectorAll(".sg-composer-chooser-thumb iframe");
    await waitFor(() => expect(thumbs()).toHaveLength(4));
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    await settle();
    expect(thumbs()).toHaveLength(0);
    fireEvent.click(screen.getByRole("radio", { name: "Cards" }));
    await settle();
    await waitFor(() => expect(thumbs()).toHaveLength(4));
    fireEvent.click(screen.getByRole("button", { name: "Patterns" }));
    await settle();
    expect(thumbs()).toHaveLength(0);
    expect(screen.queryByRole("radiogroup", { name: "Component view" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Components" }));
    await settle();
    await waitFor(() => expect(thumbs()).toHaveLength(4));
    open.value = false;
    await settle();
    expect(thumbs()).toHaveLength(0);
  });
});
