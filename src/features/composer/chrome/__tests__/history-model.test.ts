import { describe, expect, it } from "vitest";
import type { CompositionDocument } from "../../../../composer/browser";
import {
  HISTORY_COALESCE_WINDOW_MS,
  HISTORY_MAX_DEPTH,
  breakHistoryCoalescing,
  canRedo,
  canUndo,
  clearHistory,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
  type CoalesceKey,
  type ComposerHistoryEntry,
} from "../history-model";

function document(name: string): CompositionDocument {
  return {
    schemaVersion: 2,
    id: "history-test",
    name,
    root: [],
  };
}

function entry(name: string): ComposerHistoryEntry {
  return { document: document(name), selectedId: name === "empty" ? null : name };
}

function key(nodeId: string, ...propKeys: string[]): CoalesceKey {
  return { kind: "updateProps", nodeId, propKeys: propKeys.sort() };
}

function names(history: { past: readonly { entry: ComposerHistoryEntry }[]; future: readonly ComposerHistoryEntry[] }) {
  return {
    past: history.past.map((item) => item.entry.document.name),
    future: history.future.map((item) => item.document.name),
  };
}

describe("createHistory", () => {
  it("starts empty and reports both directions unavailable", () => {
    const history = createHistory();
    expect(history).toEqual({ past: [], future: [], coalescing: null });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });
});

describe("pushHistory", () => {
  it("appends pre-mutation snapshots and clears redo entries", () => {
    let history = pushHistory(createHistory(), entry("before"), { coalesceKey: null, atMs: 0 });
    const undone = undoHistory(history, entry("after"));
    expect(undone).not.toBeNull();
    history = undone!.history;
    expect(names(history)).toEqual({ past: [], future: ["after"] });

    const next = pushHistory(history, entry("before-again"), { coalesceKey: null, atMs: 1 });
    expect(names(next)).toEqual({ past: ["before-again"], future: [] });
    expect(canUndo(next)).toBe(true);
    expect(canRedo(next)).toBe(false);
  });

  it("retains the earliest snapshot across a burst of three matching pushes and refreshes its timestamp", () => {
    const first = entry("before-1");
    let history = pushHistory(createHistory(), first, { coalesceKey: key("A", "title"), atMs: 0 });
    history = pushHistory(history, entry("before-2"), { coalesceKey: key("A", "title"), atMs: 400 });
    history = pushHistory(history, entry("before-3"), { coalesceKey: key("A", "title"), atMs: 900 });

    expect(history.past).toHaveLength(1);
    expect(history.past[0]!.entry.document.name).toBe("before-1");
    expect(history.past[0]!.atMs).toBe(900);
    expect(history.coalescing).toEqual(key("A", "title"));
  });

  it("matches only exact node and sorted patch-key sets", () => {
    let history = pushHistory(createHistory(), entry("title-before"), {
      coalesceKey: key("A", "title"),
      atMs: 0,
    });
    history = pushHistory(history, entry("title-next"), {
      coalesceKey: key("A", "title"),
      atMs: 100,
    });
    expect(history.past).toHaveLength(1);

    history = pushHistory(history, entry("subtitle-before"), {
      coalesceKey: key("A", "subtitle"),
      atMs: 200,
    });
    expect(history.past).toHaveLength(2);

    history = pushHistory(history, entry("both-before"), {
      coalesceKey: key("A", "title", "subtitle"),
      atMs: 300,
    });
    expect(history.past).toHaveLength(3);

    history = pushHistory(history, entry("other-node-before"), {
      coalesceKey: key("B", "title"),
      atMs: 400,
    });
    expect(history.past).toHaveLength(4);
  });

  it("sorts a key copy without mutating the caller and coalesces equivalent orderings", () => {
    const firstKey: CoalesceKey = { kind: "updateProps", nodeId: "A", propKeys: ["subtitle", "title"] };
    const secondKey: CoalesceKey = { kind: "updateProps", nodeId: "A", propKeys: ["title", "subtitle"] };
    const history = pushHistory(createHistory(), entry("before"), { coalesceKey: firstKey, atMs: 0 });
    const next = pushHistory(history, entry("ignored"), { coalesceKey: secondKey, atMs: 1 });

    expect(firstKey.propKeys).toEqual(["subtitle", "title"]);
    expect(next.past).toHaveLength(1);
    expect(next.past[0]!.key).toEqual({ kind: "updateProps", nodeId: "A", propKeys: ["subtitle", "title"].sort() });
  });

  it("starts a fresh entry for null keys and for gaps outside the inclusive window", () => {
    let history = pushHistory(createHistory(), entry("null-1"), { coalesceKey: null, atMs: 0 });
    history = pushHistory(history, entry("null-2"), { coalesceKey: null, atMs: 1 });
    expect(history.past).toHaveLength(2);

    history = pushHistory(history, entry("keyed-1"), { coalesceKey: key("A", "title"), atMs: 10 });
    history = pushHistory(history, entry("keyed-at-boundary"), {
      coalesceKey: key("A", "title"),
      atMs: 10 + HISTORY_COALESCE_WINDOW_MS,
    });
    expect(history.past).toHaveLength(3);
    expect(history.past[2]!.entry.document.name).toBe("keyed-1");

    history = pushHistory(history, entry("keyed-after-window"), {
      coalesceKey: key("A", "title"),
      atMs: 10 + 2 * HISTORY_COALESCE_WINDOW_MS + 1,
    });
    expect(history.past).toHaveLength(4);
    expect(history.past[3]!.entry.document.name).toBe("keyed-after-window");
  });

  it("evicts the oldest entry when the depth cap is reached", () => {
    let history = createHistory();
    for (let index = 0; index < HISTORY_MAX_DEPTH + 2; index += 1) {
      history = pushHistory(history, entry(`entry-${index}`), { coalesceKey: null, atMs: index });
    }

    expect(history.past).toHaveLength(HISTORY_MAX_DEPTH);
    expect(history.past[0]!.entry.document.name).toBe("entry-2");
    expect(history.past.at(-1)!.entry.document.name).toBe(`entry-${HISTORY_MAX_DEPTH + 1}`);
  });

  it("stores a deep snapshot rather than the caller's live document", () => {
    const source = entry("original");
    source.document.root.push({
      id: "node",
      componentId: "fixture.text",
      componentVersion: 1,
      props: { value: "original" },
      slots: {},
    });
    const history = pushHistory(createHistory(), source, { coalesceKey: null, atMs: 0 });
    source.document.name = "mutated";
    source.document.root[0]!.props.value = "mutated";

    expect(history.past[0]!.entry.document.name).toBe("original");
    expect(history.past[0]!.entry.document.root[0]!.props.value).toBe("original");
    expect(history.past[0]!.entry.document).not.toBe(source.document);
    expect(history.past[0]!.entry.document.root[0]).not.toBe(source.document.root[0]);
  });
});

