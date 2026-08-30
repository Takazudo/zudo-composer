import type { JSX } from "preact";
import type { MediaSummary } from "../../media";
import type { MediaLibraryController, MediaLibraryState, MediaLibraryView } from "./controller";
import { mediaUrl } from "./controller";

const views: readonly MediaLibraryView[] = ["gallery", "details"];
const viewLabels: Record<MediaLibraryView, string> = { gallery: "Gallery", details: "Details" };

export interface MediaLibraryProps { state: MediaLibraryState; controller: MediaLibraryController; run(action: () => void | Promise<void>): void; onDelete(record: MediaSummary): void; }

export function MediaLibrary({ state, controller, run, onDelete }: MediaLibraryProps): JSX.Element {
  return <><div class="sg-media-toolbar"><div><h2>Browse media</h2><p>{state.records.length} asset{state.records.length === 1 ? "" : "s"}</p></div><MediaViewTabs active={state.view} onChange={(view) => controller.setView(view)} /></div>
    {state.records.length === 0 ? <div class="sg-media-empty"><h3>No media yet</h3><p>Uploaded assets will appear here.</p></div> : <div class="sg-media-panels">
      <section id="sg-media-panel-gallery" role="tabpanel" aria-labelledby="sg-media-tab-gallery" hidden={state.view !== "gallery"}><ul class="sg-media-gallery">{state.records.map((record) => <li key={record.id} class="sg-media-card"><MediaPreview record={record} /><div class="sg-media-card__body"><strong title={record.fileName}>{record.fileName}</strong><MediaFacts record={record} /></div><MediaActions record={record} run={run} onDelete={onDelete} controller={controller} /></li>)}</ul></section>
      <section id="sg-media-panel-details" role="tabpanel" aria-labelledby="sg-media-tab-details" hidden={state.view !== "details"}><div class="sg-media-details-scroll" role="region" aria-label="Media details, horizontally scrollable" tabIndex={0}><table class="sg-media-details"><thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">Date</th><th scope="col">Actions</th></tr></thead><tbody>{state.records.map((record) => <tr key={record.id}><th scope="row"><div class="sg-media-details__name"><MediaPreview record={record} compact />{record.fileName}</div></th><td>{mediaTypeLabel(record.mediaType)}</td><td>{formatBytes(record.byteLength)}</td><td>{formatDate(record.updatedAt)}</td><td><MediaActions record={record} run={run} onDelete={onDelete} controller={controller} /></td></tr>)}</tbody></table></div></section>
    </div>}</>;
}

function MediaViewTabs({ active, onChange }: { active: MediaLibraryView; onChange(view: MediaLibraryView): void }): JSX.Element {
  return <div class="sg-media-tabs" role="tablist" aria-label="Media layout">{views.map((view, index) => <button id={`sg-media-tab-${view}`} key={view} type="button" role="tab" aria-selected={active === view} aria-controls={`sg-media-panel-${view}`} tabIndex={active === view ? 0 : -1} onClick={() => onChange(view)} onKeyDown={(event) => {
    let next: number | undefined;
    if (event.key === "ArrowRight") next = (index + 1) % views.length; else if (event.key === "ArrowLeft") next = (index - 1 + views.length) % views.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = views.length - 1;
    if (next === undefined) return; event.preventDefault(); onChange(views[next]!); (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }}>{viewLabels[view]}</button>)}</div>;
}

function MediaPreview({ record, compact = false }: { record: MediaSummary; compact?: boolean }): JSX.Element {
  return <div class={compact ? "sg-media-preview sg-media-preview--compact" : "sg-media-preview"}>{record.mediaType.startsWith("image/") ? <img src={mediaUrl(record)} alt="" loading="lazy" /> : <span aria-hidden="true">PDF</span>}</div>;
}
function MediaFacts({ record }: { record: MediaSummary }): JSX.Element { return <dl class="sg-media-facts"><div><dt>Type</dt><dd>{mediaTypeLabel(record.mediaType)}</dd></div><div><dt>Size</dt><dd>{formatBytes(record.byteLength)}</dd></div><div><dt>Date</dt><dd>{formatDate(record.updatedAt)}</dd></div></dl>; }
function MediaActions({ record, controller, run, onDelete }: { record: MediaSummary; controller: MediaLibraryController; run(action: () => void | Promise<void>): void; onDelete(record: MediaSummary): void }): JSX.Element { return <div class="sg-media-actions"><button type="button" onClick={() => run(() => controller.copyMarkdown(record))}>Copy Markdown</button><button type="button" class="sg-media-button--danger" onClick={() => onDelete(record)}>Delete</button></div>; }
export function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`; return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`; }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)); }
function mediaTypeLabel(value: string): string { return value === "application/pdf" ? "PDF" : value.slice(value.indexOf("/") + 1).toUpperCase(); }
