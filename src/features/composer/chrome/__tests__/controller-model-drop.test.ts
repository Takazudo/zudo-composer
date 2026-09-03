// Pure-reducer tests for the canvas drag & drop `drop` action (issue #258) —
// the ATOMIC host revalidation layered on #258's `moveSubtree` and #255's
// clone+insert. See `../../../composer/model/__tests__/move-subtree.test.ts`
// for the underlying move primitive and `controller-model-clipboard.test.ts`
// for the shared setup pattern this mirrors.

import { describe, expect, it } from "vitest";
import { createSequentialIdFactory } from "../../../../composer/browser";
import {
  COMPONENT_IDS as C,
  SLOT_IDS as S,
  FIXTURE_COMPONENT_IDS as F,
  doc,
  fixtureManifest,
  makeAbcDocument,
  node,
  resetFixtureIds,
} from "../../../../composer/__tests__/fixtures";
import {
  applyComposerAction,
  createInitialControllerState,
  isDocumentMutation,
  type ComposerControllerState,
  type ComposerReducerContext,
} from "../controller-model";

function ctx(): ComposerReducerContext {
  return { manifest: fixtureManifest, idFactory: createSequentialIdFactory("drop") };
}

function stateFrom(document: ReturnType<typeof makeAbcDocument>): ComposerControllerState {
  resetFixtureIds();
  return createInitialControllerState({
    document,
    manifest: fixtureManifest,
    saveStatus: { kind: "saved" },
  });
}

const abc = () => stateFrom(makeAbcDocument());

/** A document with one opaque (unknown-component) node inside split.right. */
function withOpaqueInRight(): ComposerControllerState {
  const document = makeAbcDocument();
  document.root[0].slots[S.splitRight].push({
    id: "ghost",
    componentId: "ghost.unknown",
    componentVersion: 1,
    props: {},
    slots: {},
  });
  return stateFrom(document);
}

describe("applyComposerAction — drop: move", () => {
  it("registers as a document mutation (drives autosave)", () => {
    expect(isDocumentMutation({ type: "drop", sourceNodeId: "B", target: { parentId: "split", slotId: S.splitRight, index: 0 }, copy: false })).toBe(true);
  });

  it("moves a node within its own slot (down-shift), selecting it and revealing its ancestors", () => {
    const state = abc();
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "B", target: { parentId: "split", slotId: S.splitRight, index: 2 }, copy: false },
      ctx(),
    );
    expect(result.error).toBeNull();
    expect(result.documentChanged).toBe(true);
    expect(result.state.document.root[0].slots[S.splitRight].map((n) => n.id)).toEqual(["C", "B"]);
    expect(result.state.selectedId).toBe("B");
    expect(result.state.expandedIds.has("split")).toBe(true);
  });

  it("moves cross-slot within one parent (SplitLayout left→right) with NO index shift", () => {
    const state = abc();
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "A", target: { parentId: "split", slotId: S.splitRight, index: 1 }, copy: false },
      ctx(),
    );
    expect(result.error).toBeNull();
    const split = result.state.document.root[0];
    expect(split.slots[S.splitLeft]).toHaveLength(0);
    expect(split.slots[S.splitRight].map((n) => n.props.label)).toEqual(["B", "A", "C"]);
    expect(result.state.selectedId).toBe("A");
  });

  it("reveals MULTIPLE ancestors after a deep move", () => {
    const document = doc([
      node(
        C.splitLayout,
        { ratio: "50-50", gap: "md" },
        {
          [S.splitLeft]: [node(F.box, { label: "A" }, {}, "A")],
          [S.splitRight]: [node(C.stack, { gap: "md" }, { [S.stackChildren]: [] }, "stack")],
        },
        "split",
      ),
    ]);
    const state = stateFrom(document);
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "A", target: { parentId: "stack", slotId: S.stackChildren, index: 0 }, copy: false },
      ctx(),
    );
    expect(result.error).toBeNull();
    expect(result.state.selectedId).toBe("A");
    // Both the stack and the split are expanded so the moved node is revealed.
    expect(result.state.expandedIds.has("stack")).toBe(true);
    expect(result.state.expandedIds.has("split")).toBe(true);
  });

  it("a same-slot no-op move keeps the document unchanged but still selects the node", () => {
    const state = abc();
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "B", target: { parentId: "split", slotId: S.splitRight, index: 0 }, copy: false },
      ctx(),
    );
    expect(result.error).toBeNull();
    expect(result.documentChanged).toBe(false);
    expect(result.state.document.root[0].slots[S.splitRight].map((n) => n.id)).toEqual(["B", "C"]);
    expect(result.state.selectedId).toBe("B");
  });
});

