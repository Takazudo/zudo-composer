// Tests for the clipboard/duplicate foundation (wave 6, issue #255):
// `cloneSubtreeWithNewIds` + `insertSubtree`. These are pure model primitives
// the #247 controller composes into copy/cut/paste/duplicate — see that
// module's own tests for the controller-level lifecycle.

import { describe, expect, it } from "vitest";
import {
  cloneForestWithNewIds,
  cloneSubtreeWithNewIds,
  insertForest,
  insertSubtree,
} from "../commands";
import { createSequentialIdFactory } from "../../../shared/id-factory";
import { indexDocument } from "../index-model";
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

const ids = () => createSequentialIdFactory("clone");

describe("cloneSubtreeWithNewIds", () => {
  it("re-issues the root id and every descendant id, preserving componentId/version/props/slot shape", () => {
    const stack = node(
      C.stack,
      { gap: "md" },
      {
        [S.stackChildren]: [
          node(X.box, { label: "A" }, {}, "a"),
          node(X.box, { label: "B" }, {}, "b"),
        ],
      },
      "stack",
    );
    const clone = cloneSubtreeWithNewIds(stack, ids());

    expect(clone.id).not.toBe("stack");
    expect(clone.componentId).toBe(stack.componentId);
    expect(clone.componentVersion).toBe(stack.componentVersion);
    expect(clone.props).toEqual(stack.props);

    const clonedChildren = clone.slots[S.stackChildren];
    expect(clonedChildren).toHaveLength(2);
    expect(clonedChildren.map((c) => c.componentId)).toEqual([X.box, X.box]);
    expect(clonedChildren.map((c) => c.props.label)).toEqual(["A", "B"]);
    // Every id in the clone — root and descendants — is fresh.
    const originalIds = new Set(["stack", "a", "b"]);
    const cloneIds = [clone.id, ...clonedChildren.map((c) => c.id)];
    for (const id of cloneIds) expect(originalIds.has(id)).toBe(false);
    expect(new Set(cloneIds).size).toBe(cloneIds.length); // internally unique too
  });

  it("does not mutate the source subtree", () => {
    const box = node(X.box, { label: "A" }, {}, "a");
    const before = JSON.parse(JSON.stringify(box));
    cloneSubtreeWithNewIds(box, ids());
    expect(box).toEqual(before);
  });

  it("produces fully distinct id sets across two separate clones of the same source", () => {
    const stack = node(
      C.stack,
      {},
      { [S.stackChildren]: [node(X.box, {}, {}, "a"), node(X.box, {}, {}, "b")] },
      "stack",
    );
    const factory = ids();
    const first = cloneSubtreeWithNewIds(stack, factory);
    const second = cloneSubtreeWithNewIds(stack, factory);

    const idsOf = (n: typeof first): string[] => [n.id, ...Object.values(n.slots).flat().map((c) => c.id)];
    const firstIds = idsOf(first);
    const secondIds = idsOf(second);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(firstIds.length + secondIds.length);
  });
});

describe("cloneForestWithNewIds", () => {
  it("clones every root and descendant with a complete old-to-new id map", () => {
    const forest = [
      node(
        C.stack,
        { gap: "lg" },
        {
          [S.stackChildren]: [
            node(C.stack, { gap: "sm" }, { [S.stackChildren]: [node(X.box, { label: "deep" }, {}, "deep")] }, "nested"),
          ],
        },
        "first",
      ),
      node(X.box, { label: "second" }, {}, "second"),
    ];

    const cloned = cloneForestWithNewIds(forest, ids());
    const clonedFirst = cloned.roots[0]!;
    const clonedNested = clonedFirst.slots[S.stackChildren][0]!;
    const clonedDeep = clonedNested.slots[S.stackChildren][0]!;
    const clonedSecond = cloned.roots[1]!;

    expect(cloned.roots.map((root) => root.props)).toEqual([{ gap: "lg" }, { label: "second" }]);
    expect(cloned.roots.map((root) => root.componentId)).toEqual([C.stack, X.box]);
    expect(cloned.idMap.get("first")).toBe(clonedFirst.id);
    expect(cloned.idMap.get("nested")).toBe(clonedNested.id);
    expect(cloned.idMap.get("deep")).toBe(clonedDeep.id);
    expect(cloned.idMap.get("second")).toBe(clonedSecond.id);
    expect(new Set(cloned.idMap.values()).size).toBe(4);
    expect([...cloned.idMap.values()].every((id) => !["first", "nested", "deep", "second"].includes(id))).toBe(true);
  });

  it("rejects an empty forest and non-fresh factory ids", () => {
    expect(() => cloneForestWithNewIds([], ids())).toThrow(/empty/i);
    const forest = [node(X.box, {}, {}, "source")];
    expect(() => cloneForestWithNewIds(forest, () => "source")).toThrow(/non-fresh/i);
  });
});

