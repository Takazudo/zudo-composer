// The Content-AI journey, run unchanged against every backend through the
// shared boundary, with an injected proposer. "Restart" closes the backend's
// handles and reopens both the backend and the proposal store; nothing
// survives in memory between the halves of a recovery.
import { createContentAiService, createFakeContentAiProposer, type ContentAiProposalStore, type ContentAiProposer, type ContentAiServiceOptions } from "./ai";
import type { EditorialScenarioHarness, EditorialScenarioStep } from "./scenario";
import { EditorialError } from "./types";

const editor = { actor: { id: "editor" }, source: "content-editor" };
const OWNER = "scenario-backend";

export interface ContentAiScenarioOptions {
  /** Opens the durable proposal store; called again after every restart. */
  openProposals(): Promise<ContentAiProposalStore>;
}

export async function runContentAiScenario(harness: EditorialScenarioHarness, check: (actual: unknown, expected: unknown, message: string) => void, options: ContentAiScenarioOptions): Promise<EditorialScenarioStep[]> {
  const steps: EditorialScenarioStep[] = [];
  const { entry } = harness;
  let ids = 0;
  let proposals = await options.openProposals();
  const service = (overrides: Partial<ContentAiServiceOptions> = {}) => createContentAiService({
    boundary: (provenance) => harness.boundary(provenance), actor: { id: "editor" }, owner: OWNER, proposer: createFakeContentAiProposer(),
    store: proposals, createId: () => `proposal-${String(++ids).padStart(4, "0")}`, ...overrides,
  });
  const restart = async () => { await harness.restart(); proposals = await options.openProposals(); };
  const human = () => harness.boundary(editor);
  const working = () => human().readEntry({ entry, perspective: "working" });
  const published = () => human().readEntry({ entry, perspective: "published" });
  const count = async () => { let total = 0, cursor: string | undefined; do { const page = await human().listRevisions({ entry, limit: 100, ...(cursor ? { cursor } : {}) }); total += page.revisions.length; cursor = page.nextCursor ?? undefined; } while (cursor); return total; };
  const refused = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { if (error instanceof EditorialError) return error; throw error; } throw new Error("Expected a refusal."); };
  const proposed = async (instruction: string) => {
    const result = await service().prepare({ entry, instruction });
    if (result.status !== "proposed") throw new Error("Expected a proposal.");
    return result.proposal;
  };

  await harness.publish();
  check((await service().scope(entry)).map((field) => field.key), ["title", "body"], "C1. Content-AI is scoped to the Article title and body");

  // History already exists, so each AI step below appends exactly its own revision.
  const start = await working();
  await human().saveFields({ entry, expected: start.expected, values: { body: "Human draft" }, clear: [], operationKey: "human-before-ai" });
  const before = await working(), history = await count(), publishedTitle = (await published()).values.title;
  const proposal = await proposed("tighter");
  check(proposal.differences.map((difference) => difference.fieldId), ["title", "body"], "C2. the proposal shows field differences");
  check([proposal.candidate.title, proposal.candidate.slug], [`${before.values.title} — tighter`, before.values.slug], "C2. the candidate is the exact complete working state Apply would write");
  check([(await working()).values, await count()], [before.values, history], "C2. preparing writes nothing");
  await restart();
  check((await service().read({ proposalId: proposal.id })), { proposal, applied: null, undone: null }, "C2. after a restart the same immutable proposal is read back");
  steps.push({ step: "prepare", detail: proposal.differences });

  check(await service().prepare({ entry, instruction: "please refuse" }), { status: "refused", message: "The fake provider declines instructions that ask it to refuse." }, "C3. a model refusal is kept and nothing is prepared");
  const outside: ContentAiProposer = { label: "outside", propose: async () => ({ kind: "proposal", values: { slug: "hijack" }, summary: "" }) };
  check((await refused(() => service({ proposer: outside }).prepare({ entry, instruction: "x" }))).code, "forbidden", "C3. a proposal outside title/body is refused");
  check((await refused(() => service({ owner: "another-backend" }).read({ proposalId: proposal.id }))).code, "not-found", "C3. another backend cannot look the proposal up");
  check((await refused(() => service({ actor: { id: "someone-else" } }).apply({ proposalId: proposal.id, renderedCandidate: proposal.candidateDigest }))).code, "not-found", "C3. another actor cannot apply it");
  check((await refused(() => service({ canApply: false }).apply({ proposalId: proposal.id, renderedCandidate: proposal.candidateDigest }))).code, "forbidden", "C3. a propose-only host cannot apply");
  check((await refused(() => service().apply({ proposalId: proposal.id }))).code, "invalid-request", "C3. a fresh Apply needs a render of the exact candidate");
  check((await refused(() => service().apply({ proposalId: proposal.id, renderedCandidate: "0".repeat(64) }))).code, "invalid-request", "C3. a render of another candidate does not count");
  check((await refused(() => service({ now: () => new Date(Date.parse(proposal.expiresAt) + 1) }).apply({ proposalId: proposal.id, renderedCandidate: proposal.candidateDigest }))).code, "invalid-request", "C3. an expired proposal cannot be freshly applied");
  check(await count(), history, "C3. every refusal wrote nothing");

  // The acknowledgement is lost: the Apply commits, its response is dropped, and the process restarts.
  const applied = (await service().apply({ proposalId: proposal.id, renderedCandidate: proposal.candidateDigest })).receipt;
  await restart();
  const head = (await human().listRevisions({ entry, limit: 1 })).revisions[0];
  check([await count(), head?.source, head?.actor, head?.id], [history + 1, "content-ai", { id: "editor" }, applied.revisionId], "C4. Apply appends one revision with AI provenance");
  check(await service().apply({ proposalId: proposal.id }), { receipt: applied, recovered: true }, "C4. after a restart the retry recovers the original receipt without a fresh render");
  check(await service().read({ proposalId: proposal.id }), { proposal, applied, undone: null }, "C4. reading the proposal reports the committed Apply");
  check(await count(), history + 1, "C4. recovery creates no duplicate");
  check((await published()).values.title, publishedTitle, "C4. publication is untouched");
  steps.push({ step: "apply", detail: applied });

  const undone = (await service().undo({ proposalId: proposal.id })).receipt;
  await restart();
  check([(await working()).values.title, await count()], [before.values.title, history + 2], "C5. Undo appends a validated restore of the previous values");
  check(await service().undo({ proposalId: proposal.id }), { receipt: undone, recovered: true }, "C5. after a restart a retried Undo recovers the same receipt");
  check(await count(), history + 2, "C5. the recovered Undo adds nothing");
  steps.push({ step: "undo", detail: undone });

  // The crash window: the content commit lands, then the process stops before anything else happens.
  const crashed = await proposed("crash window");
  const ai = harness.boundary({ actor: { id: "editor" }, source: "content-ai" });
  const committed = await ai.saveFields({ entry, expected: crashed.expected, values: crashed.values, clear: [], operationKey: crashed.operationKey });
  await restart();
  check(await service().apply({ proposalId: crashed.id }), { receipt: committed, recovered: true }, "C6. a commit whose process stopped is found, not reported as unapplied");
  check(await count(), history + 3, "C6. and is not applied twice");
  steps.push({ step: "crash-window", detail: committed });

  const second = await proposed("again");
  const pin = await working();
  await human().saveFields({ entry, expected: pin.expected, values: { body: "Human body" }, clear: [], operationKey: "human-during-ai" });
  check((await refused(() => service().apply({ proposalId: second.id, renderedCandidate: second.candidateDigest }))).code, "revision-conflict", "C7. a stale Apply is refused");
  check([(await working()).values.body, await count()], ["Human body", history + 4], "C7. the refused Apply writes nothing");

  const third = await proposed("third");
  await service().apply({ proposalId: third.id, renderedCandidate: third.candidateDigest });
  const later = await working();
  await human().saveFields({ entry, expected: later.expected, values: { title: "Human title after AI" }, clear: [], operationKey: "human-after-ai" });
  check((await refused(() => service({ canApply: false }).undo({ proposalId: third.id }))).code, "forbidden", "C8. a propose-only host cannot freshly undo");
  check((await refused(() => service().undo({ proposalId: third.id }))).code, "revision-conflict", "C8. Undo never silently overwrites a later human edit");
  check((await working()).values.title, "Human title after AI", "C8. the human edit survives");
  check(await service().apply({ proposalId: third.id }), { receipt: (await service().read({ proposalId: third.id })).applied, recovered: true }, "C8. the committed Apply stays recoverable after later edits");
  steps.push({ step: "guards", detail: await count() });

  // Inference down: no new proposal, but saved Content, history and committed operations stay readable.
  const offline = service({ proposer: null });
  check((await refused(() => offline.prepare({ entry, instruction: "anything" }))).code, "unavailable", "C9. without a provider nothing new is prepared");
  check((await offline.read({ proposalId: proposal.id })).undone, undone, "C9. without a provider committed operations are still read back");
  check(await offline.apply({ proposalId: crashed.id }), { receipt: committed, recovered: true }, "C9. without a provider a committed Apply is still recovered");
  check((await working()).values.title, "Human title after AI", "C9. without a provider the saved Content is unchanged");
  steps.push({ step: "provider-unavailable", detail: await count() });
  return steps;
}
