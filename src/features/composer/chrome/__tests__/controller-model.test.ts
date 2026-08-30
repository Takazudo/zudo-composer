import { describe, expect, it } from "vitest";
import { createSequentialIdFactory } from "../../../../composer/browser";
import {
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
  DOCUMENT_MUTATION_HISTORY_POLICY,
  DOCUMENT_MUTATION_TYPES,
  describeSaveStatus,
  hasUnsavedChanges,
  isDocumentMutation,
  type ComposerReducerContext,
} from "../controller-model";

// Shared fixture manifest/document reused verbatim from #245 — its header
// comment names #247 as an intended downstream consumer.

function ctx(): ComposerReducerContext {
  return { manifest: fixtureManifest, idFactory: createSequentialIdFactory("n") };
}

function initial() {
  resetFixtureIds();
  return createInitialControllerState({
    document: makeAbcDocument(),
    manifest: fixtureManifest,
    saveStatus: { kind: "saved" },
    leftWidth: 260,
    rightWidth: 320,
  });
}

describe("createInitialControllerState", () => {
  it("selects the first root node and starts with no expansion", () => {
    const state = initial();
    expect(state.selectedId).toBe("split");
    expect(state.expandedIds.size).toBe(0);
    expect(state.mode).toBe("edit");
    expect(state.viewport).toBe("fluid");
    expect(state.leftWidth).toBe(260);
    expect(state.rightWidth).toBe(320);
  });
});

describe("applyComposerAction — document commands", () => {
  it("renames through the reducer and reports identical input as a no-op", () => {
    const state = initial();
    const renamed = applyComposerAction(state, { type: "rename", name: "Renamed" }, ctx());
    expect(renamed.error).toBeNull();
    expect(renamed.documentChanged).toBe(true);
    expect(renamed.state.document.name).toBe("Renamed");
    expect(applyComposerAction(renamed.state, { type: "rename", name: "Renamed" }, ctx()).documentChanged).toBe(
      false,
    );
  });

  it("add uses the shared InsertionTarget shape and selects the inserted node", () => {
    const state = initial();
    const { state: next, error, documentChanged } = applyComposerAction(
      state,
      { type: "add", target: { parentId: "split", slotId: "right", index: 2 }, componentId: F.box },
      ctx(),
    );
    expect(error).toBeNull();
    expect(documentChanged).toBe(true);
    expect(next.selectedId).not.toBe(state.selectedId);
    expect(next.document.root[0]!.slots.right).toHaveLength(3);
  });

  it("add surfaces a command error and leaves state untouched (unknown component)", () => {
    const state = initial();
    const { state: next, error, documentChanged } = applyComposerAction(
      state,
      { type: "add", target: { parentId: "split", slotId: "right", index: 0 }, componentId: "nope" },
      ctx(),
    );
    expect(error).toMatch(/unknown component/i);
    expect(documentChanged).toBe(false);
    expect(next).toBe(state);
  });

  it("add into a single-cardinality occupied slot is rejected", () => {
    const state = initial();
    const { error, documentChanged } = applyComposerAction(
      state,
      { type: "add", target: { parentId: "split", slotId: "left", index: 1 }, componentId: F.box },
      ctx(),
    );
    expect(error).toMatch(/single-child/i);
    expect(documentChanged).toBe(false);
  });

  it("updateProps merges a JSON-safe patch and rejects a bad field value", () => {
    const state = initial();
    const ok = applyComposerAction(state, { type: "updateProps", nodeId: "A", patch: { label: "AA" } }, ctx());
    expect(ok.error).toBeNull();
    expect(ok.documentChanged).toBe(true);
    expect(ok.state.document.root[0]!.slots.left[0]!.props.label).toBe("AA");

    const bad = applyComposerAction(
      state,
      { type: "updateProps", nodeId: "A", patch: { size: 999 } },
      ctx(),
    );
    expect(bad.error).toMatch(/above max/i);
    expect(bad.documentChanged).toBe(false);
  });

  it("reorder swaps siblings and is a no-op (not an error) at a boundary", () => {
    const state = initial();
    const moved = applyComposerAction(state, { type: "reorder", nodeId: "B", direction: "down" }, ctx());
    expect(moved.error).toBeNull();
    expect(moved.documentChanged).toBe(true);
    expect(moved.state.document.root[0]!.slots.right.map((n) => n.id)).toEqual(["C", "B"]);

    const boundary = applyComposerAction(moved.state, { type: "reorder", nodeId: "B", direction: "down" }, ctx());
    expect(boundary.error).toBeNull();
    expect(boundary.documentChanged).toBe(false);
  });

  it("remove repairs selection to a sibling and clears the removed subtree", () => {
    const state = { ...initial(), selectedId: "B" };
    const { state: next, error, documentChanged } = applyComposerAction(
      state,
      { type: "remove", nodeId: "B" },
      ctx(),
    );
    expect(error).toBeNull();
    expect(documentChanged).toBe(true);
    expect(next.selectedId).toBe("C");
    expect(next.document.root[0]!.slots.right.map((n) => n.id)).toEqual(["C"]);
  });
});