describe("insertForest", () => {
  const rootTarget = (index: number): InsertionTarget => ({
    parentId: null,
    slotId: VIRTUAL_ROOT_SLOT_ID,
    index,
  });

  it("inserts a deep multi-root Pattern forest in order with no retained source references", () => {
    const sourceRoots = [
      node(
        C.stack,
        { gap: "lg" },
        {
          [S.stackChildren]: [
            node(C.stack, { gap: "sm" }, { [S.stackChildren]: [node(X.box, { label: "deep" }, {}, "deep")] }, "nested"),
          ],
        },
        "first",
      ),
      node(X.box, { label: "second" }, {}, "second"),
    ];
    const result = insertForest(doc([]), M, rootTarget(0), sourceRoots, ids());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root.map((root) => root.componentId)).toEqual([C.stack, X.box]);
    expect(result.selectedId).toBe(result.document.root[0]!.id);
    expect(result.document.root[0]!.slots[S.stackChildren][0]!.slots[S.stackChildren][0]!.props.label).toBe("deep");

    sourceRoots[0]!.props.gap = "sm";
    sourceRoots.splice(1, 1);
    expect(result.document.root).toHaveLength(2);
    expect(result.document.root[0]!.props.gap).toBe("lg");
  });

  it("rejects an empty forest, a stale target index, an unavailable root, and clone/destination id collisions", () => {
    const stack = node(C.stack, {}, { [S.stackChildren]: [] }, "stack");
    const before = doc([stack]);
    const snapshot = JSON.parse(JSON.stringify(before));
    const root = node(X.box, {}, {}, "pattern-root");

    const empty = insertForest(before, M, { parentId: "stack", slotId: S.stackChildren, index: 0 }, [], ids());
    expect(empty).toMatchObject({ ok: false, code: "empty-forest" });

    const stale = insertForest(before, M, { parentId: "stack", slotId: S.stackChildren, index: 1 }, [root], ids());
    expect(stale).toMatchObject({ ok: false, code: "invalid-insertion-target" });

    const unavailable = insertForest(
      before,
      M,
      { parentId: "stack", slotId: S.stackChildren, index: 0 },
      [node("gone.component", {}, {}, "gone")],
      ids(),
    );
    expect(unavailable).toMatchObject({ ok: false, code: "forest-component-unavailable" });

    const collision = insertForest(
      doc([node(X.box, {}, {}, "fixture-box-1")]),
      M,
      rootTarget(1),
      [root],
      createSequentialIdFactory("clone"),
    );
    expect(collision).toMatchObject({ ok: false, code: "forest-node-id-collision" });
    expect(before).toEqual(snapshot);
  });

  it("validates every root before insertion, including accepts and single-cardinality", () => {
    const gallery = node(X.gallery, {}, { items: [] }, "gallery");
    const before = doc([gallery]);
    const sourceRoots = [node(X.box, {}, {}, "good"), node(C.stack, {}, { [S.stackChildren]: [] }, "bad")];
    const rejected = insertForest(
      before,
      M,
      { parentId: "gallery", slotId: "items", index: 0 },
      sourceRoots,
      ids(),
    );
    expect(rejected).toMatchObject({ ok: false, code: "root-accepts" });
    expect(before.root[0]!.slots.items).toEqual([]); // no accepted prefix was inserted

    const split = node(C.splitLayout, {}, { [S.splitLeft]: [], [S.splitRight]: [] }, "split");
    const multiple = insertForest(
      doc([split]),
      M,
      { parentId: "split", slotId: S.splitLeft, index: 0 },
      [node(X.box, {}, {}, "one"), node(X.box, {}, {}, "two")],
      ids(),
    );
    expect(multiple).toMatchObject({ ok: false, code: "forest-cardinality" });

    const occupied = insertForest(
      makeAbcDocument(),
      M,
      { parentId: "split", slotId: S.splitLeft, index: 1 },
      [node(X.box, {}, {}, "other")],
      ids(),
    );
    expect(occupied).toMatchObject({ ok: false, code: "forest-cardinality" });
  });

  it("honors a resolved bound-root policy and refuses an unresolved one", () => {
    const bound = doc([]);
    bound.binding = { sourceRecordId: "source-record", outletId: "outlet-main" };
    const sourceRoots = [node(X.box, {}, {}, "pattern-root")];

    const unresolved = insertForest(bound, M, rootTarget(0), sourceRoots, ids());
    expect(unresolved).toMatchObject({ ok: false, code: "unresolved-root-policy" });

    const resolved = insertForest(
      bound,
      M,
      rootTarget(0),
      sourceRoots,
      ids(),
      { kind: "resolved", accepts: [X.box], cardinality: "single" },
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.document.root).toHaveLength(1);

    const second = insertForest(
      resolved.document,
      M,
      rootTarget(1),
      sourceRoots,
      ids(),
      { kind: "resolved", accepts: [X.box], cardinality: "single" },
    );
    expect(second).toMatchObject({ ok: false, code: "root-cardinality" });
  });
});

