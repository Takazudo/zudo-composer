import { describe, expect, it } from "vitest";
import {
  addNode,
  removeNode,
  reorderNode,
  repairSelection,
  updateProps,
} from "../commands";
import { createSequentialIdFactory } from "../../../shared/id-factory";
import { indexDocument } from "../index-model";
import { RESERVED_PERSISTED_KEYS } from "@zudo-composer/component-contract";
import { VIRTUAL_ROOT_SLOT_ID } from "../types";
import type { InsertionTarget, JsonObject } from "../types";
import { COMPONENT_IDS as C, SLOT_IDS as S } from "../../__tests__/fixtures";
import {
  FIXTURE_COMPONENT_IDS as X,
  doc,
  fixtureManifest as M,
  node,
} from "../../__tests__/fixtures";

const rootTarget = (index: number): InsertionTarget => ({
  parentId: null,
  slotId: VIRTUAL_ROOT_SLOT_ID,
  index,
});

const ids = () => createSequentialIdFactory("id");

describe("addNode", () => {
  it("appends into the virtual root and selects the new node", () => {
    const before = doc([]);
    const result = addNode(before, M, rootTarget(0), C.stack, ids());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root).toHaveLength(1);
    expect(result.document.root[0].componentId).toBe(C.stack);
    expect(result.selectedId).toBe(result.insertedId);
    // input is not mutated
    expect(before.root).toHaveLength(0);
  });

  it("initialises props from defaults and declared slots to empty arrays", () => {
    const result = addNode(doc([]), M, rootTarget(0), C.splitLayout, ids());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = result.document.root[0];
    expect(created.props).toEqual({ ratio: "50-50", gap: "md" });
    expect(created.slots).toEqual({ [S.splitLeft]: [], [S.splitRight]: [] });
    expect(created.componentVersion).toBe(1);
  });

  it("inserts before the first child at index 0", () => {
    const stack = node(C.stack, { gap: "md" }, { [S.stackChildren]: [node(X.box, { label: "old" }, {}, "old")] }, "stack");
    const before = doc([stack]);
    const target: InsertionTarget = { parentId: "stack", slotId: S.stackChildren, index: 0 };
    const result = addNode(before, M, target, X.box, ids());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const children = result.document.root[0].slots[S.stackChildren];
    expect(children.map((c) => c.id)).toEqual([result.insertedId, "old"]);
  });

  it("inserts at an explicit middle index", () => {
    const stack = node(
      C.stack,
      {},
      { [S.stackChildren]: [node(X.box, {}, {}, "a"), node(X.box, {}, {}, "b")] },
      "stack",
    );
    const target: InsertionTarget = { parentId: "stack", slotId: S.stackChildren, index: 1 };
    const result = addNode(doc([stack]), M, target, X.box, ids());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root[0].slots[S.stackChildren].map((c) => c.id)).toEqual([
      "a",
      result.insertedId,
      "b",
    ]);
  });

  it("mints distinct ids for duplicate component types", () => {
    const factory = ids();
    const one = addNode(doc([]), M, rootTarget(0), C.stack, factory);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    const two = addNode(one.document, M, rootTarget(1), C.stack, factory);
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    const [a, b] = two.document.root;
    expect(a.componentId).toBe(b.componentId);
    expect(a.id).not.toBe(b.id);
  });

  it("rejects an out-of-range insertion index", () => {
    const result = addNode(doc([]), M, rootTarget(3), C.stack, ids());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/out of range/i);
  });

  it("rejects a non-integer insertion index", () => {
    const result = addNode(doc([]), M, rootTarget(0.5), C.stack, ids());
    expect(result.ok).toBe(false);
  });

  it("rejects an undeclared slot", () => {
    const stack = node(C.stack, {}, { [S.stackChildren]: [] }, "stack");
    const target: InsertionTarget = { parentId: "stack", slotId: "nope", index: 0 };
    const result = addNode(doc([stack]), M, target, X.box, ids());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not declared/i);
  });

  it("rejects an unknown component", () => {
    const result = addNode(doc([]), M, rootTarget(0), "does.not.exist", ids());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/unknown component/i);
  });

  it("rejects a second child in a single-cardinality slot", () => {
    const split = node(
      C.splitLayout,
      { ratio: "50-50", gap: "md" },
      { [S.splitLeft]: [node(X.box, {}, {}, "l")], [S.splitRight]: [] },
      "split",
    );
    const target: InsertionTarget = { parentId: "split", slotId: S.splitLeft, index: 1 };
    const result = addNode(doc([split]), M, target, X.box, ids());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/single-child/i);
  });

  it("rejects a child a slot does not accept", () => {
    const gallery = node(X.gallery, {}, { items: [] }, "g");
    const target: InsertionTarget = { parentId: "g", slotId: "items", index: 0 };
    const bad = addNode(doc([gallery]), M, target, C.stack, ids());
    expect(bad.ok).toBe(false);
    const good = addNode(doc([gallery]), M, target, X.box, ids());
    expect(good.ok).toBe(true);
  });

  it("rejects adding into an opaque (unknown-component) parent", () => {
    const opaque = node("ghost.component", {}, { slot: [] }, "ghost");
    const target: InsertionTarget = { parentId: "ghost", slotId: "slot", index: 0 };
    const result = addNode(doc([opaque]), M, target, X.box, ids());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/opaque/i);
  });
});

