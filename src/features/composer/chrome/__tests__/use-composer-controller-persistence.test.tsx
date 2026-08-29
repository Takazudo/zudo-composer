import "../../test-support/cleanup";
import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSaveQueue,
  createSequentialIdFactory,
  type CompositionDocument,
  type CompositionRecord,
  type CompositionSaveOutcome,
  type CompositionRecordRef,
  type SaveQueue,
  type SaveQueueSnapshot,
} from "../../../../composer/browser";
import {
  FIXTURE_COMPONENT_IDS as F,
  fixtureManifest,
  makeAbcDocument,
  node,
  resetFixtureIds,
} from "../../../../composer/__tests__/fixtures";
import {
  INSPECTOR_COMMIT_DEBOUNCE_MS,
  useComposerController,
} from "../use-composer-controller";

const ref = { providerId: "indexeddb", recordId: "record-a" } as const;

function record(): CompositionRecord {
  const document = makeAbcDocument();
  document.id = ref.recordId;
  return {
    id: ref.recordId,
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    document,
  };
}

interface Attempt {
  snapshot: SaveQueueSnapshot<CompositionRecord, CompositionRecordRef>;
  resolve(): void;
  reject(reason: unknown): void;
}

function controlledQueue(initialRecord = record()): {
  queue: SaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>;
  attempts: Attempt[];
} {
  const attempts: Attempt[] = [];
  const queue = createSaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>({
    ref,
    initialRecord,
    write: (snapshot) =>
      new Promise<CompositionSaveOutcome>((resolve, reject) => {
        attempts.push({
          snapshot,
          resolve: () => resolve({ canonical: { status: "saved" }, derived: { status: "current", records: [] } }),
          reject,
        });
      }),
  });
  return { queue, attempts };
}

function setup() {
  resetFixtureIds();
  const initialRecord = record();
  const harness = controlledQueue(initialRecord);
  const idFactory = createSequentialIdFactory("n");
  const hook = renderHook(() =>
    useComposerController({
      manifest: fixtureManifest,
      record: initialRecord,
      saveQueue: harness.queue,
      idFactory,
      now: () => "2026-01-02T04:04:05.000Z",
    }),
  );
  return { ...hook, ...harness };
}

