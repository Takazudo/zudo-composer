import { computed, For, Show, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { Rebuild } from "../../components/rebuild";
import { read, type MaybeSignal } from "../../components/reactive";
import { Keyed } from "../../runtime";
import { when } from "../native-editing/live";
import { stringLeaves, wordDiff, annotationId } from "./review-model";
import type { DraftChange, DraftView, PageRef } from "./types";

const keyOf = (page: PageRef) => `${page.sitemapId}/${page.pageId}`;

function Diff({ before, after }: { before: string; after: string }) {
  const { insert, remove } = wordDiff(before, after);
  const marks = (text: string, spans: [number, number][], tag: "ins" | "del") => {
    const parts: Child[] = [];
    let cursor = 0;
    spans.forEach(([start, end]) => { parts.push(text.slice(cursor, start), tag === "ins" ? <ins>{text.slice(start, end)}</ins> : <del>{text.slice(start, end)}</del>); cursor = end; });
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
  return <>{paths.map(path => <div>{path && <p class="cms-assistant-hint">{describePath(path)}</p>}<Diff before={before.get(path) ?? ""} after={after.get(path) ?? ""} /></div>)}</>;
}
const describePath = (path: string) => {
  const parts = path.split("/").filter(Boolean).map(Number);
  return parts.length === 2 ? `Row ${parts[0]! + 1}, cell ${parts[1]! + 1}` : parts.length === 1 ? `Item ${parts[0]! + 1}` : path;
};
function AddedDetail({ change }: { change: DraftChange }) {
  return <ul class="cms-assistant-added">{Object.entries(change.props ?? {}).map(([prop, value]) => <li><span class="cms-assistant-hint">{prop}</span> {isImage(value) ? <img src={String(value)} alt="" /> : Array.isArray(value) ? <code>{JSON.stringify(value)}</code> : <ins>{String(value)}</ins>}</li>)}
    {change.children ? <li class="cms-assistant-hint">Includes {change.children} nested block{change.children === 1 ? "" : "s"}.</li> : null}</ul>;
}

type Dependents = { change: DraftChange; items: { id: string; kind: string; reason: string | null }[] } | null;
/** Live values may be signals; callbacks are read once. */
export interface ReviewPanelProps {
  view: MaybeSignal<DraftView | null>; currentPage: MaybeSignal<string>; evidence: MaybeSignal<ReadonlySet<string>>; fallback: MaybeSignal<ReadonlySet<string>>;
  busy: MaybeSignal<boolean>; frameReady: MaybeSignal<boolean>; canApply: MaybeSignal<boolean>; applyBlocker: MaybeSignal<string | null>; error: MaybeSignal<string | null>;
  onOpen(change: DraftChange): void; onPage(page: PageRef): void; onWithdraw(change: DraftChange): void;
  onApply(): void; onDiscard(): void; onRevalidate(): void; onUndo(): void; onRecover(): void;
  dependents: MaybeSignal<Dependents>; onConfirmDependents(): void; onCancelDependents(): void;
}

/** Validated Unstaged Changes and receipt-backed results; never derived from message text. */
export function ReviewPanel(props: ReviewPanelProps) {
  const draft = computed(() => read(props.view)?.draft ?? null);
  const mode = computed(() => {
    const value = draft.value;
    if (!value || value.status === "discarded" || (value.status === "open" && !value.changes.length && !value.stale.length && !value.buildError)) return "empty";
    return value.status === "applied" || value.status === "undone" ? "receipt" : "open";
  });
  const busy = computed(() => read(props.busy));
  const error = computed(() => read(props.error) ?? "");
  const errorLine = () => <Show when={when(() => error.value)}>{() => <p role="alert" class="cms-assistant-error">{error}</p>}</Show>;
  return <Keyed value={mode} by={value => value}>{value => {
    if (value.value === "empty") return <section class="cms-assistant-review" aria-label="Unstaged changes"><h2>Unstaged changes</h2><p class="cms-assistant-hint">No pending AI changes. Proposals appear here for review before anything is saved.</p></section>;
    if (value.value === "receipt") {
      const applied = computed(() => draft.value?.status === "applied");
      const receipt = computed(() => {
        const current = draft.value;
        if (!current) return "";
        const entry = current.status === "applied" ? current.applied : current.undone;
        return `Receipt ${entry?.operationId} · ${new Date(entry?.committedAt ?? "").toLocaleString("en")}${current.status === "applied" && !read(props.frameReady) ? " · Waiting for the current page to finish rendering before Undo." : ""}`;
      });
      return <section class="cms-assistant-review" aria-label="Applied changes">
        <h2>{computed(() => applied.value ? "Applied to Composer" : "Undo committed")}</h2>
        <p role="status">{receipt}</p>
        <p class="cms-assistant-hint">Applied changes are saved authoring data in Composer. They are not published or deployed.</p>
        {errorLine()}
        <Show when={applied}>{() => <button type="button" class="cms-btn cms-btn--sm" disabled={computed(() => busy.value || !read(props.frameReady))} on:click={() => props.onUndo()}>Undo apply</button>}</Show>
      </section>;
    }
    return <OpenReview {...props} draft={computed(() => draft.value!)} busy={busy} errorLine={errorLine} />;
  }}</Keyed>;
}

type OpenDraft = NonNullable<DraftView["draft"]>;
function OpenReview(props: ReviewPanelProps & { draft: ReadonlySignal<OpenDraft>; busy: ReadonlySignal<boolean>; errorLine(): Child }) {
  const { draft, busy } = props;
  const changes = computed(() => draft.value?.changes ?? []);
  const pages = computed(() => draft.value?.pages.filter(page => page.changed) ?? []);
  const multiple = when(() => pages.value.length > 1);
  const dependents = computed(() => read(props.dependents));
  const stale = computed(() => draft.value?.stale ?? []);
  const buildError = computed(() => draft.value?.buildError?.message ?? "");
  return <section class="cms-assistant-review" aria-label="Unstaged changes">
    <header class="cms-assistant-review__header">
      <h2>Unstaged changes <span class="cms-assistant-count" aria-label={computed(() => `${changes.value.length} changes`)}>{computed(() => String(changes.value.length))}</span></h2>
      <span class="cms-assistant-hint">{computed(() => `Draft r${draft.value?.revision}`)}</span>
    </header>
    <Show when={multiple}>{() => <nav class="cms-assistant-page-tabs" aria-label="Changed pages"><For each={pages} by={page => keyOf(page.page)}>{page => {
      const key = keyOf(page.value.page);
      const count = computed(() => String(changes.value.filter(change => keyOf(change.page) === key).length));
      const confirmed = when(() => !!draft.value?.candidateDigest && read(props.evidence).has(`${draft.value.candidateDigest}|${key}`));
      return <button type="button" class="cms-btn cms-btn--sm" aria-current={computed(() => read(props.currentPage) === key ? "page" : null)} on:click={() => props.onPage(page.value.page)}>{page.value.page.pageId} <span class="cms-assistant-count">{count}</span><Show when={confirmed}>{() => <span class="cms-assistant-hint"> · reviewed</span>}</Show></button>;
    }}</For></nav>}</Show>
    <Show when={when(() => stale.value.length > 0)}>{() => <div role="alert" class="cms-assistant-warning"><p>These changes no longer match the saved pages:</p><ul><For each={stale} by={entry => `${keyOf(entry.page)}\0${entry.reason}`}>{entry => <li>{entry.value.page.pageId}: {entry.value.reason}</li>}</For></ul><button type="button" class="cms-btn cms-btn--sm" disabled={busy} on:click={() => props.onRevalidate()}>Revalidate against saved pages</button></div>}</Show>
    <Show when={when(() => !draft.value?.dependenciesCurrent)}>{() => <p role="alert" class="cms-assistant-warning">Components or host source changed since this draft began. Revalidate, then review again.</p>}</Show>
    <Show when={when(() => buildError.value)}>{() => <p role="alert" class="cms-assistant-error">{buildError}</p>}</Show>
    <ol class="cms-assistant-changes"><For each={changes} by={change => `${change.id}\0${JSON.stringify(change)}`}>{item => {
      const change = item.value, key = keyOf(change.page);
      const fallback = when(() => read(props.fallback).has(annotationId(change)) && read(props.currentPage) === key);
      return <li class="cms-assistant-change" data-kind={change.kind}>
        <div class="cms-assistant-change__head">
          <span class="cms-assistant-tag" data-kind={change.kind}>{change.kind === "added" ? "Added" : change.kind === "removed" ? "Removed" : "Changed"}</span>
          <button type="button" class="cms-assistant-link" on:click={() => props.onOpen(change)}>{change.componentTitle}{change.fieldLabel ? ` · ${change.fieldLabel}` : ""}</button>
          <Show when={multiple}>{() => <span class="cms-assistant-hint">{change.page.pageId}</span>}</Show>
        </div>
        {change.kind === "added" ? <AddedDetail change={change} /> : <FieldDetail change={change} />}
        <Show when={fallback}>{() => <p class="cms-assistant-hint">Word highlights aren't available for this block's rendering, so the preview marks the whole block; the exact field change is listed here.</p>}</Show>
        {change.reasons[0] && <p class="cms-assistant-hint">Requested: “{change.reasons[0]}”</p>}
        <button type="button" class="cms-assistant-link" disabled={busy} on:click={() => props.onWithdraw(change)}>Withdraw</button>
      </li>;
    }}</For></ol>
    <Rebuild value={dependents}>{value => {
      if (!value) return null;
      const count = value.items.length;
      return <div role="alertdialog" aria-label="Dependent changes" class="cms-assistant-warning">
        <p>Withdrawing this change also removes {count} dependent change{count === 1 ? "" : "s"} placed relative to it.</p>
        <button type="button" class="cms-btn cms-btn--sm" on:click={() => props.onConfirmDependents()}>Withdraw all {count + 1}</button>
        <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" on:click={() => props.onCancelDependents()}>Keep</button>
      </div>;
    }}</Rebuild>
    {props.errorLine()}
    <div class="cms-assistant-review__actions">
      <button type="button" class="cms-btn cms-btn--primary" disabled={computed(() => busy.value || !read(props.frameReady) || !read(props.canApply))} aria-describedby="assistant-apply-state" on:click={() => props.onApply()}>Apply to Composer</button>
      <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" disabled={busy} on:click={() => props.onDiscard()}>Discard all</button>
      <button type="button" class="cms-btn cms-btn--ghost cms-btn--sm" disabled={busy} on:click={() => props.onRecover()}>Check receipt</button>
    </div>
    <p id="assistant-apply-state" role="status" class="cms-assistant-hint">{computed(() => read(props.canApply) ? "Every changed page rendered successfully as reviewed. Apply saves to Composer; it does not publish." : read(props.applyBlocker) ?? "")}</p>
  </section>;
}
