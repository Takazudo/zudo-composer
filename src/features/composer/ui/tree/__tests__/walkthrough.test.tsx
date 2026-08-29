/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
// End-to-end proof that ComposerTree + ComposerChooser satisfy the epic's
// fixed "A/B/C right-column" walkthrough (#243) through nothing but their own
// typed callbacks — no central host file (controller, app entry, route shell)
// is touched. This harness wires the two components to the Composer core's public
// commands (addNode/reorderNode/removeNode — CONSUMED, not redefined, per
// #250's brief) with local `useState`, standing in for what wave-5
// integration (#251) will do for real against `useComposerController`.

import { useMemo, useState } from "preact/hooks";
import { describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/preact";
import type { CompositionDocument, InsertionTarget } from "../../../../../composer";
import {
  addNode,
  COMPOSITION_SCHEMA_VERSION,
  createComponentCatalog,
  createSequentialIdFactory,
  removeNode,
  reorderNode,
} from "../../../../../composer";
import { ComposerTree } from "../composer-tree";
import { ComposerChooser } from "../../chooser/composer-chooser";
import { ancestorChainIds } from "../tree-helpers";
import { fixtureCatalog, fixturePackManifest } from "./fixtures";

function emptyDocument(): CompositionDocument {
  return { schemaVersion: COMPOSITION_SCHEMA_VERSION, id: "walkthrough", name: "Walkthrough", root: [] };
}

function Harness() {
  const [document, setDocument] = useState<CompositionDocument>(emptyDocument());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const [chooser, setChooser] = useState<{ open: boolean; target: InsertionTarget | null }>({
    open: false,
    target: null,
  });

  // Both must be STABLE across Harness re-renders (a fresh idFactory per
  // render would restart its counter and mint colliding ids).
  const manifestIndex = useMemo(() => createComponentCatalog(fixturePackManifest), []);
  const idFactory = useMemo(() => createSequentialIdFactory("n"), []);

  function expandIds(ids: string[]) {
    setExpandedIds((prev) => new Set([...prev, ...ids]));
  }

  return (
    <>
      <ComposerTree
        document={document}
        manifest={manifestIndex}
        entries={fixtureCatalog}
        selectedId={selectedId}
        expandedIds={expandedIds}
        onSelect={setSelectedId}
        onReveal={(id) => {
          setSelectedId(id);
          expandIds(ancestorChainIds(document, manifestIndex, id));
        }}
        onToggleExpanded={(id) =>
          setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onOpenChooser={(target) => setChooser({ open: true, target })}
        onReorder={(nodeId, direction) => {
          const result = reorderNode(document, manifestIndex, nodeId, direction);
          if (result.ok) {
            setDocument(result.document);
            setSelectedId(result.selectedId);
          }
        }}
        onRemove={(nodeId) => {
          const result = removeNode(document, manifestIndex, nodeId, selectedId);
          if (result.ok) {
            setDocument(result.document);
            setSelectedId(result.selectedId);
          }
        }}
        onOpenNodeMenu={() => undefined}
        onOpenInsertMenu={() => undefined}
      />
      <ComposerChooser
        open={chooser.open}
        target={chooser.target}
        document={document}
        manifest={manifestIndex}
        entries={fixtureCatalog}
        onAdd={(target, componentId) => {
          const result = addNode(document, manifestIndex, target, componentId, idFactory);
          if (result.ok) {
            setDocument(result.document);
            setSelectedId(result.selectedId);
          }
        }}
        onExpandAncestors={expandIds}
        onClose={() => setChooser({ open: false, target: null })}
      />
    </>
  );
}

/**
 * Both the tree and the (unrestricted) chooser can show a button named e.g.
 * "Split Layout" or "Box" at the same time — the tree row and the catalog
 * card. Every interaction below is explicitly scoped to one region or the
 * other so a click always hits the intended element.
 */
function regions(container: Element) {
  return {
    tree: () => container.querySelector(".sg-composer-tree") as HTMLElement,
    dialog: () => container.querySelector("dialog") as HTMLElement,
  };
}

describe("Structure rail + chooser — the A/B/C right-column walkthrough", () => {
  it("builds a two-column composition with A in left and B then C in right, through typed callbacks only", () => {
    const { container } = render(<Harness />);
    const { tree, dialog } = regions(container);

    // 1) Add a two-column component (Split Layout) to the virtual document root.
    fireEvent.click(within(tree()).getByRole("button", { name: "Add component to document root" }));
    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name: "Split Layout" }));
    const splitId = tree().querySelector('[data-sg-tree-node-id]')!.getAttribute("data-sg-tree-node-id")!;
    expect(within(tree()).getByText("Split Layout")).toBeInTheDocument();

    // Expand the newly added Split Layout to reach its named slots.
    fireEvent.click(within(tree()).getByRole("button", { name: /expand split layout/i }));

    // 2) Add one component (Box) to its left slot.
    fireEvent.click(within(tree()).getByRole("button", { name: /Add component to Left in Split Layout/i }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Box" }));

    // 3) Add B then C to its right slot, in that order.
    fireEvent.click(within(tree()).getByRole("button", { name: /Add component to Right in Split Layout/i }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Box" }));
    fireEvent.click(within(tree()).getByRole("button", { name: /Add component to Right in Split Layout/i }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Box" }));

    // The named-slot hierarchy/order in the tree matches the walkthrough:
    // left has exactly one child, right has exactly two, in insertion order.
    const leftSlot = tree().querySelector('[data-sg-tree-slot-id="left"]')!;
    const rightSlot = tree().querySelector('[data-sg-tree-slot-id="right"]')!;
    const leftIds = [...leftSlot.querySelectorAll("[data-sg-tree-node-id]")].map((el) =>
      el.getAttribute("data-sg-tree-node-id"),
    );
    const rightIds = [...rightSlot.querySelectorAll("[data-sg-tree-node-id]")].map((el) =>
      el.getAttribute("data-sg-tree-node-id"),
    );
    expect(leftIds).toHaveLength(1);
    expect(rightIds).toHaveLength(2);

    const [bId, cId] = rightIds;

    // 4) Move C up — sibling reorder within the right slot only. Both Box
    // rows share an identical display name (the default "label" prop), so
    // scope the query to C's own row rather than relying on aria-label text.
    const cRow = tree().querySelector(`[data-sg-tree-node-id="${cId}"]`) as HTMLElement;
    fireEvent.click(within(cRow).getByRole("button", { name: /^Move .* up$/ }));

    const rightIdsAfterMove = [
      ...tree().querySelector('[data-sg-tree-slot-id="right"]')!.querySelectorAll("[data-sg-tree-node-id]"),
    ].map((el) => el.getAttribute("data-sg-tree-node-id"));
    expect(rightIdsAfterMove).toEqual([cId, bId]);

    // Move it back down to restore B-then-C for the rest of the walkthrough.
    fireEvent.click(within(cRow).getByRole("button", { name: /^Move .* down$/ }));
    const rightIdsRestored = [
      ...tree().querySelector('[data-sg-tree-slot-id="right"]')!.querySelectorAll("[data-sg-tree-node-id]"),
    ].map((el) => el.getAttribute("data-sg-tree-node-id"));
    expect(rightIdsRestored).toEqual([bId, cId]);

    // 5) Remove the whole Split Layout subtree — requires explicit confirmation.
    fireEvent.click(within(tree()).getByRole("button", { name: /^Remove Split Layout/ }));
    expect(within(tree()).getByText(/Remove Split Layout and its 3 nested components\?/)).toBeInTheDocument();
    fireEvent.click(within(tree()).getByRole("button", { name: "Confirm removal" }));

    // After removal, selection clears to the virtual-root context and the
    // document root is empty again.
    expect(within(tree()).getByText("Empty document — add a component to get started.")).toBeInTheDocument();
    expect(splitId).toBeTruthy();
  });

  it("cancelling the chooser makes no document mutation", () => {
    const { container } = render(<Harness />);
    const { tree, dialog } = regions(container);
    fireEvent.click(within(tree()).getByRole("button", { name: "Add component to document root" }));
    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(tree().querySelectorAll("[data-sg-tree-node-id]")).toHaveLength(0);
    expect(within(tree()).getByText("Empty document — add a component to get started.")).toBeInTheDocument();
  });

  it("chooser target capture is not redirected by a tree selection change made while it is open", () => {
    const { container } = render(<Harness />);
    const { tree, dialog } = regions(container);

    // Seed a Split Layout with a Box already in `left`.
    fireEvent.click(within(tree()).getByRole("button", { name: "Add component to document root" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Split Layout" }));
    fireEvent.click(within(tree()).getByRole("button", { name: /expand split layout/i }));
    fireEvent.click(within(tree()).getByRole("button", { name: /Add component to Left in Split Layout/i }));
    fireEvent.click(within(dialog() as HTMLElement).getByRole("button", { name: "Box" }));

    // Open the chooser for the RIGHT slot, then — while it's open — select a
    // different node IN THE TREE (the kind of thing a future canvas click
    // could also do). The chooser must still add to the captured right slot.
    fireEvent.click(within(tree()).getByRole("button", { name: /Add component to Right in Split Layout/i }));
    fireEvent.click(within(tree()).getByRole("button", { name: "Split Layout" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Box" }));

    const rightSlot = tree().querySelector('[data-sg-tree-slot-id="right"]')!;
    expect(rightSlot.querySelectorAll("[data-sg-tree-node-id]")).toHaveLength(1);
    const leftSlot = tree().querySelector('[data-sg-tree-slot-id="left"]')!;
    expect(leftSlot.querySelectorAll("[data-sg-tree-node-id]")).toHaveLength(1);
  });
});
