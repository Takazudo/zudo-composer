import type { JSX } from "preact";
import { stringLeaves, wordDiff, annotationId } from "./review-model";
import type { DraftChange, DraftView, PageRef } from "./types";

const keyOf = (page: PageRef) => `${page.sitemapId}/${page.pageId}`;

function Diff({ before, after }: { before: string; after: string }) {
  const { insert, remove } = wordDiff(before, after);
  const marks = (text: string, spans: [number, number][], Tag: "ins" | "del") => {
    const parts: (string | JSX.Element)[] = [];
    let cursor = 0;
    spans.forEach(([start, end], index) => { parts.push(text.slice(cursor, start), <Tag key={index}>{text.slice(start, end)}</Tag>); cursor = end; });
    parts.push(text.slice(cursor));
    return parts;
  };
  return <dl class="cms-assistant-diff">
    <dt>Current</dt><dd>{before ? marks(before, remove, "del") : <em>(empty)</em>}</dd>
    <dt>Draft</dt><dd>{after ? marks(after, insert, "ins") : <em>(empty)</em>}</dd>
  </dl>;
}
const isImage = (value: unknown) => typeof value === "string" && /^\/(?:uploaded-)?assets\//.test(value);
function FieldDetail({ change }: { change: DraftChange }) {
  if (isImage(change.before) || isImage(change.after)) return <div class="cms-assistant-images">
    <figure><figcaption>Current</figcaption>{change.before ? <img src={String(change.before)} alt="" /> : <em>(none)</em>}</figure>
    <figure><figcaption>Draft</figcaption>{change.after ? <img src={String(change.after)} alt="" /> : <em>(none)</em>}</figure>
  </div>;
  const before = new Map(stringLeaves(change.before).map(leaf => [leaf.path, leaf.text])), after = new Map(stringLeaves(change.after).map(leaf => [leaf.path, leaf.text]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path));
  if (!paths.length) return <Diff before={JSON.stringify(change.before ?? null)} after={JSON.stringify(change.after ?? null)} />;
  return <>{paths.map(path => <div key={path}>{path && <p class="cms-assistant-hint">{describePath(path)}</p>}<Diff before={before.get(path) ?? ""} after={after.get(path) ?? ""} /></div>)}</>;
}
const describePath = (path: string) => {
  const parts = path.split("/").filter(Boolean).map(Number);
  return parts.length === 2 ? `Row ${parts[0]! + 1}, cell ${parts[1]! + 1}` : parts.length === 1 ? `Item ${parts[0]! + 1}` : path;
};
function AddedDetail({ change }: { change: DraftChange }) {
  return <ul class="cms-assistant-added">{Object.entries(change.props ?? {}).map(([prop, value]) => <li key={prop}><span class="cms-assistant-hint">{prop}</span> {isImage(value) ? <img src={String(value)} alt="" /> : Array.isArray(value) ? <code>{JSON.stringify(value)}</code> : <ins>{String(value)}</ins>}</li>)}
    {change.children ? <li class="cms-assistant-hint">Includes {change.children} nested block{change.children === 1 ? "" : "s"}.</li> : null}</ul>;
}

export interface ReviewPanelProps {
  view: DraftView | null; currentPage: string; evidence: ReadonlySet<string>; fallback: ReadonlySet<string>;
  busy: boolean; canApply: boolean; applyBlocker: string | null; error: string | null;
  onOpen(change: DraftChange): void; onPage(page: PageRef): void; onWithdraw(change: DraftChange): void;
  onApply(): void; onDiscard(): void; onRevalidate(): void; onUndo(): void; onRecover(): void;
  dependents: { change: DraftChange; items: { id: string; kind: string; reason: string | null }[] } | null; onConfirmDependents(): void; onCancelDependents(): void;
}

