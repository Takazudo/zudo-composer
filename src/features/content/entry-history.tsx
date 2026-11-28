import { computed, For, getScope, Show, signal } from "@takazudo/zfb/zudo-react";
import { formatLibraryTimestampFull } from "../../components/library-page";
import { read, toSignal, type MaybeSignal } from "../../components/reactive";
import { Rebuild } from "../../components/rebuild";
import { Button } from "../../components/ui";
import type { ContentEntryRecord, ContentFieldDefinition } from "../../content";
import { EditorialError, type EditorialComparison, type EditorialFieldDiagnostic, type EditorialRevision } from "../../content/editorial";
import type { ContentAuthoringController } from "./controller";

const PAGE_SIZE = 10;
const OPERATION_LABELS: Record<string, string> = {
  initial: "Values before history began",
  save: "Saved",
  "set-fields": "Edited",
  "restore-revision": "Restored",
  "remove-field": "Field removed",
};
const SOURCE_LABELS: Record<string, string> = {
  "content-editor": "Content editor",
  "content-ai": "AI proposal",
  "content-store": "Content",
  "existing-content": "Existing content",
};

function display(value: unknown): string {
  if (value === undefined) return "—";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export interface EntryHistoryProps {
  controller: ContentAuthoringController;
  /** The open Entry; its id is fixed for this history's lifetime. */
  entry: MaybeSignal<ContentEntryRecord>;
  fields: MaybeSignal<readonly ContentFieldDefinition[]>;
  /** Changes whenever a save lands, so the list follows the editor. */
  refreshKey: MaybeSignal<string>;
  /** The outcome of the last history action; it outranks the list summary. */
  notice: MaybeSignal<{ entryId: string; text: string } | null>;
}

/**
 * The open Entry's working history. Compare shows a revision against the
 * current working values; Restore writes a revision's values as a new
 * revision, so nothing in the list is ever replaced.
 */
export function EntryHistory({ controller, entry: suppliedEntry, fields, refreshKey, notice }: EntryHistoryProps) {
  const scope = getScope();
  const editorial = controller.editorial;
  const entry = toSignal(suppliedEntry);
  if (!editorial) return null;
  const entryId = entry.value.id;
  const ref = () => controller.entryRef(entry.value);
  const revisions = signal<readonly EditorialRevision[]>([]);
  const cursor = signal<string | null>(null);
  const status = signal("Loading history…");
  const comparison = signal<{ revisionId: string; value: EditorialComparison } | null>(null);
  const refusal = signal<{ message: string; diagnostics: readonly EditorialFieldDiagnostic[] } | null>(null);
  const busy = signal(false);
  const generation = signal(0);
  const label = (fieldId: string) => read(fields).find((field) => field.id === fieldId)?.label ?? fieldId;

  let load = 0;
  // Computeds rerun their readers on every upstream change, so the trigger is compared by value.
  let requested: string | null = null;
  scope.effect(() => {
    const trigger = `${read(refreshKey)}\u0000${generation.value}`;
    if (trigger === requested) return;
    requested = trigger;
    const current = ++load;
    const live = () => current === load && !scope.abortSignal.aborted;
    void editorial.listRevisions({ entry: ref(), limit: PAGE_SIZE }).then((page) => {
      if (!live()) return;
      revisions.value = page.revisions; cursor.value = page.nextCursor;
      status.value = page.revisions.length ? `${page.revisions.length}${page.nextCursor ? "+" : ""} revisions.` : "No revisions yet. History begins with the first save.";
    }, (error: unknown) => { if (live()) status.value = error instanceof Error ? error.message : "History is unavailable."; });
  });

  const loadOlder = async () => {
    const from = cursor.value;
    if (!from) return;
    const page = await editorial.listRevisions({ entry: ref(), limit: PAGE_SIZE, cursor: from });
    if (scope.abortSignal.aborted) return;
    revisions.value = [...revisions.value, ...page.revisions]; cursor.value = page.nextCursor;
  };
  const compare = async (revisionId: string) => {
    if (comparison.value?.revisionId === revisionId) { comparison.value = null; return; }
    const value = await editorial.compare({ entry: ref(), from: { revisionId }, to: { perspective: "working" } });
    if (!scope.abortSignal.aborted) comparison.value = { revisionId, value };
  };
  const restore = async (revision: EditorialRevision) => {
    busy.value = true; refusal.value = null;
    try {
      await controller.restoreRevision(revision.id);
      comparison.value = null;
      generation.value += 1;
    } catch (error) {
      if (error instanceof EditorialError) refusal.value = { message: error.message, diagnostics: error.diagnostics };
      else refusal.value = { message: error instanceof Error ? error.message : "Restore failed.", diagnostics: [] };
    } finally { busy.value = false; }
  };

  const headingId = `content-history-${entryId}`;
  return (
    <section class="sg-content-group sg-content-history" aria-labelledby={headingId}>
      <div class="sg-content-history__head">
        <h3 class="sg-content-group__title" id={headingId}>History</h3>
        <Button variant="ghost" size="sm" on:click={() => { generation.value += 1; }}>Refresh history</Button>
      </div>
      <p class="sg-content-history__status" role="status">{computed(() => { const current = read(notice); return current?.entryId === entryId ? current.text : status.value; })}</p>
      <Rebuild value={refusal}>{(current) => current ? (
        <div class="sg-content-history__refusal" role="alert">
          <p>{current.message}</p>
          {current.diagnostics.length ? <ul>{current.diagnostics.map((item) => <li><strong>{label(item.fieldId)}</strong>: {item.message}</li>)}</ul> : null}
        </div>
      ) : null}</Rebuild>
      <ol class="sg-content-history__list" data-history-entry={entryId}>
        <For each={revisions} by={(revision) => revision.id}>{(slot, index) => {
          const revision = slot.value;
          const open = computed(() => comparison.value?.revisionId === revision.id ? comparison.value.value : null);
          return (
            <li class="sg-content-history__item" data-revision-id={revision.id} data-revision-sequence={revision.sequence}>
              <div class="sg-content-history__summary">
                <span>#{revision.sequence} · {OPERATION_LABELS[revision.operation.kind] ?? revision.operation.kind} · {SOURCE_LABELS[revision.source] ?? revision.source}</span>
                <time datetime={revision.createdAt}>{formatLibraryTimestampFull(revision.createdAt)}</time>
              </div>
              <div class="sg-content-history__actions">
                <Button variant="default" size="sm" aria-expanded={computed(() => open.value !== null)} on:click={() => void compare(revision.id)}>Compare #{revision.sequence} with current</Button>
                <Button variant="default" size="sm" disabled={computed(() => busy.value || index.value === 0)} on:click={() => void restore(revision)}>Restore #{revision.sequence}</Button>
              </div>
              <Rebuild value={open}>{(value) => value === null ? null : value.differences.length ? (
                <table class="sg-content-history__diff">
                  <thead><tr><th scope="col">Field</th><th scope="col">Revision #{revision.sequence}</th><th scope="col">Current</th></tr></thead>
                  <tbody>{value.differences.map((difference) => (
                    <tr data-field-id={difference.fieldId}>
                      <th scope="row">{difference.removedFromDefinition ? `${difference.label} (removed field)` : label(difference.fieldId)}</th>
                      <td>{display(difference.before)}</td>
                      <td>{display(difference.after)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p class="sg-content-history__same">Same values as the current Entry.</p>}</Rebuild>
            </li>
          );
        }}</For>
      </ol>
      <Show when={computed(() => cursor.value !== null)}>{() => <Button variant="ghost" size="sm" on:click={() => void loadOlder()}>Load older revisions</Button>}</Show>
    </section>
  );
}