describe("updateProps", () => {
  it("merges a valid patch", () => {
    const heading = node(C.sectionHeading, { heading: "Old", as: "h2" }, {}, "h");
    const result = updateProps(doc([heading]), M, "h", { heading: "New" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root[0].props).toEqual({ heading: "New", as: "h2" });
  });

  it("rejects a value outside a select field's options", () => {
    const heading = node(C.sectionHeading, { heading: "H", as: "h2" }, {}, "h");
    const result = updateProps(doc([heading]), M, "h", { as: "h9" });
    expect(result.ok).toBe(false);
  });

  it("repairs a node whose only opacity reason is an invalid declared prop value", () => {
    const heading = node(C.sectionHeading, { heading: "H", as: "h9" }, {}, "h");
    const result = updateProps(doc([heading]), M, "h", { as: "h3" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root[0]!.props).toEqual({ heading: "H", as: "h3" });
  });

  it("does not repair props when a non-prop opacity reason is also present", () => {
    const heading = node(C.sectionHeading, { heading: "H", as: "h9" }, {}, "h");
    heading.componentVersion = 2;
    const result = updateProps(doc([heading]), M, "h", { as: "h3" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/read-only/i);
  });

  it("rejects a non-JSON-safe value", () => {
    const heading = node(C.sectionHeading, { heading: "H" }, {}, "h");
    const result = updateProps(doc([heading]), M, "h", { heading: (() => 1) as never });
    expect(result.ok).toBe(false);
  });

  it("refuses to edit an opaque node (read-only props)", () => {
    const opaque = node("ghost.component", { a: 1 }, {}, "ghost");
    const result = updateProps(doc([opaque]), M, "ghost", { a: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/read-only/i);
  });

  it("rejects writing into a prop that is a declared structural slot", () => {
    // Stack's default slot renders into the "children" prop — a scalar write
    // there would sit inert in storage while colliding with the slot's prop.
    const stack = node(C.stack, { gap: "md" }, { [S.stackChildren]: [] }, "stack");
    const result = updateProps(doc([stack]), M, "stack", { children: "hijacked" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/structural slot/i);
  });

  it("removes an optional top-level prop explicitly and refuses required omission", () => {
    const heading = node(C.sectionHeading, { heading: "Old", as: "h2" }, {}, "h");
    const removed = updateProps(doc([heading]), M, "h", {}, ["as"]);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.changed).toBe(true);
    expect(removed.document.root[0]!.props).toEqual({ heading: "Old" });

    const refused = updateProps(doc([heading]), M, "h", {}, ["heading"]);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatch(/required.*cannot be removed/i);
  });

  describe("rejects RESERVED_PERSISTED_KEYS", () => {
    // `updateProps` is the model layer's own gate: a direct caller bypasses the
    // preview protocol's wire-level rejection (`protocol.ts`) entirely, so the
    // model must refuse a reserved key on its own rather than trust the bridge.
    const literalKeys = [...RESERVED_PERSISTED_KEYS].filter((k) => k !== "__proto__");

    it.each(literalKeys)('rejects a patch that sets reserved key "%s"', (reservedKey) => {
      const heading = node(C.sectionHeading, { heading: "Old", as: "h2" }, {}, "h");
      const before = doc([heading]);
      const patch = { [reservedKey]: "x" } as JsonObject;

      const result = updateProps(before, M, "h", patch);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/reserved/i);
      // the document is left unchanged
      expect(before.root[0].props).toEqual({ heading: "Old", as: "h2" });
    });

    it("rejects a patch carrying __proto__ as an OWN property", () => {
      // Object-literal syntax `{ __proto__: "x" }` sets the PROTOTYPE rather
      // than creating an own property, so it would never reach `Object.entries`
      // and would pass this check by accident regardless of correctness.
      // `JSON.parse` (like a real attacker-controlled payload) creates a real
      // own property named "__proto__" — the case the check must actually catch.
      const patch = JSON.parse('{"__proto__": "x"}') as JsonObject;
      expect(Object.prototype.hasOwnProperty.call(patch, "__proto__")).toBe(true);

      const heading = node(C.sectionHeading, { heading: "Old", as: "h2" }, {}, "h");
      const before = doc([heading]);

      const result = updateProps(before, M, "h", patch);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/reserved/i);
      // the document is left unchanged
      expect(before.root[0].props).toEqual({ heading: "Old", as: "h2" });
    });
  });
});

describe("reorderNode", () => {
  const threeStack = () =>
    node(
      C.stack,
      {},
      {
        [S.stackChildren]: [
          node(X.box, {}, {}, "a"),
          node(X.box, {}, {}, "b"),
          node(X.box, {}, {}, "c"),
        ],
      },
      "stack",
    );

  it("moves a node down within its slot", () => {
    const result = reorderNode(doc([threeStack()]), M, "b", "down");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root[0].slots[S.stackChildren].map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(result.changed).toBe(true);
  });

  it("moves a node up within its slot", () => {
    const result = reorderNode(doc([threeStack()]), M, "b", "up");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root[0].slots[S.stackChildren].map((c) => c.id)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op at the slot boundary", () => {
    const result = reorderNode(doc([threeStack()]), M, "a", "up");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.document.root[0].slots[S.stackChildren].map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("reorders opaque nodes within their current slot", () => {
    const stack = node(
      C.stack,
      {},
      { [S.stackChildren]: [node("ghost.x", {}, {}, "g1"), node("ghost.x", {}, {}, "g2")] },
      "stack",
    );
    const result = reorderNode(doc([stack]), M, "g1", "down");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root[0].slots[S.stackChildren].map((c) => c.id)).toEqual(["g2", "g1"]);
  });
});

describe("removeNode + selection repair", () => {
  it("removes a subtree and repairs selection to the shifted sibling", () => {
    const stack = node(
      C.stack,
      {},
      { [S.stackChildren]: [node(X.box, {}, {}, "a"), node(X.box, {}, {}, "b"), node(X.box, {}, {}, "c")] },
      "stack",
    );
    const result = removeNode(doc([stack]), M, "b", "b");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root[0].slots[S.stackChildren].map((c) => c.id)).toEqual(["a", "c"]);
    expect(result.selectedId).toBe("c"); // sibling that shifted into b's index
  });

  it("repairs to the previous sibling when the last child is removed", () => {
    const stack = node(
      C.stack,
      {},
      { [S.stackChildren]: [node(X.box, {}, {}, "a"), node(X.box, {}, {}, "b")] },
      "stack",
    );
    const result = removeNode(doc([stack]), M, "b", "b");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selectedId).toBe("a");
  });

  it("repairs to the parent when a slot becomes empty", () => {
    const stack = node(C.stack, {}, { [S.stackChildren]: [node(X.box, {}, {}, "only")] }, "stack");
    const result = removeNode(doc([stack]), M, "only", "only");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selectedId).toBe("stack");
  });

  it("repairs to null when the last root node is removed", () => {
    const result = removeNode(doc([node(X.box, {}, {}, "only")]), M, "only", "only");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selectedId).toBeNull();
  });

  it("keeps a selection that survives the removal", () => {
    const stack = node(
      C.stack,
      {},
      { [S.stackChildren]: [node(X.box, {}, {}, "a"), node(X.box, {}, {}, "b")] },
      "stack",
    );
    const result = removeNode(doc([stack]), M, "a", "b");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selectedId).toBe("b");
  });

  it("removes an opaque node", () => {
    const stack = node(C.stack, {}, { [S.stackChildren]: [node("ghost.x", {}, {}, "g")] }, "stack");
    const result = removeNode(doc([stack]), M, "g", "g");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(indexDocument(result.document, M).byId.has("g")).toBe(false);
  });
});

describe("repairSelection", () => {
  it("keeps a present selection", () => {
    const d = doc([node(X.box, {}, {}, "a")]);
    expect(repairSelection(d, M, "a")).toBe("a");
  });
  it("falls back to the first root node for a missing selection", () => {
    const d = doc([node(X.box, {}, {}, "a")]);
    expect(repairSelection(d, M, "gone")).toBe("a");
  });
  it("returns null for an empty document", () => {
    expect(repairSelection(doc([]), M, "gone")).toBeNull();
  });
});