/** Validated Unstaged Changes and receipt-backed results; never derived from message text. */
export function ReviewPanel(props: ReviewPanelProps) {
  const draft = props.view?.draft;
  if (!draft || draft.status === "discarded" || (draft.status === "open" && !draft.changes.length && !draft.stale.length && !draft.buildError)) return <section class="cms-assistant-review" aria-label="Unstaged changes"><h2>Unstaged changes</h2><p class="cms-assistant-hint">No pending AI changes. Proposals appear here for review before anything is saved.</p></section>;
  if (draft.status === "applied" || draft.status === "undone") return <section class="cms-assistant-review" aria-label="Applied changes">
    <h2>{draft.status === "applied" ? "Applied to Composer" : "Undo committed"}</h2>
    <p role="status">Receipt {draft.status === "applied" ? draft.applied?.operationId : draft.undone?.operationId} · {new Date((draft.status === "applied" ? draft.applied?.committedAt : draft.undone?.committedAt) ?? "").toLocaleString("en")}</p>
    <p class="cms-assistant-hint">Applied changes are saved authoring data in Composer. They are not published or deployed.</p>
    {props.error && <p role="alert" class="cms-assistant-error">{props.error}</p>}
    {draft.status === "applied" && <button type="button" class="cms-btn cms-btn--sm" disabled={props.busy} onClick={props.onUndo}>Undo apply</button>}
  </section>;
  const changes = draft.changes;
  const pages = draft.pages.filter(page => page.changed);
  return <section class="cms-assistant-review" aria-label="Unstaged changes">
    <header class="cms-assistant-review__header">
      <h2>Unstaged changes <span class="cms-assistant-count" aria-label={`${changes.length} changes`}>{changes.length}</span></h2>
      <span class="cms-assistant-hint">Draft r{draft.revision}</span>
    </header>
    {pages.length > 1 && <nav class="cms-assistant-page-tabs" aria-label="Changed pages">{pages.map(page => {
      const key = keyOf(page.page), count = changes.filter(change => keyOf(change.page) === key).length;
      const confirmed = !!draft.candidateDigest && props.evidence.has(`${draft.candidateDigest}|${key}`);
      return <button key={key} type="button" class="cms-btn cms-btn--sm" aria-current={props.currentPage === key ? "page" : undefined} onClick={() => props.onPage(page.page)}>{page.page.pageId} <span class="cms-assistant-count">{count}</span>{confirmed ? <span class="cms-assistant-hint"> · reviewed</span> : null}</button>;
    })}</nav>}
    {draft.stale.length > 0 && <div role="alert" class="cms-assistant-warning"><p>These changes no longer match the saved pages:</p><ul>{draft.stale.map(entry => <li key={keyOf(entry.page)}>{entry.page.pageId}: {entry.reason}</li>)}</ul><button type="button" class="cms-btn cms-btn--sm" disabled={props.busy} onClick={props.onRevalidate}>Revalidate against saved pages</button></div>}
    {!draft.dependenciesCurrent && <p role="alert" class="cms-assistant-warning">Components or host source changed since this draft began. Revalidate, then review again.</p>}
    {draft.buildError && <p role="alert" class="cms-assistant-error">{draft.buildError.message}</p>}
    <ol class="cms-assistant-changes">{changes.map(change => {
      const key = keyOf(change.page);
      return <li key={change.id} class="cms-assistant-change" data-kind={change.kind}>
        <div class="cms-assistant-change__head">
          <span class="cms-assistant-tag" data-kind={change.kind}>{change.kind === "added" ? "Added" : change.kind === "removed" ? "Removed" : "Changed"}</span>
          <button type="button" class="cms-assistant-link" onClick={() => props.onOpen(change)}>{change.componentTitle}{change.fieldLabel ? ` · ${change.fieldLabel}` : ""}</button>
          {pages.length > 1 && <span class="cms-assistant-hint">{change.page.pageId}</span>}
        </div>
        {change.kind === "added" ? <AddedDetail change={change} /> : <FieldDetail change={change} />}
        {props.fallback.has(annotationId(change)) && props.currentPage === key && <p class="cms-assistant-hint">Word highlights aren't available for this block's rendering, so the preview marks the whole block; the exact field change is listed here.</p>}
        {change.reasons[0] && <p class="cms-assistant-hint">Requested: “{change.reasons[0]}”</p>}
        <button type="button" class="cms-assistant-link" disabled={props.busy} onClick={() => props.onWithdraw(change)}>Withdraw</button>
      </li>;
    })}</ol>
    {props.dependents && <div role="alertdialog" aria-label="Dependent changes" class="cms-assistant-warning">
      <p>Withdrawing this change also removes {props.dependents.items.length} dependent change{props.dependents.items.length === 1 ? "" : "s"} placed relative to it.</p>
      <button type="button" class="cms-btn cms-btn--sm" onClick={props.onConfirmDependents}>Withdraw all {props.dependents.items.length + 1}</button>
      <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" onClick={props.onCancelDependents}>Keep</button>
    </div>}
    {props.error && <p role="alert" class="cms-assistant-error">{props.error}</p>}
    <div class="cms-assistant-review__actions">
      <button type="button" class="cms-btn cms-btn--primary" disabled={props.busy || !props.canApply} aria-describedby="assistant-apply-state" onClick={props.onApply}>Apply to Composer</button>
      <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" disabled={props.busy} onClick={props.onDiscard}>Discard all</button>
      <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" disabled={props.busy} onClick={props.onRecover}>Check receipt</button>
    </div>
    <p id="assistant-apply-state" role="status" class="cms-assistant-hint">{props.canApply ? "Every changed page rendered successfully as reviewed. Apply saves to Composer; it does not publish." : props.applyBlocker}</p>
  </section>;
}
