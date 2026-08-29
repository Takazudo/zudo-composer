import { describe, expect, it, vi } from "vitest";
import type { SitemapRecord, SitemapRecordLoadOutcome } from "../../../../sitemapper/library";
import { createSitemapperRecordTransitions, type SitemapperRecordSession } from "../record-transition";

function record(id: string, title = id): SitemapRecord {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    document: {
      schemaVersion: 1,
      id,
      name: title,
      root: [{ id: `${id}-home`, title: "Home", children: [] }],
    },
  };
}

function harness(records = [record("one"), record("two")]) {
  const values = new Map(records.map((value) => [value.id, value]));
  const calls: string[] = [];
  const sessions = new Map<string, SitemapperRecordSession>();
  const store = {
    get: vi.fn(async (id: string): Promise<SitemapRecordLoadOutcome> => {
      const value = values.get(id);
      return value ? { status: "loaded", record: value } : { status: "not-found", id };
    }),
    put: vi.fn(async (value: SitemapRecord) => { values.set(value.id, value); }),
  };
  const createSession = vi.fn((value: SitemapRecord): SitemapperRecordSession => {
    let draft = value;
    const session = {
      flushPropUpdates: vi.fn(() => { calls.push(`props:${value.id}`); }),
      queue: {
        get state() {
          return { status: "saved", draft } as never;
        },
        flush: vi.fn(async () => { calls.push(`queue.flush:${value.id}`); }),
        close: vi.fn(async () => { calls.push(`queue.close:${value.id}`); }),
      },
    };
    Object.defineProperty(session, "draft", {
      set(next: SitemapRecord) { draft = next; },
    });
    sessions.set(value.id, session);
    return session;
  });
  const transitions = createSitemapperRecordTransitions({
    store,
    createSession,
    idFactory: () => "copy",
    now: () => "2026-03-01T00:00:00.000Z",
  });
  return { calls, sessions, store, transitions, values };
}

describe("record transitions", () => {
  it("starts at the index, opens, switches, and returns to the index", async () => {
    const { transitions } = harness();
    expect(transitions.state.view).toBe("index");
    await transitions.open("one");
    expect(transitions.state).toMatchObject({ view: "record", record: { id: "one" } });
    await transitions.switchTo("two");
    expect(transitions.state).toMatchObject({ view: "record", record: { id: "two" } });
    await transitions.backToIndex();
    expect(transitions.state).toEqual({ view: "index", error: null });
  });

  it("always leaves in props-flush, queue-flush, queue-close order", async () => {
    const { calls, transitions } = harness();
    await transitions.open("one");
    await transitions.switchTo("two");
    expect(calls).toEqual(["props:one", "queue.flush:one", "queue.close:one"]);
  });

  it("stays on the current record and surfaces a save failure without closing", async () => {
    const { sessions, transitions } = harness();
    await transitions.open("one");
    const session = sessions.get("one")!;
    vi.mocked(session.queue.flush).mockRejectedValueOnce(new Error("disk full"));
    const result = await transitions.switchTo("two");
    expect(result).toMatchObject({ status: "failed", error: { code: "save-failed" } });
    expect(transitions.state).toMatchObject({ view: "record", record: { id: "one" }, error: { message: "Could not save the current sitemap." } });
    expect(session.queue.close).not.toHaveBeenCalled();
  });

  it("duplicates the flushed live draft and opens the duplicate", async () => {
    const { sessions, store, transitions } = harness([record("one", "Original")]);
    await transitions.open("one");
    const session = sessions.get("one")! as SitemapperRecordSession & { draft: SitemapRecord };
    session.draft = {
      ...record("one", "Original"),
      document: { ...record("one", "Original").document, root: [{ id: "one-home", title: "Pending", children: [] }] },
    };
    const result = await transitions.duplicateCurrent();
    expect(result).toMatchObject({ status: "committed", state: { view: "record", record: { id: "copy" } } });
    expect(store.put).toHaveBeenCalledWith(expect.objectContaining({
      id: "copy",
      document: expect.objectContaining({ id: "copy", name: "Original copy", root: [expect.objectContaining({ title: "Pending" })] }),
    }));
  });

  it("a fresh coordinator represents reload and returns to the index", async () => {
    const first = harness();
    await first.transitions.open("one");
    const reloaded = harness();
    expect(reloaded.transitions.state).toEqual({ view: "index", error: null });
  });
});
