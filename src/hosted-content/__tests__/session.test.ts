import { describe, expect, it, vi } from "vitest";
import { createContentEntryRecord, createContentModelRecord } from "../../content";
import { HostedContentSession } from "../session";
import { HostedContentError } from "../types";
import type { HostedCommand, HostedResult, HostedState, HostedTransport } from "../types";
import type { HostedRecoveryCheckpoint, HostedPreviewAdapter, HostedSessionOptions } from "../session";
const stamp = "2026-01-01T00:00:00.000Z";
const entry = { providerId: "content-filesystem", modelId: "course", recordId: "lesson" };
export function state(): HostedState {
  return { draftRevision: "r0", baseline: { gitSha: "g0", contentDigest: "c0" }, definition: "d0", integrationFence: 0, providers: [{ providerId: entry.providerId,
    models: [createContentModelRecord({ name: "Course", kind: "single", fields: [{ id: "title", key: "title", label: "講座名", kind: "text", required: true }, { id: "slug", key: "slug", label: "Slug", kind: "slug", required: false }] }, { id: entry.modelId, timestamp: stamp })],
    entries: [createContentEntryRecord(entry.modelId, { title: "初期値", slug: "fixed-route" }, { id: entry.recordId, timestamp: stamp })] }] };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const title = (session: HostedContentSession) => session.state.content!.providers[0]!.entries[0]!.values.title;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export function backend() {
  const content = state(); let counter = 0; const receipts = new Map<string, HostedResult>(); const fingerprints = new Map<string, string>(); const requests: HostedCommand[] = [];
  const transport: HostedTransport = {
    readState: async () => clone(content), readReceipt: async (key) => { const result = receipts.get(key); return result ? { actorId: "author", operationKey: key, fingerprint: key, result: clone(result) } : null; },
    execute: async (request) => {
      requests.push(request);
      if (receipts.has(request.operationKey)) {
        if (fingerprints.get(request.operationKey) !== JSON.stringify(request)) throw new HostedContentError("operation-key-reuse", "Key reused for different request");
        return clone(receipts.get(request.operationKey)!);
      }
      if (request.expected.draftRevision !== content.draftRevision) throw new HostedContentError("revision-conflict", "Another author saved");
      const result: HostedResult = { state: clone(content) };
      if (request.kind === "set-fields") {
        const record = content.providers[0]!.entries.find((e) => e.id === request.entry.recordId)!;
        Object.assign(record.values, clone(request.values)); request.clear.forEach((key) => delete record.values[key]);
        content.draftRevision = `r${++counter}`; result.state = clone(content);
      } else if (request.kind === "capture-snapshot") {
        result.snapshot = { ...clone(content), id: `s${counter}`, digest: `digest${counter}`, assets: [], diagnostics: [], renderData: {} };
      } else if (request.kind === "begin-publication") {
        result.publication = { id: "p1", snapshotId: request.snapshotId, expectedBaseline: content.baseline, status: "submitted", statusVersion: 1 };
      }
      receipts.set(request.operationKey, clone(result)); fingerprints.set(request.operationKey, JSON.stringify(request)); return result;
    },
    getPublication: async () => { throw new Error("not used"); },
  };
  return { transport, requests, content: () => clone(content) };
}
function session(base = backend(), extra: Partial<HostedSessionOptions> = {}) {
  let key = 0; const value = new HostedContentSession({ transport: base.transport, createOperationKey: () => `key${++key}`, ...extra });
  return { value, base };
}
describe("hosted immutable save session", () => {
  it("retains B when A is acknowledged, then sends B against A's revision", async () => {
    const base = backend(); const gate = deferred<HostedResult>(); const execute = base.transport.execute;
    base.transport.execute = vi.fn(async (request) => { const result = await execute(request); return base.requests.length === 1 ? gate.promise : result; });
    const { value } = session(base); await value.initialize(); value.edit(entry, "title", "A");
    const flush = value.flush(); await vi.waitFor(() => expect(base.requests).toHaveLength(1));
    value.edit(entry, "title", "B"); gate.resolve({ state: base.content() }); await flush;
    expect(title(value)).toBe("B"); expect(base.requests).toHaveLength(2);
    expect(base.requests[1]!.expected.draftRevision).toBe("r1"); expect(base.requests[1]!.kind === "set-fields" && base.requests[1]!.values.title).toBe("B");
    expect(value.state.dirty).toBe(false);
  });
  it("reopens a host checkpoint after lost acknowledgement and recovers A before sending B", async () => {
    const base = backend(); const execute = base.transport.execute; let saved!: HostedRecoveryCheckpoint;
    base.transport.execute = async (request) => { await execute(request); throw new Error("response lost"); };
    const { value } = session(base, { persistRecovery: (checkpoint) => { saved = checkpoint; } });
    await value.initialize(); value.edit(entry, "title", "A"); await expect(value.flush()).rejects.toThrow("response lost");
    const original = clone(value.state.pending!.request); value.edit(entry, "title", "B"); value.dispose();
    await vi.waitFor(() => expect(saved.edits[0]!.value).toBe("B"));
    base.transport.execute = execute;
    const reopened = new HostedContentSession({ transport: base.transport, createOperationKey: () => "keyB", recovery: saved });
    await reopened.initialize(); expect(reopened.state.phase).toBe("recovering"); await reopened.flush();
    expect(base.requests[0]).toEqual(original); expect(base.requests[1]).toEqual(original); expect(base.requests).toHaveLength(3); expect(title(reopened)).toBe("B");
    expect(base.requests[2]!.expected.draftRevision).toBe("r1"); expect(base.content().draftRevision).toBe("r2");
  });
  it("retries identical A when no receipt is visible, before later B", async () => {
    const base = backend(); const execute = base.transport.execute; let fail = true;
    const attempts: HostedCommand[] = [];
    base.transport.execute = async (request) => { attempts.push(request); if (fail) { fail = false; throw new Error("connection reset before commit"); } return execute(request); };
    const { value } = session(base); await value.initialize(); value.edit(entry, "title", "A");
    await expect(value.flush()).rejects.toThrow(); const pending = value.state.pending!.request;
    expect(Object.isFrozen(pending)).toBe(true); expect(Object.isFrozen(pending.expected.baseline)).toBe(true);
    value.edit(entry, "title", "B"); await value.flush();
    expect(attempts[1]).toEqual(attempts[0]); expect(attempts[2]!.operationKey).not.toBe(pending.operationKey); expect(title(value)).toBe("B");
  });
  it("does not dispatch until the immutable request checkpoint is persisted", async () => {
    const base = backend(); const gate = deferred<void>();
    const { value } = session(base, { persistRecovery: (checkpoint) => checkpoint.pending ? gate.promise : undefined });
    await value.initialize(); value.edit(entry, "title", "A"); const flush = value.flush();
    await Promise.resolve(); await Promise.resolve(); expect(base.requests).toHaveLength(0);
    gate.resolve(); await flush; expect(base.requests).toHaveLength(1);
  });
  it("keeps a rejected conflict until explicit review/reapply", async () => {
    const base = backend(); const { value } = session(base); await value.initialize(); value.edit(entry, "title", "私の値");
    await base.transport.execute({ kind: "set-fields", operationKey: "other", expected: state(), entry, values: { title: "他の値" }, clear: [] });
    await expect(value.flush()).rejects.toThrow(); expect(value.state.phase).toBe("conflict"); expect(title(value)).toBe("私の値");
    const review = await value.reviewAuthoritative(); expect(review.providers[0]!.entries[0]!.values.title).toBe("他の値");
    await value.reapply(review); await value.flush(); expect(title(value)).toBe("私の値");
  });
  it("invokes host authentication recovery while keeping exact pending work", async () => {
    const base = backend(); base.transport.execute = async () => { throw new Error("expired"); }; const expiry = vi.fn();
    const { value } = session(base, { isAuthenticationExpired: (error) => error instanceof Error && error.message === "expired", onAuthenticationExpired: expiry });
    await value.initialize(); value.edit(entry, "title", "未保存"); await expect(value.flush()).rejects.toThrow("expired");
    expect(expiry).toHaveBeenCalledOnce(); expect(title(value)).toBe("未保存"); expect(value.state.pending!.request.operationKey).toBe("key1");
  });
  it("does not treat expired authentication as proof that an earlier unknown operation failed", async () => {
    const base = backend(); const execute = base.transport.execute; let lost = true; let expired = false;
    base.transport.execute = async (request) => {
      if (expired) throw new HostedContentError("forbidden", "authentication expired");
      const result = await execute(request); if (lost) { lost = false; throw new Error("lost after commit"); } return result;
    };
    const { value } = session(base, { isAuthenticationExpired: (error) => error instanceof Error && error.message === "authentication expired" });
    await value.initialize(); value.edit(entry, "title", "A"); await expect(value.flush()).rejects.toThrow("lost after commit");
    const original = value.state.pending!.request; expired = true; await expect(value.flush()).rejects.toThrow("authentication expired");
    expect(value.state.pending!.rejected).toBe(false); expect(value.state.pending!.request).toEqual(original); await expect(value.reapply(base.content())).rejects.toThrow("Recover");
    expired = false; value.edit(entry, "title", "B"); await value.flush(); expect(title(value)).toBe("B"); expect(base.content().draftRevision).toBe("r2");
  });
  it("never marks a stale render current and binds publication to the reviewed snapshot", async () => {
    const base = backend(); const rendered = deferred<void>(); const preview = { render: vi.fn(() => rendered.promise) };
    const { value } = session(base, { preview }); await value.initialize();
    const capture = value.captureAndPreview("/course"); await vi.waitFor(() => expect(preview.render).toHaveBeenCalledOnce());
    value.edit(entry, "title", "B"); rendered.resolve(); await expect(capture).rejects.toThrow("stale");
    await expect(value.submit()).rejects.toThrow("Preview");
    const snapshot = await value.captureAndPreview("/course"); expect(snapshot.providers[0]!.entries[0]!.values.title).toBe("B");
    const publication = await value.submit(); expect(publication.snapshotId).toBe(snapshot.id);
  });
  it("flush waits for a capture command and then drains edits made during that command", async () => {
    const base = backend(); const execute = base.transport.execute; const gate = deferred<void>();
    base.transport.execute = async (request) => { const result = await execute(request); if (request.kind === "capture-snapshot") await gate.promise; return result; };
    const { value } = session(base, { preview: { render: async () => undefined } }); await value.initialize();
    const capture = value.captureAndPreview("home").catch((error: unknown) => error);
    await vi.waitFor(() => expect(base.requests[0]!.kind).toBe("capture-snapshot"));
    value.edit(entry, "title", "B"); const flush = value.flush(); gate.resolve();
    await flush; await capture;
    expect(value.state.dirty).toBe(false); expect(base.content().providers[0]!.entries[0]!.values.title).toBe("B");
    expect(base.requests[1]!.kind).toBe("set-fields");
  });
  it("blocks Submit after preview reload until the exact document is rendered again", async () => {
    let previewState: NonNullable<HostedPreviewAdapter["state"]> = { status: "idle" };
    let changed = () => {};
    const preview: HostedPreviewAdapter = {
      get state() { return previewState; },
      subscribe(listener) { changed = listener; return () => { changed = () => {}; }; },
      async render(snapshot, routeId) {
        previewState = { status: "rendered", result: { snapshotId: snapshot.id, snapshotDigest: snapshot.digest, draftRevision: snapshot.draftRevision, baseline: snapshot.baseline, definition: snapshot.definition, routeId } };
        changed();
      },
    };
    const { value } = session(backend(), { preview }); await value.initialize();
    await value.captureAndPreview("home"); const rendered = previewState;
    expect(value.state.reviewedSnapshot).not.toBeNull();
    previewState = { status: "pending" }; changed(); expect(value.state.reviewedSnapshot).toBeNull();
    await expect(value.submit()).rejects.toThrow("Preview");
    previewState = rendered; changed(); expect(value.state.reviewedSnapshot).not.toBeNull();
    expect((await value.submit()).snapshotId).toBe(value.state.reviewedSnapshot!.id);
  });
  it("never accepts a receipt for the same key with another payload", async () => {
    const base = backend(); const { value } = session(base, { createOperationKey: () => "same-key" });
    await value.initialize(); value.edit(entry, "title", "A"); await value.flush();
    value.edit(entry, "title", "B"); await expect(value.flush()).rejects.toThrow("Key reused");
    expect(value.state.pending!.rejected).toBe(true); expect(value.state.dirty).toBe(true);
    expect(title(value)).toBe("B"); expect(base.content().providers[0]!.entries[0]!.values.title).toBe("A");
  });
  it("cancelling an unsent creation does not mark an unrelated in-flight save clean", async () => {
    const base = backend(); const execute = base.transport.execute; const gate = deferred<void>();
    base.transport.execute = async (request) => { await gate.promise; return execute(request); };
    const { value } = session(base); await value.initialize(); value.edit(entry, "title", "A"); const saving = value.flush();
    value.stageCreation("questions", { question: "Unsent" }); value.cancelCreation();
    expect(value.state.phase).toBe("saving"); expect(value.state.pending).not.toBeNull();
    gate.resolve(); await saving; expect(value.state.phase).toBe("saved");
  });
  it("keeps unrelated entry edits while acknowledging one entry", async () => {
    const base = backend(); const initial = state(); initial.providers[0]!.entries.push(createContentEntryRecord(entry.modelId, { title: "Other" }, { id: "other", timestamp: stamp }));
    base.transport.readState = async () => clone(initial);
    const requests: HostedCommand[] = []; base.transport.execute = async (request) => { requests.push(request); return { state: clone(initial) }; };
    const { value } = session(base); await value.initialize(); value.edit(entry, "title", "A"); value.edit({ ...entry, recordId: "other" }, "title", "B"); await value.flush();
    expect(requests).toHaveLength(2); expect(requests[1]!.kind === "set-fields" && requests[1]!.entry.recordId).toBe("other");
  });
});
