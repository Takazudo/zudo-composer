// Pure-reducer tests for the clipboard/duplicate foundation (issue #255):
// copy / cut / paste / duplicate on `applyComposerAction`. See
// `controller-model.test.ts` for the shared setup pattern this mirrors, and
// `../../../composer/model/__tests__/clone-insert-subtree.test.ts` for the
// underlying model-primitive tests.

import { describe, expect, it } from "vitest";
import { createSequentialIdFactory } from "../../../../composer/browser";
import {
  FIXTURE_COMPONENT_IDS as F,
  fixtureManifest,
  makeAbcDocument,
  resetFixtureIds,
} from "../../../../composer/__tests__/fixtures";
import {
  applyComposerAction,
  createInitialControllerState,
  type ComposerControllerState,
  type ComposerReducerContext,
} from "../controller-model";

function ctx(): ComposerReducerContext {
  return { manifest: fixtureManifest, idFactory: createSequentialIdFactory("n") };
}

function initial(): ComposerControllerState {
  resetFixtureIds();
  return createInitialControllerState({
    document: makeAbcDocument(),
    manifest: fixtureManifest,
    saveStatus: { kind: "saved" },
  });
}

/** A document with one opaque (unknown-component) root node, "ghost". */
function withOpaqueNode(): ComposerControllerState {
  const state = initial();
  return {
    ...state,
    document: {
      ...state.document,
      root: [
        ...state.document.root,
        { id: "ghost", componentId: "ghost.unknown", componentVersion: 1, props: {}, slots: {} },
      ],
    },
  };
}

describe("applyComposerAction — clipboard: copy", () => {
  it("copy stores a snapshot in clipboard without touching the document", () => {
    const state = initial();
    const { state: next, error, documentChanged } = applyComposerAction(state, { type: "copy", nodeId: "B" }, ctx());
    expect(error).toBeNull();
    expect(documentChanged).toBe(false);
    expect(next.document).toBe(state.document);
    expect(next.clipboard).toMatchObject({ id: "B", componentId: F.box });
  });

  it("copy is refused for an opaque node and leaves the clipboard untouched", () => {
    const state = withOpaqueNode();
    const { error, state: next } = applyComposerAction(state, { type: "copy", nodeId: "ghost" }, ctx());
    expect(error).toMatch(/unavailable/i);
    expect(next.clipboard).toBeNull();
  });

  it("copy errors on an unknown node id", () => {
    const state = initial();
    const { error } = applyComposerAction(state, { type: "copy", nodeId: "nope" }, ctx());
    expect(error).toMatch(/not found/i);
  });

  it("the clipboard is a snapshot — later document edits do not change what was copied", () => {
    const state = initial();
    const copied = applyComposerAction(state, { type: "copy", nodeId: "B" }, ctx()).state;
    const edited = applyComposerAction(
      copied,
      { type: "updateProps", nodeId: "B", patch: { label: "Edited" } },
      ctx(),
    ).state;
    expect(edited.document.root[0]!.slots.right.find((n) => n.id === "B")!.props.label).toBe("Edited");
    expect(edited.clipboard).toMatchObject({ id: "B" });
    expect(edited.clipboard!.props.label).not.toBe("Edited");
  });
});

describe("applyComposerAction — clipboard: cut", () => {
  it("cut copies the node into the clipboard, removes it, and repairs selection", () => {
    const state = { ...initial(), selectedId: "B" };
    const { state: next, error, documentChanged } = applyComposerAction(state, { type: "cut", nodeId: "B" }, ctx());
    expect(error).toBeNull();
    expect(documentChanged).toBe(true);
    expect(next.clipboard).toMatchObject({ id: "B", componentId: F.box });
    expect(next.document.root[0]!.slots.right.map((n) => n.id)).toEqual(["C"]);
    expect(next.selectedId).toBe("C"); // sibling shifted into B's index (#245 repair)
  });

  it("cut is refused for an opaque node — the document and clipboard are both untouched", () => {
    const state = withOpaqueNode();
    const { error, state: next, documentChanged } = applyComposerAction(state, { type: "cut", nodeId: "ghost" }, ctx());
    expect(error).toMatch(/unavailable/i);
    expect(documentChanged).toBe(false);
    expect(next.document.root.map((n) => n.id)).toContain("ghost");
    expect(next.clipboard).toBeNull();
  });
});