describe("undoHistory and redoHistory", () => {
  it("moves snapshots between stacks in undo then redo order and returns null at either end", () => {
    const history = pushHistory(createHistory(), entry("before"), { coalesceKey: key("A", "title"), atMs: 1 });
    const current = entry("after");
    const undone = undoHistory(history, current);
    expect(undone).not.toBeNull();
    expect(undone!.restore.document.name).toBe("before");
    expect(names(undone!.history)).toEqual({ past: [], future: ["after"] });
    expect(undone!.history.coalescing).toBeNull();
    expect(undoHistory(undone!.history, entry("before"))).toBeNull();

    const redone = redoHistory(undone!.history, entry("before"));
    expect(redone).not.toBeNull();
    expect(redone!.restore.document.name).toBe("after");
    expect(names(redone!.history)).toEqual({ past: ["before"], future: [] });
    expect(redone!.history.past[0]!.key).toBeNull();
    expect(redone!.history.coalescing).toBeNull();
    expect(redoHistory(redone!.history, entry("after"))).toBeNull();
  });

  it("snapshots current and restored entries across both directions", () => {
    const before = entry("before");
    const current = entry("current");
    const history = pushHistory(createHistory(), before, { coalesceKey: null, atMs: 0 });
    const undone = undoHistory(history, current)!;
    current.document.name = "changed-current";
    undone.restore.document.name = "changed-restore";
    expect(undone.history.future[0]!.document.name).toBe("current");

    const redone = redoHistory(undone.history, entry("before"))!;
    expect(redone.restore.document.name).toBe("current");
    redone.restore.document.name = "changed-again";
    expect(redone.history.past[0]!.entry.document.name).toBe("before");
  });
});

describe("coalescing barriers", () => {
  it("breaks the group without changing either stack", () => {
    const history = pushHistory(createHistory(), entry("before"), { coalesceKey: key("A", "title"), atMs: 0 });
    const broken = breakHistoryCoalescing(history);
    expect(broken.past).toBe(history.past);
    expect(broken.future).toBe(history.future);
    expect(broken.coalescing).toBeNull();

    const next = pushHistory(broken, entry("new-group"), { coalesceKey: key("A", "title"), atMs: 1 });
    expect(next.past).toHaveLength(2);
    expect(next.past[0]!.entry.document.name).toBe("before");
  });

  it("ends coalescing on undo, redo, and clear", () => {
    const keyed = pushHistory(createHistory(), entry("before"), { coalesceKey: key("A", "title"), atMs: 0 });
    const undone = undoHistory(keyed, entry("after"))!;
    expect(undone.history.coalescing).toBeNull();

    const redone = redoHistory(undone.history, entry("before"))!;
    expect(redone.history.coalescing).toBeNull();
    expect(clearHistory()).toEqual({ past: [], future: [], coalescing: null });
  });
});
