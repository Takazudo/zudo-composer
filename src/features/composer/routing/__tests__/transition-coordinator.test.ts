import { describe, expect, it, vi } from "vitest";

import type {
  CompositionLoadOutcome,
  CompositionProviderId,
  CompositionRecord,
  CompositionRecordRef,
  CompositionSaveOutcome,
  CompositionSummary,
  SaveQueueState,
} from "../../../../composer/browser";
import { COMPOSITION_SCHEMA_VERSION } from "../../../../composer/browser";

import type { ComposerRoute, ComposerRouteResolution } from "../route";
import {
  createComposerTransitionCoordinator,
  type ComposerDetailSession,
  type ComposerRoutingProvider,
  type ComposerTransitionCoordinatorOptions,
  type ComposerTransitionIntent,
} from "../transition-coordinator";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function record(id: string, name = id): CompositionRecord {
  return {
    id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    document: { schemaVersion: COMPOSITION_SCHEMA_VERSION, id, name, root: [] },
  };
}

function summary(id: string, name = id): CompositionSummary {
  return {
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    nodeCount: 0,
  };
}

function loaded(value: CompositionRecord): CompositionLoadOutcome {
  return { status: "loaded", record: value };
}

function fakeSession(
  ref: Readonly<CompositionRecordRef>,
  initialRecord: CompositionRecord,
  options: {
    draft?: CompositionRecord;
    flush?: () => Promise<void>;
    flushPendingProps?: (boundRef: Readonly<CompositionRecordRef>) => void | Promise<void>;
  } = {},
): ComposerDetailSession {
  const state = {
    status: "saved",
    ref,
    draft: options.draft ?? initialRecord,
    draftRevision: 0,
    savedRevision: 0,
    closed: false,
    dirty: false,
    saving: false,
    error: null,
  } satisfies SaveQueueState<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>;
  return {
    queue: {
      ref,
      state,
      flush: vi.fn(options.flush ?? (async () => undefined)),
    },
    flushPendingProps: vi.fn(options.flushPendingProps ?? (() => undefined)),
  };
}

function provider(
  id: CompositionProviderId,
  records: Record<string, CompositionRecord> = {},
): ComposerRoutingProvider & {
  list: ReturnType<typeof vi.fn<() => Promise<readonly CompositionSummary[]>>>;
  get: ReturnType<typeof vi.fn<(recordId: string) => Promise<CompositionLoadOutcome>>>;
} {
  return {
    id,
    list: vi.fn(async () => Object.values(records).map((item) => summary(item.id, item.document.name))),
    get: vi.fn(async (recordId) =>
      records[recordId] ? loaded(records[recordId]) : { status: "not-found", id: recordId },
    ),
  };
}

function matched(route: ComposerRoute): ComposerRouteResolution {
  return { status: "matched", route };
}

function detailIntent(
  providerId: CompositionProviderId,
  recordId: string,
  history: ComposerTransitionIntent["history"] = "push",
): ComposerTransitionIntent {
  return {
    resolution: matched({ kind: "detail", providerId, recordId }),
    url: `/composer#/composition/${providerId}/${encodeURIComponent(recordId)}`,
    history,
  };
}

function indexIntent(
  history: ComposerTransitionIntent["history"] = "push",
  indexProviderId?: CompositionProviderId,
): ComposerTransitionIntent {
  return {
    resolution: matched({ kind: "index" }),
    url: "/composer#/",
    history,
    indexProviderId,
  };
}

