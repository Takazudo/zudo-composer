import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { CONTENT_FIELD_KINDS, type ContentEntryRecord, type ContentFieldDefinition, type ContentProvider } from "../../content";
import { ContentConfirmDialog } from "./confirm-dialog";
import { createContentAuthoringController, type ContentAuthoringController, type ContentAuthoringState, type ContentPane } from "./controller";

export interface ContentRouteContentProps { provider: ContentProvider; controller?: ContentAuthoringController }
type Confirm = { kind: "model"; id: string; label: string } | { kind: "entry"; id: string; label: string } | { kind: "field"; id: string; label: string };
const panes: readonly ContentPane[] = ["models", "entries", "inspector"];
const paneLabels = { models: "Models", entries: "Entries", inspector: "Inspector" } as const;

function entryLabel(entry: ContentEntryRecord, fields: readonly ContentFieldDefinition[]): string {
  for (const field of fields) { const value = entry.values[field.id]; if (typeof value === "string" && value.trim()) return value; }
  return "Untitled Entry";
}

export function ContentApp({ provider, controller: supplied }: ContentRouteContentProps): JSX.Element {
  const controller = useMemo(() => supplied ?? createContentAuthoringController(provider), [provider, supplied]);
  const [state, setState] = useState<ContentAuthoringState>(controller.state); const [confirm, setConfirm] = useState<Confirm | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => { if (controller.state.phase === "idle") void controller.initialize(); }, [controller]);
  const run = (action: () => void | Promise<void>) => {
    const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : "Content action failed.");
    setError(null);
    try { void Promise.resolve(action()).catch(fail); } catch (reason) { fail(reason); }
  };
  return <main class="sg-content-app" aria-busy={state.phase === "loading"}>
    <header class="sg-content-app__header"><div><p class="sg-content-eyebrow">Content</p><h1>Content authoring</h1></div><div class="sg-content-save" aria-live="polite" aria-atomic="true">{state.message}</div></header>
    {(error || state.saveStatus === "error") && <div class="sg-content-notice sg-content-notice--error" role="alert"><span>{error ?? state.message}</span>{state.saveStatus === "error" && <button type="button" onClick={() => controller.retrySave()}>Retry save</button>}</div>}
    {state.phase === "error" && <section class="sg-content-state" aria-labelledby="content-error"><h2 id="content-error">Content library unavailable</h2><p>{state.message}</p><button type="button" class="sg-content-button--primary" onClick={() => run(() => controller.retryInitialization())}>Retry</button></section>}
    {state.phase === "recovery" && <section class="sg-content-state" aria-labelledby="content-recovery"><h2 id="content-recovery">Stored Content needs recovery</h2><p>{state.recoveryMessage}</p><p>Your source records are quarantined and will not be overwritten.</p><div class="sg-content-actions"><button type="button" onClick={() => run(() => controller.retryInitialization())}>Retry</button><button type="button" class="sg-content-button--danger" onClick={() => setConfirm({ kind: "model", id: "__fresh__", label: "all quarantined Content data" })}>Start fresh…</button></div></section>}
    {state.phase === "loading" && <p class="sg-content-state" role="status">Loading Content library…</p>}
    {state.phase === "ready" && <>
      <div class="sg-content-tabs" role="tablist" aria-label="Content workspace">
        {panes.map((pane, index) => <button id={`sg-content-tab-${pane}`} key={pane} role="tab" type="button" aria-selected={state.activePane === pane} aria-controls={`sg-content-panel-${pane}`} tabIndex={state.activePane === pane ? 0 : -1} onClick={() => controller.setActivePane(pane)} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const next = (index + (event.key === "ArrowRight" ? 1 : -1) + panes.length) % panes.length; controller.setActivePane(panes[next]!); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
        }}>{paneLabels[pane]}</button>)}
      </div>
      <div class="sg-content-workspace">
        <section id="sg-content-panel-models" role="tabpanel" aria-labelledby="sg-content-tab-models" class="sg-content-pane sg-content-pane--models" data-active={state.activePane === "models"}>
          <div class="sg-content-pane__heading"><div><h2>Models</h2><p>{state.models.length} total</p></div><div class="sg-content-actions"><button type="button" class="sg-content-button--primary" onClick={() => run(() => controller.createModel("Untitled collection", "collection"))}>New Collection</button><button type="button" onClick={() => run(() => controller.createModel("Untitled single", "single"))}>New Single</button></div></div>
          {state.models.length === 0 ? <div class="sg-content-empty"><h3>No Content models</h3><p>Create a Collection for many Entries or a Single for one workspace.</p><div class="sg-content-actions"><button type="button" class="sg-content-button--primary" onClick={() => run(() => controller.createModel("Untitled collection", "collection"))}>Create Collection</button><button type="button" onClick={() => run(() => controller.createModel("Untitled single", "single"))}>Create Single</button></div></div> :
          <ul class="sg-content-list" aria-label="Content models">{state.models.map((model) => <li key={model.id}><button type="button" class="sg-content-list__select" aria-pressed={state.model?.id === model.id} onClick={() => run(() => controller.openModel(model.id))}><strong>{model.name}</strong><span>{model.kind === "single" ? "Single" : "Collection"} · {model.fieldCount} fields · {state.entryCounts[model.id] ?? 0} Entries</span></button><button type="button" aria-label={`Delete ${model.name}`} onClick={() => setConfirm({ kind: "model", id: model.id, label: model.name })}>Delete</button></li>)}</ul>}
        </section>
        <section id="sg-content-panel-entries" role="tabpanel" aria-labelledby="sg-content-tab-entries" class="sg-content-pane sg-content-pane--entries" data-active={state.activePane === "entries"}>
          <div class="sg-content-pane__heading"><div><h2>Entries</h2><p>{state.model ? `${state.model.document.name} · ${state.entryCounts[state.model.id] ?? 0} total` : "Choose a model"}</p></div><div class="sg-content-actions">{state.model && <button type="button" onClick={() => run(() => controller.inspectSchema())}>Edit schema</button>}{state.model && <button type="button" onClick={() => run(() => controller.reloadEntries())}>Reload</button>}{state.model && !(state.model.document.kind === "single" && state.entries.length > 0) && <button type="button" class="sg-content-button--primary" onClick={() => run(() => controller.createEntry())}>New Entry</button>}</div></div>
          {!state.model ? <div class="sg-content-empty"><h3>No model selected</h3><p>Choose a model to open its Entry workspace.</p></div> : state.entries.length === 0 ? <div class="sg-content-empty"><h3>No Entries</h3><p>{state.model.document.kind === "single" ? "Create the one Entry workspace for this Single." : "Create the first draft Entry."}</p></div> :
          <ul class="sg-content-list" aria-label="Entries">{state.entries.map((entry) => { const incomplete = controller.completeness(entry).length > 0; return <li key={entry.id}><button type="button" class="sg-content-list__select" aria-pressed={state.entry?.id === entry.id} onClick={() => run(() => controller.openEntry(entry.id))}><strong>{entryLabel(entry, state.model!.document.fields)}</strong><span>{incomplete ? "Incomplete draft" : "Complete"} · {entry.id}</span></button><button type="button" aria-label={`Delete ${entryLabel(entry, state.model!.document.fields)}`} onClick={() => setConfirm({ kind: "entry", id: entry.id, label: entryLabel(entry, state.model!.document.fields) })}>Delete</button></li>; })}</ul>}
          {state.nextCursor && <button type="button" class="sg-content-load-more" onClick={() => run(() => controller.loadMoreEntries())}>Load more Entries</button>}
        </section>
        <section id="sg-content-panel-inspector" role="tabpanel" aria-labelledby="sg-content-tab-inspector" class="sg-content-pane sg-content-pane--inspector" data-active={state.activePane === "inspector"}>
          <div class="sg-content-pane__heading"><div><h2>Inspector</h2><p>{state.entry ? "Entry fields" : "Model schema"}</p></div></div>
          {!state.model ? <div class="sg-content-empty"><p>Open a model to inspect its schema.</p></div> : state.entry ? <EntryInspector state={state} controller={controller} /> : <SchemaInspector state={state} controller={controller} run={run} remove={(field) => setConfirm({ kind: "field", id: field.id, label: field.label })} />}
        </section>
      </div>
    </>}
    <ContentConfirmDialog open={confirm !== null} title={confirm?.kind === "field" ? "Remove field?" : confirm?.id === "__fresh__" ? "Start fresh?" : `Delete ${confirm?.kind ?? "item"}?`} confirmLabel={confirm?.id === "__fresh__" ? "Start fresh" : "Delete"} onClose={() => setConfirm(null)} onConfirm={() => { if (!confirm) return; if (confirm.id === "__fresh__") run(() => controller.startFresh()); else if (confirm.kind === "model") run(() => controller.deleteModel(confirm.id)); else if (confirm.kind === "entry") run(() => controller.deleteEntry(confirm.id)); else run(() => controller.removeField(confirm.id)); }}>
      <p><strong>{confirm?.label}</strong> will be permanently removed.</p>{confirm?.kind === "field" && <p>Stored values for this field will be scrubbed from every Entry.</p>}
    </ContentConfirmDialog>
  </main>;
}

