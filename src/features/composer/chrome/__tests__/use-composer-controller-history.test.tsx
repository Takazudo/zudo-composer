import "../../test-support/cleanup";
import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSaveQueue,
  createSequentialIdFactory,
  publishGlobalTemplate,
  type CompositionDocument,
  type CompositionRecord,
  type CompositionRecordRef,
  type CompositionSaveOutcome,
  type JsonObject,
  type RootPolicy,
  type SaveQueue,
  type SaveQueueSnapshot,
} from "../../../../composer/browser";
import {
  COMPONENT_IDS as C,
  FIXTURE_COMPONENT_IDS as F,
  SLOT_IDS as S,
  doc,
  fixtureManifest,
  makeAbcDocument,
  node,
  resetFixtureIds,
} from "../../../../composer/__tests__/fixtures";
import {
  INSPECTOR_COMMIT_DEBOUNCE_MS,
  useComposerController,
  type ComposerController,
} from "../use-composer-controller";

const ref = { providerId: "indexeddb", recordId: "record-history" } as const;

interface Attempt {
  snapshot: SaveQueueSnapshot<CompositionRecord, CompositionRecordRef>;
  resolve(): void;
}

function makeRecord(source = makeAbcDocument()): CompositionRecord {
  const document = structuredClone(source);
  document.id = ref.recordId;
  return {
    id: ref.recordId,
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    document,
  };
}

function controlledQueue(initialRecord: CompositionRecord): {
  queue: SaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>;
  attempts: Attempt[];
} {
  const attempts: Attempt[] = [];
  const queue = createSaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>({
    ref,
    initialRecord,
    write: (snapshot) => new Promise((resolve) => {
      attempts.push({
        snapshot,
        resolve: () => resolve({ canonical: { status: "saved" }, derived: { status: "current", records: [] } }),
      });
    }),
  });
  return { queue, attempts };
}

function setup(source?: CompositionDocument, rootPolicy?: RootPolicy, historyNow?: () => number) {
  resetFixtureIds();
  const initialRecord = makeRecord(source);
  const harness = controlledQueue(initialRecord);
  const hook = renderHook(() => useComposerController({
    manifest: fixtureManifest,
    record: initialRecord,
    saveQueue: harness.queue,
    rootPolicy,
    idFactory: createSequentialIdFactory("history"),
    now: () => "2026-01-02T04:04:05.000Z",
    historyNow,
  }));
  return { ...hook, ...harness };
}

function labelOfA(document: CompositionDocument): unknown {
  return document.root[0]!.slots.left![0]!.props.label;
}

