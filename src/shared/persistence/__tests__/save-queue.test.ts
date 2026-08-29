import { describe, expect, it } from "vitest";
import {
  SaveQueueClosedError,
  createSaveQueue,
} from "../save-queue";
import type {
  SaveQueue,
  SaveQueueRef,
  SaveQueueSnapshot,
} from "../save-queue";

interface NoteRecord {
  id: string;
  title: string;
  tags: string[];
}

const ref = { providerId: "notes", recordId: "note-a" } as const satisfies SaveQueueRef;

function record(title: string, id = ref.recordId): NoteRecord {
  return { id, title, tags: ["draft"] };
}

function controlled<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface WriteAttempt {
  snapshot: SaveQueueSnapshot<NoteRecord>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

function queueHarness(): { queue: SaveQueue<NoteRecord>; attempts: WriteAttempt[] } {
  const attempts: WriteAttempt[] = [];
  const queue = createSaveQueue<NoteRecord>({
    ref,
    initialRecord: record("initial"),
    write: (snapshot) => {
      const pending = controlled<void>();
      attempts.push({ snapshot, resolve: () => pending.resolve(), reject: pending.reject });
      return pending.promise;
    },
  });
  return { queue, attempts };
}

async function advancePromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("generic revision-aware save queue", () => {
  it("coalesces edits during one write and persists the newest revision next", async () => {
    const { queue, attempts } = queueHarness();
    queue.edit(ref, record("A"));
    queue.edit(ref, record("B"));
    queue.edit(ref, record("C"));

    await advancePromises();
    expect(attempts).toHaveLength(1);
    expect(attempts[0].snapshot).toMatchObject({
      revision: 1,
      record: { title: "A" },
    });
    expect(Object.isFrozen(attempts[0].snapshot.record)).toBe(true);

    attempts[0].resolve();
    await advancePromises();
    expect(attempts).toHaveLength(2);
    expect(attempts[1].snapshot).toMatchObject({
      revision: 3,
      record: { title: "C" },
    });

    attempts[1].resolve();
    await queue.flush();
    expect(queue.state).toMatchObject({
      status: "saved",
      dirty: false,
      draftRevision: 3,
      savedRevision: 3,
    });
  });

  it("keeps flush pending until the latest edit wins settlement", async () => {
    const { queue, attempts } = queueHarness();
    queue.edit(ref, record("first"));
    const flush = queue.flush();
    queue.edit(ref, record("latest"));

    await advancePromises();
    attempts[0].resolve();
    await advancePromises();
    expect(attempts[1].snapshot.revision).toBe(2);
    expect(queue.state).toMatchObject({
      status: "saving",
      savedRevision: 1,
      draftRevision: 2,
      savingRevision: 2,
    });

    attempts[1].resolve();
    await flush;
    expect(queue.state).toMatchObject({ status: "saved", savedRevision: 2 });
  });

  it("closes without starting pending drafts and ignores the late write settlement", async () => {
    const { queue, attempts } = queueHarness();
    queue.edit(ref, record("pending"));
    await advancePromises();

    const close = queue.close();
    expect(queue.state).toMatchObject({
      closed: true,
      status: "dirty",
      draftRevision: 1,
      savedRevision: 0,
    });
    await expect(queue.flush()).rejects.toBeInstanceOf(SaveQueueClosedError);
    expect(() => queue.edit(ref, record("after-close"))).toThrow(SaveQueueClosedError);
    expect(() => queue.retry()).toThrow(SaveQueueClosedError);

    attempts[0].resolve();
    await close;
    expect(queue.state).toMatchObject({
      closed: true,
      status: "dirty",
      draft: { title: "pending" },
      savedRevision: 0,
    });
    expect(queue.close()).toBe(close);
  });
});
