import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentAiProposal, EditorialReceipt, RemoteContentAi } from "../../../content/editorial";
import { aiProposalStale, createContentAuthoringController } from "../controller";
import { createMemoryContentProvider } from "../fixtures";

const DIGEST = "a".repeat(64);

async function open() {
  const provider = createMemoryContentProvider();
  const controller = createContentAuthoringController(provider);
  await controller.initialize(); await controller.openModel("articles"); await controller.openEntry("entry-1");
  const entry = controller.state.entry!;
  const ref = controller.entryRef(entry);
  const proposal: ContentAiProposal = {
    id: "proposal-0001", entry: ref, expected: "pinned", summary: "Shorter.", values: { title: "Proposed" },
    differences: [{ fieldId: "title", key: "title", label: "Title", change: "changed", before: entry.values.title, after: "Proposed", removedFromDefinition: false }], candidate: { ...entry.values, title: "Proposed" },
    candidateDigest: DIGEST, operationKey: "content-ai:proposal-0001", provider: "test",
    createdAt: "2026-10-30T00:00:00.000Z", expiresAt: "2999-01-01T00:00:00.000Z",
  };
  const receipt: EditorialReceipt = { operationKey: proposal.operationKey, entry: ref, revisionId: "revision-2", expected: "after" };
  const contentAi = {
    status: vi.fn(), scope: vi.fn(),
    prepare: vi.fn(async () => ({ status: "proposed" as const, proposal })),
    read: vi.fn(async () => ({ proposal, applied: null as EditorialReceipt | null, undone: null })),
    apply: vi.fn(async () => ({ receipt, recovered: false })),
    undo: vi.fn(),
  } satisfies RemoteContentAi;
  Object.assign(provider.store, { contentAi });
  await controller.prepareAiProposal("Shorter");
  return { controller, contentAi, proposal, receipt };
}

afterEach(() => { localStorage.clear(); });

describe("Content-AI approval in the controller command path", () => {
  it("refuses a fresh Apply until the current candidate has rendered, without calling Apply", async () => {
    const { controller, contentAi, proposal } = await open();
    expect(controller.state.aiSession?.render.status).toBe("rendering");
    await expect(controller.runAiProposal("apply", proposal.id)).rejects.toThrow("successful render of this exact candidate");
    expect(contentAi.apply).not.toHaveBeenCalled();
  });

  it("lets only the latest render token approve, and only for the proposal's digest", async () => {
    const { controller, contentAi, proposal } = await open();
    const late = controller.beginCandidateRender(proposal.id);
    const latest = controller.beginCandidateRender(proposal.id);
    controller.recordCandidateRender(late, proposal.id, { status: "ready", digest: DIGEST });
    expect(controller.state.aiSession?.render.status).toBe("rendering");
    controller.recordCandidateRender(latest, proposal.id, { status: "ready", digest: "b".repeat(64) });
    expect(controller.state.aiSession?.render.status).toBe("failed");
    const current = controller.beginCandidateRender(proposal.id);
    controller.recordCandidateRender(current, proposal.id, { status: "ready", digest: DIGEST });
    await controller.runAiProposal("apply", proposal.id);
    expect(contentAi.apply).toHaveBeenCalledWith({ proposalId: proposal.id, renderedCandidate: DIGEST });
    expect(controller.state.aiSession?.applied?.revisionId).toBe("revision-2");
  });

  it("treats a local edit after Prepare as stale even with an approved render", async () => {
    const { controller, contentAi, proposal } = await open();
    controller.recordCandidateRender(controller.beginCandidateRender(proposal.id), proposal.id, { status: "ready", digest: DIGEST });
    controller.updateEntryValue("title", "A human edit");
    expect(aiProposalStale(controller.state.entry, proposal)).toBe(true);
    await expect(controller.runAiProposal("apply", proposal.id)).rejects.toThrow("changed after this proposal was prepared");
    expect(contentAi.apply).not.toHaveBeenCalled();
  });

  it("recovers a committed Apply without a render, and restores the proposal after a reload", async () => {
    const { controller, contentAi, proposal, receipt } = await open();
    contentAi.read.mockResolvedValue({ proposal, applied: receipt, undone: null });
    await controller.runAiProposal("apply", proposal.id);
    expect(contentAi.apply).not.toHaveBeenCalled();
    expect(controller.state.aiSession).toMatchObject({ applied: receipt, recovered: "apply" });

    const reloaded = createContentAuthoringController(controller.provider);
    await reloaded.initialize(); await reloaded.openModel("articles"); await reloaded.openEntry("entry-1");
    expect(await reloaded.restoreAiProposal()).toBe(true);
    expect(contentAi.read).toHaveBeenLastCalledWith({ proposalId: proposal.id });
    expect(contentAi.prepare).toHaveBeenCalledTimes(1);
    expect(reloaded.state.aiSession).toMatchObject({ applied: receipt, restored: true, render: { status: "rendering" } });
  });

  it("forgets the browser reference when the proposal is discarded", async () => {
    const { controller } = await open();
    controller.discardAiProposal();
    expect(await controller.restoreAiProposal()).toBe(false);
  });
});