async function advancePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useComposerController — history", () => {
  it("restores and reapplies every undoable document mutation", () => {
    const scenarios: Array<{ prepare?(controller: ComposerController): void; run(controller: ComposerController): void }> = [
      { run: (controller) => controller.add({ parentId: "split", slotId: S.splitRight, index: 1 }, F.box) },
      { run: (controller) => controller.rename("Renamed") },
      { run: (controller) => controller.updateProps("A", { label: "Changed" }) },
      { run: (controller) => controller.reorder("B", "down") },
      { run: (controller) => controller.remove("B") },
      { run: (controller) => controller.cut("B") },
      {
        prepare: (controller) => controller.copy("A"),
        run: (controller) => controller.paste({ parentId: "split", slotId: S.splitRight, index: 1 }),
      },
      {
        run: (controller) => controller.insertForest(
          [node(F.box, { label: "Pattern" }, {}, "pattern-source")],
          { parentId: "split", slotId: S.splitRight, index: 1 },
        ),
      },
      { run: (controller) => controller.duplicate("B") },
      { run: (controller) => controller.drop("B", { parentId: "split", slotId: S.splitRight, index: 2 }, false) },
    ];

    for (const scenario of scenarios) {
      const hook = setup();
      act(() => scenario.prepare?.(hook.result.current));
      const before = structuredClone(hook.result.current.state.document);
      act(() => scenario.run(hook.result.current));
      expect(hook.result.current.lastError).toBeNull();
      const after = structuredClone(hook.result.current.state.document);
      expect(after).not.toEqual(before);

      act(() => hook.result.current.undo());
      expect(hook.result.current.state.document).toEqual(before);
      act(() => hook.result.current.redo());
      expect(hook.result.current.state.document).toEqual(after);
      hook.unmount();
    }
  });

  it("undoes and redoes through the save queue, with end-of-stack no-ops", () => {
    const { result, queue } = setup();
    const initial = structuredClone(result.current.state.document);

    act(() => result.current.rename("Renamed"));
    expect(result.current.canUndo).toBe(true);
    const statusBeforeUndo = result.current.state.saveStatus;
    act(() => result.current.undo());
    expect(result.current.state.document).toEqual(initial);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
    expect(queue.state.draftRevision).toBe(2);

    const statusAtEnd = result.current.state.saveStatus;
    act(() => result.current.undo());
    expect(result.current.state.saveStatus).toEqual(statusAtEnd);
    expect(queue.state.draftRevision).toBe(2);

    act(() => result.current.redo());
    expect(result.current.state.document.name).toBe("Renamed");
    expect(queue.state.draftRevision).toBe(3);
    const statusAfterRedo = result.current.state.saveStatus;
    act(() => result.current.redo());
    expect(result.current.state.saveStatus).toEqual(statusAfterRedo);
    expect(statusBeforeUndo.kind).toBe("saving");
  });

  it("coalesces sorted same-field prop bursts, respects the window, and breaks on selection", () => {
    let atMs = 0;
    const coalesced = setup(undefined, undefined, () => atMs);
    act(() => coalesced.result.current.updateProps("A", { size: 1, label: "A1" }));
    atMs = 100;
    act(() => coalesced.result.current.updateProps("A", { label: "A2", size: 2 }));
    act(() => coalesced.result.current.undo());
    expect(labelOfA(coalesced.result.current.state.document)).toBe("A");
    expect(coalesced.result.current.canUndo).toBe(false);
    coalesced.unmount();

    atMs = 0;
    const separated = setup(undefined, undefined, () => atMs);
    act(() => separated.result.current.updateProps("A", { label: "A1" }));
    atMs = 1001;
    act(() => separated.result.current.updateProps("A", { label: "A2" }));
    act(() => separated.result.current.undo());
    expect(labelOfA(separated.result.current.state.document)).toBe("A1");
    act(() => separated.result.current.undo());
    expect(labelOfA(separated.result.current.state.document)).toBe("A");
    separated.unmount();

    atMs = 0;
    const interrupted = setup(undefined, undefined, () => atMs);
    act(() => interrupted.result.current.updateProps("A", { label: "A1" }));
    act(() => interrupted.result.current.select("B"));
    atMs = 100;
    act(() => interrupted.result.current.updateProps("A", { label: "A2" }));
    act(() => interrupted.result.current.undo());
    expect(labelOfA(interrupted.result.current.state.document)).toBe("A1");
    expect(interrupted.result.current.state.selectedId).toBe("B");
  });

  it("coalesces exact structured leaves while structural edits checkpoint whole arrays", () => {
    let atMs = 0;
    const initialActions: JsonObject[] = [
      { label: "Start", href: "/start" },
      { label: "Docs", href: "/docs" },
    ];
    const source = doc([node(F.box, { label: "Hero", actions: initialActions }, {}, "A")]);
    const { result } = setup(source, undefined, () => atMs);
    const actions = () => result.current.state.document.root[0]!.props.actions;

    act(() => result.current.select("A"));
    const firstTyping = structuredClone(initialActions);
    firstTyping[0]!.label = "Start now";
    act(() => result.current.updateProps("A", { actions: firstTyping }, [["actions", 0, "label"]]));
    atMs = 100;
    const secondTyping = structuredClone(firstTyping);
    secondTyping[0]!.label = "Start today";
    act(() => result.current.updateProps("A", { actions: secondTyping }, [["actions", 0, "label"]]));

    const added = [...secondTyping, { label: "Contact", href: "/contact" }];
    atMs = 200;
    act(() => result.current.updateProps("A", { actions: added }, null));
    const reordered = [added[2]!, added[0]!, added[1]!];
    atMs = 300;
    act(() => result.current.updateProps("A", { actions: reordered }, null));
    expect(actions()).toEqual(reordered);

    act(() => result.current.undo());
    expect(actions()).toEqual(added);
    expect(result.current.state.selectedId).toBe("A");
    expect(result.current.record.document).toEqual(result.current.state.document);
    act(() => result.current.undo());
    expect(actions()).toEqual(secondTyping);
    act(() => result.current.undo());
    expect(actions()).toEqual(initialActions);
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.redo());
    expect(actions()).toEqual(secondTyping);
    act(() => result.current.redo());
    expect(actions()).toEqual(added);
    act(() => result.current.redo());
    expect(actions()).toEqual(reordered);
    expect(result.current.state.selectedId).toBe("A");
    expect(result.current.record.document).toEqual(result.current.state.document);
  });

  it("keeps a mixed pending structural and leaf batch non-coalescing", () => {
    let atMs = 0;
    const initialActions: JsonObject[] = [{ label: "Start", href: "/start" }];
    const source = doc([node(F.box, { label: "Hero", actions: initialActions }, {}, "A")]);
    const { result } = setup(source, undefined, () => atMs);
    const actions = () => result.current.state.document.root[0]!.props.actions;
    const added: JsonObject[] = [...initialActions, { label: "Docs", href: "/docs" }];
    const edited = structuredClone(added);
    edited[1]!.label = "Read docs";

    act(() => {
      result.current.updatePropsDebounced("A", { actions: added }, null);
      result.current.updatePropsDebounced("A", { actions: edited }, [["actions", 1, "label"]]);
      result.current.flushPropUpdates();
    });
    const next = structuredClone(edited);
    next[1]!.label = "Read the docs";
    atMs = 100;
    act(() => result.current.updateProps("A", { actions: next }, [["actions", 1, "label"]]));

    act(() => result.current.undo());
    expect(actions()).toEqual(edited);
    act(() => result.current.undo());
    expect(actions()).toEqual(initialActions);
  });

  it("flushes pending inspector input before undo and queues the reverted latest revision", async () => {
    vi.useFakeTimers();
    const { result, attempts, queue } = setup();
    act(() => result.current.updatePropsDebounced("A", { label: "pending" }));
    expect(labelOfA(result.current.state.document)).toBe("A");

    act(() => result.current.undo());
    expect(labelOfA(result.current.state.document)).toBe("A");
    expect(queue.state.draftRevision).toBe(2);
    await advancePromises();
    expect(attempts).toHaveLength(1);
    expect(labelOfA(attempts[0]!.snapshot.record.document)).toBe("pending");

    attempts[0]!.resolve();
    await advancePromises();
    expect(attempts).toHaveLength(2);
    expect(labelOfA(attempts[1]!.snapshot.record.document)).toBe("A");
    act(() => { vi.advanceTimersByTime(INSPECTOR_COMMIT_DEBOUNCE_MS * 2); });
    expect(queue.state.draftRevision).toBe(2);
  });

  it("repairs/reveals restored selection while preserving session-only state", () => {
    const { result } = setup();
    act(() => {
      result.current.copy("A");
      result.current.setViewport("mobile");
      result.current.select("B");
      result.current.remove("B");
      result.current.setExpanded("split", false);
    });
    expect(result.current.state.selectedId).toBe("C");

    act(() => result.current.undo());
    expect(result.current.state.selectedId).toBe("B");
    expect(result.current.state.expandedIds.has("split")).toBe(true);
    expect(result.current.state.clipboard?.id).toBe("A");
    expect(result.current.state.viewport).toBe("mobile");

    const invalidSelection = setup();
    act(() => {
      invalidSelection.result.current.select("missing");
      invalidSelection.result.current.rename("repair checkpoint");
      invalidSelection.result.current.undo();
    });
    expect(invalidSelection.result.current.state.selectedId).toBe("split");
  });

  it("disables history in Preview and clears redo on a new mutation", () => {
    const { result } = setup();
    act(() => result.current.rename("First"));
    act(() => result.current.setMode("preview"));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.undo());
    expect(result.current.state.document.name).toBe("First");

    act(() => result.current.setMode("edit"));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.rename("Replacement"));
    expect(result.current.canRedo).toBe(false);
  });

  it("does not flush pending prop edits when history commands no-op in Preview", () => {
    vi.useFakeTimers();
    const { result, queue } = setup();
    act(() => result.current.setMode("preview"));
    act(() => result.current.updatePropsDebounced("A", { label: "pending" }));
    expect(queue.state.draftRevision).toBe(0);

    act(() => {
      result.current.undo();
      result.current.redo();
    });
    expect(labelOfA(result.current.state.document)).toBe("A");
    expect(queue.state.draftRevision).toBe(0);

    act(() => {
      result.current.flushPropUpdates();
    });
    expect(labelOfA(result.current.state.document)).toBe("pending");
  });

  it("clears history only for a material effective root-policy change", () => {
    const source = makeAbcDocument();
    source.binding = { sourceRecordId: "source", outletId: "outlet" };
    const initialPolicy = { kind: "resolved", accepts: [F.box, F.widgetA], cardinality: "many" } as const;
    const { result } = setup(source, initialPolicy);
    act(() => result.current.rename("Undoable"));
    act(() => result.current.setRootPolicy({
      kind: "resolved",
      accepts: [F.widgetA, F.box],
      cardinality: "many",
    }));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.setRootPolicy({ kind: "resolved", accepts: [F.box], cardinality: "single" }));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("clears both stacks after each accepted publication/binding barrier", () => {
    const globalCandidate = () => doc([node(C.stack, {}, { [S.stackChildren]: [] }, "owner")]);
    const twoSlots = () => doc([node(C.splitLayout, {}, { [S.splitLeft]: [], [S.splitRight]: [] }, "owner")]);
    const publish = (document: CompositionDocument, target: { parentId: string; slotId: string }) => {
      const result = publishGlobalTemplate(document, fixtureManifest, target, "Main", createSequentialIdFactory("outlet"));
      if (!result.ok) throw new Error(result.error);
      return result.document;
    };
    const firstTarget = { parentId: "owner", slotId: S.splitLeft };
    const secondTarget = { parentId: "owner", slotId: S.splitRight };
    const contract = {
      sourceRecordId: "source",
      outletId: "outlet",
      sameProvider: true,
      sourceIsGlobalTemplate: true,
      sourceHasBinding: false,
      rootPolicy: { kind: "resolved" as const, cardinality: "many" as const },
    };
    const bound = makeAbcDocument();
    bound.binding = { sourceRecordId: "source", outletId: "outlet" };

    const scenarios: Array<{ document: CompositionDocument; rootPolicy?: RootPolicy; run(controller: ComposerController): void }> = [
      { document: makeAbcDocument(), run: (controller) => controller.publishPattern() },
      { document: globalCandidate(), run: (controller) => controller.publishGlobalTemplate({ parentId: "owner", slotId: S.stackChildren }, "Main") },
      { document: publish(globalCandidate(), { parentId: "owner", slotId: S.stackChildren }), run: (controller) => controller.setGlobalTemplateOutlet({ parentId: "owner", slotId: S.stackChildren }, "Changed") },
      { document: publish(globalCandidate(), { parentId: "owner", slotId: S.stackChildren }), run: (controller) => controller.renameGlobalTemplateOutlet("Changed") },
      { document: publish(twoSlots(), firstTarget), run: (controller) => controller.reassignGlobalTemplateOutlet(secondTarget) },
      { document: publish(globalCandidate(), { parentId: "owner", slotId: S.stackChildren }), run: (controller) => controller.clearPublication({ dependentCount: 0 }) },
      { document: makeAbcDocument(), run: (controller) => controller.bindConsumer(contract) },
      { document: bound, rootPolicy: contract.rootPolicy, run: (controller) => controller.removeBinding() },
    ];

    for (const scenario of scenarios) {
      const hook = setup(scenario.document, scenario.rootPolicy);
      act(() => hook.result.current.rename("history seed"));
      expect(hook.result.current.canUndo).toBe(true);
      act(() => scenario.run(hook.result.current));
      expect(hook.result.current.lastError).toBeNull();
      expect(hook.result.current.canUndo).toBe(false);
      expect(hook.result.current.canRedo).toBe(false);
      hook.unmount();
    }
  });
});
