// The decisive editorial scenario, run unchanged against every backend that
// answers the shared boundary. It imports no test framework: a backend's own
// suite supplies the assertion and calls it.
import type { ContentEntryRef } from "../model";
import { EditorialError, type ContentEditorialBoundary, type EditorialProvenance, type EditorialRevision } from "./types";

export interface EditorialScenarioHarness {
  readonly entry: ContentEntryRef;
  /** A boundary over the backend's current handle, bound to trusted provenance. */
  boundary(provenance: EditorialProvenance): ContentEditorialBoundary;
  /** Activate the Entry's current working values through the backend's own publication path. */
  publish(): Promise<void>;
  /** Close every handle and reopen the same storage. */
  restart(): Promise<void>;
  /** Change the definition so the named field no longer exists. */
  removeField(fieldId: string): Promise<void>;
}
export interface EditorialScenarioStep { step: string; detail: unknown }

const human: EditorialProvenance = { actor: { id: "editor" }, source: "content-editor" };
const assistant: EditorialProvenance = { actor: { id: "editor" }, source: "content-ai" };

export async function runEditorialScenario(harness: EditorialScenarioHarness, check: (actual: unknown, expected: unknown, message: string) => void): Promise<EditorialScenarioStep[]> {
  const steps: EditorialScenarioStep[] = [];
  const { entry } = harness;
  const editor = () => harness.boundary(human);
  const ai = () => harness.boundary(assistant);
  const working = () => editor().readEntry({ entry, perspective: "working" });
  const published = () => editor().readEntry({ entry, perspective: "published" });
  const history = async (): Promise<EditorialRevision[]> => {
    const all: EditorialRevision[] = [];
    let cursor: string | undefined;
    do {
      const page = await editor().listRevisions({ entry, limit: 2, ...(cursor ? { cursor } : {}) });
      all.push(...page.revisions);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return all;
  };
  const refused = async (work: () => Promise<unknown>): Promise<EditorialError> => {
    try { await work(); } catch (error) { if (error instanceof EditorialError) return error; throw error; }
    throw new Error("Expected the editorial boundary to refuse.");
  };
  const title = (values: Record<string, unknown>) => [values.title, values.body];

  await harness.publish();
  check(title((await published()).values), ["Title A", "Body A"], "1. A is published");
  check((await working()).status, "published", "1. working equals the activated publication");
  steps.push({ step: "publish-a", detail: (await editor().publicationStatus()).activated });

  const beforeB = await working();
  const savedB = await editor().saveFields({ entry, expected: beforeB.expected, values: { title: "Title B", body: "Body B" }, clear: [], operationKey: "save-b" });
  check(title((await working()).values), ["Title B", "Body B"], "2. working is B");
  check(title((await published()).values), ["Title A", "Body A"], "2. published stays A");
  check((await working()).status, "changed", "2. the Entry reports unpublished changes");
  const afterB = await history();
  check(afterB.map((revision) => [revision.sequence, revision.operation.kind, revision.source]), [[2, "set-fields", "content-editor"], [1, "initial", afterB[1]?.source]], "2. history begins with the existing values, then B");
  check(afterB[1]?.values.title, "Title A", "2. the initial revision records the values that existed before history");
  steps.push({ step: "save-b", detail: savedB });

  const pinned = await working();
  const proposal = { entry, expected: pinned.expected, values: { title: "Title C", body: "Body C" }, clear: [] };
  const prepared = await ai().validateFields(proposal);
  check(prepared.differences.map((difference) => [difference.fieldId, difference.before, difference.after]), [["title", "Title B", "Title C"], ["body", "Body B", "Body C"]], "3. the proposal shows field differences");
  check(prepared.values.title, "Title C", "3. the candidate is complete");
  check(title((await working()).values), ["Title B", "Body B"], "3. preparing writes nothing");
  check((await history()).length, 2, "3. preparing appends no history");
  steps.push({ step: "prepare-c", detail: prepared.differences });

  const applied = await ai().saveFields({ ...proposal, operationKey: "apply-c" });
  const afterC = await history();
  check(afterC.length, 3, "4. Apply appends exactly one revision");
  check([afterC[0]?.id, afterC[0]?.source, afterC[0]?.actor, afterC[0]?.operation], [applied.revisionId, "content-ai", { id: "editor" }, { kind: "set-fields", key: "apply-c" }], "4. the revision carries AI provenance");
  check(title((await published()).values), ["Title A", "Body A"], "4. published stays A");
  steps.push({ step: "apply-c", detail: applied });

  await harness.restart();
  check(title((await working()).values), ["Title C", "Body C"], "5. values persist across restart");
  check((await history()).map((revision) => revision.id), afterC.map((revision) => revision.id), "5. history persists across restart");

  const revisionB = afterC.find((revision) => revision.operation.key === "save-b")!;
  const restoreRequest = { entry, revisionId: revisionB.id, expected: (await working()).expected, operationKey: "restore-b" };
  const restored = await editor().restoreRevision(restoreRequest);
  const afterRestore = await history();
  check([afterRestore.length, afterRestore[0]?.restoredFrom, afterRestore[0]?.operation.kind], [4, revisionB.id, "restore-revision"], "6. restore appends a new revision");
  check(title((await working()).values), ["Title B", "Body B"], "6. working is B again");
  check(title((await published()).values), ["Title A", "Body A"], "6. published stays A");
  check((await working()).lifecycle, pinned.lifecycle, "6. publication intent is kept");
  steps.push({ step: "restore-b", detail: restored });

  check(await ai().saveFields({ ...proposal, operationKey: "apply-c" }), applied, "7. a lost-ack Apply retry returns the same receipt");
  check(await editor().restoreRevision(restoreRequest), restored, "7. a lost-ack restore retry returns the same receipt");
  check((await history()).length, 4, "7. retries append nothing");
  check((await refused(() => ai().saveFields({ ...proposal, values: { title: "Other" }, operationKey: "apply-c" }))).code, "operation-key-reuse", "7. a reused key with another request is refused");

  const stalePin = await working();
  const stale = { entry, expected: stalePin.expected, values: { title: "Title D" }, clear: [] };
  await ai().validateFields(stale);
  await editor().saveFields({ entry, expected: stalePin.expected, values: { subtitle: "Human edit" }, clear: [], operationKey: "human-edit" });
  const staleError = await refused(() => ai().saveFields({ ...stale, operationKey: "apply-d" }));
  check(staleError.code, "revision-conflict", "8. a stale Apply is refused");
  check([(await working()).values.title, (await working()).values.subtitle], ["Title B", "Human edit"], "8. the human edit survives and nothing partial is written");
  check((await history()).length, 5, "8. the refused Apply appends nothing");
  steps.push({ step: "stale-apply", detail: staleError.code });

  await harness.removeField("subtitle");
  const beforeIncompatible = await history();
  const incompatible = await refused(async () => editor().restoreRevision({ entry, revisionId: beforeIncompatible.find((revision) => revision.operation.key === "human-edit")!.id, expected: (await working()).expected, operationKey: "restore-removed" }));
  check([incompatible.code, incompatible.diagnostics.map((item) => [item.fieldId, item.code])], ["restore-incompatible", [["subtitle", "field-removed"]]], "9. an incompatible restore is refused with field diagnostics");
  check((await history()).length, beforeIncompatible.length, "9. the refused restore appends nothing");
  check(title((await published()).values), ["Title A", "Body A"], "9. published still A");
  steps.push({ step: "incompatible-restore", detail: incompatible.diagnostics });
  return steps;
}