function SchemaInspector({ state, controller, run, remove }: { state: ContentAuthoringState; controller: ContentAuthoringController; run(action: () => void | Promise<void>): void; remove(field: ContentFieldDefinition): void }) {
  const model = state.model!; return <div class="sg-content-form"><label>Model name<input value={model.document.name} onInput={(e) => controller.renameModel(e.currentTarget.value)} /></label><label>Model kind<select value={model.document.kind} disabled aria-describedby="kind-help"><option value="collection">Collection</option><option value="single">Single</option></select></label><p id="kind-help" class="sg-content-help">Model kind is immutable after creation to protect Entry cardinality.</p>
    <div class="sg-content-section-heading"><h3>Fields</h3><button type="button" onClick={() => controller.addField()}>Add field</button></div>
    {model.document.fields.map((field, index) => { const kindLocked = state.entries.some((entry) => Object.hasOwn(entry.values, field.id)); const kindHelpId = `content-kind-help-${field.id}`; return <fieldset key={field.id} class="sg-content-field"><legend>{field.label}</legend><label>Label<input value={field.label} onInput={(e) => controller.updateField(field.id, { label: e.currentTarget.value })} /></label><label>Key<input value={field.key} pattern="[a-z][A-Za-z0-9]{0,63}" onInput={(e) => controller.updateField(field.id, { key: e.currentTarget.value })} /></label><label>Type<select value={field.kind} disabled={kindLocked} aria-describedby={kindLocked ? kindHelpId : undefined} onChange={(e) => run(() => controller.updateField(field.id, { kind: e.currentTarget.value as ContentFieldDefinition["kind"] }))}>{CONTENT_FIELD_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>{kindLocked && <p id={kindHelpId} class="sg-content-help">Type is immutable because stored Entries use this field.</p>}<label class="sg-content-check"><input type="checkbox" checked={field.required} onChange={(e) => controller.updateField(field.id, { required: e.currentTarget.checked })} />Required</label><div class="sg-content-actions"><button type="button" disabled={index === 0} onClick={() => controller.moveField(field.id, -1)}>Move up</button><button type="button" disabled={index === model.document.fields.length - 1} onClick={() => controller.moveField(field.id, 1)}>Move down</button><button type="button" onClick={() => remove(field)}>Remove…</button></div></fieldset>; })}
  </div>;
}

function EntryInspector({ state, controller }: { state: ContentAuthoringState; controller: ContentAuthoringController }) {
  const entry = state.entry!; const diagnostics = controller.completeness(); return <div class="sg-content-form"><div class="sg-content-completeness" role="status"><strong>{diagnostics.length ? "Incomplete draft" : "Complete"}</strong><span>{diagnostics.length ? `${diagnostics.length} required value${diagnostics.length === 1 ? "" : "s"} missing. Draft changes still save.` : "All required values are present."}</span></div>{state.model!.document.fields.map((field) => {
    const id = `content-entry-${field.id}`; const value = entry.values[field.id]; if (field.kind === "boolean") return <label key={field.id} class="sg-content-check"><input id={id} type="checkbox" checked={value === true} onChange={(e) => controller.updateEntryValue(field.id, e.currentTarget.checked)} />{field.label}{field.required ? " (required)" : ""}</label>;
    if (field.kind === "long-text" || field.kind === "markdown") return <label key={field.id}>{field.label}{field.required ? " (required)" : ""}<textarea id={id} value={typeof value === "string" ? value : ""} onInput={(e) => controller.updateEntryValue(field.id, e.currentTarget.value)} /></label>;
    return <label key={field.id}>{field.label}{field.required ? " (required)" : ""}<input id={id} type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : field.kind === "color" ? "color" : field.kind === "url" ? "url" : "text"} value={typeof value === "string" || typeof value === "number" ? value : ""} onInput={(e) => { const numeric = e.currentTarget.valueAsNumber; controller.updateEntryValue(field.id, field.kind === "number" ? (e.currentTarget.value === "" || !Number.isFinite(numeric) ? undefined : numeric) : e.currentTarget.value); }} /></label>;
  })}</div>;
}
