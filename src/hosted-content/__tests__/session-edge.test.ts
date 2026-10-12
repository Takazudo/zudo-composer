import { describe, expect, it } from "vitest";
import { HostedContentSession } from "../session";
import { editorFixture, page } from "./editor-fixture";
import { HostedContentError } from "../types";
import type { HostedState } from "../types";
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((ready) => { resolve = ready; }); return { promise, resolve }; }
describe("hosted form intent races", () => {
  it("freezes the current staged creation only after an earlier record save has resolved", async () => {
    const fixture = editorFixture(); const execute = fixture.transport.execute; const saved = gate<void>(); const entered = gate<void>();
    fixture.transport.execute = async (request) => { const result = await execute(request); if (request.kind === "set-fields") { entered.resolve(); await saved.promise; } return result; };
    let key = 0; const session = new HostedContentSession({ transport: fixture.transport, createOperationKey: () => `edge-${++key}` }); await session.initialize();
    session.edit(page, "title", "A record save"); session.stageCreation("questions", { question: "Creation A" });
    const creating = session.createEntry("questions", { question: "Creation A" }); await entered.promise;
    session.stageCreation("questions", { question: "Creation B" }); saved.resolve(); const result = await creating;
    const command = fixture.requests.find((request) => request.kind === "create-entry"); expect(command).toMatchObject({ values: { question: "Creation B" } });
    const created = fixture.database().state.providers[0]!.entries.find((entry) => entry.id === result.createdEntry!.recordId)!;
    expect(created.values.question).toBe("Creation B"); expect(session.state.creationDraft).toBeNull(); expect(session.state.dirty).toBe(false);
  });
  it("restores a configuration-required rejection as blocked and treats storage contention as recoverable", async () => {
    const fixture = editorFixture(); let key = 0;
    const session = new HostedContentSession({ transport: fixture.transport, createOperationKey: () => `blocked-${++key}` }); await session.initialize();
    const stored = fixture.database(); fixture.replace({ ...stored, state: { ...stored.state, definition: "d-next" } });
    session.edit(page, "title", "保持"); await expect(session.flush()).rejects.toMatchObject({ code: "configuration-required" });
    expect(session.state.phase).toBe("blocked");
    const restored = new HostedContentSession({ transport: fixture.transport, createOperationKey: () => "unused", recovery: session.checkpoint() }); await restored.initialize();
    expect(restored.state.phase).toBe("blocked"); expect(restored.state.content!.providers[0]!.entries[0]!.values.title).toBe("保持");
    const busy = new HostedContentSession({ transport: { ...fixture.transport, execute: async () => { throw new HostedContentError("unavailable", "busy"); } }, createOperationKey: () => "busy" });
    await busy.initialize(); busy.edit(page, "title", "再試行"); await expect(busy.flush()).rejects.toMatchObject({ code: "unavailable" });
    expect(busy.state.phase).toBe("recovering"); expect(busy.state.pending!.rejected).toBe(false);
  });
  it("cannot refresh over an incomplete number entered while the authoritative read is pending", async () => {
    const fixture = editorFixture(); const session = new HostedContentSession({ transport: fixture.transport, createOperationKey: () => "unused" }); await session.initialize();
    const original = session.state.content!; const read = gate<HostedState>(); let reads = 0;
    fixture.transport.readState = () => { reads++; return read.promise; };
    const refreshing = session.refresh(); session.setIncompleteInput("price", true);
    read.resolve({ ...original, draftRevision: "new-authoritative-revision" }); await expect(refreshing).rejects.toThrow("edited while loading");
    expect(session.state.content!.draftRevision).toBe(original.draftRevision); expect(session.state.invalidInputs).toEqual(["price"]); expect(session.state.dirty).toBe(true);
    await expect(session.refresh()).rejects.toThrow("Review retained"); expect(reads).toBe(1);
    expect(session.state.phase).toBe("dirty"); expect(session.state.error).toBeNull();
  });
  it("keeps dirty edits made during an authoritative read without failing the session", async () => {
    const fixture = editorFixture(); const session = new HostedContentSession({ transport: fixture.transport, createOperationKey: () => "unused" }); await session.initialize();
    const original = session.state.content!; const read = gate<HostedState>();
    fixture.transport.readState = () => read.promise;
    const refreshing = session.refresh(); session.edit(page, "title", "編集中");
    read.resolve({ ...original, draftRevision: "new-authoritative-revision" }); await expect(refreshing).rejects.toThrow("edited while loading");
    expect(session.state.phase).toBe("dirty"); expect(session.state.error).toBeNull();
    expect(session.state.content!.providers[0]!.entries.find((entry) => entry.id === page.recordId)!.values.title).toBe("編集中");
  });
});