describe("insertSubtree", () => {
  const rootTarget = (index: number): InsertionTarget => ({
    parentId: null,
    slotId: VIRTUAL_ROOT_SLOT_ID,
    index,
  });

  it("inserts a cloned subtree into the virtual root and selects it", () => {
    const clone = cloneSubtreeWithNewIds(node(X.box, { label: "A" }, {}, "a"), ids());
    const result = insertSubtree(doc([]), M, rootTarget(0), clone);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root).toHaveLength(1);
    expect(result.document.root[0].id).toBe(clone.id);
    expect(result.selectedId).toBe(clone.id);
    expect(result.insertedId).toBe(clone.id);
  });

  it("inserts a whole subtree (with descendants) into a named slot at an explicit index", () => {
    const before = makeAbcDocument();
    const boxClone = cloneSubtreeWithNewIds(node(X.box, { label: "D" }, {}, "d"), ids());
    const target: InsertionTarget = { parentId: "split", slotId: S.splitRight, index: 1 };
    const result = insertSubtree(before, M, target, boxClone);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.root[0].slots[S.splitRight].map((c) => c.id)).toEqual(["B", boxClone.id, "C"]);
    // input untouched
    expect(before.root[0].slots[S.splitRight]).toHaveLength(2);
  });

  it("preserves descendant structure of a multi-level subtree on insert", () => {
    const split = node(
      C.splitLayout,
      { ratio: "50-50", gap: "md" },
      {
        [S.splitLeft]: [node(X.box, { label: "L" }, {}, "l")],
        [S.splitRight]: [],
      },
      "split-src",
    );
    const clone = cloneSubtreeWithNewIds(split, ids());
    const result = insertSubtree(doc([]), M, rootTarget(0), clone);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inserted = result.document.root[0];
    expect(inserted.slots[S.splitLeft]).toHaveLength(1);
    expect(inserted.slots[S.splitLeft][0].props.label).toBe("L");
    expect(inserted.slots[S.splitLeft][0].id).not.toBe("l");
  });

  it("rejects a virtual-root target with the wrong slot id", () => {
    const clone = cloneSubtreeWithNewIds(node(X.box, {}, {}, "a"), ids());
    const target: InsertionTarget = { parentId: null, slotId: "left", index: 0 };
    const result = insertSubtree(doc([]), M, target, clone);
    expect(result.ok).toBe(false);
  });

  it("rejects an undeclared slot", () => {
    const stack = node(C.stack, {}, { [S.stackChildren]: [] }, "stack");
    const clone = cloneSubtreeWithNewIds(node(X.box, {}, {}, "a"), ids());
    const target: InsertionTarget = { parentId: "stack", slotId: "nope", index: 0 };
    const result = insertSubtree(doc([stack]), M, target, clone);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not declared/i);
  });

  it("rejects a second child in a single-cardinality slot", () => {
    const before = makeAbcDocument(); // split.left is single-cardinality, already occupied by A
    const clone = cloneSubtreeWithNewIds(node(X.box, {}, {}, "extra"), ids());
    const target: InsertionTarget = { parentId: "split", slotId: S.splitLeft, index: 1 };
    const result = insertSubtree(before, M, target, clone);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/single-child/i);
  });

  it("rejects a subtree whose component the target slot does not accept", () => {
    const gallery = node(X.gallery, {}, { items: [] }, "g");
    const stackClone = cloneSubtreeWithNewIds(node(C.stack, {}, { [S.stackChildren]: [] }, "s"), ids());
    const target: InsertionTarget = { parentId: "g", slotId: "items", index: 0 };
    const result = insertSubtree(doc([gallery]), M, target, stackClone);
    expect(result.ok).toBe(false);
  });

  it("rejects an out-of-range insertion index", () => {
    const clone = cloneSubtreeWithNewIds(node(X.box, {}, {}, "a"), ids());
    const result = insertSubtree(doc([]), M, rootTarget(3), clone);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/out of range/i);
  });

  it("rejects a non-integer insertion index", () => {
    const clone = cloneSubtreeWithNewIds(node(X.box, {}, {}, "a"), ids());
    const result = insertSubtree(doc([]), M, rootTarget(0.5), clone);
    expect(result.ok).toBe(false);
  });

  it("rejects inserting into an opaque (unknown-component) parent", () => {
    const opaque = node("ghost.component", {}, { slot: [] }, "ghost");
    const clone = cloneSubtreeWithNewIds(node(X.box, {}, {}, "a"), ids());
    const target: InsertionTarget = { parentId: "ghost", slotId: "slot", index: 0 };
    const result = insertSubtree(doc([opaque]), M, target, clone);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/opaque/i);
  });

  it("rejects a subtree whose id collides with an existing document node (ids must already be re-issued)", () => {
    const before = doc([node(X.box, {}, {}, "dup")]);
    const collidingClone: ReturnType<typeof cloneSubtreeWithNewIds> = {
      ...node(X.box, { label: "new" }, {}, "dup"),
    };
    const result = insertSubtree(before, M, rootTarget(1), collidingClone);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already exists/i);
  });

  it("does not mutate the input document or the inserted subtree", () => {
    const before = makeAbcDocument();
    const beforeSnapshot = JSON.parse(JSON.stringify(before));
    const clone = cloneSubtreeWithNewIds(node(X.box, {}, {}, "d"), ids());
    const cloneSnapshot = JSON.parse(JSON.stringify(clone));
    insertSubtree(before, M, { parentId: "split", slotId: S.splitRight, index: 0 }, clone);
    expect(before).toEqual(beforeSnapshot);
    expect(clone).toEqual(cloneSnapshot);
  });

  it("supports pasting the same clipboard twice yielding two document-distinct inserted nodes", () => {
    const source = node(X.box, { label: "X" }, {}, "src");
    const factory = ids();
    let d = doc([]);
    const first = insertSubtree(d, M, rootTarget(0), cloneSubtreeWithNewIds(source, factory));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    d = first.document;
    const second = insertSubtree(d, M, rootTarget(1), cloneSubtreeWithNewIds(source, factory));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.document.root.map((n) => n.id)).toHaveLength(2);
    expect(new Set(second.document.root.map((n) => n.id)).size).toBe(2);
    expect(indexDocument(second.document, M).byId.size).toBe(2);
  });
});
