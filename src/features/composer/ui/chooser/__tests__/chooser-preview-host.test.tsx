/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
// `ChooserPreviewHost` — issue #254's ephemeral second preview iframe/bridge.
//
// `buildChooserPreviewDocument` is tested directly as a pure function (the
// container-slot-placeholder acceptance criterion). The component itself is
// exercised against the REAL #248 bridge, wired through a local
// recording-frame/deliverable-host harness (no live iframe) — proving the
// non-interactive session mode, the single-node/slot-placeholder document it
// actually sends, and that its bridge is a fully independent instance (its
// own posts, its own dispose on unmount).

import { describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { render, screen } from "@testing-library/preact";
import type { ComponentManifest } from "@zudo-composer/component-contract";
import { COMPOSITION_SCHEMA_VERSION } from "../../../../../composer";
import {
  ChooserPreviewHost,
  CHOOSER_PREVIEW_PLACEHOLDER_ID,
  buildChooserPreviewDocument,
} from "../chooser-preview-host";
import { makeChooserPreviewBridgeHarness } from "./preview-bridge-test-harness";

function src(exportName: string): ComponentManifest["source"] {
  return { module: `@fixtures/${exportName.toLowerCase()}`, exportKind: "named", exportName };
}

const placeholderEntry: ComponentManifest = {
  id: CHOOSER_PREVIEW_PLACEHOLDER_ID,
  schemaVersion: 3,
  title: "Placeholder Box",
  category: "Media",
  description: "Labeled image stand-in.",
  source: src("PlaceholderBox"),
  defaults: { label: "hero-image.png", aspect: "16/9" },
  fields: [],
  slots: [],
};

const leafEntry: ComponentManifest = {
  id: "test.box",
  schemaVersion: 1,
  title: "Box",
  category: "Content",
  description: "A generic content leaf.",
  source: src("Box"),
  defaults: { label: "Box" },
  fields: [],
  slots: [],
};

const containerEntry: ComponentManifest = {
  id: "test.split",
  schemaVersion: 2,
  title: "Split Layout",
  category: "Layout",
  description: "Two-column layout with named left/right slots.",
  source: src("SplitLayout"),
  defaults: { ratio: "50-50" },
  fields: [],
  slots: [
    { id: "left", prop: "left", label: "Left", cardinality: "single" },
    { id: "right", prop: "right", label: "Right", cardinality: "many" },
  ],
};

const catalogById = new Map<string, ComponentManifest>(
  [placeholderEntry, leafEntry, containerEntry].map((entry) => [entry.id, entry]),
);

describe("buildChooserPreviewDocument — pure document builder", () => {
  it("a leaf entry (no declared slots) renders bare: its componentId/defaults, no slot children", () => {
    const doc = buildChooserPreviewDocument(leafEntry, catalogById);
    expect(doc.root).toHaveLength(1);
    const root = doc.root[0]!;
    expect(root.componentId).toBe("test.box");
    expect(root.componentVersion).toBe(1);
    expect(root.props).toEqual({ label: "Box" });
    expect(root.slots).toEqual({});
  });

  it("a container entry gets a PlaceholderBox child in EVERY declared slot", () => {
    const doc = buildChooserPreviewDocument(containerEntry, catalogById);
    const root = doc.root[0]!;
    expect(root.componentId).toBe("test.split");
    expect(root.props).toEqual({ ratio: "50-50" });
    expect(Object.keys(root.slots).sort()).toEqual(["left", "right"]);
    for (const slotId of ["left", "right"]) {
      const children = root.slots[slotId]!;
      expect(children).toHaveLength(1);
      expect(children[0]!.componentId).toBe(CHOOSER_PREVIEW_PLACEHOLDER_ID);
      expect(children[0]!.componentVersion).toBe(placeholderEntry.schemaVersion);
      expect(children[0]!.props).toEqual(placeholderEntry.defaults);
      expect(children[0]!.slots).toEqual({});
    }
    // Distinct node ids per slot (never a shared/duplicated node reference).
    expect(root.slots.left![0]!.id).not.toBe(root.slots.right![0]!.id);
  });

  it("falls back to an empty slot when the catalog has no PlaceholderBox entry (defensive — never true against the real manifest)", () => {
    const noPlaceholder = new Map(catalogById);
    noPlaceholder.delete(CHOOSER_PREVIEW_PLACEHOLDER_ID);
    const doc = buildChooserPreviewDocument(containerEntry, noPlaceholder);
    expect(doc.root[0]!.slots.left).toEqual([]);
    expect(doc.root[0]!.slots.right).toEqual([]);
  });
});

function mount(entry: ComponentManifest | null) {
  const harness = makeChooserPreviewBridgeHarness();
  const utils = render(
    <ChooserPreviewHost
      entry={entry}
      catalogById={catalogById}
      createBridge={harness.createBridge}
      location={harness.location}
    />,
  );
  return { harness, ...utils };
}

describe("ChooserPreviewHost — empty state before first hover", () => {
  it("shows the empty-state hint and sends nothing, even after the iframe becomes ready", () => {
    const { harness } = mount(null);
    expect(screen.getByText(/Hover or focus a component to preview it here/)).toBeInTheDocument();
    act(() => harness.deliverReady());
    expect(harness.posts).toHaveLength(0);
  });
});

describe("ChooserPreviewHost — live document over its OWN bridge", () => {
  it("renders a fully loaded multi-root Pattern source unchanged through the isolated bridge", () => {
    const harness = makeChooserPreviewBridgeHarness();
    const source = {
      schemaVersion: COMPOSITION_SCHEMA_VERSION,
      id: "feature-pattern",
      name: "Feature row",
      publication: { kind: "pattern" as const },
      root: [
        { id: "pattern-one", componentId: leafEntry.id, componentVersion: leafEntry.schemaVersion, props: {}, slots: {} },
        { id: "pattern-two", componentId: leafEntry.id, componentVersion: leafEntry.schemaVersion, props: {}, slots: {} },
      ],
    };
    render(
      <ChooserPreviewHost
        entry={null}
        sourceDocument={source}
        label="Pattern preview"
        catalogById={catalogById}
        createBridge={harness.createBridge}
        location={harness.location}
      />,
    );

    act(() => harness.deliverReady());
    expect(harness.posts).toHaveLength(1);
    const posted = harness.posts[0]!.message as { document: typeof source; session: { mode: string } };
    expect(posted.document).toBe(source);
    expect(posted.document.root.map((node) => node.id)).toEqual(["pattern-one", "pattern-two"]);
    expect(posted.session.mode).toBe("preview");
  });

  it("sends a single-node render for the previewed entry, addressed to the exact preview origin", () => {
    const { harness } = mount(leafEntry);
    act(() => harness.deliverReady());
    expect(harness.posts).toHaveLength(1);
    const posted = harness.posts[0]!;
    expect(posted.targetOrigin).toBe(harness.location.targetOrigin);
    const message = posted.message as { type: string; document: { root: unknown[] }; session: unknown };
    expect(message.type).toBe("render");
    expect(message.document.root).toHaveLength(1);
    // Non-interactive: always "preview" mode, never "edit".
    expect(message.session).toMatchObject({ mode: "preview", selectedId: null });
  });

  it("re-renders when the previewed entry changes (still one bridge instance, one growing post log)", () => {
    const { harness, rerender } = mount(leafEntry);
    act(() => harness.deliverReady());
    expect(harness.posts).toHaveLength(1);

    rerender(
      <ChooserPreviewHost
        entry={containerEntry}
        catalogById={catalogById}
        createBridge={harness.createBridge}
        location={harness.location}
      />,
    );
    expect(harness.posts).toHaveLength(2);
    const latest = harness.posts.at(-1)!.message as { document: { root: { componentId: string }[] } };
    expect(latest.document.root[0]!.componentId).toBe("test.split");
  });

  it("clears the empty-state hint once an entry is previewed", () => {
    const { harness, rerender } = mount(null);
    expect(screen.getByText(/Hover or focus a component/)).toBeInTheDocument();
    rerender(
      <ChooserPreviewHost
        entry={leafEntry}
        catalogById={catalogById}
        createBridge={harness.createBridge}
        location={harness.location}
      />,
    );
    expect(screen.queryByText(/Hover or focus a component/)).not.toBeInTheDocument();
  });
});

describe("ChooserPreviewHost — bridge lifecycle is fully independent", () => {
  it("disposes its OWN bridge on unmount, never affecting a second, separately-mounted harness", () => {
    const disposeSpy = vi.fn();
    const harness = makeChooserPreviewBridgeHarness();
    const spyingCreateBridge: typeof harness.createBridge = (options) => {
      const bridge = harness.createBridge(options);
      return { ...bridge, dispose: () => (disposeSpy(), bridge.dispose()) };
    };
    const { unmount } = render(
      <ChooserPreviewHost
        entry={leafEntry}
        catalogById={catalogById}
        createBridge={spyingCreateBridge}
        location={harness.location}
      />,
    );
    expect(disposeSpy).not.toHaveBeenCalled();
    unmount();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
