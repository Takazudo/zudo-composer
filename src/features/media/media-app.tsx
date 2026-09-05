import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useWorkspace } from "../../app/workspace-context";
import { parseIntent, type RouteIntentParseOutcome } from "../../app/route-intents";
import { OutlineTree, type OutlineNode, type OutlineInsertSession } from "../../components/outline-tree";
import { LibraryPage, RowMenu } from "../../components/library-page";
import { Dialog } from "../../components/overlay";
import { Banner, Button, Checkbox, DataTable, Field, Input, Select, SegmentedControl, Textarea } from "../../components/ui";
import { FolderIcon, UploadIcon } from "../../components/icons";
import { mediaFolderPath as resolveFolderPath, type MediaProvider, type MediaSummary, type MediaFolder } from "../../media";
import type { MediaContentServices, MediaContentLocation, MediaUsageScan } from "../../media/integration/content";
import { createMediaLibraryController, type MediaLibraryController, type MediaLibraryControllerOptions } from "./controller";
import { MediaThumb } from "./media-thumb";
import { useMediaDimensions, type MediaDimensionStore } from "./media-dimensions";
import { formatBytes, mediaTypeLabel } from "./media-format";
import { MediaUploadPanel, useMediaUpload } from "./media-upload";
import { MediaUsePicker } from "./media-use-picker";

export interface MediaRouteContentProps {
  provider?: MediaProvider;
  controller?: MediaLibraryController;
  controllerOptions?: MediaLibraryControllerOptions;
  contentServices?: MediaContentServices;
  usageHref?: (location: MediaContentLocation) => string;
  intent?: RouteIntentParseOutcome;
}
type Scope = "all" | "trash" | { folderId: string | null };
type Action = { kind: "folder"; folder?: MediaFolder; parentId: string | null; index: number; token: string; session?: OutlineInsertSession }
  | { kind: "move" | "trash"; records: readonly MediaSummary[] }
  | { kind: "preview"; record: MediaSummary } | { kind: "use"; record: MediaSummary };
function mediaFolderPath(folders: readonly MediaFolder[], id: string | null): readonly string[] {
  try { return resolveFolderPath(folders, id); } catch { return ["Folder unavailable"]; }
}