describe("applyComposerAction — clipboard: paste", () => {
  it("pastes a fresh clone at the target, selecting and revealing it", () => {
    const copied = applyComposerAction(initial(), { type: "copy", nodeId: "B" }, ctx()).state;
    const { state: next, error, documentChanged } = applyComposerAction(
      copied,
      { type: "paste", target: { parentId: "split", slotId: "right", index: 0 } },
      ctx(),
    );
    expect(error).toBeNull();
    expect(documentChanged).toBe(true);
    expect(next.document.root[0]!.slots.right).toHaveLength(3);
    const pastedId = next.document.root[0]!.slots.right[0]!.id;
    expect(pastedId).not.toBe("B"); // freshly re-issued, not the original node id
    expect(next.document.root[0]!.slots.right[0]!.componentId).toBe(F.box);
    expect(next.selectedId).toBe(pastedId);
    expect(next.expandedIds.has("split")).toBe(true); // ancestor revealed
  });

  it("pasting the same clipboard twice yields two document nodes with fully distinct ids", () => {
    const copied = applyComposerAction(initial(), { type: "copy", nodeId: "B" }, ctx()).state;
    const c = ctx();
    const once = applyComposerAction(copied, { type: "paste", target: { parentId: null, slotId: "root", index: 0 } }, c);
    const twice = applyComposerAction(
      once.state,
      { type: "paste", target: { parentId: null, slotId: "root", index: 0 } },
      c,
    );
    const [firstPasted, secondPasted] = twice.state.document.root;
    expect(firstPasted!.id).not.toBe(secondPasted!.id);
  });

  it("clipboard survives a paste — pasting again after a paste keeps working", () => {
    const copied = applyComposerAction(initial(), { type: "copy", nodeId: "B" }, ctx()).state;
    expect(copied.clipboard).not.toBeNull();
    const c = ctx();
    const afterPaste = applyComposerAction(
      copied,
      { type: "paste", target: { parentId: null, slotId: "root", index: 0 } },
      c,
    ).state;
    expect(afterPaste.clipboard).not.toBeNull();
  });

  it("paste into an incompatible slot is rejected with an honest error, not a silent no-op", () => {
    // split.left is single-cardinality and already occupied by "A".
    const copied = applyComposerAction(initial(), { type: "copy", nodeId: "B" }, ctx()).state;
    const { state: next, error, documentChanged } = applyComposerAction(
      copied,
      { type: "paste", target: { parentId: "split", slotId: "left", index: 1 } },
      ctx(),
    );
    expect(error).toMatch(/single-child/i);
    expect(documentChanged).toBe(false);
    expect(next).toBe(copied); // untouched — an explicit error, never a quiet no-op
  });

  it("paste with an empty clipboard is refused", () => {
    const state = initial();
    const { error, documentChanged } = applyComposerAction(
      state,
      { type: "paste", target: { parentId: null, slotId: "root", index: 0 } },
      ctx(),
    );
    expect(error).toMatch(/clipboard is empty/i);
    expect(documentChanged).toBe(false);
  });
});

describe("applyComposerAction — clipboard: duplicate", () => {
  it("duplicate inserts a fresh clone immediately after the source and selects it", () => {
    const state = initial();
    const { state: next, error, documentChanged } = applyComposerAction(state, { type: "duplicate", nodeId: "B" }, ctx());
    expect(error).toBeNull();
    expect(documentChanged).toBe(true);
    const rightIds = next.document.root[0]!.slots.right.map((n) => n.id);
    expect(rightIds).toHaveLength(3);
    expect(rightIds[0]).toBe("B");
    expect(rightIds[2]).toBe("C");
    const duplicatedId = rightIds[1]!;
    expect(duplicatedId).not.toBe("B");
    expect(next.selectedId).toBe(duplicatedId);
  });

  it("duplicate reveals the duplicated node's ancestors", () => {
    const state = { ...initial(), expandedIds: new Set<string>() };
    const { state: next } = applyComposerAction(state, { type: "duplicate", nodeId: "B" }, ctx());
    expect(next.expandedIds.has("split")).toBe(true);
  });

  it("duplicate is refused for an opaque node", () => {
    const state = withOpaqueNode();
    const { error, documentChanged } = applyComposerAction(state, { type: "duplicate", nodeId: "ghost" }, ctx());
    expect(error).toMatch(/unavailable/i);
    expect(documentChanged).toBe(false);
  });

  it("duplicating twice yields three sibling nodes with pairwise distinct ids", () => {
    const state = initial();
    const c = ctx();
    const once = applyComposerAction(state, { type: "duplicate", nodeId: "B" }, c);
    const twice = applyComposerAction(once.state, { type: "duplicate", nodeId: "B" }, c);
    const rightIds = twice.state.document.root[0]!.slots.right.map((n) => n.id);
    expect(rightIds).toHaveLength(4);
    expect(new Set(rightIds).size).toBe(4);
  });
});