describe("applyComposerAction — Composition reuse commands", () => {
  it("inserts a Pattern forest through one reducer transition and selects/reveals its first root", () => {
    const state = { ...initial(), expandedIds: new Set<string>() };
    const sourceRoots = [node(F.box, { label: "Pattern A" }, {}, "source-a"), node(F.box, { label: "Pattern B" }, {}, "source-b")];
    const result = applyComposerAction(
      state,
      { type: "insertForest", target: { parentId: "split", slotId: "right", index: 1 }, sourceRoots },
      ctx(),
    );

    expect(result.error).toBeNull();
    expect(result.documentChanged).toBe(true);
    const right = result.state.document.root[0]!.slots.right;
    expect(right.map((item) => item.props.label)).toEqual(["B", "Pattern A", "Pattern B", "C"]);
    expect(result.state.selectedId).toBe(right[1]!.id);
    expect(result.state.expandedIds.has("split")).toBe(true);

    sourceRoots[0]!.props.label = "mutated source";
    expect(right[1]!.props.label).toBe("Pattern A");
  });

  it("binds through a resolved contract, persists one accepted action, and applies its root policy to later inserts", () => {
    const empty = createInitialControllerState({
      document: doc([]),
      manifest: fixtureManifest,
      saveStatus: { kind: "saved" },
      leftWidth: 260,
      rightWidth: 320,
    });
    const contract = {
      sourceRecordId: "source-record",
      outletId: "outlet-main",
      sameProvider: true,
      sourceIsGlobalTemplate: true,
      sourceHasBinding: false,
      rootPolicy: { kind: "resolved" as const, accepts: [F.box], cardinality: "single" as const },
    };

    const bound = applyComposerAction(empty, { type: "bindConsumer", contract }, ctx());
    expect(bound.error).toBeNull();
    expect(bound.documentChanged).toBe(true);
    expect(bound.state.document.binding).toEqual({ sourceRecordId: "source-record", outletId: "outlet-main" });

    const accepted = applyComposerAction(
      bound.state,
      { type: "add", target: { parentId: null, slotId: "root", index: 0 }, componentId: F.box },
      ctx(),
    );
    expect(accepted.documentChanged).toBe(true);
    const rejected = applyComposerAction(
      accepted.state,
      { type: "add", target: { parentId: null, slotId: "root", index: 1 }, componentId: F.box },
      ctx(),
    );
    expect(rejected.documentChanged).toBe(false);
    expect(rejected.error).toMatch(/only one root/i);
    expect(rejected.state).toBe(accepted.state);
  });

  it("makes publication actions document mutations and rejects an outlet insert without a save transition", () => {
    const state = initial();
    const published = applyComposerAction(
      state,
      { type: "publishGlobalTemplate", target: { parentId: "split", slotId: "right" }, label: "Main" },
      ctx(),
    );
    // right is occupied in the A/B/C fixture, so this must be a no-op.
    expect(published.documentChanged).toBe(false);
    expect(published.error).toMatch(/empty declared/i);
  });
});

describe("applyComposerAction — selection, reveal, expansion", () => {
  it("select sets selectedId verbatim, including null", () => {
    const state = initial();
    expect(applyComposerAction(state, { type: "select", nodeId: "B" }, ctx()).state.selectedId).toBe("B");
    expect(applyComposerAction(state, { type: "select", nodeId: null }, ctx()).state.selectedId).toBeNull();
  });

  it("reveal selects the node and expands every ancestor", () => {
    const state = initial();
    const { state: next } = applyComposerAction(state, { type: "reveal", nodeId: "B" }, ctx());
    expect(next.selectedId).toBe("B");
    expect(next.expandedIds.has("split")).toBe(true);
  });

  it("toggleExpanded flips membership; setExpanded is absolute", () => {
    const state = initial();
    const opened = applyComposerAction(state, { type: "toggleExpanded", nodeId: "split" }, ctx()).state;
    expect(opened.expandedIds.has("split")).toBe(true);
    const closed = applyComposerAction(opened, { type: "toggleExpanded", nodeId: "split" }, ctx()).state;
    expect(closed.expandedIds.has("split")).toBe(false);

    const forced = applyComposerAction(state, { type: "setExpanded", nodeId: "split", expanded: true }, ctx()).state;
    expect(forced.expandedIds.has("split")).toBe(true);
  });
});

