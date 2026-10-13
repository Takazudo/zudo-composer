import { describe, expect, it, vi } from "vitest";
import { HostedContentSession } from "../session";
import type { HostedPreviewAdapter, HostedSessionOptions } from "../session";
import type { HostedResult, HostedState } from "../types";
import { editorFixture, page, faq } from "./editor-fixture";
function setup(extra: Partial<HostedSessionOptions> = {}) {
  const fixture = editorFixture(); let key = 0;
  const session = new HostedContentSession({ transport: fixture.transport, createOperationKey: () => `projection-${++key}`, ...extra });
  return { session, fixture };
}
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((ready) => { resolve = ready; }); return { promise, resolve }; }
const values = (content: HostedState) => content.providers[0]!.entries.find((entry) => entry.id === page.recordId)!.values;
function expectFrozen(value: unknown): void {
  if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(expectFrozen); }
}
describe("hosted content projection ownership and freshness", () => {
  it("reuses deeply frozen content without serializing it on warm reads and preserves old edits", async () => {
    const { session } = setup(); expect(session.state.content).toBeNull(); await session.initialize();
    const original = session.state.content!; expectFrozen(original);
    const serialize = vi.spyOn(JSON, "stringify");
    try { for (let i = 0; i < 10; i++) expect(session.state.content).toBe(original); expect(serialize).not.toHaveBeenCalled(); } finally { serialize.mockRestore(); }
    session.edit(page, "details", { label: "B", secret: "Locked" });
    const edited = session.state.content!; expect(edited).not.toBe(original); expectFrozen(edited);
    expect(values(original).details).toEqual({ label: "Visible", secret: "Locked" });
    session.edit(page, "summary", undefined); const cleared = session.state.content!;
    expect(values(cleared)).not.toHaveProperty("summary"); expect(values(edited).details).toEqual({ label: "B", secret: "Locked" });
    await session.flush(); expect(session.state.content).not.toBe(cleared); expect(values(session.state.content!)).not.toHaveProperty("summary");
  });
  it("shows metadata-only changes and raw errors while retaining content and pending identity", async () => {
    const { session, fixture } = setup(); await session.initialize(); const original = session.state.content;
    session.stageCreation("questions", { question: "Draft" }); expect(session.state.content).toBe(original); expectFrozen(session.state.creationDraft);
    session.cancelCreation(); session.setIncompleteInput("price", true); expect(session.state.invalidInputs).toEqual(["price"]); expect(session.state.content).toBe(original);
    session.setIncompleteInput("price", false); expect(session.state.phase).toBe("clean");
    const error = new Error("lost response"); fixture.transport.execute = async () => { throw error; };
    session.edit(page, "title", "A"); const edited = session.state.content;
    const notifications: string[] = []; session.subscribe((state) => { notifications.push(state.phase); expect(state.content).toBe(edited); });
    await expect(session.flush()).rejects.toBe(error); expect(notifications).toContain("saving"); expect(notifications).toContain("recovering");
    expect(session.state.error).toBe(error); expect(session.currentError).toBe(error); expect(session.state.pending).toBe(session.state.pending); expectFrozen(session.state.pending);
  });
  it("invalidates on acknowledgement even when localRevision is unchanged and later B is retained", async () => {
    const checkpoint = gate<void>(); let observed!: HostedState;
    const { session, fixture } = setup({ persistRecovery: (saved) => {
      if (!saved.pending && fixture.requests.length === 1) { observed = session.state.content!; return checkpoint.promise; }
    } });
    const execute = fixture.transport.execute; const entered = gate<void>(); const response = gate<void>();
    fixture.transport.execute = async (request) => { const result = await execute(request); if (request.kind === "set-fields" && fixture.requests.length === 1) { entered.resolve(); await response.promise; } return result; };
    await session.initialize(); session.edit(page, "title", "A"); const saving = session.flush(); await entered.promise;
    session.edit(page, "title", "B"); const before = session.state; response.resolve();
    await vi.waitFor(() => expect(observed).toBeDefined());
    expect(session.state.localRevision).toBe(before.localRevision); expect(observed).not.toBe(before.content);
    expect(observed.draftRevision).not.toBe(before.content!.draftRevision); expect(values(observed).title).toBe("B"); expect(values(before.content!).title).toBe("B");
    checkpoint.resolve(); await saving; expect(fixture.requests).toHaveLength(2); expect(values(session.state.content!).title).toBe("B");
  });
  it("detaches recovery, authoritative inputs and checkpoints across reapply, discard and refresh", async () => {
    const { session, fixture } = setup(); await session.initialize(); session.edit(page, "title", "Mine");
    const recovery = session.checkpoint(); const restored = setup({ recovery }).session; const recovered = restored.state.content!;
    recovery.edits[0]!.value = "poison"; recovery.acknowledged!.providers.length = 0; expect(values(restored.state.content!).title).toBe("Mine");
    await restored.initialize(); expect(restored.state.content).toBe(recovered);
    const authoritative = await fixture.transport.readState(); authoritative.draftRevision = "next"; values(authoritative).summary = "Changed outside";
    const revision = restored.state.localRevision; await restored.reapply(authoritative);
    expect(restored.state.localRevision).toBe(revision); expect(restored.state.content).not.toBe(recovered); expect(values(restored.state.content!).title).toBe("Mine");
    values(authoritative).summary = "poison"; expect(values(restored.state.content!).summary).toBe("Changed outside");
    const checkpoint = restored.checkpoint(); checkpoint.edits.length = 0; checkpoint.acknowledged!.providers.length = 0; expect(values(restored.state.content!).title).toBe("Mine");
    await restored.discard(await fixture.transport.readState()); expect(values(restored.state.content!).title).toBe("日本語の講座");
    const previous = restored.state.content; await restored.refresh(); expect(restored.state.content).not.toBe(previous);
  });
  it("projects collection changes and detaches both external responses and public results", async () => {
    const { session, fixture } = setup(); const execute = fixture.transport.execute; let external!: HostedResult;
    fixture.transport.execute = async (request) => { external = await execute(request); return external; };
    await session.initialize(); const initial = session.state.content!;
    const created = await session.createEntry("questions", { question: "New", answer: "Answer" }); const createdRef = { ...created.createdEntry! };
    created.state.providers.length = 0; created.createdEntry!.recordId = "poison"; external.state.providers.length = 0; external.createdEntry!.recordId = "external poison";
    const afterCreate = session.state.content!; expect(afterCreate.providers[0]!.entries.find((entry) => entry.id === createdRef.recordId)!.values.question).toBe("New");
    expect(session.state.lastCreatedEntry).toEqual(createdRef); expect(values(initial).questions).toEqual([faq]);
    const detached = { ...faq, recordId: "faq-detached" }; await session.addEntry("questions", detached); const added = session.state.content!;
    expect(values(added).questions).toEqual([faq, createdRef, detached]);
    const reordered = await session.reorder("questions", [detached, createdRef, faq]); reordered.state.providers.length = 0;
    expect(values(session.state.content!).questions).toEqual([detached, createdRef, faq]); expect(values(added).questions).toEqual([faq, createdRef, detached]);
  });
  it("overlays later creation-form edits on the newly acknowledged entry", async () => {
    const { session, fixture } = setup(); const execute = fixture.transport.execute; const entered = gate<void>(); const released = gate<void>();
    fixture.transport.execute = async (request) => { const result = await execute(request); if (request.kind === "create-entry") { entered.resolve(); await released.promise; } return result; };
    await session.initialize(); session.stageCreation("questions", { question: "A", answer: "Answer" });
    const creating = session.createEntry("questions", { question: "A", answer: "Answer" }); await entered.promise;
    const before = session.state.content!; session.stageCreation("questions", { question: "B", answer: "Later answer" });
    released.resolve(); const result = await creating; const projected = session.state.content!;
    expect(projected).not.toBe(before); expectFrozen(projected);
    expect(projected.providers[0]!.entries.find((entry) => entry.id === result.createdEntry!.recordId)!.values).toMatchObject({ question: "B", answer: "Later answer" });
    expect(before.providers[0]!.entries.some((entry) => entry.id === result.createdEntry!.recordId)).toBe(false);
    expect(session.state.creationDraft).toBeNull(); expect(session.state.dirty).toBe(true); await session.flush();
    expect(fixture.database().state.providers[0]!.entries.find((entry) => entry.id === result.createdEntry!.recordId)!.values.question).toBe("B");
  });
  it.each([false, true])("checks live preview eligibility on every read (subscribe=%s)", async (subscribed) => {
    let status: NonNullable<HostedPreviewAdapter["state"]> = { status: "idle" }; let changed = () => {};
    const preview: HostedPreviewAdapter = { get state() { return status; }, ...(subscribed ? { subscribe(listener: () => void) { changed = listener; return () => { changed = () => {}; }; } } : {}),
      async render(snapshot, routeId) { status = { status: "rendered", result: { snapshotId: snapshot.id, snapshotDigest: snapshot.digest, draftRevision: snapshot.draftRevision, baseline: snapshot.baseline, definition: snapshot.definition, routeId } }; changed(); }, invalidate() { status = { status: "stale" }; changed(); }, dispose() { status = { status: "disposed" }; changed(); } };
    const { session, fixture } = setup({ preview }); await session.initialize(); const snapshot = await session.captureAndPreview("home");
    const content = session.state.content; expect(session.state.reviewedSnapshot).toBe(snapshot); expectFrozen(snapshot);
    const rendered = status;
    for (const state of ["stale", "pending", "disposed"]) { status = { status: state }; changed(); expect(session.state.content).toBe(content); expect(session.state.reviewedSnapshot).toBeNull(); await expect(session.submit()).rejects.toThrow("Preview"); }
    status = rendered; changed(); expect(session.state.reviewedSnapshot).toBe(snapshot);
    const publication = await session.submit(); const retained = session.state.publication!;
    publication.id = "poison"; publication.expectedBaseline.gitSha = "poison"; expect(session.state.publication).toEqual(retained);
    const current = session.state.content; const error = new Error("publication unavailable"); fixture.transport.getPublication = async () => { throw error; };
    await expect(session.refreshPublication()).rejects.toBe(error); expect(session.state.publicationError).toBe(error); expect(session.state.content).toBe(current);
    session.dispose(); expect(session.state.reviewedSnapshot).toBeNull(); expect(session.state.content).toBe(current);
  });
  it("exposes new content before synchronous preview callbacks and preserves per-listener envelopes", async () => {
    let notify = () => {}; const preview: HostedPreviewAdapter = { render: async () => undefined, subscribe(listener) { notify = listener; return () => {}; }, invalidate() { notify(); } };
    const { session } = setup({ preview }); await session.initialize(); const initial = session.state.content!;
    const observations: string[] = []; let edited = false;
    session.subscribe((state) => {
      const title = values(session.state.content!).title as string; observations.push(title);
      state.phase = "failed";
      if (title === "A" && !edited) { edited = true; session.edit(page, "title", "B"); expect(values(session.state.content!).title).toBe("B"); }
    });
    const phases: string[] = []; session.subscribe((state) => { phases.push(state.phase); });
    session.edit(page, "title", "A"); expect(observations).toContain("A"); expect(observations).toContain("B"); expect(values(session.state.content!).title).toBe("B");
    expect(values(initial).title).toBe("日本語の講座"); expect(phases).not.toContain("failed");
  });
});