function harness(overrides: Partial<ComposerTransitionCoordinatorOptions> = {}) {
  const indexeddb = provider("indexeddb");
  const files = provider("files");
  const providers = new Map<string, ComposerRoutingProvider>([
    ["indexeddb", indexeddb],
    ["files", files],
  ]);
  const history = { push: vi.fn(), replace: vi.fn() };
  const preference = { read: vi.fn<() => CompositionProviderId | null>(() => null), write: vi.fn() };
  const sessions: ComposerDetailSession[] = [];
  const createDetailSession = vi.fn(
    (ref: Readonly<CompositionRecordRef>, value: CompositionRecord) => {
      const session = fakeSession(ref, value);
      sessions.push(session);
      return session;
    },
  );
  const coordinator = createComposerTransitionCoordinator({
    registry: { get: (id) => providers.get(id) },
    defaultProviderId: "indexeddb",
    preference,
    history,
    createDetailSession,
    ...overrides,
  });
  return {
    coordinator,
    indexeddb,
    files,
    providers,
    history,
    preference,
    sessions,
    createDetailSession,
  };
}

describe("latest-intent Composer transition coordinator", () => {
  it("uses a readable preference only for the index default", async () => {
    const h = harness();
    h.preference.read.mockReturnValue("files");
    h.files.list.mockResolvedValue([summary("file-a")]);

    const result = await h.coordinator.transition(indexIntent("already-applied"));

    expect(result.status).toBe("committed");
    expect(h.coordinator.state).toMatchObject({
      view: "index",
      providerId: "files",
      collection: [{ id: "file-a" }],
    });
    expect(h.indexeddb.list).not.toHaveBeenCalled();
    expect(h.preference.write).toHaveBeenCalledWith("files");
    expect(h.history.push).not.toHaveBeenCalled();
  });

  it("falls back when preference reads fail and keeps writes best-effort", async () => {
    const h = harness();
    h.preference.read.mockImplementation(() => {
      throw new Error("storage disabled");
    });
    h.preference.write.mockImplementation(() => {
      throw new Error("quota");
    });

    await expect(h.coordinator.transition(indexIntent())).resolves.toMatchObject({
      status: "committed",
    });
    expect(h.coordinator.state).toMatchObject({ view: "index", providerId: "indexeddb" });
    expect(h.history.push).toHaveBeenCalledWith("/composer#/");
  });

  it("treats a detail provider as authoritative despite another preference", async () => {
    const h = harness();
    h.preference.read.mockReturnValue("files");
    h.indexeddb.get.mockResolvedValue(loaded(record("same", "Browser copy")));
    h.indexeddb.list.mockResolvedValue([summary("same", "Browser copy")]);
    h.files.get.mockResolvedValue(loaded(record("same", "File copy")));

    await h.coordinator.transition(detailIntent("indexeddb", "same", "already-applied"));

    expect(h.coordinator.state).toMatchObject({
      view: "detail",
      providerId: "indexeddb",
      record: { document: { name: "Browser copy" } },
    });
    expect(h.preference.read).not.toHaveBeenCalled();
    expect(h.files.get).not.toHaveBeenCalled();
  });

  it("commits actionable invalid-route and unknown-record states on direct load", async () => {
    const h = harness();
    const invalid = {
      status: "not-found",
      error: {
        code: "malformed-record-id-encoding",
        message: "Bad record encoding.",
        pathname: "/composer/",
        hash: "#/composition/files/%",
      },
    } as const;

    await h.coordinator.transition({
      resolution: invalid,
      url: "/composer#/composition/files/%",
      history: "already-applied",
    });
    expect(h.coordinator.state).toMatchObject({
      view: "not-found",
      error: { code: "malformed-record-id-encoding" },
    });

    const fresh = harness();
    await fresh.coordinator.transition(detailIntent("files", "missing", "already-applied"));
    expect(fresh.coordinator.state).toMatchObject({
      view: "not-found",
      route: { kind: "detail", providerId: "files", recordId: "missing" },
      error: { code: "record-not-found" },
    });
  });

  it("loads collection and record before publishing provider UI", async () => {
    const h = harness();
    const list = deferred<readonly CompositionSummary[]>();
    const get = deferred<CompositionLoadOutcome>();
    h.files.list.mockReturnValueOnce(list.promise);
    h.files.get.mockReturnValueOnce(get.promise);
    const observed: string[] = [];
    h.coordinator.subscribe((state) => observed.push(`${state.view}:${"providerId" in state ? state.providerId : "none"}`));

    const transition = h.coordinator.transition(detailIntent("files", "target"));
    get.resolve(loaded(record("target")));
    await Promise.resolve();
    expect(h.coordinator.state).toBeNull();
    expect(observed).toEqual([]);

    list.resolve([summary("target")]);
    await expect(transition).resolves.toMatchObject({ status: "committed" });
    expect(observed).toEqual(["detail:files"]);
  });

  it("lets rapid A→B→C navigation commit only C", async () => {
    const h = harness();
    h.indexeddb.list.mockResolvedValue([summary("a")]);
    h.indexeddb.get.mockResolvedValueOnce(loaded(record("a")));
    await h.coordinator.transition(detailIntent("indexeddb", "a"));

    const bList = deferred<readonly CompositionSummary[]>();
    const bGet = deferred<CompositionLoadOutcome>();
    const cList = deferred<readonly CompositionSummary[]>();
    const cGet = deferred<CompositionLoadOutcome>();
    h.indexeddb.list.mockReturnValueOnce(bList.promise).mockReturnValueOnce(cList.promise);
    h.indexeddb.get.mockReturnValueOnce(bGet.promise).mockReturnValueOnce(cGet.promise);

    const b = h.coordinator.transition(detailIntent("indexeddb", "b"));
    await vi.waitFor(() => expect(h.indexeddb.list).toHaveBeenCalledTimes(2));
    const c = h.coordinator.transition(detailIntent("indexeddb", "c"));
    await vi.waitFor(() => expect(h.indexeddb.list).toHaveBeenCalledTimes(3));

    cList.resolve([summary("c")]);
    cGet.resolve(loaded(record("c")));
    await expect(c).resolves.toMatchObject({ status: "committed" });
    expect(h.coordinator.state).toMatchObject({ view: "detail", route: { recordId: "c" } });

    bList.resolve([summary("b")]);
    bGet.resolve(loaded(record("b")));
    await expect(b).resolves.toEqual({ status: "stale" });
    expect(h.coordinator.state).toMatchObject({ view: "detail", route: { recordId: "c" } });
    expect(h.createDetailSession).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale provider-switch failure after a newer switch succeeds", async () => {
    const h = harness();
    h.indexeddb.get.mockResolvedValueOnce(loaded(record("a")));
    await h.coordinator.transition(detailIntent("indexeddb", "a"));

    const staleFilesList = deferred<readonly CompositionSummary[]>();
    h.files.list.mockReturnValueOnce(staleFilesList.promise);
    h.files.get.mockResolvedValueOnce(loaded(record("same", "File copy")));
    h.indexeddb.get.mockResolvedValueOnce(loaded(record("c", "Browser C")));

    const files = h.coordinator.transition(detailIntent("files", "same", "already-applied"));
    await vi.waitFor(() => expect(h.files.list).toHaveBeenCalledOnce());
    const browser = h.coordinator.transition(detailIntent("indexeddb", "c", "already-applied"));
    await expect(browser).resolves.toMatchObject({ status: "committed" });

    staleFilesList.reject(new Error("late files failure"));
    await expect(files).resolves.toEqual({ status: "stale" });
    expect(h.coordinator.state).toMatchObject({
      view: "detail",
      providerId: "indexeddb",
      record: { document: { name: "Browser C" } },
    });
    expect(h.history.replace).not.toHaveBeenCalled();
  });

  it("ignores a stale get failure after a newer record succeeds", async () => {
    const h = harness();
    h.indexeddb.get.mockResolvedValueOnce(loaded(record("a")));
    await h.coordinator.transition(detailIntent("indexeddb", "a"));

    const staleGet = deferred<CompositionLoadOutcome>();
    h.indexeddb.get.mockReturnValueOnce(staleGet.promise);
    const stale = h.coordinator.transition(
      detailIntent("indexeddb", "b", "already-applied"),
    );
    await vi.waitFor(() => expect(h.indexeddb.get).toHaveBeenCalledTimes(2));

    h.indexeddb.get.mockResolvedValueOnce(loaded(record("c")));
    const latest = h.coordinator.transition(
      detailIntent("indexeddb", "c", "already-applied"),
    );
    await expect(latest).resolves.toMatchObject({ status: "committed" });

    staleGet.reject(new Error("late get failure"));
    await expect(stale).resolves.toEqual({ status: "stale" });
    expect(h.coordinator.state).toMatchObject({ route: { recordId: "c" } });
    expect(h.history.replace).not.toHaveBeenCalled();
  });

  it("opens the route provider when providers contain the same record id", async () => {
    const h = harness();
    h.indexeddb.get.mockResolvedValueOnce(loaded(record("shared", "Browser copy")));
    await h.coordinator.transition(detailIntent("indexeddb", "shared"));
    h.files.get.mockResolvedValueOnce(loaded(record("shared", "File copy")));

    await h.coordinator.transition(detailIntent("files", "shared"));

    expect(h.coordinator.state).toMatchObject({
      providerId: "files",
      route: { providerId: "files", recordId: "shared" },
      record: { document: { name: "File copy" } },
    });
  });

  it("binds the old identity through prop and queue flush before loading a target", async () => {
    const flush = deferred<void>();
    const pendingRefs: Readonly<CompositionRecordRef>[] = [];
    const old = record("old");
    const oldSession = fakeSession(
      { providerId: "indexeddb", recordId: "old" },
      old,
      {
        flush: () => flush.promise,
        flushPendingProps: (ref) => {
          pendingRefs.push(ref);
        },
      },
    );
    const h = harness({
      createDetailSession: vi.fn((ref, value) =>
        ref.providerId === "indexeddb" && ref.recordId === "old"
          ? oldSession
          : fakeSession(ref, value),
      ),
    });
    h.indexeddb.get.mockResolvedValueOnce(loaded(old));
    await h.coordinator.transition(detailIntent("indexeddb", "old"));

    const leaving = h.coordinator.transition(indexIntent("already-applied", "files"));
    await Promise.resolve();
    expect(pendingRefs).toEqual([{ providerId: "indexeddb", recordId: "old" }]);
    expect(h.files.list).not.toHaveBeenCalled();

    flush.resolve();
    await leaving;
    expect(h.files.list).toHaveBeenCalledOnce();
  });

  it("flushes edits made while the target load is pending before committing it", async () => {
    const old = record("old");
    const targetGet = deferred<CompositionLoadOutcome>();
    let lateEdit = false;
    const observedDrafts: boolean[] = [];
    const oldSession = fakeSession(
      { providerId: "indexeddb", recordId: "old" },
      old,
      {
        flushPendingProps: () => {
          observedDrafts.push(lateEdit);
        },
      },
    );
    const h = harness({
      createDetailSession: vi.fn((ref, value) =>
        ref.providerId === "indexeddb" && ref.recordId === "old"
          ? oldSession
          : fakeSession(ref, value),
      ),
    });
    h.indexeddb.get.mockResolvedValueOnce(loaded(old));
    await h.coordinator.transition(detailIntent("indexeddb", "old"));
    h.files.get.mockImplementationOnce(() => targetGet.promise);

    const leaving = h.coordinator.transition(detailIntent("files", "target"));
    await vi.waitFor(() => expect(observedDrafts).toEqual([false]));
    lateEdit = true;
    targetGet.resolve(loaded(record("target")));

    await expect(leaving).resolves.toMatchObject({ status: "committed" });
    expect(observedDrafts).toEqual([false, true]);
    expect(oldSession.queue.flush).toHaveBeenCalledTimes(2);
    expect(h.coordinator.state).toMatchObject({ providerId: "files", route: { recordId: "target" } });
  });

  it("rolls back when the final flush after target loading fails", async () => {
    const old = record("old", "Mounted draft");
    let flushCalls = 0;
    const oldSession = fakeSession(
      { providerId: "indexeddb", recordId: "old" },
      old,
      {
        flush: async () => {
          flushCalls += 1;
          if (flushCalls === 2) throw new Error("late edit write failed");
        },
      },
    );
    const h = harness({
      createDetailSession: vi.fn((ref, value) =>
        ref.providerId === "indexeddb" && ref.recordId === "old"
          ? oldSession
          : fakeSession(ref, value),
      ),
    });
    h.indexeddb.get.mockResolvedValueOnce(loaded(old));
    await h.coordinator.transition(detailIntent("indexeddb", "old"));
    h.files.get.mockResolvedValueOnce(loaded(record("target")));
    h.history.replace.mockClear();

    const result = await h.coordinator.transition(
      detailIntent("files", "target", "already-applied"),
    );

    expect(result).toMatchObject({ status: "rolled-back", error: { code: "flush-failed" } });
    expect(h.coordinator.state).toMatchObject({
      providerId: "indexeddb",
      route: { recordId: "old" },
      draft: { document: { name: "Mounted draft" } },
    });
    expect(h.preference.write).not.toHaveBeenCalledWith("files");
    expect(h.history.replace).toHaveBeenCalledWith("/composer#/composition/indexeddb/old");
  });

  it("restores URL and preserves provider, collection, and latest draft when flush fails", async () => {
    const old = record("old", "Original");
    const draft = record("old", "Typed draft");
    const flushFailure = new Error("disk full");
    const oldSession = fakeSession(
      { providerId: "indexeddb", recordId: "old" },
      old,
      { draft, flush: async () => Promise.reject(flushFailure) },
    );
    const h = harness({
      createDetailSession: vi.fn((ref, value) =>
        ref.providerId === "indexeddb" && ref.recordId === "old"
          ? oldSession
          : fakeSession(ref, value),
      ),
    });
    h.indexeddb.list.mockResolvedValueOnce([summary("old")]);
    h.indexeddb.get.mockResolvedValueOnce(loaded(old));
    await h.coordinator.transition(detailIntent("indexeddb", "old"));
    h.history.replace.mockClear();

    const result = await h.coordinator.transition(
      detailIntent("files", "new", "already-applied"),
    );

    expect(result).toMatchObject({ status: "rolled-back", error: { code: "flush-failed" } });
    expect(h.coordinator.state).toMatchObject({
      view: "detail",
      providerId: "indexeddb",
      collection: [{ id: "old" }],
      draft: { document: { name: "Typed draft" } },
    });
    expect(h.files.list).not.toHaveBeenCalled();
    expect(h.history.replace).toHaveBeenCalledWith("/composer#/composition/indexeddb/old");
  });

  it("makes a stale flush failure inert", async () => {
    const old = record("old");
    const firstFlush = deferred<void>();
    const secondFlush = deferred<void>();
    let flushCalls = 0;
    const oldSession = fakeSession(
      { providerId: "indexeddb", recordId: "old" },
      old,
      { flush: () => (++flushCalls === 1 ? firstFlush.promise : secondFlush.promise) },
    );
    const h = harness({
      createDetailSession: vi.fn((ref, value) =>
        ref.providerId === "indexeddb" && ref.recordId === "old"
          ? oldSession
          : fakeSession(ref, value),
      ),
    });
    h.indexeddb.get.mockResolvedValueOnce(loaded(old));
    await h.coordinator.transition(detailIntent("indexeddb", "old"));

    const stale = h.coordinator.transition(detailIntent("files", "b", "already-applied"));
    await vi.waitFor(() => expect(flushCalls).toBe(1));
    const latest = h.coordinator.transition(detailIntent("files", "c", "already-applied"));
    await vi.waitFor(() => expect(flushCalls).toBe(2));
    h.files.get.mockResolvedValueOnce(loaded(record("c")));
    secondFlush.resolve();
    await expect(latest).resolves.toMatchObject({ status: "committed" });
    firstFlush.reject(new Error("late flush failure"));

    await expect(stale).resolves.toEqual({ status: "stale" });
    expect(h.coordinator.state).toMatchObject({ providerId: "files", route: { recordId: "c" } });
  });

  it("rolls back all state and delays preference writes when target loading fails", async () => {
    const h = harness();
    h.indexeddb.list.mockResolvedValueOnce([summary("old")]);
    h.indexeddb.get.mockResolvedValueOnce(loaded(record("old", "Draft stays")));
    await h.coordinator.transition(detailIntent("indexeddb", "old"));
    h.preference.write.mockClear();
    h.history.replace.mockClear();
    h.files.list.mockResolvedValueOnce([summary("target")]);
    h.files.get.mockRejectedValueOnce(new Error("read failure"));

    const result = await h.coordinator.transition(
      detailIntent("files", "target", "already-applied"),
    );

    expect(result).toMatchObject({
      status: "rolled-back",
      error: { code: "record-load-failed" },
    });
    expect(h.coordinator.state).toMatchObject({
      providerId: "indexeddb",
      collection: [{ id: "old" }],
      draft: { document: { name: "Draft stays" } },
    });
    expect(h.preference.write).not.toHaveBeenCalled();
    expect(h.history.replace).toHaveBeenCalledWith("/composer#/composition/indexeddb/old");
  });

  it("supports direct load, refresh reconstruction, and back/forward history", async () => {
    for (let refresh = 0; refresh < 2; refresh += 1) {
      const h = harness();
      h.files.get.mockResolvedValueOnce(loaded(record("direct")));
      await h.coordinator.transition(detailIntent("files", "direct", "already-applied"));
      expect(h.coordinator.state).toMatchObject({ providerId: "files", route: { recordId: "direct" } });
      expect(h.history.push).not.toHaveBeenCalled();
      expect(h.history.replace).not.toHaveBeenCalled();
    }

    const h = harness();
    h.indexeddb.get.mockResolvedValueOnce(loaded(record("a")));
    await h.coordinator.transition(detailIntent("indexeddb", "a", "already-applied"));
    await h.coordinator.transition(indexIntent("already-applied", "files"));
    expect(h.coordinator.state).toMatchObject({ view: "index", providerId: "files" });
    h.indexeddb.get.mockResolvedValueOnce(loaded(record("a")));
    await h.coordinator.transition(detailIntent("indexeddb", "a", "already-applied"));
    expect(h.coordinator.state).toMatchObject({ view: "detail", providerId: "indexeddb" });
    expect(h.history.push).not.toHaveBeenCalled();
  });

  it("rejects an unavailable explicit index provider instead of silently changing it", async () => {
    const h = harness();
    h.providers.delete("files");
    await h.coordinator.transition(indexIntent("already-applied"));

    const result = await h.coordinator.transition(
      indexIntent("already-applied", "files"),
    );
    expect(result).toMatchObject({ status: "rolled-back", error: { code: "unknown-provider" } });
    expect(h.coordinator.state).toMatchObject({ view: "index", providerId: "indexeddb" });
  });

  it("rejects a registry entry whose provider identity does not match its key", async () => {
    const h = harness();
    h.indexeddb.get.mockResolvedValueOnce(loaded(record("safe")));
    await h.coordinator.transition(detailIntent("indexeddb", "safe", "already-applied"));
    h.providers.set("files", h.indexeddb);

    const result = await h.coordinator.transition(
      indexIntent("already-applied", "files"),
    );

    expect(result).toMatchObject({ status: "rolled-back", error: { code: "unknown-provider" } });
    expect(h.files.list).not.toHaveBeenCalled();
    expect(h.coordinator.state).toMatchObject({ providerId: "indexeddb" });
  });
});
