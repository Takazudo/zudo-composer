import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatLibraryTimestampFull } from "../../components/library-page";
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
  entry: ContentEntryRecord;
  fields: readonly ContentFieldDefinition[];
  /** Changes whenever a save lands, so the list follows the editor. */
  refreshKey: string;
  /** The outcome of the last history action; it outranks the list summary. */
  notice: { entryId: string; text: string } | null;
}

/**
 * The open Entry's working history. Compare shows a revision against the
 * current working values; Restore writes a revision's values as a new
 * revision, so nothing in the list is ever replaced.
 */
export function EntryHistory({ controller, entry, fields, refreshKey, notice }: EntryHistoryProps): JSX.Element | null {
  const editorial = controller.editorial;
  const [revisions, setRevisions] = useState<readonly EditorialRevision[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading history…");
  const [comparison, setComparison] = useState<{ revisionId: string; value: EditorialComparison } | null>(null);
  const [refusal, setRefusal] = useState<{ message: string; diagnostics: readonly EditorialFieldDiagnostic[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const ref = editorial ? controller.entryRef(entry) : null;
  const label = (fieldId: string) => fields.find((field) => field.id === fieldId)?.label ?? fieldId;

  useEffect(() => {
    if (!editorial || !ref) return;
    let current = true;
    void editorial.listRevisions({ entry: ref, limit: PAGE_SIZE }).then((page) => {
      if (!current) return;
      setRevisions(page.revisions); setCursor(page.nextCursor);
      setStatus(page.revisions.length ? `${page.revisions.length}${page.nextCursor ? "+" : ""} revisions.` : "No revisions yet. History begins with the first save.");
    }, (error: unknown) => { if (current) setStatus(error instanceof Error ? error.message : "History is unavailable."); });
    return () => { current = false; };
  }, [editorial, entry.id, refreshKey, generation]);

  if (!editorial || !ref) return null;

  const loadOlder = async () => {
    if (!cursor) return;
    const page = await editorial.listRevisions({ entry: ref, limit: PAGE_SIZE, cursor });
    setRevisions([...revisions, ...page.revisions]); setCursor(page.nextCursor);
  };
  const compare = async (revisionId: string) => {
    if (comparison?.revisionId === revisionId) { setComparison(null); return; }
    setComparison({ revisionId, value: await editorial.compare({ entry: ref, from: { revisionId }, to: { perspective: "working" } }) });
  };
  const restore = async (revision: EditorialRevision) => {
    setBusy(true); setRefusal(null);
    try {
      await controller.restoreRevision(revision.id);
      setComparison(null);
      setGeneration(generation + 1);
    } catch (error) {
      if (error instanceof EditorialError) setRefusal({ message: error.message, diagnostics: error.diagnostics });
      else setRefusal({ message: error instanceof Error ? error.message : "Restore failed.", diagnostics: [] });
    } finally { setBusy(false); }
  };

  return (
    <section class="sg-content-group sg-content-history" aria-labelledby={`content-history-${entry.id}`}>
      <div class="sg-content-history__head">
        <h3 class="sg-content-group__title" id={`content-history-${entry.id}`}>History</h3>
        <Button variant="ghost" size="sm" onClick={() => setGeneration(generation + 1)}>Refresh history</Button>
      </div>
      <p class="sg-content-history__status" role="status">{notice?.entryId === entry.id ? notice.text : status}</p>
      {refusal ? (
        <div class="sg-content-history__refusal" role="alert">
          <p>{refusal.message}</p>
          {refusal.diagnostics.length ? <ul>{refusal.diagnostics.map((item) => <li key={item.fieldId}><strong>{label(item.fieldId)}</strong>: {item.message}</li>)}</ul> : null}
        </div>
      ) : null}
      <ol class="sg-content-history__list" data-history-entry={entry.id}>
        {revisions.map((revision, index) => (
          <li key={revision.id} class="sg-content-history__item" data-revision-id={revision.id} data-revision-sequence={revision.sequence}>
            <div class="sg-content-history__summary">
              <span>#{revision.sequence} · {OPERATION_LABELS[revision.operation.kind] ?? revision.operation.kind} · {SOURCE_LABELS[revision.source] ?? revision.source}</span>
              <time dateTime={revision.createdAt}>{formatLibraryTimestampFull(revision.createdAt)}</time>
            </div>
            <div class="sg-content-history__actions">
              <Button variant="default" size="sm" aria-expanded={comparison?.revisionId === revision.id} onClick={() => void compare(revision.id)}>Compare #{revision.sequence} with current</Button>
              <Button variant="default" size="sm" disabled={busy || index === 0} onClick={() => void restore(revision)}>Restore #{revision.sequence}</Button>
            </div>
            {comparison?.revisionId === revision.id ? (
              comparison.value.differences.length ? (
                <table class="sg-content-history__diff">
                  <thead><tr><th scope="col">Field</th><th scope="col">Revision #{revision.sequence}</th><th scope="col">Current</th></tr></thead>
                  <tbody>{comparison.value.differences.map((difference) => (
                    <tr key={difference.fieldId} data-field-id={difference.fieldId}>
                      <th scope="row">{difference.removedFromDefinition ? `${difference.label} (removed field)` : label(difference.fieldId)}</th>
                      <td>{display(difference.before)}</td>
                      <td>{display(difference.after)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ) : <p class="sg-content-history__same">Same values as the current Entry.</p>
            ) : null}
          </li>
        ))}
      </ol>
      {cursor ? <Button variant="ghost" size="sm" onClick={() => void loadOlder()}>Load older revisions</Button> : null}
    </section>
  );
}
