import { describe, expect, it } from "vitest";
import { HostedContentSession } from "../session";
import { editorFixture, page } from "./editor-fixture";
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
  it("cannot refresh over an incomplete number entered while the authoritative read is pending", async () => {
    const fixture = editorFixture(); const session = new HostedContentSession({ transport: fixture.transport, createOperationKey: () => "unused" }); await session.initialize();
    const original = session.state.content!; const read = gate<HostedState>(); let reads = 0;
    fixture.transport.readState = () => { reads++; return read.promise; };
    const refreshing = session.refresh(); session.setIncompleteInput("price", true);
    read.resolve({ ...original, draftRevision: "new-authoritative-revision" }); await expect(refreshing).rejects.toThrow("edited while loading");
    expect(session.state.content!.draftRevision).toBe(original.draftRevision); expect(session.state.invalidInputs).toEqual(["price"]); expect(session.state.dirty).toBe(true);
    await expect(session.refresh()).rejects.toThrow("Review retained"); expect(reads).toBe(1);
  });
});
