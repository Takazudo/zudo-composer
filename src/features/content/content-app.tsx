import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { ContentProvider } from "../../content";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { ContentConfirmDialog } from "./confirm-dialog";
import { ContentEntryAuthor, ContentSchemaAuthor } from "./content-author";
import { ContentLibrary } from "./content-library";
import { ContentPreviewPane } from "./content-preview-pane";
import { createContentAuthoringController, type ContentAuthoringController, type ContentAuthoringState, type ContentPane } from "./controller";
import { contentEntryLabel } from "./presentation";
import type { ContentPreviewSource } from "./preview-source";

export interface ContentRouteContentProps {
  provider: ContentProvider;
  controller?: ContentAuthoringController;
  componentProvider?: ComposerComponentProvider;
  createPreviewSource?: () => ContentPreviewSource;
}

type Confirm = { kind: "model"; id: string; label: string } | { kind: "entry"; id: string; label: string } | { kind: "field"; id: string; label: string };
const panes: readonly ContentPane[] = ["library", "author", "preview"];
const paneLabels: Record<ContentPane, string> = { library: "Library", author: "Author", preview: "Preview" };

export function ContentApp({ provider, controller: supplied, componentProvider, createPreviewSource }: ContentRouteContentProps): JSX.Element {
  const controller = useMemo(() => supplied ?? createContentAuthoringController(provider), [provider, supplied]);
  const [state, setState] = useState<ContentAuthoringState>(controller.state);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => { if (controller.state.phase === "idle") void controller.initialize(); }, [controller]);
  const run = (action: () => void | Promise<void>) => {
    const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : "Content action failed.");
    setError(null);
    try { void Promise.resolve(action()).catch(fail); } catch (reason) { fail(reason); }
  };
  const selectedEntryName = state.entry && state.model ? contentEntryLabel(state.entry, state.model.document.fields) : "Entry";

  return <main class="sg-content-app" aria-busy={state.phase === "loading"}>
    <header class="sg-content-app__header"><div><p class="sg-content-eyebrow">Authoring studio</p><h1>Content authoring</h1></div><div class="sg-content-save" aria-live="polite" aria-atomic="true">{state.message}</div></header>
    {(error || state.saveStatus === "error") && <div class="sg-content-notice sg-content-notice--error" role="alert"><span>{error ?? state.message}</span>{state.saveStatus === "error" && <button type="button" onClick={() => controller.retrySave()}>Retry save</button>}</div>}
    {state.phase === "error" && <section class="sg-content-state" aria-labelledby="content-error"><h2 id="content-error">Content library unavailable</h2><p>{state.message}</p><button type="button" class="sg-content-button--primary" onClick={() => run(() => controller.retryInitialization())}>Retry</button></section>}
    {state.phase === "recovery" && <section class="sg-content-state" aria-labelledby="content-recovery"><h2 id="content-recovery">Stored Content needs recovery</h2><p>{state.recoveryMessage}</p><p>Your source records are quarantined and will not be overwritten.</p><div class="sg-content-actions"><button type="button" onClick={() => run(() => controller.retryInitialization())}>Retry</button><button type="button" class="sg-content-button--danger" onClick={() => setConfirm({ kind: "model", id: "__fresh__", label: "all quarantined Content data" })}>Start fresh…</button></div></section>}
    {state.phase === "loading" && <p class="sg-content-state" role="status">Loading Content library…</p>}
    {state.phase === "ready" && <><WorkspaceTabs active={state.activePane} onChange={(pane) => controller.setActivePane(pane)} /><div class="sg-content-workspace">
      <section id="sg-content-panel-library" role="tabpanel" aria-labelledby="sg-content-tab-library" class="sg-content-pane sg-content-pane--library" data-active={state.activePane === "library"}><ContentLibrary state={state} controller={controller} run={run} onDeleteModel={(id, label) => setConfirm({ kind: "model", id, label })} onDeleteEntry={(id, label) => setConfirm({ kind: "entry", id, label })} /></section>
      <section id="sg-content-panel-author" role="tabpanel" aria-labelledby="sg-content-tab-author" class="sg-content-pane sg-content-pane--author" data-active={state.activePane === "author"}>
        <div class="sg-content-pane__heading"><div><h2>Author</h2><p>{state.model?.document.name ?? "Choose a model"}</p></div>{state.model && <div class="sg-content-mode-switch" role="group" aria-label="Authoring mode"><button type="button" aria-pressed={state.workMode === "entries"} onClick={() => controller.browseEntries("author")}>Entries</button><button type="button" aria-pressed={state.workMode === "model-fields"} onClick={() => run(() => controller.inspectSchema())}>Model fields</button></div>}</div>
        {!state.model ? <div class="sg-content-empty"><h3>No model selected</h3><p>Choose a model from the Library.</p></div> : state.workMode === "model-fields" ? <ContentSchemaAuthor state={state} controller={controller} run={run} onRemove={(field) => setConfirm({ kind: "field", id: field.id, label: field.label })} /> : state.entry ? <ContentEntryAuthor state={state} controller={controller} /> : <div class="sg-content-empty"><h3>Choose an Entry</h3><p>Select an Entry in the Library or create a new one.</p></div>}
      </section>
      <section id="sg-content-panel-preview" role="tabpanel" aria-labelledby="sg-content-tab-preview" class="sg-content-pane sg-content-pane--preview" data-active={state.activePane === "preview"}><div class="sg-content-pane__heading"><div><h2>Preview</h2><p>Evaluated from the current unsaved draft</p></div></div><ContentPreviewPane providerId={provider.descriptor.id} model={state.model} entry={state.entry} entryName={selectedEntryName} componentProvider={componentProvider} createPreviewSource={createPreviewSource} /></section>
    </div></>}
    <ContentConfirmDialog open={confirm !== null} title={confirm?.kind === "field" ? "Remove field?" : confirm?.id === "__fresh__" ? "Start fresh?" : `Delete ${confirm?.kind ?? "item"}?`} confirmLabel={confirm?.id === "__fresh__" ? "Start fresh" : "Delete"} onClose={() => setConfirm(null)} onConfirm={() => { if (!confirm) return; if (confirm.id === "__fresh__") run(() => controller.startFresh()); else if (confirm.kind === "model") run(() => controller.deleteModel(confirm.id)); else if (confirm.kind === "entry") run(() => controller.deleteEntry(confirm.id)); else run(() => controller.removeField(confirm.id)); }}><p><strong>{confirm?.label}</strong> will be permanently removed.</p>{confirm?.kind === "field" && <p>Stored values for this field will be scrubbed from every Entry.</p>}</ContentConfirmDialog>
  </main>;
}

function WorkspaceTabs({ active, onChange }: { active: ContentPane; onChange(pane: ContentPane): void }): JSX.Element {
  return <div class="sg-content-tabs" role="tablist" aria-label="Content workspace">{panes.map((pane, index) => <button id={`sg-content-tab-${pane}`} key={pane} role="tab" type="button" aria-selected={active === pane} aria-controls={`sg-content-panel-${pane}`} tabIndex={active === pane ? 0 : -1} onClick={() => onChange(pane)} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const next = (index + (event.key === "ArrowRight" ? 1 : -1) + panes.length) % panes.length; onChange(panes[next]!); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus(); }}>{paneLabels[pane]}</button>)}</div>;
}
