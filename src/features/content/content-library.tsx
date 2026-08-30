import type { JSX } from "preact";
import { CollectionIcon, FileIcon, FolderIcon, SettingsIcon, SingleIcon } from "../../components/icons";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";
import { contentEntryLabel } from "./presentation";

export interface ContentLibraryProps {
  state: ContentAuthoringState;
  controller: ContentAuthoringController;
  run(action: () => void | Promise<void>): void;
  onDeleteModel(id: string, label: string): void;
  onDeleteEntry(id: string, label: string): void;
}

export function ContentLibrary({ state, controller, run, onDeleteModel, onDeleteEntry }: ContentLibraryProps): JSX.Element {
  return <><div class="sg-content-pane__heading"><div><h2>Library</h2><p>{state.models.length} model{state.models.length === 1 ? "" : "s"}</p></div><div class="sg-content-actions"><button type="button" class="sg-content-button--primary" onClick={() => run(() => controller.createModel("Untitled collection", "collection"))}>New Collection</button><button type="button" onClick={() => run(() => controller.createModel("Untitled single", "single"))}>New Single</button></div></div>
    {state.models.length === 0 ? <div class="sg-content-empty"><h3>No Content models</h3><p>Create a Collection for many Entries or a Single for one workspace.</p></div> : <ul class="sg-content-library" aria-label="Content models">{state.models.map((model) => { const selected = state.model?.id === model.id; const ModelIcon = model.kind === "single" ? SingleIcon : CollectionIcon; return <li key={model.id} data-selected={selected}>
      <div class="sg-content-library__model"><button type="button" aria-pressed={selected} onClick={() => run(() => controller.openModel(model.id))}><ModelIcon /><span><strong>{model.name}</strong><small>{model.kind === "single" ? "Single" : "Collection"}</small></span></button><button type="button" aria-label={`Delete ${model.name}`} onClick={() => onDeleteModel(model.id, model.name)}>Delete</button></div>
      <ul class="sg-content-library__children"><li><button type="button" aria-current={selected && state.workMode === "entries" ? "page" : undefined} onClick={() => run(async () => { await controller.openModel(model.id); controller.browseEntries(); })}><FolderIcon /><span>Entries</span><small>{state.entryCounts[model.id] ?? 0}</small></button></li><li><button type="button" aria-current={selected && state.workMode === "model-fields" ? "page" : undefined} onClick={() => run(async () => { await controller.openModel(model.id); await controller.inspectSchema(); })}><SettingsIcon /><span>Model fields</span><small>{model.fieldCount}</small></button></li>{selected && state.workMode === "entries" && <li class="sg-content-library__entries"><EntryList state={state} controller={controller} run={run} onDeleteEntry={onDeleteEntry} /></li>}</ul>
    </li>; })}</ul>}</>;
}

function EntryList({ state, controller, run, onDeleteEntry }: Pick<ContentLibraryProps, "state" | "controller" | "run" | "onDeleteEntry">): JSX.Element {
  const canCreate = state.model && !(state.model.document.kind === "single" && state.entries.length > 0);
  return <div class="sg-content-entry-list"><div class="sg-content-entry-list__actions"><button type="button" onClick={() => run(() => controller.reloadEntries())}>Reload</button>{canCreate && <button type="button" class="sg-content-button--primary" onClick={() => run(() => controller.createEntry())}>New Entry</button>}</div>{state.entries.length === 0 ? <p class="sg-content-help">No Entries yet.</p> : <ul aria-label="Entries">{state.entries.map((entry) => { const label = contentEntryLabel(entry, state.model!.document.fields); const incomplete = controller.completeness(entry).length > 0; return <li key={entry.id}><button type="button" aria-pressed={state.entry?.id === entry.id} onClick={() => run(() => controller.openEntry(entry.id))}><FileIcon /><span><strong>{label}</strong><small>{incomplete ? "Incomplete draft" : "Complete"}</small></span></button><button type="button" aria-label={`Delete ${label}`} onClick={() => onDeleteEntry(entry.id, label)}>Delete</button></li>; })}</ul>}{state.nextCursor && <button type="button" class="sg-content-load-more" onClick={() => run(() => controller.loadMoreEntries())}>Load more Entries</button>}</div>;
}
