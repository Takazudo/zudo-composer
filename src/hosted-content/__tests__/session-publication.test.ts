import { describe, expect, it, vi } from "vitest";
import { HostedContentSession } from "../session";
import type { HostedPublication } from "../types";
import { editorFixture } from "./editor-fixture";
const preview = { render: async () => undefined };
function create(fixture = editorFixture(), extra: Partial<ConstructorParameters<typeof HostedContentSession>[0]> = {}) {
  let key = 0; const session = new HostedContentSession({ transport: fixture.transport, preview, createOperationKey: () => `publication-${++key}`, ...extra }); return { session, fixture };
}
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((ready) => { resolve = ready; }); return { promise, resolve }; }
describe("host-owned publication recovery", () => {
  it("restores the operation from a checkpoint and authenticates a fresh status without restoring approval", async () => {
    const { session, fixture } = create(); await session.initialize(); await session.captureAndPreview("home"); const publication = await session.submit();
    const checkpoint = session.checkpoint(); expect(checkpoint.publication!.id).toBe(publication.id); session.dispose();
    await fixture.service.recordStatus({ publicationId: publication.id, snapshotId: publication.snapshotId, statusVersion: 2, status: "building" });
    fixture.transport.getPublication = vi.fn(fixture.transport.getPublication);
    const reopened = create(fixture, { recovery: checkpoint, createOperationKey: () => "new-session" }).session;
    expect(reopened.state.publicationStale).toBe(true); await reopened.initialize();
    expect(fixture.transport.getPublication).toHaveBeenCalledWith(publication.id);
    expect(reopened.state.publication).toMatchObject({ id: publication.id, status: "building", statusVersion: 2 });
    expect(reopened.state.publicationStale).toBe(false); expect(reopened.state.reviewedSnapshot).toBeNull();
    expect((await reopened.refreshPublication()).status).toBe("building");
  });
  it("retains the last known operation on unavailable status and invokes host authentication recovery", async () => {
    const { session, fixture } = create(); await session.initialize(); await session.captureAndPreview("home"); const publication = await session.submit();
    const checkpoint = session.checkpoint(); const expired = vi.fn(); fixture.transport.getPublication = async () => { throw new Error("expired"); };
    const reopened = create(fixture, { recovery: checkpoint, isAuthenticationExpired: () => true, onAuthenticationExpired: expired }).session;
    await reopened.initialize(); expect(expired).toHaveBeenCalledOnce();
    expect(reopened.state.publication).toEqual(publication); expect(reopened.state.publicationStale).toBe(true); expect(reopened.state.publicationError).toBeInstanceOf(Error);
    expect(reopened.state.content!.draftRevision).toBe(checkpoint.acknowledged!.draftRevision);
  });
  it("does not regress on late lower-version status or replace the operation with a foreign snapshot", async () => {
    const { session, fixture } = create(); await session.initialize(); await session.captureAndPreview("home"); const publication = await session.submit();
    const older = gate<HostedPublication>(); let calls = 0;
    fixture.transport.getPublication = () => ++calls === 1 ? older.promise : Promise.resolve({ ...publication, status: "verified", statusVersion: 3 });
    const first = session.refreshPublication(); await session.refreshPublication(); older.resolve({ ...publication, status: "building", statusVersion: 2 }); await first;
    expect(session.state.publication).toMatchObject({ status: "verified", statusVersion: 3 });
    fixture.transport.getPublication = async () => ({ ...publication, snapshotId: "foreign", statusVersion: 4 });
    await expect(session.refreshPublication()).rejects.toThrow("does not match"); expect(session.state.publication!.statusVersion).toBe(3); expect(session.state.publicationStale).toBe(true);
  });
});
