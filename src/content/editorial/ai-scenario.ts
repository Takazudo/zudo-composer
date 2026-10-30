// The Content-AI journey, run unchanged against every backend through the
// shared boundary, with an injected proposer.
import { createContentAiService, createFakeContentAiProposer, type ContentAiProposer } from "./ai";
import type { EditorialScenarioHarness, EditorialScenarioStep } from "./scenario";
import { EditorialError } from "./types";

const editor = { actor: { id: "editor" }, source: "content-editor" };

export async function runContentAiScenario(harness: EditorialScenarioHarness, check: (actual: unknown, expected: unknown, message: string) => void): Promise<EditorialScenarioStep[]> {
  const steps: EditorialScenarioStep[] = [];
  const { entry } = harness;
  let ids = 0;
  const service = (proposer: ContentAiProposer = createFakeContentAiProposer()) => createContentAiService({ boundary: (provenance) => harness.boundary(provenance), actor: { id: "editor" }, proposer, createId: () => `proposal-${++ids}` });
  const human = () => harness.boundary(editor);
  const working = () => human().readEntry({ entry, perspective: "working" });
  const published = () => human().readEntry({ entry, perspective: "published" });
  const count = async () => { let total = 0, cursor: string | undefined; do { const page = await human().listRevisions({ entry, limit: 100, ...(cursor ? { cursor } : {}) }); total += page.revisions.length; cursor = page.nextCursor ?? undefined; } while (cursor); return total; };
  const refused = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { if (error instanceof EditorialError) return error; throw error; } throw new Error("Expected a refusal."); };

  await harness.publish();
  const ai = service();
  const scope = await ai.scope(entry);
  check(scope.map((field) => field.key), ["title", "body"], "C1. Content-AI is scoped to the Article title and body");

  // History already exists, so each AI step below appends exactly its own revision.
  const start = await working();
  await human().saveFields({ entry, expected: start.expected, values: { body: "Human draft" }, clear: [], operationKey: "human-before-ai" });
  const before = await working(), history = await count(), publishedTitle = (await published()).values.title;
  const prepared = await ai.prepare({ entry, instruction: "tighter" });
  if (prepared.status !== "proposed") throw new Error("Expected a proposal.");
  const { proposal } = prepared;
  check(proposal.differences.map((difference) => difference.fieldId), ["title", "body"], "C2. the proposal shows field differences");
  check([proposal.candidate.title, proposal.candidate.slug], [`${before.values.title} — tighter`, before.values.slug], "C2. the candidate is the exact complete working state Apply would write");
  check([(await working()).values, await count()], [before.values, history], "C2. preparing writes nothing");
  steps.push({ step: "prepare", detail: proposal.differences });

  check(await ai.prepare({ entry, instruction: "please refuse" }), { status: "refused", message: "The fake provider declines instructions that ask it to refuse." }, "C3. a model refusal is kept and nothing is prepared");
  const outside: ContentAiProposer = { label: "outside", propose: async () => ({ kind: "proposal", values: { slug: "hijack" }, summary: "" }) };
  check((await refused(() => service(outside).prepare({ entry, instruction: "x" }))).code, "forbidden", "C3. a proposal outside title/body is refused");

  const applied = await ai.apply({ proposalId: proposal.id });
  const afterApply = await human().listRevisions({ entry, limit: 1 });
  check([await count(), afterApply.revisions[0]?.source, afterApply.revisions[0]?.actor, afterApply.revisions[0]?.id], [history + 1, "content-ai", { id: "editor" }, applied.revisionId], "C4. Apply appends one revision with AI provenance");
  check(await ai.apply({ proposalId: proposal.id }), applied, "C4. a repeated Apply returns the same receipt");
  check(await count(), history + 1, "C4. the repeat creates no duplicate");
  check((await published()).values.title, publishedTitle, "C4. publication is untouched");
  steps.push({ step: "apply", detail: applied });

  const undone = await ai.undo({ proposalId: proposal.id });
  check([(await working()).values.title, await count()], [before.values.title, history + 2], "C5. Undo appends a validated restore of the previous values");
  check(await ai.undo({ proposalId: proposal.id }), undone, "C5. a repeated Undo returns the same receipt");
  steps.push({ step: "undo", detail: undone });

  const second = await ai.prepare({ entry, instruction: "again" });
  if (second.status !== "proposed") throw new Error("Expected a proposal.");
  const pin = await working();
  await human().saveFields({ entry, expected: pin.expected, values: { body: "Human body" }, clear: [], operationKey: "human-during-ai" });
  check((await refused(() => ai.apply({ proposalId: second.proposal.id }))).code, "revision-conflict", "C6. a stale Apply is refused");
  check([(await working()).values.body, await count()], ["Human body", history + 3], "C6. the refused Apply writes nothing");

  const third = await ai.prepare({ entry, instruction: "third" });
  if (third.status !== "proposed") throw new Error("Expected a proposal.");
  await ai.apply({ proposalId: third.proposal.id });
  const later = await working();
  await human().saveFields({ entry, expected: later.expected, values: { title: "Human title after AI" }, clear: [], operationKey: "human-after-ai" });
  check((await refused(() => ai.undo({ proposalId: third.proposal.id }))).code, "revision-conflict", "C7. Undo never silently overwrites a later human edit");
  check((await working()).values.title, "Human title after AI", "C7. the human edit survives");
  steps.push({ step: "guards", detail: await count() });
  return steps;
}