describe("applyComposerAction — drop: atomic revalidation rejects with NO document change", () => {
  it("rejects a cycle (moving a node into its own subtree)", () => {
    const state = abc();
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "split", target: { parentId: "split", slotId: S.splitRight, index: 0 }, copy: false },
      ctx(),
    );
    expect(result.error).toMatch(/own subtree/i);
    expect(result.documentChanged).toBe(false);
    expect(result.state).toBe(state);
  });

  it("rejects a move into an already-occupied single slot (cardinality)", () => {
    const state = abc(); // split.left is single, occupied by A
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "C", target: { parentId: "split", slotId: S.splitLeft, index: 0 }, copy: false },
      ctx(),
    );
    expect(result.error).toMatch(/single-child/i);
    expect(result.documentChanged).toBe(false);
    expect(result.state.document).toBe(state.document);
  });

  it("rejects a move into a slot the component is not accepted by (incompatible slot)", () => {
    const document = doc([
      node(F.gallery, {}, { items: [] }, "g"),
      node(C.stack, {}, { [S.stackChildren]: [] }, "s"),
    ]);
    const state = stateFrom(document);
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "s", target: { parentId: "g", slotId: "items", index: 0 }, copy: false },
      ctx(),
    );
    expect(result.error).toMatch(/does not accept/i);
    expect(result.documentChanged).toBe(false);
  });

  it("rejects an unknown source node", () => {
    const state = abc();
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "nope", target: { parentId: "split", slotId: S.splitRight, index: 0 }, copy: false },
      ctx(),
    );
    expect(result.error).toMatch(/not found/i);
    expect(result.documentChanged).toBe(false);
  });
});

describe("applyComposerAction — drop: opaque-node policy", () => {
  it("ALLOWS a same-slot reorder of an opaque node", () => {
    const state = withOpaqueInRight(); // right = [B, C, ghost]
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "ghost", target: { parentId: "split", slotId: S.splitRight, index: 0 }, copy: false },
      ctx(),
    );
    expect(result.error).toBeNull();
    expect(result.state.document.root[0].slots[S.splitRight].map((n) => n.id)).toEqual(["ghost", "B", "C"]);
  });

  it("REJECTS a cross-slot move of an opaque node", () => {
    const state = withOpaqueInRight();
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "ghost", target: { parentId: null, slotId: "root", index: 0 }, copy: false },
      ctx(),
    );
    expect(result.error).toMatch(/unavailable/i);
    expect(result.documentChanged).toBe(false);
    expect(result.state.document).toBe(state.document);
  });

  it("REJECTS a copy of an opaque node", () => {
    const state = withOpaqueInRight();
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "ghost", target: { parentId: "split", slotId: S.splitRight, index: 0 }, copy: true },
      ctx(),
    );
    expect(result.error).toMatch(/unavailable/i);
    expect(result.documentChanged).toBe(false);
  });
});

describe("applyComposerAction — drop: Alt-copy", () => {
  it("keeps the source and inserts a fully re-ID'd clone, selecting + revealing the clone", () => {
    const state = abc();
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "B", target: { parentId: "split", slotId: S.splitRight, index: 0 }, copy: true },
      ctx(),
    );
    expect(result.error).toBeNull();
    expect(result.documentChanged).toBe(true);
    const right = result.state.document.root[0].slots[S.splitRight];
    // Source B is still present …
    expect(right.some((n) => n.id === "B")).toBe(true);
    // … and a clone was inserted at index 0 with a FRESH id but the same props.
    const clone = right[0];
    expect(clone.id).not.toBe("B");
    expect(clone.componentId).toBe(F.box);
    expect(clone.props.label).toBe("B");
    // The new node is selected + revealed.
    expect(result.state.selectedId).toBe(clone.id);
    expect(result.state.expandedIds.has("split")).toBe(true);
  });

  it("re-issues EVERY id when copying a subtree (no id collides with the source subtree)", () => {
    const document = doc([
      node(
        C.stack,
        { gap: "md" },
        { [S.stackChildren]: [node(F.box, { label: "x" }, {}, "inner")] },
        "srcStack",
      ),
    ]);
    const state = stateFrom(document);
    const result = applyComposerAction(
      state,
      { type: "drop", sourceNodeId: "srcStack", target: { parentId: null, slotId: "root", index: 1 }, copy: true },
      ctx(),
    );
    expect(result.error).toBeNull();
    const clone = result.state.document.root[1];
    expect(clone.id).not.toBe("srcStack");
    expect(clone.slots[S.stackChildren][0].id).not.toBe("inner");
    expect(clone.slots[S.stackChildren][0].props.label).toBe("x");
    // Source subtree intact.
    expect(result.state.document.root[0].id).toBe("srcStack");
  });
});