describe("applyComposerAction — mode, viewport, widths, save status", () => {
  it("setMode / setViewport / setLeftWidth / setRightWidth update verbatim and never touch the document", () => {
    const state = initial();
    expect(applyComposerAction(state, { type: "setMode", mode: "preview" }, ctx()).state.mode).toBe("preview");
    expect(applyComposerAction(state, { type: "setViewport", viewport: "mobile" }, ctx()).state.viewport).toBe(
      "mobile",
    );
    const widthResult = applyComposerAction(state, { type: "setLeftWidth", width: 300 }, ctx());
    expect(widthResult.state.leftWidth).toBe(300);
    expect(widthResult.documentChanged).toBe(false);
    expect(widthResult.state.document).toBe(state.document);
  });

  it("setSaveStatus updates verbatim", () => {
    const state = initial();
    const next = applyComposerAction(
      state,
      { type: "setSaveStatus", status: { kind: "error", reason: "quota" } },
      ctx(),
    ).state;
    expect(next.saveStatus).toEqual({ kind: "error", reason: "quota" });
  });
});

describe("isDocumentMutation / hasUnsavedChanges", () => {
  it("locks the exhaustive document-mutation history partition at 10 undoable / 8 barriers", () => {
    const entries = Object.entries(DOCUMENT_MUTATION_HISTORY_POLICY);
    expect(DOCUMENT_MUTATION_TYPES).toHaveLength(18);
    expect(new Set(DOCUMENT_MUTATION_TYPES).size).toBe(18);
    expect(entries.filter(([, policy]) => policy === "undoable").map(([type]) => type).sort()).toEqual([
      "add", "cut", "drop", "duplicate", "insertForest", "paste", "remove", "rename", "reorder", "updateProps",
    ]);
    expect(entries.filter(([, policy]) => policy === "barrier").map(([type]) => type).sort()).toEqual([
      "bindConsumer", "clearPublication", "publishGlobalTemplate", "publishPattern", "reassignGlobalTemplateOutlet",
      "removeBinding", "renameGlobalTemplateOutlet", "setGlobalTemplateOutlet",
    ]);
    expect([...DOCUMENT_MUTATION_TYPES].sort()).toEqual(entries.map(([type]) => type).sort());
  });

  it("flags exactly the document-mutating action types", () => {
    expect(isDocumentMutation({ type: "add", target: { parentId: null, slotId: "root", index: 0 }, componentId: "x" })).toBe(
      true,
    );
    expect(isDocumentMutation({ type: "rename", name: "Renamed" })).toBe(true);
    expect(isDocumentMutation({ type: "updateProps", nodeId: "x", patch: {} })).toBe(true);
    expect(isDocumentMutation({ type: "reorder", nodeId: "x", direction: "up" })).toBe(true);
    expect(isDocumentMutation({ type: "remove", nodeId: "x" })).toBe(true);
    expect(isDocumentMutation({ type: "insertForest", target: { parentId: null, slotId: "root", index: 0 }, sourceRoots: [] })).toBe(true);
    expect(isDocumentMutation({ type: "publishPattern" })).toBe(true);
    expect(isDocumentMutation({ type: "bindConsumer", contract: {
      sourceRecordId: "source", outletId: "outlet", sameProvider: true, sourceIsGlobalTemplate: true, sourceHasBinding: false,
      rootPolicy: { kind: "resolved", cardinality: "many" },
    } })).toBe(true);
    expect(isDocumentMutation({ type: "setRootPolicy", rootPolicy: { kind: "unresolved" } })).toBe(false);
    expect(isDocumentMutation({ type: "select", nodeId: null })).toBe(false);
    expect(isDocumentMutation({ type: "setMode", mode: "edit" })).toBe(false);
  });

  it("hasUnsavedChanges is false only when saveStatus is saved", () => {
    const state = initial();
    expect(hasUnsavedChanges(state)).toBe(false);
    expect(hasUnsavedChanges({ ...state, saveStatus: { kind: "dirty" } })).toBe(true);
    expect(hasUnsavedChanges({ ...state, saveStatus: { kind: "saving" } })).toBe(true);
    expect(hasUnsavedChanges({ ...state, saveStatus: { kind: "error", reason: "x" } })).toBe(true);
  });
});

describe("describeSaveStatus", () => {
  it("has concise provider-neutral wording for async persistence states", () => {
    expect(describeSaveStatus({ kind: "saved" })).toBe("Saved");
    expect(describeSaveStatus({ kind: "dirty" })).toBe("Unsaved changes");
    expect(describeSaveStatus({ kind: "saving" })).toBe("Saving…");
    expect(describeSaveStatus({ kind: "error", reason: "quota" })).toBe("Save failed");
  });
});