async function advancePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function labelOfA(document: CompositionDocument): unknown {
  return document.root[0]!.slots.left![0]!.props.label;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useComposerController — record persistence", () => {
  it("queues exactly one revision for one accepted atomic Pattern forest insertion", async () => {
    const { result, attempts } = setup();
    const sourceRoots = [node(F.box, { label: "Pattern A" }, {}, "source-a"), node(F.box, { label: "Pattern B" }, {}, "source-b")];

    act(() => { result.current.insertForest(sourceRoots, { parentId: "split", slotId: "right", index: 1 }); });
    await advancePromises();

    expect(result.current.lastError).toBeNull();
    expect(attempts).toHaveLength(1);
    const right = attempts[0]!.snapshot.record.document.root[0]!.slots.right;
    expect(right.map((item) => item.props.label)).toEqual(["B", "Pattern A", "Pattern B", "C"]);
    expect(result.current.state.selectedId).toBe(right[1]!.id);
  });

  it("writes exactly one revision for an accepted binding command and none for a rejected reuse command", async () => {
    const { result, attempts } = setup();
    act(() => result.current.bindConsumer({
      sourceRecordId: "source-record",
      outletId: "outlet-main",
      sameProvider: true,
      sourceIsGlobalTemplate: true,
      sourceHasBinding: false,
      rootPolicy: { kind: "resolved", cardinality: "many" },
    }));
    await advancePromises();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.snapshot.record.document.binding).toEqual({
      sourceRecordId: "source-record",
      outletId: "outlet-main",
    });

    act(() => result.current.publishPattern());
    expect(result.current.lastError).toMatch(/bound/i);
    expect(attempts).toHaveLength(1);
  });

  it("serializes overlapping controller edits and saves the newest retained record", async () => {
    const { result, queue, attempts } = setup();

    act(() => result.current.updateProps("A", { label: "A1" }));
    act(() => result.current.updateProps("A", { label: "A2" }));
    expect(result.current.state.saveStatus).toEqual({ kind: "saving" });
    await advancePromises();
    expect(attempts).toHaveLength(1);
    expect(labelOfA(attempts[0]!.snapshot.record.document)).toBe("A1");

    attempts[0]!.resolve();
    await advancePromises();
    expect(attempts).toHaveLength(2);
    expect(labelOfA(attempts[1]!.snapshot.record.document)).toBe("A2");
    attempts[1]!.resolve();
    await act(async () => result.current.flushPersistence());

    expect(queue.state.status).toBe("saved");
    expect(result.current.state.saveStatus).toEqual({ kind: "saved" });
  });

  it("retains the mounted draft after a failed flush, then Retry saves that same draft", async () => {
    const { result, attempts } = setup();
    act(() => result.current.updateProps("A", { label: "Keep me" }));
    const flush = result.current.flushPersistence().catch((error: unknown) => error);
    await advancePromises();

    const failure = new Error("offline");
    await act(async () => {
      attempts[0]!.reject(failure);
      await advancePromises();
    });
    expect(await flush).toBe(failure);
    expect(labelOfA(result.current.state.document)).toBe("Keep me");
    expect(result.current.state.saveStatus).toEqual({ kind: "error", reason: "offline" });

    act(() => result.current.retrySave());
    await advancePromises();
    expect(attempts[1]!.snapshot.record.document).toEqual(result.current.state.document);
    attempts[1]!.resolve();
    await act(async () => result.current.flushPersistence());
    expect(result.current.state.saveStatus).toEqual({ kind: "saved" });
  });

  it("a newer edit after failure restarts persistence without discarding either draft", async () => {
    const { result, attempts } = setup();
    act(() => result.current.updateProps("A", { label: "First" }));
    await advancePromises();
    attempts[0]!.reject(new Error("temporary"));
    await advancePromises();

    act(() => result.current.updateProps("A", { label: "Newer" }));
    await advancePromises();
    expect(attempts[1]!.snapshot.record.document.root[0]!.slots.left![0]!.props.label).toBe("Newer");
    expect(labelOfA(result.current.state.document)).toBe("Newer");
  });

  it("marks debounce input dirty immediately and synchronously flushes it before unload/export", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { result, attempts } = setup();
    act(() => result.current.updatePropsDebounced("A", { label: "Latest" }));

    expect(result.current.state.saveStatus).toEqual({ kind: "dirty" });
    expect(labelOfA(result.current.state.document)).toBe("A");

    let blocked = false;
    act(() => {
      blocked = !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    });
    expect(blocked).toBe(true);
    expect(labelOfA(result.current.flushPropUpdates())).toBe("Latest");
    await advancePromises();
    expect(labelOfA(attempts[0]!.snapshot.record.document)).toBe("Latest");

    act(() => { vi.advanceTimersByTime(INSPECTOR_COMMIT_DEBOUNCE_MS * 2); });
    expect(attempts).toHaveLength(1);
  });

  it("restores the queue status when a pending prop command is rejected", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { result, attempts } = setup();
    act(() => result.current.updatePropsDebounced("missing", { label: "Invalid" }));
    expect(result.current.state.saveStatus).toEqual({ kind: "dirty" });

    act(() => { result.current.flushPropUpdates(); });
    expect(result.current.lastError).toMatch(/not found/i);
    expect(result.current.state.saveStatus).toEqual({ kind: "saved" });
    await expect(result.current.flushPersistence()).resolves.toBeUndefined();
    expect(attempts).toHaveLength(0);
  });

  it("closes on unmount without reporting a late write as saved or leaking its rejection", async () => {
    const { result, queue, attempts, unmount } = setup();
    act(() => result.current.updateProps("A", { label: "In flight" }));
    await advancePromises();
    unmount();
    expect(queue.state).toMatchObject({ closed: true, dirty: true });

    attempts[0]!.reject(new Error("late failure"));
    await advancePromises();
    expect(queue.state).toMatchObject({ closed: true, dirty: true, savedRevision: 0 });
  });

  it("keeps canonical Saved while exposing a separate blocked generated-output outcome", async () => {
    const initialRecord = record();
    const queue = createSaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>({
      ref,
      initialRecord,
      write: async () => ({
        canonical: { status: "saved" },
        derived: {
          status: "blocked",
          records: [{ recordId: ref.recordId, status: "blocked", reason: "The linked source is unavailable." }],
        },
      }),
    });
    const hook = renderHook(() => useComposerController({
      manifest: fixtureManifest,
      record: initialRecord,
      saveQueue: queue,
      now: () => "2026-01-02T04:04:05.000Z",
    }));

    act(() => hook.result.current.rename("Canonical local edit"));
    await act(async () => hook.result.current.flushPersistence());

    expect(hook.result.current.state.saveStatus).toEqual({ kind: "saved" });
    expect(hook.result.current.state.derivedOutput).toMatchObject({
      status: "blocked",
      records: [{ recordId: ref.recordId, reason: "The linked source is unavailable." }],
    });
  });
});
