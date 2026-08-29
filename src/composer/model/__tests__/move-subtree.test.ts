// Tests for the drag-and-drop MOVE primitive (wave 9, issue #258): `moveSubtree`.
//
// The pure, mechanical relocation half of drag & drop — the COPY half composes
// `cloneSubtreeWithNewIds` + `insertSubtree` (see clone-insert-subtree.test.ts),
// and the opaque-node policy is layered on in the controller (see
// controller-model-drop.test.ts). These tests pin the two subtle, verified
// rules the prototype fixed: SAME-SLOT-ONLY index adjustment and the
// descendant-cycle guard.

import { describe, expect, it } from "vitest";
import { moveSubtree } from "../commands";
import { VIRTUAL_ROOT_SLOT_ID } from "../types";
import type { InsertionTarget } from "../types";
import { COMPONENT_IDS as C, SLOT_IDS as S } from "../../__tests__/fixtures";
import {
  FIXTURE_COMPONENT_IDS as X,
  doc,
  fixtureManifest as M,
  makeAbcDocument,
  node,
} from "../../__tests__/fixtures";

const rootTarget = (index: number): InsertionTarget => ({
  parentId: null,
  slotId: VIRTUAL_ROOT_SLOT_ID,
  index,
});

/** A flat Stack holding boxes a,b,c,d at the document root. */
function makeStackDocument() {
  return doc([
    node(
      C.stack,
      { gap: "md" },
      {
        [S.stackChildren]: [
          node(X.box, { label: "a" }, {}, "a"),
          node(X.box, { label: "b" }, {}, "b"),
          node(X.box, { label: "c" }, {}, "c"),
          node(X.box, { label: "d" }, {}, "d"),
        ],
      },
      "stack",
    ),
  ]);
}

const stackKids = (result: { document: ReturnType<typeof makeStackDocument> }) =>
  result.document.root[0].slots[S.stackChildren].map((n) => n.props.label);