export function MediaApp(props: MediaRouteContentProps): JSX.Element {
  if (!props.provider) return <LibraryPage class="sg-media-route" title="Media" icon={FolderIcon} purpose="Organize reusable images and files."><Banner tone="info">The Media provider is unavailable in this build. Authoring requires the local development transport. Committed static files remain available; no library assets can be listed or changed here.</Banner><Button disabled>Upload</Button><Button disabled>New folder</Button></LibraryPage>;
  return <ConnectedMedia {...props} provider={props.provider} />;
}
function ConnectedMedia({ provider, controller: supplied, controllerOptions, contentServices, usageHref, intent }: MediaRouteContentProps & { provider: MediaProvider }): JSX.Element {
  const controller = useMemo(() => supplied ?? createMediaLibraryController(provider, { ...controllerOptions, contentServices: contentServices ?? controllerOptions?.contentServices }), [provider, supplied, controllerOptions, contentServices]);
  const [state, setState] = useState(controller.state);
  const integration = useWorkspace()?.integration;
  const [scope, setScope] = useState<Scope>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState(""); const [type, setType] = useState("all"); const [sort, setSort] = useState("name");
  const [view, setView] = useState<"grid" | "list">(() => { try { return localStorage.getItem("zudo-composer.media.view") === "list" ? "list" : "grid"; } catch { return "grid"; } });
  const [action, setAction] = useState<Action | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const dimensions = useMediaDimensions();
  const replaceInput = useRef<HTMLInputElement>(null); const replaceTarget = useRef<MediaSummary | null>(null);
  const appliedIntent = useRef<string | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [intentRetry, setIntentRetry] = useState(0);
  useEffect(() => { const stop = controller.subscribe(setState); void controller.initialize(); return () => { stop(); if (!supplied) controller.dispose(); }; }, [controller, supplied]);
  useEffect(() => {
    if (!integration) return;
    const session = integration.sessions.register({ feature: "Media metadata", providerId: provider.descriptor.id, workspaceId: integration.workspace.id }, { flush: () => controller.flush() });
    let generation = controller.state.generation;
    const stop = controller.subscribe((next) => { if (next.generation !== generation) { generation = next.generation; session.changed(); } });
    return () => { stop(); session.detach(); };
  }, [controller, integration, provider]);
  useEffect(() => {
    const refresh = () => { if (!controller.state.busy) void controller.refresh().catch((error) => controller.reportFailure(error)); };
    window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh);
  }, [controller]);
  const run = (task: () => Promise<unknown>) => { setDialogError(null); void task().catch((error) => { controller.reportFailure(error); setDialogError(error instanceof Error ? error.message : "Media operation failed."); }); };
  const folders = state.snapshot?.folders ?? [];
  const activeFolders = folders.filter(({ state }) => state === "active");
  const folderId = typeof scope === "object" ? scope.folderId : null;
  const currentFolder = activeFolders.find(({ id }) => id === folderId);
  const scopeName = scope === "trash" ? "Trash" : scope === "all" ? "All assets" : folderId === null ? "Unfiled" : currentFolder?.name ?? "Folder unavailable";
  const chooseScope = (next: Scope) => { setScope(next); setSelected(new Set()); setActiveId(null); setSearch(""); };
  const rows = state.records.filter((record) => (scope === "trash" ? record.state === "trash" : record.state === "active")
    && (typeof scope !== "object" || record.folderId === scope.folderId)
    && (type === "all" || (type === "images" ? record.mediaType.startsWith("image/") : record.mediaType === "application/pdf"))
    && `${record.fileName} ${record.note} ${mediaFolderPath(folders, record.folderId).join("/")}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : sort === "size" ? b.byteLength - a.byteLength : a.fileName.localeCompare(b.fileName)) || a.id.localeCompare(b.id));
  const chosen = state.records.filter(({ id }) => selected.has(id));
  const active = state.records.find(({ id }) => id === activeId) ?? null;
  const toggle = (id: string, checked: boolean) => setSelected((prior) => { const next = new Set(prior); if (checked) next.add(id); else next.delete(id); return next; });
  useEffect(() => { setSelected((prior) => new Set([...prior].filter((id) => state.records.some((record) => record.id === id && (scope === "trash" ? record.state === "trash" : record.state === "active"))))); }, [state.records, scope]);
  useEffect(() => {
    const parsed = intent ?? parseIntent();
    const key = JSON.stringify([parsed, intentRetry]);
    if (appliedIntent.current === key) return;
    if (parsed.status === "invalid") {
      appliedIntent.current = key; setIntentError(parsed.message); setActiveId(null); setSelected(new Set()); return;
    }
    if (parsed.status === "matched" && parsed.intent.route === "media") {
      if (state.phase === "idle" || state.phase === "loading") return;
      appliedIntent.current = key;
      const id = parsed.intent.assetId;
      const record = state.records.find((record) => record.id === id);
      if (state.phase !== "ready" || parsed.intent.providerId !== provider.descriptor.id || !record) {
        setIntentError("This Media link targets a missing or unavailable asset. Reload and retry the link deliberately."); setActiveId(null); setSelected(new Set()); return;
      }
      setIntentError(null); setActiveId(id); setSelected(new Set([id])); setScope(record.state === "trash" ? "trash" : "all");
    }
  }, [intent, intentRetry, provider, state.records, state.phase]);
  const refresh = useCallback(() => controller.refresh(), [controller]);
  const uploadStore = useMemo(() => ({ upload: (file: Blob & { name: string }) => controller.upload(file, folderId) }), [controller, folderId]);
  const upload = useMediaUpload({ store: uploadStore, refresh });
  const writable = controller.capability("metadata") && state.phase === "ready";
  const canUpload = state.phase === "ready" && controller.capability("replace") && typeof controller.store?.upload === "function" && scope !== "trash";
  const open = (next: Action) => {
    setDialogError(null);
    if ((next.kind === "move" || next.kind === "trash") && next.records.some((record) => controller.hasDraft(record.id))) {
      run(async () => {
        await controller.flush();
        const records = next.records.map((record) => controller.state.records.find(({ id }) => id === record.id));
        if (records.some((record) => !record)) throw new Error("A selected asset is no longer available.");
        setAction({ ...next, records: records as MediaSummary[] });
      });
    } else setAction(next);
  };
  const close = () => { if (action?.kind === "folder") action.session?.cancel(); setAction(null); setDialogError(null); };
  const folderTree = (parentId: string | null): OutlineNode[] => activeFolders.filter((folder) => folder.parentId === parentId).map((folder) => ({ id: folder.id, kind: "group", title: folder.name, count: state.records.filter((record) => record.state === "active" && record.folderId === folder.id).length, children: folderTree(folder.id) }));
  const nodes = folderTree(null);
  const newFolder = () => { if (!state.snapshot) return; open({ kind: "folder", parentId: folderId, index: activeFolders.filter((folder) => folder.parentId === folderId).length, token: state.snapshot.mutationToken }); };
  const replace = (record: MediaSummary) => { replaceTarget.current = record; replaceInput.current?.click(); };
  const recordMenu = (record: MediaSummary) => <RowMenu label={record.fileName} open={{ id: "inspect", label: "Inspect", onSelect: () => setActiveId(record.id) }} actions={record.state === "trash" ? [{ id: "restore", label: "Restore", disabled: !controller.capability("restore") || state.busy, onSelect: () => run(() => controller.restore([record])) }] : [
    { id: "move", label: "Move to…", disabled: !writable || state.busy, onSelect: () => open({ kind: "move", records: [record] }) },
    { id: "replace", label: "Replace file…", disabled: !controller.capability("replace") || state.busy, onSelect: () => replace(record) },
    { id: "copy", label: "Copy authoring URL", onSelect: () => run(() => controller.copyUrl(record)) },
  ]} destructive={record.state === "active" ? [{ id: "trash", label: "Move to trash…", disabled: !controller.capability("trash") || state.busy, onSelect: () => open({ kind: "trash", records: [record] }) }] : []} />;
  return <LibraryPage class="sg-media-route" title="Media" icon={FolderIcon} purpose="Organize reusable files, inspect their uses, and connect them to content." primaryAction={<Button variant="primary" disabled={!canUpload || state.busy || upload.state.busy} onClick={upload.openPicker}><UploadIcon size="sm" /> Upload</Button>} actions={<Button disabled={!writable || state.busy} onClick={newFolder}>New folder</Button>}>
    {!controller.store ? <Banner tone="info">This provider is read-only. Folder editing, uploads, replacement and trash are unavailable.</Banner> : null}
    {intentError ? <Banner tone="err" action={<Button disabled={state.busy} onClick={() => run(async () => { await controller.reload(); setIntentRetry((value) => value + 1); })}>Retry asset link</Button>}>{intentError}</Banner> : null}
    {state.notice ? <Banner tone={state.notice.tone === "err" ? "err" : "info"} action={state.notice.tone === "err" ? <Button disabled={state.busy} onClick={() => run(() => controller.reload())}>Reload current state</Button> : undefined}>{state.notice.text}</Banner> : null}
    {state.phase === "error" || state.phase === "recovery" ? <Banner tone="err" action={<Button onClick={() => run(() => controller.retryInitialization())}>Retry loading</Button>}>{state.errorMessage ?? state.recoveryMessage} Source and retained versions are preserved.</Banner> : null}
    {state.busy ? <p role="status">{state.operation} in progress…</p> : null}
    <div class="sg-media-workspace" aria-busy={state.phase === "loading"}>
      <aside class="sg-media-folders" aria-label="Media folders">
        <p class="sg-media-kicker">Library</p>
        <Button variant="ghost" aria-pressed={scope === "all"} onClick={() => chooseScope("all")}>All assets <span>{state.records.filter((record) => record.state === "active").length}</span></Button>
        <Button variant="ghost" aria-pressed={typeof scope === "object" && scope.folderId === null} onClick={() => chooseScope({ folderId: null })}>Unfiled</Button>
        <Button variant="ghost" aria-pressed={scope === "trash"} onClick={() => chooseScope("trash")}>Trash <span>{state.records.filter((record) => record.state === "trash").length}</span></Button>
        <p class="sg-media-kicker">Folders</p>
        <OutlineTree label="Folder outline" nodes={nodes} selectedId={folderId ?? undefined} onSelect={(id) => chooseScope({ folderId: id })} canInsert={() => (writable && !state.busy) || (state.busy && !state.uncertain && action?.kind === "folder" && action.session !== undefined)} onRequestInsert={(target, session) => { open({ kind: "folder", ...target, token: state.snapshot!.mutationToken, session }); }} onRename={(id, name) => { const folder = folders.find((item) => item.id === id)!; run(() => controller.updateFolder(id, { name }, folder.revision, state.snapshot!.mutationToken)); }} canRename={() => writable && !state.busy} addLabel={() => "Add folder"} prefKey="media-folders" renderActions={(node) => { const folder = folders.find(({ id }) => id === node.id)!; return <RowMenu label={folder.name} actions={[{ id: "edit", label: "Rename or move folder…", disabled: !writable || state.busy, onSelect: () => open({ kind: "folder", folder, parentId: folder.parentId, index: activeFolders.filter((item) => item.parentId === folder.parentId).findIndex((item) => item.id === folder.id), token: state.snapshot!.mutationToken }) }]} destructive={[{ id: "trash", label: "Trash empty folder", disabled: !writable || state.busy, onSelect: () => run(() => controller.changeFolderState(folder.id, folder.revision, false)) }]} />; }} />
        {scope === "trash" ? <section><p class="sg-media-kicker">Trashed folders</p>{folders.filter((folder) => folder.state === "trash").map((folder) => <div key={folder.id}>{folder.name} <Button size="sm" disabled={!writable || state.busy} onClick={() => run(() => controller.changeFolderState(folder.id, folder.revision, true))}>Restore folder</Button></div>)}</section> : null}
        <small class="sg-media-folder-note">Media is global. Metadata changes retain stable asset IDs and all byte versions.</small>
      </aside>
      <section class="sg-media-content" aria-label="Asset library">
        <header class="sg-media-content-header"><strong>{scopeName}</strong><SegmentedControl label="Media view" value={view} options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} onChange={(value) => { setView(value); try { localStorage.setItem("zudo-composer.media.view", value); } catch { /* Optional preference. */ } }} /></header>
        <div class="sg-media-tools"><Input type="search" aria-label="Search media" placeholder="Search files, folders or notes…" value={search} onInput={(event) => setSearch(event.currentTarget.value)} /><Select aria-label="Media type" value={type} onChange={(event) => setType(event.currentTarget.value)}><option value="all">All types</option><option value="images">Images</option><option value="pdf">PDF</option></Select><Select aria-label="Sort media" value={sort} onChange={(event) => setSort(event.currentTarget.value)}><option value="name">Name A–Z</option><option value="updated">Recently updated</option><option value="size">Largest first</option></Select></div>
        <div class="sg-media-selection"><Checkbox aria-label="Select all visible assets" checked={rows.length > 0 && rows.every(({ id }) => selected.has(id))} onCheckedChange={(checked) => setSelected((prior) => { const next = new Set(prior); for (const { id } of rows) { if (checked) next.add(id); else next.delete(id); } return next; })} /><span>{chosen.length} selected</span><Button size="sm" disabled={!chosen.length} onClick={() => setSelected(new Set())}>Clear</Button>{scope === "trash" ? <Button size="sm" disabled={!chosen.length || !controller.capability("restore") || state.busy} onClick={() => run(() => controller.restore(chosen))}>Restore selected</Button> : <><Button size="sm" disabled={!chosen.length || !writable || state.busy} onClick={() => open({ kind: "move", records: chosen })}>Move to…</Button><Button size="sm" disabled={!chosen.length || !controller.capability("trash") || state.busy} onClick={() => open({ kind: "trash", records: chosen })}>Trash…</Button></>}</div>
        {canUpload ? <MediaUploadPanel controller={upload} /> : null}
        <div class="sg-media-assets">
          {state.phase === "loading" ? <p role="status">Loading media…</p> : rows.length === 0 ? <p class="sg-media-empty">{search || type !== "all" ? "No assets match these filters." : scope === "trash" ? "Trash is empty." : "No assets in this location. Upload a file to get started."}</p> : view === "grid" ? <div class="sg-media-grid">{rows.map((record) => <article key={record.id} class={`sg-media-tile${selected.has(record.id) ? " sg-media-tile--selected" : ""}`}><div class="sg-media-tile-tools"><Checkbox aria-label={`Select ${record.fileName}`} checked={selected.has(record.id)} onCheckedChange={(checked) => toggle(record.id, checked)} />{recordMenu(record)}</div><button class="sg-media-tile-open" aria-label={`Inspect ${record.fileName}`} onClick={() => { setActiveId(record.id); setSelected(new Set([record.id])); }}><span class="sg-media-tile-art"><MediaThumb record={record} dimensions={dimensions} /></span><strong>{record.fileName}</strong><small>{mediaTypeLabel(record.mediaType)} · {formatBytes(record.byteLength)}</small><small>{mediaFolderPath(folders, record.folderId).join(" / ") || "Unfiled"}</small></button></article>)}</div> : <DataTable<MediaSummary> caption="Media assets" rows={rows} rowKey={(record) => record.id} columns={[{ key: "name", header: "Name", cell: (record) => <Button variant="ghost" onClick={() => setActiveId(record.id)}>{record.fileName}</Button> }, { key: "type", header: "Type", cell: (record) => mediaTypeLabel(record.mediaType) }, { key: "size", header: "Size", cell: (record) => formatBytes(record.byteLength) }, { key: "actions", header: "Actions", cell: recordMenu }]} selection={{ selectedIds: selected, onToggleRow: toggle, onToggleAll: (checked) => setSelected(checked ? new Set(rows.map(({ id }) => id)) : new Set()), rowLabel: (record) => record.fileName }} />}
        </div><footer class="sg-media-library-footer">{rows.length} visible · {state.records.length} in library <Button size="sm" disabled={state.busy} onClick={() => run(() => controller.reload())}>Refresh</Button></footer>
      </section>
      <MediaInspector key={active?.id ?? "empty"} record={active} controller={controller} dimensions={dimensions} usageHref={usageHref} onClose={() => setActiveId(null)} onPreview={(record) => open({ kind: "preview", record })} onUse={(record) => open({ kind: "use", record })} onMove={(record) => open({ kind: "move", records: [record] })} onReplace={replace} onTrash={(record) => open({ kind: "trash", records: [record] })} run={run} />
    </div>
    <input ref={replaceInput} class="sg-media-upload__input" aria-label="Replacement file" type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; const target = replaceTarget.current; if (file && target) run(() => controller.replace(target, file)); }} />
    {action ? <MediaActionDialog action={action} controller={controller} folders={folders} error={dialogError} close={close} run={run} usageHref={usageHref} /> : null}
  </LibraryPage>;
}

function MediaInspector({ record, controller, dimensions, usageHref, onClose, onPreview, onUse, onMove, onReplace, onTrash, run }: {
  record: MediaSummary | null; controller: MediaLibraryController; dimensions: MediaDimensionStore; usageHref?: (location: MediaContentLocation) => string;
  onClose(): void; onPreview(record: MediaSummary): void; onUse(record: MediaSummary): void; onMove(record: MediaSummary): void; onReplace(record: MediaSummary): void; onTrash(record: MediaSummary): void; run(task: () => Promise<unknown>): void;
}) {
  const [name, setName] = useState(record?.fileName ?? ""); const [note, setNote] = useState(record?.note ?? "");
  const [draftBase, setDraftBase] = useState(record);
  useEffect(() => { if (record && !controller.hasDraft(record.id)) { setName(record.fileName); setNote(record.note); setDraftBase(record); } }, [record?.revision, controller.state.generation, controller]);
  const [scan, setScan] = useState<MediaUsageScan | null>(null);
  const [contentGeneration, setContentGeneration] = useState(0);
  const scanEpoch = useRef(0);
  useEffect(() => record ? controller.contentServices?.subscribeChanges(() => { scanEpoch.current++; setScan(null); setContentGeneration((value) => value + 1); }) : undefined, [controller, record?.id]);
  useEffect(() => { const epoch = ++scanEpoch.current; setScan(null); if (record) void controller.scan(record).then((value) => { if (scanEpoch.current === epoch) setScan(value); }); return () => { scanEpoch.current++; }; }, [controller, record?.id, controller.state.snapshot?.mutationToken, contentGeneration]);
  if (!record) return <aside class="sg-media-inspector" aria-label="Asset details"><header><strong>Asset details</strong></header><p class="sg-media-empty">Select an asset to inspect its file, metadata and Content uses.</p></aside>;
  const writable = controller.capability("metadata") && record.state === "active" && !controller.state.busy;
  const full = controller.state.snapshot?.records.find(({ id }) => id === record.id);
  return <aside class="sg-media-inspector" aria-label="Asset details"><header><strong>Asset details</strong><Button size="sm" onClick={onClose}>Close</Button></header><button class="sg-media-inspector-preview" onClick={() => onPreview(record)} aria-label={`Preview ${record.fileName}`}><MediaThumb detail record={record} dimensions={dimensions} /></button><div class="sg-media-inspector-body"><h2>{record.fileName}</h2><p>{mediaTypeLabel(record.mediaType)} · {formatBytes(record.byteLength)} · Revision {record.revision}</p><div class="sg-media-actions"><Button variant="primary" disabled={!controller.contentServices || controller.state.phase !== "ready" || controller.state.uncertain || controller.state.busy || record.state !== "active"} onClick={() => onUse(record)}>Use in content</Button><Button onClick={() => onPreview(record)}>Preview</Button></div><p class="sg-media-kicker">Location & identity</p><code>{record.id}</code><p>{mediaFolderPath(controller.state.snapshot?.folders ?? [], record.folderId).join(" / ") || "Unfiled"}</p><div class="sg-media-actions"><Button size="sm" onClick={() => run(() => controller.copy(record.id))}>Copy ID</Button><Button size="sm" onClick={() => run(() => controller.copyUrl(record))}>Copy authoring URL</Button><Button size="sm" disabled={!writable} onClick={() => onMove(record)}>Move</Button></div><Field label="Asset name"><Input value={name} disabled={!writable} onInput={(event) => { setName(event.currentTarget.value); controller.draftMetadata(draftBase ?? record, { fileName: event.currentTarget.value }); }} /></Field><Field label="Internal note" help="A library note, not alternative text for a Content usage."><Textarea value={note} disabled={!writable} onInput={(event) => { setNote(event.currentTarget.value); controller.draftMetadata(draftBase ?? record, { note: event.currentTarget.value }); }} /></Field><Button disabled={!writable} onClick={() => run(async () => { controller.draftMetadata(draftBase ?? record, { fileName: name, note }); await controller.saveDraft(record.id); })}>Save details</Button>{draftBase && draftBase.revision !== record.revision && controller.hasDraft(record.id) ? <Banner tone="warn">This asset changed since editing began. Your text is retained; discard it to load current details before reapplying.</Banner> : null}<Button size="sm" disabled={controller.state.busy || controller.state.uncertain || !controller.hasDraft(record.id)} onClick={() => { controller.discardDraft(record.id); setName(record.fileName); setNote(record.note); setDraftBase(record); }}>Discard unsaved details</Button><section><p class="sg-media-kicker">Used by</p>{!scan ? <p role="status">Checking structured Content uses…</p> : <><p>{scan.message}</p>{scan.locations.map((location, index) => <div class="sg-media-usage" key={index}>{usageHref ? <a href={usageHref(location)}>{location.entryTitle}</a> : <strong>{location.entryTitle}</strong>}<small>{location.modelName} · {location.fieldLabel} · {location.valuePath.join(" / ")}</small><small>{location.use.kind === "image" ? location.use.alt || "Decorative image" : location.use.kind === "link" ? location.use.label : location.use.title}</small></div>)}</>}</section><section><p class="sg-media-kicker">Immutable versions</p>{full?.document.versions.map((version) => <p key={version.id}><a href={version.url} target="_blank" rel="noreferrer">{version.id.slice(0, 12)}</a> · {version.id === full.document.currentVersionId ? "Latest" : "Historical pin"} · {formatBytes(version.byteLength)}</p>)}</section><div class="sg-media-actions">{record.state === "trash" ? <Button disabled={!controller.capability("restore") || controller.state.busy} onClick={() => run(() => controller.restore([record]))}>Restore asset</Button> : <><Button disabled={!controller.capability("replace") || controller.state.busy} onClick={() => onReplace(record)}>Replace file</Button><Button disabled={!controller.capability("trash") || controller.state.busy} onClick={() => onTrash(record)}>Trash…</Button></>}</div></div></aside>;
}

function MediaActionDialog({ action, controller, folders, error, close, run, usageHref }: { action: Action; controller: MediaLibraryController; folders: readonly MediaFolder[]; error: string | null; close(): void; run(task: () => Promise<unknown>): void; usageHref?: (location: MediaContentLocation) => string }) {
  const [name, setName] = useState(action.kind === "folder" ? action.folder?.name ?? "" : "");
  const [destination, setDestination] = useState(action.kind === "folder" ? action.parentId ?? "" : "");
  const [index, setIndex] = useState(action.kind === "folder" ? action.index : 0);
  const [scans, setScans] = useState<readonly MediaUsageScan[] | null>(null);
  const [usageGeneration, setUsageGeneration] = useState(0);
  const usageEpoch = useRef(0);
  useEffect(() => action.kind === "trash" ? controller.contentServices?.subscribeChanges(() => { usageEpoch.current++; setScans(null); setUsageGeneration((value) => value + 1); }) : undefined, [action, controller]);
  useEffect(() => { const epoch = ++usageEpoch.current; if (action.kind === "trash") void Promise.all(action.records.map((record) => controller.scan(record))).then((value) => { if (usageEpoch.current === epoch) setScans(value); }); return () => { usageEpoch.current++; }; }, [action, controller, usageGeneration]);
  const blocked = !scans || scans.some((scan) => scan.status !== "complete" || scan.locations.length > 0);
  const parents = folders.filter((folder) => folder.state === "active" && (action.kind !== "folder" || folder.id !== action.folder?.id));
  const destinationSelect = <Field label="Destination folder"><Select value={destination} onChange={(event) => { setDestination(event.currentTarget.value); setIndex(folders.filter((folder) => folder.parentId === (event.currentTarget.value || null) && folder.state === "active" && (action.kind !== "folder" || folder.id !== action.folder?.id)).length); }}><option value="">Unfiled / root</option>{parents.map((folder) => <option key={folder.id} value={folder.id}>{mediaFolderPath(folders, folder.id).join(" / ")}</option>)}</Select></Field>;
  const submit = () => run(async () => {
    if (action.kind === "folder") {
      const target = action.session ? action.session.resolveTarget() : { parentId: destination || null, index };
      if (!target) throw new Error("The folder insertion point changed. Reopen the insertion control.");
      if (action.folder) await controller.updateFolder(action.folder.id, { name, parentId: target.parentId, index: target.index }, action.folder.revision, action.token);
      else { const folder = await controller.createFolder(name, target.parentId, target.index, action.token); action.session?.complete(folder.id); }
    } else if (action.kind === "move") await controller.move(action.records, destination || null);
    else if (action.kind === "trash") await controller.trash(action.records);
    close();
  });
  if (action.kind === "use") return <MediaUsePicker record={action.record} controller={controller} onClose={close} />;
  if (action.kind === "preview") return <Dialog open title={action.record.fileName} size="wide" onClose={close}><div class="sg-media-preview-stage">{action.record.mediaType.startsWith("image/") ? <img src={action.record.url} alt={action.record.fileName} /> : <iframe title={`PDF preview: ${action.record.fileName}`} src={action.record.url} />}</div><a href={action.record.url} target="_blank" rel="noreferrer">Open exact immutable version</a></Dialog>;
  return <Dialog open title={action.kind === "folder" ? action.folder ? "Edit folder" : "New folder" : action.kind === "move" ? "Move assets" : "Move assets to trash?"} onClose={close} dismissOnBackdrop={false} footer={<><Button disabled={controller.state.busy} onClick={close}>Cancel</Button><Button variant="primary" disabled={controller.state.phase !== "ready" || controller.state.uncertain || controller.state.busy || (action.kind === "trash" && blocked) || (action.kind === "folder" && !name.trim())} onClick={submit}>{action.kind === "trash" ? "Move to trash" : "Save"}</Button></>}>
    {error ? <Banner tone="err">{error}</Banner> : null}
    {action.kind === "folder" ? <><Field label="Folder name"><Input value={name} onInput={(event) => setName(event.currentTarget.value)} /></Field>{!action.session ? <>{destinationSelect}<Field label="Sibling position"><Input type="number" min={0} value={index} onInput={(event) => setIndex(Number(event.currentTarget.value))} /></Field></> : <p>Insert at position {action.index + 1} in {mediaFolderPath(folders, action.parentId).join(" / ") || "root"}.</p>}</> : action.kind === "move" ? destinationSelect : <><p>Records and every byte version are retained. Restore is available from Trash.</p>{!scans ? <p role="status">Checking all selected assets…</p> : scans.map((scan, index) => <section key={index}><strong>{action.records[index]?.fileName}</strong><p>{scan.message}</p>{scan.locations.map((location, i) => <p key={i}>{usageHref ? <a href={usageHref(location)}>{location.modelName} / {location.entryTitle} / {location.fieldLabel}</a> : `${location.modelName} / ${location.entryTitle} / ${location.fieldLabel}`}</p>)}</section>)}{blocked ? <p>Trash is blocked until every authoritative scan is complete and no active Content uses remain.</p> : null}</>}
  </Dialog>;
}