describe("moveSubtree — same-slot index adjustment", () => {
  it("DOWN-shifts the index when the source sat BEFORE the destination (the verified adjustment)", () => {
    // Move a (index 0) to index 2 within [a,b,c,d]. Removing a leaves [b,c,d];
    // the raw target 2 must become 1, landing a between b and c → [b,a,c,d].
    const before = makeStackDocument();
    const target: InsertionTarget = { parentId: "stack", slotId: S.stackChildren, index: 2 };
    const result = moveSubtree(before, M, "a", target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stackKids(result)).toEqual(["b", "a", "c", "d"]);
    expect(result.selectedId).toBe("a");
    expect(result.changed).toBe(true);
  });

  it("does NOT adjust when the source sat AFTER the destination", () => {
    // Move d (index 3) to index 1 within [a,b,c,d]. Nothing before index 1
    // shifts, so d lands at 1 → [a,d,b,c].
    const before = makeStackDocument();
    const target: InsertionTarget = { parentId: "stack", slotId: S.stackChildren, index: 1 };
    const result = moveSubtree(before, M, "d", target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stackKids(result)).toEqual(["a", "d", "b", "c"]);
  });

  it("a same-slot move to the source's own resolved position is a valid no-op (changed: false)", () => {
    // Move b (index 1) to index 2: adjusted 2→1 === source index → no change.
    const before = makeStackDocument();
    const target: InsertionTarget = { parentId: "stack", slotId: S.stackChildren, index: 2 };
    const result = moveSubtree(before, M, "b", target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stackKids(result)).toEqual(["a", "b", "c", "d"]);
    expect(result.changed).toBe(false);
    expect(result.selectedId).toBe("b");
  });

  it("moving to the exact same index is a no-op too", () => {
    const before = makeStackDocument();
    const target: InsertionTarget = { parentId: "stack", slotId: S.stackChildren, index: 1 };
    const result = moveSubtree(before, M, "b", target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stackKids(result)).toEqual(["a", "b", "c", "d"]);
    expect(result.changed).toBe(false);
  });

  it("moves to the end of its own slot", () => {
    const before = makeStackDocument();
    const target: InsertionTarget = { parentId: "stack", slotId: S.stackChildren, index: 4 };
    const result = moveSubtree(before, M, "a", target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(stackKids(result)).toEqual(["b", "c", "d", "a"]);
  });
});

describe("moveSubtree — cross-slot moves (index adjustment must NOT apply)", () => {
  it("moves within ONE parent across slots (SplitLayout left→right) with NO index shift", () => {
    // A lives in `left` (index 0); move it into `right` (index 1). left and
    // right share the parent `split` but are different slots — so the raw
    // target index 1 is used verbatim: right [B,C] → [B,A,C].
    const before = makeAbcDocument();
    const target: InsertionTarget = { parentId: "split", slotId: S.splitRight, index: 1 };
    const result = moveSubtree(before, M, "A", target);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const split = result.document.root[0];
    expect(split.slots[S.splitLeft]).toHaveLength(0);
    expect(split.slots[S.splitRight].map((n) => n.props.label)).toEqual(["B", "A", "C"]);
    expect(result.selectedId).toBe("A");
  });

  it("moves a node up to a different parent's slot, carrying its whole subtree", () => {
    // split.right holds a Stack S (with a box) and box C. Move S out to the
    // virtual root at index 0.
    const before = doc([
      node(
        C.splitLayout,
        { ratio: "50-50", gap: "md" },
        {
          [S.splitLeft]: [node(X.box, { label: "A" }, {}, "A")],
          [S.splitRight]: [
            node(
              C.stack,
              { gap: "md" },
              { [S.stackChildren]: [node(X.box, { label: "inner" }, {}, "inner")] },
              "innerStack",
            ),
            node(X.box, { label: "C" }, {}, "C"),
          ],
        },
        "split",
      ),
    ]);
    const result = moveSubtree(before, M, "innerStack", rootTarget(0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root.map((n) => n.id)).toEqual(["innerStack", "split"]);
    // Its subtree came along.
    expect(result.document.root[0].slots[S.stackChildren][0].props.label).toBe("inner");
    // And it left the source slot.
    expect(result.document.root[1].slots[S.splitRight].map((n) => n.id)).toEqual(["C"]);
  });
});

describe("moveSubtree — root-target semantics", () => {
  it("moves a nested node out to the virtual root", () => {
    const before = makeAbcDocument();
    const result = moveSubtree(before, M, "B", rootTarget(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root.map((n) => n.id)).toEqual(["split", "B"]);
  });

  it("reorders within the virtual root with the same-slot adjustment", () => {
    const before = doc([
      node(X.box, {}, {}, "one"),
      node(X.box, {}, {}, "two"),
      node(X.box, {}, {}, "three"),
    ]);
    // Move `one` (index 0) to index 2 at root → adjusted to 1 → [two, one, three].
    const result = moveSubtree(before, M, "one", rootTarget(2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root.map((n) => n.id)).toEqual(["two", "one", "three"]);
  });

  it("rejects a virtual-root target with a non-root slot id", () => {
    const before = makeAbcDocument();
    const result = moveSubtree(before, M, "B", { parentId: null, slotId: "left", index: 0 });
    expect(result.ok).toBe(false);
  });
});

describe("moveSubtree — descendant-cycle guard", () => {
  it("rejects moving a node into its OWN subtree (would orphan the destination)", () => {
    // Move split into its own right slot — right is a descendant slot of split.
    const before = makeAbcDocument();
    const target: InsertionTarget = { parentId: "split", slotId: S.splitRight, index: 0 };
    const result = moveSubtree(before, M, "split", target);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/own subtree/i);
  });

  it("rejects moving a node under one of its DEEP descendants", () => {
    const before = doc([
      node(
        C.stack,
        {},
        {
          [S.stackChildren]: [
            node(
              C.stack,
              {},
              { [S.stackChildren]: [node(X.box, {}, {}, "leaf")] },
              "childStack",
            ),
          ],
        },
        "rootStack",
      ),
    ]);
    // Move rootStack under childStack (a descendant) → cycle.
    const target: InsertionTarget = { parentId: "childStack", slotId: S.stackChildren, index: 0 };
    const result = moveSubtree(before, M, "rootStack", target);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/own subtree/i);
  });

  it("moving a node into a SIBLING's slot (not its own subtree) is allowed", () => {
    const before = doc([
      node(C.stack, {}, { [S.stackChildren]: [] }, "target"),
      node(X.box, { label: "mover" }, {}, "mover"),
    ]);
    const t: InsertionTarget = { parentId: "target", slotId: S.stackChildren, index: 0 };
    const result = moveSubtree(before, M, "mover", t);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root.map((n) => n.id)).toEqual(["target"]);
    expect(result.document.root[0].slots[S.stackChildren].map((n) => n.id)).toEqual(["mover"]);
  });
});

describe("moveSubtree — slot acceptance + cardinality", () => {
  it("rejects a cross-slot move into a slot the component is not accepted by", () => {
    // Gallery.items only accepts boxes; move a Stack into it.
    const before = doc([
      node(X.gallery, {}, { items: [] }, "g"),
      node(C.stack, {}, { [S.stackChildren]: [] }, "s"),
    ]);
    const t: InsertionTarget = { parentId: "g", slotId: "items", index: 0 };
    const result = moveSubtree(before, M, "s", t);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/does not accept/i);
  });

  it("rejects moving a second child into an already-occupied single slot", () => {
    // split.left is single and holds A; move C from right into left.
    const before = makeAbcDocument();
    const t: InsertionTarget = { parentId: "split", slotId: S.splitLeft, index: 0 };
    const result = moveSubtree(before, M, "C", t);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/single-child/i);
  });

  it("allows a same-slot reorder of the lone child of a single slot (no cardinality bite)", () => {
    // split.left holds only A; a same-slot move keeps it there (a no-op), and
    // cardinality must NOT reject it.
    const before = makeAbcDocument();
    const t: InsertionTarget = { parentId: "split", slotId: S.splitLeft, index: 0 };
    const result = moveSubtree(before, M, "A", t);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
  });

  it("reorders freely within an `accepts`-restricted slot without re-checking membership", () => {
    // Gallery.items only accepts boxes, and both children already satisfy that
    // (they were validated at insertion time). A same-slot reorder must not
    // re-run the accepts check — it is a pure position change, not a fresh
    // membership decision (mirrors reorderNode's identical assumption, and is
    // what lets an opaque node's accepts-violating componentId — which would
    // ALSO make its parent opaque per classifyNode's "unaccepted-child" rule,
    // and so is blocked from ANY entry by validateInsertionTarget regardless —
    // stay purely academic: within a still-valid, non-opaque parent, same-slot
    // membership is never in question).
    const before = doc([
      node(X.gallery, {}, { items: [node(X.box, { label: "a" }, {}, "a"), node(X.box, { label: "b" }, {}, "b")] }, "g"),
    ]);
    const t: InsertionTarget = { parentId: "g", slotId: "items", index: 2 };
    const result = moveSubtree(before, M, "a", t);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root[0].slots.items.map((n) => n.id)).toEqual(["b", "a"]);
  });

  it("rejects an out-of-range target index", () => {
    const before = makeStackDocument();
    const t: InsertionTarget = { parentId: "stack", slotId: S.stackChildren, index: 99 };
    const result = moveSubtree(before, M, "a", t);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/out of range/i);
  });

  it("rejects moving into an opaque parent", () => {
    const before = doc([
      node("ghost.component", {}, { slot: [] }, "ghost"),
      node(X.box, {}, {}, "mover"),
    ]);
    const t: InsertionTarget = { parentId: "ghost", slotId: "slot", index: 0 };
    const result = moveSubtree(before, M, "mover", t);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/opaque/i);
  });
});

describe("moveSubtree — purity + errors", () => {
  it("does not mutate the input document", () => {
    const before = makeAbcDocument();
    const snapshot = JSON.parse(JSON.stringify(before));
    moveSubtree(before, M, "B", rootTarget(1));
    expect(before).toEqual(snapshot);
  });

  it("returns an error for an unknown source node", () => {
    const before = makeAbcDocument();
    const result = moveSubtree(before, M, "nope", rootTarget(0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not found/i);
  });

  it("re-uses the same node ids (a relocation, not a clone)", () => {
    const before = makeAbcDocument();
    const result = moveSubtree(before, M, "B", rootTarget(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // B kept its id — it moved, it was not re-issued.
    expect(result.document.root.some((n) => n.id === "B")).toBe(true);
  });
});
