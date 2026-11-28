import { downloadAsset } from "../../browser/asset-download.mjs";
import { batch, computed, For, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import type { AppServices } from "../../app/services";
import { parseIntent, type RouteIntentParseOutcome } from "../../app/route-intents";
import { OutlineTree, type OutlineNode, type OutlineInsertSession } from "../../components/outline-tree";
import { LibraryPage, RowMenu, type RowMenuAction } from "../../components/library-page";
import { Dialog } from "../../components/overlay";
import { liveSlot, Rebuild } from "../../components/rebuild";
import { Banner, Button, Checkbox, DataTable, Field, Input, Select, SegmentedControl, Textarea } from "../../components/ui";
import { FolderIcon, UploadIcon } from "../../components/icons";
import { Keyed } from "../../runtime";
import { ASSET_ACCEPT, ASSET_MAX_BYTE_LENGTH, ASSET_KIND_LABELS, assetKindForMime, assetDownloadFileName, assetFolderPath as resolveFolderPath, type AssetProvider, type AssetSummary, type AssetFolder } from "../../assets";
import type { AssetContentServices, AssetContentLocation, AssetUsageLocation, AssetUsageScan } from "../../assets/integration/content";
import { createAssetLibraryController, type AssetLibraryController, type AssetLibraryControllerOptions, type AssetLibraryState } from "./controller";
import { AssetThumb } from "./assets-thumb";
import { createAssetDimensions, type AssetDimensionStore } from "./assets-dimensions";
import { formatBytes, assetTypeLabel } from "./assets-format";
import { AssetUploadPanel, createAssetUpload } from "./assets-upload";
import { AssetUsePicker } from "./assets-use-picker";
import { ImageEditorDialog } from "./image-editor-dialog";
import { AssetView } from "./live";

export interface AssetRouteContentProps {
  /** The shell's route services; absent when the route is rendered on its own (tests, embeds). */
  services?: AppServices;
  provider?: AssetProvider;
  controller?: AssetLibraryController;
  controllerOptions?: AssetLibraryControllerOptions;
  contentServices?: AssetContentServices;
  usageHref?: (location: AssetContentLocation) => string;
  intent?: RouteIntentParseOutcome;
}
type Scope = "all" | "trash" | { folderId: string | null };
type Action = { kind: "folder"; folder?: AssetFolder; parentId: string | null; index: number; token: string; session?: OutlineInsertSession }
  | { kind: "move" | "trash"; records: readonly AssetSummary[] }
  | { kind: "preview"; record: AssetSummary } | { kind: "use"; record: AssetSummary };
const EDITABLE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const isEditableImage = (record: Pick<AssetSummary, "mimeType">): boolean => EDITABLE_IMAGE_MIMES.has(record.mimeType);
function assetFolderPath(folders: readonly AssetFolder[], id: string | null): readonly string[] {
  try { return resolveFolderPath(folders, id); } catch { return ["Folder unavailable"]; }
}
type Run = (task: () => Promise<unknown>) => void;

/** Identity for objects that carry no id of their own (actions, records), for `Keyed`. */
function objectIdentity<T extends object>(): (value: T | null) => number {
  const ids = new WeakMap<T, number>();
  let next = 0;
  return (value) => {
    if (value === null) return 0;
    let id = ids.get(value);
    if (id === undefined) { id = ++next; ids.set(value, id); }
    return id;
  };
}

export function AssetApp(props: AssetRouteContentProps): Child {
  if (!props.provider) return <LibraryPage class="sg-assets-route" title="Assets" icon={FolderIcon} purpose="Organize reusable images and files."><Banner tone="info">The Assets library and upload authoring are available only under the local development server (<code>pnpm dev</code>). Committed files under <code>publicAssetsDir</code> are still served from <code>/uploaded-assets/</code>.</Banner><Button disabled>Upload</Button><Button disabled>New folder</Button></LibraryPage>;
  return <ConnectedAsset {...props} provider={props.provider} />;
}
function ConnectedAsset({ services, provider, controller: supplied, controllerOptions, contentServices, usageHref, intent }: AssetRouteContentProps & { provider: AssetProvider }): Child {
  const scopeHandle = getScope();
  const controller = supplied ?? createAssetLibraryController(provider, { ...controllerOptions, contentServices: contentServices ?? controllerOptions?.contentServices });
  const state = signal<AssetLibraryState>(controller.state);
  const integration = services?.workspace.integration;
  const scope = signal<Scope>("all");
  const selected = signal<ReadonlySet<string>>(new Set());
  // Mirror of `selected` for reads that must not subscribe (inside effects that write it).
  let selectedNow: ReadonlySet<string> = selected.value;
  const setSelected = (next: ReadonlySet<string> | ((prior: ReadonlySet<string>) => ReadonlySet<string>)) => {
    selectedNow = typeof next === "function" ? next(selectedNow) : next;
    selected.value = selectedNow;
  };
  const activeId = signal<string | null>(null);
  const search = signal(""); const type = signal("all"); const sort = signal("name");
  const view = signal<"grid" | "list">((() => { try { return localStorage.getItem("zudo-composer.assets.view") === "list" ? "list" : "grid"; } catch { return "grid"; } })());
  const action = signal<Action | null>(null);
  const editorRecord = signal<AssetSummary | null>(null);
  const dialogError = signal<string | null>(null);
  const dimensions = createAssetDimensions();
  const replaceInput: Ref<HTMLInputElement> = { current: null }; let replaceTarget: AssetSummary | null = null;
  let appliedIntent: string | null = null;
  const intentError = signal<string | null>(null);
  const intentRetry = signal(0);
  scopeHandle.onActivate(() => {
    const stop = controller.subscribe((next) => { state.value = next; });
    void controller.initialize();
    return () => { stop(); if (!supplied) controller.dispose(); };
  });
  scopeHandle.onActivate(() => {
    if (!integration) return;
    const session = integration.sessions.register({ feature: "Asset metadata", providerId: provider.descriptor.id, workspaceId: integration.workspace.id }, { flush: () => controller.flush() });
    let generation = controller.state.generation;
    const stop = controller.subscribe((next) => { if (next.generation !== generation) { generation = next.generation; session.changed(); } });
    return () => { stop(); session.detach(); };
  });
  scopeHandle.onActivate(() => {
    const refresh = () => { if (!controller.state.busy) void controller.refresh().catch((error) => controller.reportFailure(error)); };
    window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh);
  });
  const run: Run = (task) => { dialogError.value = null; void task().catch((error) => { controller.reportFailure(error); if (!scopeHandle.abortSignal.aborted) dialogError.value = error instanceof Error ? error.message : "Asset operation failed."; }); };
  const folders = computed(() => state.value.snapshot?.folders ?? []);
  const activeFolders = computed(() => folders.value.filter(({ state }) => state === "active"));
  const folderId = computed(() => { const value = scope.value; return typeof value === "object" ? value.folderId : null; });
  const scopeName = computed(() => {
    const value = scope.value;
    if (value === "trash") return "Trash";
    if (value === "all") return "All assets";
    if (folderId.value === null) return "Unfiled";
    return activeFolders.value.find(({ id }) => id === folderId.value)?.name ?? "Folder unavailable";
  });
  const chooseScope = (next: Scope) => { batch(() => { scope.value = next; setSelected(new Set()); activeId.value = null; search.value = ""; }); };
  const scopedRecords = computed(() => {
    const value = scope.value, text = search.value.toLowerCase(), allFolders = folders.value;
    return state.value.records.filter((record) => (value === "trash" ? record.state === "trash" : record.state === "active")
      && (typeof value !== "object" || record.folderId === value.folderId)
      && `${record.fileName} ${record.note} ${assetFolderPath(allFolders, record.folderId).join("/")}`.toLowerCase().includes(text));
  });
  const rows = computed(() => {
    const kind = type.value, order = sort.value;
    return scopedRecords.value.filter((record) => kind === "all" || assetKindForMime(record.mimeType)?.kind === kind)
      .sort((a, b) => (order === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : order === "size" ? b.byteLength - a.byteLength : a.fileName.localeCompare(b.fileName)) || a.id.localeCompare(b.id));
  });
  const chosen = computed(() => state.value.records.filter(({ id }) => selected.value.has(id)));
  const active = computed(() => state.value.records.find(({ id }) => id === activeId.value) ?? null);
  const toggle = (id: string, checked: boolean) => setSelected((prior) => { const next = new Set(prior); if (checked) next.add(id); else next.delete(id); return next; });
  scopeHandle.effect(() => {
    const records = state.value.records, value = scope.value;
    setSelected((prior) => new Set([...prior].filter((id) => records.some((record) => record.id === id && (value === "trash" ? record.state === "trash" : record.state === "active")))));
  });
  scopeHandle.effect(() => {
    const parsed = intent ?? parseIntent();
    const key = JSON.stringify([parsed, intentRetry.value]);
    const { phase, records } = state.value;
    if (appliedIntent === key) return;
    if (parsed.status === "invalid") {
      appliedIntent = key; batch(() => { intentError.value = parsed.message; activeId.value = null; setSelected(new Set()); }); return;
    }
    if (parsed.status === "matched" && parsed.intent.route === "assets") {
      if (phase === "idle" || phase === "loading") return;
      appliedIntent = key;
      const id = parsed.intent.assetId;
      const record = records.find((record) => record.id === id);
      if (phase !== "ready" || parsed.intent.providerId !== provider.descriptor.id || !record) {
        batch(() => { intentError.value = "This Asset link targets a missing or unavailable asset. Reload and retry the link deliberately."; activeId.value = null; setSelected(new Set()); }); return;
      }
      batch(() => { intentError.value = null; activeId.value = id; setSelected(new Set([id])); scope.value = record.state === "trash" ? "trash" : "all"; });
    }
  });
  // The upload target folder is read when a file is stored, not when the queue was created.
  let currentFolderId: string | null = null;
  scopeHandle.effect(() => { currentFolderId = folderId.value; });
  const upload = createAssetUpload({ store: { upload: (file) => controller.upload(file, currentFolderId) }, refresh: () => controller.refresh(), workspace: services?.workspace });
  // `capability` reads the controller's plain state; reading the state signal first keeps every gate tracked.
  const can = (name: Parameters<AssetLibraryController["capability"]>[0]) => { void state.value; return controller.capability(name); };
  const busy = computed(() => state.value.busy);
  const ready = computed(() => state.value.phase === "ready");
  const writable = computed(() => can("metadata") && ready.value);
  const canUpload = computed(() => ready.value && can("replace") && typeof controller.store?.upload === "function" && scope.value !== "trash");
  const editingBlocked = computed(() => !can("replace") || !ready.value || state.value.uncertain || busy.value);
  const open = (next: Action) => {
    dialogError.value = null;
    if ((next.kind === "move" || next.kind === "trash") && next.records.some((record) => controller.hasDraft(record.id))) {
      run(async () => {
        await controller.flush();
        const records = next.records.map((record) => controller.state.records.find(({ id }) => id === record.id));
        if (records.some((record) => !record)) throw new Error("A selected asset is no longer available.");
        action.value = { ...next, records: records as AssetSummary[] };
      });
    } else action.value = next;
  };
  const close = () => { const current = action.value; if (current?.kind === "folder") current.session?.cancel(); batch(() => { action.value = null; dialogError.value = null; }); };
  const folderTree = (all: readonly AssetFolder[], records: readonly AssetSummary[], parentId: string | null): OutlineNode[] => all.filter((folder) => folder.parentId === parentId).map((folder) => ({ id: folder.id, kind: "group", title: folder.name, count: records.filter((record) => record.state === "active" && record.folderId === folder.id).length, children: folderTree(all, records, folder.id) }));
  const nodes = computed(() => folderTree(activeFolders.value, state.value.records, null));
  const newFolder = () => { const snapshot = state.value.snapshot; if (!snapshot) return; const parent = folderId.value; open({ kind: "folder", parentId: parent, index: activeFolders.value.filter((folder) => folder.parentId === parent).length, token: snapshot.mutationToken }); };
  const replace = (record: AssetSummary) => { replaceTarget = record; replaceInput.current?.click(); };
  const openEditor = (record: AssetSummary) => {
    if (record.state !== "active" || !isEditableImage(record) || editingBlocked.value) return;
    // AssetSummary is a detached, flat snapshot. Capture it at the opening
    // gesture so a later refresh cannot silently move the editor to another
    // immutable version or revision.
    editorRecord.value = { ...record };
  };
  const recordMenu = (record: AssetSummary): Child => {
    const imageAction: RowMenuAction | null = record.mimeType.startsWith("image/") ? {
      id: "edit-image",
      label: record.mimeType === "image/gif" ? "Edit image… (GIF editing is not supported)" : "Edit image…",
      disabled: record.mimeType === "image/gif" || !isEditableImage(record) ? true : editingBlocked,
      onSelect: () => openEditor(record),
    } : null;
    const actions: RowMenuAction[] = record.state === "trash" ? [{ id: "restore", label: "Restore", disabled: computed(() => !can("restore") || busy.value), onSelect: () => run(() => controller.restore([record])) }] : [
      { id: "move", label: "Move to…", disabled: computed(() => !writable.value || busy.value), onSelect: () => open({ kind: "move", records: [record] }) },
      { id: "replace", label: "Replace file…", disabled: computed(() => !can("replace") || busy.value), onSelect: () => replace(record) },
      ...(imageAction ? [imageAction] : []),
      { id: "copy", label: "Copy authoring URL", onSelect: () => run(() => controller.copyUrl(record)) },
      { id: "copy-markdown", label: "Copy Markdown", onSelect: () => run(() => controller.copyMarkdown(record)) },
    ];
    return <RowMenu label={record.fileName} open={{ id: "inspect", label: "Inspect", onSelect: () => { activeId.value = record.id; } }} actions={actions} destructive={record.state === "active" ? [{ id: "trash", label: "Move to trash…", disabled: computed(() => !can("trash") || busy.value), onSelect: () => open({ kind: "trash", records: [record] }) }] : []} />;
  };
  const findFolder = (id: string) => folders.value.find((item) => item.id === id)!;
  const notice = computed(() => state.value.notice);
  const failure = computed(() => (state.value.phase === "error" || state.value.phase === "recovery" ? `${state.value.errorMessage ?? state.value.recoveryMessage} Source and retained versions are preserved.` : null));
  // The type select's options carry live counts, and a select takes only
  // static options: it is rebuilt whenever its option set changes. The current
  // type always stays among the options, so a rebuilt select starts valid.
  const typeOptions = computed(() => [[
    { value: "all", label: `All types (${scopedRecords.value.length})` },
    ...Object.entries(ASSET_KIND_LABELS).flatMap(([kind, label]) => { const count = scopedRecords.value.filter((record) => assetKindForMime(record.mimeType)?.kind === kind).length; return count || type.value === kind ? [{ value: kind, label: `${label} (${count})` }] : []; }),
  ]]);
  const emptyText = computed(() => (search.value || type.value !== "all" ? "No assets match these filters." : scope.value === "trash" ? "Trash is empty." : "No assets in this location. Upload a file to get started."));
  const inTrash = computed(() => scope.value === "trash");
  const actionKey = objectIdentity<Action>();
  const editorKey = (record: AssetSummary | null) => (record ? `${record.id}:${record.revision}:${record.versionId}` : "none");
  const activeKey = computed(() => activeId.value ?? "empty");
  return <LibraryPage class="sg-assets-route" title="Assets" icon={FolderIcon} purpose="Organize reusable files, inspect their uses, and connect them to content." primaryAction={<Button variant="primary" disabled={computed(() => !canUpload.value || busy.value || upload.state.value.busy)} on:click={upload.openPicker}><UploadIcon size="sm" /> Upload</Button>} actions={<Button disabled={computed(() => !writable.value || busy.value)} on:click={newFolder}>New folder</Button>}>
    {!controller.store ? <Banner tone="info">This provider is read-only. Folder editing, uploads, replacement and trash are unavailable.</Banner> : null}
    <Show when={computed(() => Boolean(intentError.value))}>{() => <Banner tone="err" action={<Button disabled={busy} on:click={() => run(async () => { await controller.reload(); intentRetry.value += 1; })}>Retry asset link</Button>}>{computed(() => intentError.value ?? "")}</Banner>}</Show>
    {liveSlot(computed((): Child => { const current = notice.value; return current ? <Banner tone={current.tone === "err" ? "err" : "info"} action={current.tone === "err" ? <Button disabled={busy} on:click={() => run(() => controller.reload())}>Reload current state</Button> : undefined}>{current.text}</Banner> : null; }))}
    <Show when={computed(() => failure.value !== null)}>{() => <Banner tone="err" action={<Button on:click={() => run(() => controller.retryInitialization())}>Retry loading</Button>}>{computed(() => failure.value ?? "")}</Banner>}</Show>
    <Show when={busy}>{() => <p role="status">{computed(() => `${state.value.operation} in progress…`)}</p>}</Show>
    <div class="sg-assets-workspace" aria-busy={computed(() => state.value.phase === "loading")}>
      <aside class="sg-assets-folders" aria-label="Asset folders">
        <p class="sg-assets-kicker">Library</p>
        <Button variant="ghost" aria-pressed={computed(() => scope.value === "all")} on:click={() => chooseScope("all")}>All assets <span>{computed(() => String(state.value.records.filter((record) => record.state === "active").length))}</span></Button>
        <Button variant="ghost" aria-pressed={computed(() => typeof scope.value === "object" && scope.value.folderId === null)} on:click={() => chooseScope({ folderId: null })}>Unfiled</Button>
        <Button variant="ghost" aria-pressed={inTrash} on:click={() => chooseScope("trash")}>Trash <span>{computed(() => String(state.value.records.filter((record) => record.state === "trash").length))}</span></Button>
        <p class="sg-assets-kicker">Folders</p>
        <OutlineTree label="Folder outline" nodes={nodes} selectedId={computed(() => folderId.value ?? undefined)} onSelect={(id) => chooseScope({ folderId: id })}
          canInsert={() => (writable.value && !busy.value) || (busy.value && !state.value.uncertain && action.value?.kind === "folder" && action.value.session !== undefined)}
          onRequestInsert={(target, session) => { open({ kind: "folder", ...target, token: state.value.snapshot!.mutationToken, session }); }}
          onRename={(id, name) => { const folder = findFolder(id); run(() => controller.updateFolder(id, { name }, folder.revision, state.value.snapshot!.mutationToken)); }}
          canRename={() => writable.value && !busy.value} addLabel={() => "Add folder"} prefKey="asset-folders"
          renderActions={(node) => { const name = findFolder(node.id).name; const locked = computed(() => !writable.value || busy.value); return <RowMenu label={name} actions={[{ id: "edit", label: "Rename or move folder…", disabled: locked, onSelect: () => { const folder = findFolder(node.id); open({ kind: "folder", folder, parentId: folder.parentId, index: activeFolders.value.filter((item) => item.parentId === folder.parentId).findIndex((item) => item.id === folder.id), token: state.value.snapshot!.mutationToken }); } }]} destructive={[{ id: "trash", label: "Trash empty folder", disabled: locked, onSelect: () => { const folder = findFolder(node.id); run(() => controller.changeFolderState(folder.id, folder.revision, false)); } }]} />; }} />
        <Show when={inTrash}>{() => <section><p class="sg-assets-kicker">Trashed folders</p><For each={computed(() => folders.value.filter((folder) => folder.state === "trash"))} by={(folder) => folder.id}>{(folder) => <div>{computed(() => folder.value.name)} <Button size="sm" disabled={computed(() => !writable.value || busy.value)} on:click={() => { const current = folder.value; run(() => controller.changeFolderState(current.id, current.revision, true)); }}>Restore folder</Button></div>}</For></section>}</Show>
        <small class="sg-assets-folder-note">Assets are global. Metadata changes retain stable asset IDs and all byte versions.</small>
      </aside>
      <section class="sg-assets-content" aria-label="Assets library">
        <header class="sg-assets-content-header"><strong>{scopeName}</strong><SegmentedControl label="Assets view" value={view} options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} onChange={(value) => { view.value = value; try { localStorage.setItem("zudo-composer.assets.view", value); } catch { /* Optional preference. */ } }} /></header>
        <div class="sg-assets-tools">
          <Input type="search" aria-label="Search assets" placeholder="Search files, folders or notes…" modelValue={search} />
          <For each={typeOptions} by={(options) => JSON.stringify(options)}>{(options) => { const model = signal(type.value); return <Select aria-label="Asset type" modelValue={model} on:change={(event) => { type.value = event.currentTarget.value; }}>{options.value.map((option) => <option value={option.value}>{option.label}</option>)}</Select>; }}</For>
          <Select aria-label="Sort assets" modelValue={sort}><option value="name">Name A–Z</option><option value="updated">Recently updated</option><option value="size">Largest first</option></Select>
        </div>
        <div class="sg-assets-selection"><Checkbox aria-label="Select all visible assets" checked={computed(() => rows.value.length > 0 && rows.value.every(({ id }) => selected.value.has(id)))} onCheckedChange={(checked) => setSelected((prior) => { const next = new Set(prior); for (const { id } of rows.value) { if (checked) next.add(id); else next.delete(id); } return next; })} /><span>{computed(() => `${chosen.value.length} selected`)}</span><Button size="sm" disabled={computed(() => !chosen.value.length)} on:click={() => setSelected(new Set())}>Clear</Button>
          <Show when={inTrash} fallback={() => <><Button size="sm" disabled={computed(() => !chosen.value.length || !writable.value || busy.value)} on:click={() => open({ kind: "move", records: chosen.value })}>Move to…</Button><Button size="sm" disabled={computed(() => !chosen.value.length || !can("trash") || busy.value)} on:click={() => open({ kind: "trash", records: chosen.value })}>Trash…</Button></>}>
            {() => <Button size="sm" disabled={computed(() => !chosen.value.length || !can("restore") || busy.value)} on:click={() => run(() => controller.restore(chosen.value))}>Restore selected</Button>}
          </Show>
        </div>
        <Show when={canUpload}>{() => <AssetUploadPanel controller={upload} />}</Show>
        <div class="sg-assets-assets">
          <Show when={computed(() => state.value.phase === "loading")} fallback={() => (
            <Show when={computed(() => rows.value.length === 0)} fallback={() => (
              <Show when={computed(() => view.value === "grid")} fallback={() => <DataTable<AssetSummary> caption="Assets" rows={rows} rowKey={(record) => record.id} columns={[{ key: "name", header: "Name", cell: (record) => <Button variant="ghost" on:click={() => { activeId.value = record.id; }}>{record.fileName}</Button> }, { key: "type", header: "Type", cell: (record) => assetTypeLabel(record.mimeType) }, { key: "size", header: "Size", cell: (record) => formatBytes(record.byteLength) }, { key: "actions", header: "Actions", cell: recordMenu }]} selection={{ selectedIds: selected, onToggleRow: toggle, onToggleAll: (checked) => setSelected(checked ? new Set(rows.value.map(({ id }) => id)) : new Set()), rowLabel: (record) => record.fileName }} />}>
                {() => <div class="sg-assets-grid"><For each={rows} by={(record) => record.id}>{(item) => <AssetView record={item}>{(record) => <AssetTile record={record} folders={folders} selected={computed(() => selected.value.has(record.id))} dimensions={dimensions} menu={recordMenu(record)} onToggle={(checked) => toggle(record.id, checked)} onInspect={() => { batch(() => { activeId.value = record.id; setSelected(new Set([record.id])); }); }} />}</AssetView>}</For></div>}
              </Show>
            )}>{() => <p class="sg-assets-empty">{emptyText}</p>}</Show>
          )}>{() => <p role="status">Loading assets…</p>}</Show>
        </div><footer class="sg-assets-library-footer">{computed(() => `${rows.value.length} visible · ${state.value.records.length} in library `)}<Button size="sm" disabled={busy} on:click={() => run(() => controller.reload())}>Refresh</Button></footer>
      </section>
      <Keyed value={activeKey} by={(key) => key}>{() => <AssetInspector previewUrl={provider.previewUrl} record={active} state={state} controller={controller} dimensions={dimensions} usageHref={usageHref} onClose={() => { activeId.value = null; }} onPreview={(record) => open({ kind: "preview", record })} onUse={(record) => open({ kind: "use", record })} onMove={(record) => open({ kind: "move", records: [record] })} onReplace={replace} onEdit={openEditor} onTrash={(record) => open({ kind: "trash", records: [record] })} run={run} />}</Keyed>
    </div>
    <input ref={replaceInput} class="sg-assets-upload__input" aria-label="Replacement file" type="file" accept={ASSET_ACCEPT} on:change={(event) => { const input = event.currentTarget; const file = input.files?.[0]; input.value = ""; const target = replaceTarget; if (file && target) run(() => controller.replace(target, file)); }} />
    <Keyed value={action} by={actionKey}>{(current) => current.value ? <AssetActionDialog previewUrl={provider.previewUrl} action={current.value} state={state} controller={controller} folders={folders} error={dialogError} close={close} run={run} usageHref={usageHref} /> : null}</Keyed>
    <Keyed value={editorRecord} by={editorKey}>{(current) => {
      const record = current.value;
      if (!record) return null;
      return <ImageEditorDialog
        record={record}
        dimensions={dimensions}
        previewUrl={provider.previewUrl}
        canSaveCopy={controller.canSaveEditedImageCopy()}
        onSave={(blob, mode) => controller.saveEditedImage(record, blob, { mode })}
        onSaved={(saved) => {
          const id = saved?.id ?? record.id;
          batch(() => { activeId.value = id; setSelected(new Set([id])); });
        }}
        onClose={() => { batch(() => { editorRecord.value = null; dialogError.value = null; }); }}
      />;
    }}</Keyed>
  </LibraryPage>;
}

function AssetTile({ record, folders, selected, dimensions, menu, onToggle, onInspect }: { record: AssetSummary; folders: ReadonlySignal<readonly AssetFolder[]>; selected: ReadonlySignal<boolean>; dimensions: AssetDimensionStore; menu: Child; onToggle(checked: boolean): void; onInspect(): void }): Child {
  return <article class={computed(() => `sg-assets-tile${selected.value ? " sg-assets-tile--selected" : ""}`)}><div class="sg-assets-tile-tools"><Checkbox aria-label={`Select ${record.fileName}`} checked={selected} onCheckedChange={onToggle} />{menu}</div><button class="sg-assets-tile-open" aria-label={`Inspect ${record.fileName}`} on:click={onInspect}><span class="sg-assets-tile-art"><AssetThumb record={record} dimensions={dimensions} /></span><strong>{record.fileName}</strong><small>{assetTypeLabel(record.mimeType)} · {formatBytes(record.byteLength)}</small><small>{computed(() => assetFolderPath(folders.value, record.folderId).join(" / ") || "Unfiled")}</small></button></article>;
}

interface AssetInspectorProps {
  previewUrl?: (url: string) => string; record: ReadonlySignal<AssetSummary | null>; state: ReadonlySignal<AssetLibraryState>; controller: AssetLibraryController; dimensions: AssetDimensionStore; usageHref?: (location: AssetContentLocation) => string;
  onClose(): void; onPreview(record: AssetSummary): void; onUse(record: AssetSummary): void; onMove(record: AssetSummary): void; onReplace(record: AssetSummary): void; onEdit(record: AssetSummary): void; onTrash(record: AssetSummary): void; run: Run;
}

/** Mounted per inspected asset id (the route keys it); `record` follows that asset's revisions. */
function AssetInspector({ previewUrl, record: recordSignal, state, controller, dimensions, usageHref, onClose, onPreview, onUse, onMove, onReplace, onEdit, onTrash, run }: AssetInspectorProps): Child {
  const initial = recordSignal.value;
  if (!initial) return <aside class="sg-assets-inspector" aria-label="Asset details"><header><strong>Asset details</strong></header><p class="sg-assets-empty">Select an asset to inspect its file, metadata and Content uses.</p></aside>;
  const scope = getScope();
  const recordId = initial.id;
  // The id is fixed per mount; while the asset is still listed this follows its latest revision.
  let latest = initial;
  const record = computed(() => { const value = recordSignal.value; if (value) latest = value; return latest; });
  const name = signal(initial.fileName); const note = signal(initial.note);
  const draftBase = signal<AssetSummary>(initial);
  let draftBaseNow = initial;
  const setDraftBase = (value: AssetSummary) => { draftBaseNow = value; draftBase.value = value; };
  const revision = computed(() => record.value.revision);
  const generation = computed(() => state.value.generation);
  // Advance the committed base before another input event can author a draft.
  scope.effect(() => {
    void revision.value; void generation.value;
    const current = latest;
    if (!controller.hasDraft(current.id)) batch(() => { name.value = current.fileName; note.value = current.note; setDraftBase(current); });
  });
  const scan = signal<AssetUsageScan | null>(null);
  const contentGeneration = signal(0);
  let scanEpoch = 0;
  scope.onActivate(() => controller.contentServices?.subscribeChanges(() => { scanEpoch++; batch(() => { scan.value = null; contentGeneration.value += 1; }); }));
  const mutationToken = computed(() => state.value.snapshot?.mutationToken);
  scope.effect(() => {
    void mutationToken.value; void contentGeneration.value;
    const epoch = ++scanEpoch;
    scan.value = null;
    void controller.scan(latest).then((value) => { if (scanEpoch === epoch) scan.value = value; });
    return () => { scanEpoch++; };
  });
  // `capability` reads the controller's plain state; reading the state signal first keeps every gate tracked.
  const can = (name: Parameters<AssetLibraryController["capability"]>[0]) => { void state.value; return controller.capability(name); };
  const busy = computed(() => state.value.busy);
  const isActive = computed(() => record.value.state === "active");
  const writable = computed(() => can("metadata") && isActive.value && !busy.value);
  const full = computed(() => state.value.snapshot?.records.find(({ id }) => id === recordId));
  const editorDisabled = computed(() => !isActive.value || !isEditableImage(record.value) || !can("replace") || state.value.phase !== "ready" || state.value.uncertain || busy.value);
  const gifHelpId = "sg-assets-gif-edit-help-" + recordId;
  const isImage = initial.mimeType.startsWith("image/");
  const isGif = initial.mimeType === "image/gif";
  const stale = computed(() => { void generation.value; return draftBase.value.revision !== record.value.revision && controller.hasDraft(recordId); });
  const hasDraft = computed(() => { void generation.value; return controller.hasDraft(recordId); });
  const usageText = (location: AssetUsageLocation) => location.use.kind === "image" ? location.use.alt || "Decorative image" : (location.use.kind === "link" || location.use.kind === "download") ? location.use.label : location.use.title;
  return <aside class="sg-assets-inspector" aria-label="Asset details">
    <header><strong>Asset details</strong><Button size="sm" on:click={onClose}>Close</Button></header>
    <button class="sg-assets-inspector-preview" on:click={() => onPreview(record.value)} aria-label={computed(() => "Preview " + record.value.fileName)}><AssetView record={record}>{(value) => <AssetThumb detail record={value} dimensions={dimensions} />}</AssetView></button>
    <div class="sg-assets-inspector-body">
      <h2>{computed(() => record.value.fileName)}</h2>
      <p>{computed(() => `${assetTypeLabel(record.value.mimeType)} · ${formatBytes(record.value.byteLength)} · Revision ${record.value.revision}`)}</p>
      <div class="sg-assets-actions"><Button variant="primary" disabled={computed(() => !controller.contentServices || state.value.phase !== "ready" || state.value.uncertain || busy.value || !isActive.value)} on:click={() => onUse(record.value)}>Use in content</Button><Button on:click={() => onPreview(record.value)}>Preview</Button></div>
      <p class="sg-assets-kicker">Location & identity</p>
      <code>{recordId}</code>
      <p>{computed(() => assetFolderPath(state.value.snapshot?.folders ?? [], record.value.folderId).join(" / ") || "Unfiled")}</p>
      <div class="sg-assets-actions"><Button size="sm" on:click={() => run(() => controller.copy(recordId))}>Copy ID</Button><Button size="sm" on:click={() => run(() => controller.copyUrl(record.value))}>Copy authoring URL</Button><Button size="sm" on:click={() => run(() => controller.copyMarkdown(record.value))}>Copy Markdown</Button><Button size="sm" disabled={computed(() => !writable.value)} on:click={() => onMove(record.value)}>Move</Button></div>
      <Field label="Asset name">{(field) => <Input field={field} modelValue={name} disabled={computed(() => !writable.value)} on:input={(event) => { controller.draftMetadata(draftBaseNow, { fileName: event.currentTarget.value }); }} />}</Field>
      <Field label="Internal note" help="A library note, not alternative text for a Content usage.">{(field) => <Textarea field={field} modelValue={note} disabled={computed(() => !writable.value)} on:input={(event) => { controller.draftMetadata(draftBaseNow, { note: event.currentTarget.value }); }} />}</Field>
      <Button disabled={computed(() => !writable.value)} on:click={() => run(async () => { controller.draftMetadata(draftBaseNow, { fileName: name.value, note: note.value }); await controller.saveDraft(recordId); })}>Save details</Button>
      <Show when={stale}>{() => <Banner tone="warn">This asset changed since editing began. Your text is retained; discard it to load current details before reapplying.</Banner>}</Show>
      <Button size="sm" disabled={computed(() => busy.value || state.value.uncertain || !hasDraft.value)} on:click={() => { controller.discardDraft(recordId); const current = record.value; batch(() => { name.value = current.fileName; note.value = current.note; setDraftBase(current); }); }}>Discard unsaved details</Button>
      <section>
        <p class="sg-assets-kicker">Used by</p>
        <Rebuild value={scan}>{(current) => !current ? <p role="status">Checking structured Content uses…</p> : <><p>{current.message}</p>{current.locations.map((location) => <div class="sg-assets-usage">{usageHref ? <a href={usageHref(location)}>{location.entryTitle}</a> : <strong>{location.entryTitle}</strong>}<small>{location.modelName} · {location.fieldLabel} · {location.valuePath.join(" / ")}</small><small>{usageText(location)}</small></div>)}{current.additionalLocations?.map(({ location, href }) => <div class="sg-assets-usage">{href ? <a href={href}>{location.domain} / {location.sourceRecordId ?? location.recordId}</a> : <strong>{location.recordId}</strong>}<small>{location.fieldId ?? location.nodeId} · {location.property} · {location.pathname}</small></div>)}</>}</Rebuild>
      </section>
      <section>
        <p class="sg-assets-kicker">Immutable versions</p>
        <Rebuild value={full}>{(current) => current?.document.versions.map((version) => <p><a href={previewUrl?.(version.url) ?? version.url} target="_blank" rel="noreferrer">{version.id.slice(0, 12)}</a> · {version.id === current.document.currentVersionId ? "Latest" : "Historical pin"} · {formatBytes(version.byteLength)}</p>) ?? null}</Rebuild>
      </section>
      <div class="sg-assets-actions">
        <Show when={isActive} fallback={() => <Button disabled={computed(() => !can("restore") || busy.value)} on:click={() => run(() => controller.restore([record.value]))}>Restore asset</Button>}>{() => <>
          {isImage ? <>
            <Button disabled={editorDisabled} title={isGif ? "GIF editing is not supported" : undefined} aria-describedby={isGif ? gifHelpId : undefined} on:click={() => onEdit(record.value)}>Edit image…</Button>
            {isGif ? <span id={gifHelpId} class="sg-assets-visually-hidden">GIF editing is not supported</span> : null}
          </> : null}
          <Button disabled={computed(() => !can("replace") || busy.value)} on:click={() => onReplace(record.value)}>Replace file</Button>
          <Button disabled={computed(() => !can("trash") || busy.value)} on:click={() => onTrash(record.value)}>Trash…</Button>
        </>}</Show>
      </div>
    </div>
  </aside>;
}

interface AssetActionDialogProps { previewUrl?: (url: string) => string; action: Action; state: ReadonlySignal<AssetLibraryState>; controller: AssetLibraryController; folders: ReadonlySignal<readonly AssetFolder[]>; error: ReadonlySignal<string | null>; close(): void; run: Run; usageHref?: (location: AssetContentLocation) => string }

/** Mounted once per opened action (the route keys it by the action object). */
function AssetActionDialog({ previewUrl, action, state, controller, folders, error, close, run, usageHref }: AssetActionDialogProps): Child {
  if (action.kind === "use") return <AssetUsePicker record={action.record} controller={controller} onClose={close} />;
  if (action.kind === "preview") return <Dialog open title={action.record.fileName} size="wide" onClose={close}><div class="sg-assets-preview-stage">{action.record.mimeType.startsWith("image/") ? <img src={action.record.url} alt={action.record.fileName} /> : action.record.mimeType === "application/pdf" ? <iframe title={`PDF preview: ${action.record.fileName}`} src={previewUrl?.(action.record.url) ?? action.record.url} /> : <section class="sg-assets-download-card"><strong>{action.record.fileName}</strong><span>{assetTypeLabel(action.record.mimeType)} · {formatBytes(action.record.byteLength)}</span><a aria-label="Download" href={previewUrl?.(action.record.url) ?? action.record.url} download={assetDownloadFileName(action.record.fileName, action.record.mimeType)} on:click={(event) => { void downloadAsset(event, ASSET_MAX_BYTE_LENGTH); }}>Download</a></section>}</div><a href={previewUrl?.(action.record.url) ?? action.record.url} target="_blank" rel="noreferrer">Open exact immutable version</a></Dialog>;
  const scope = getScope();
  const editing = action.kind === "folder" ? action.folder : undefined;
  const name = signal(action.kind === "folder" ? action.folder?.name ?? "" : "");
  const destination = signal(action.kind === "folder" ? action.parentId ?? "" : "");
  // The sibling position is a numeric draft: `null` while the text is not a number, which blocks Save.
  const index = signal<number | null>(action.kind === "folder" ? action.index : 0);
  const indexInput: Ref<HTMLInputElement> = { current: null };
  const scans = signal<readonly AssetUsageScan[] | null>(null);
  const usageGeneration = signal(0);
  let usageEpoch = 0;
  if (action.kind === "trash") {
    const records = action.records;
    scope.onActivate(() => controller.contentServices?.subscribeChanges(() => { usageEpoch++; batch(() => { scans.value = null; usageGeneration.value += 1; }); }));
    scope.effect(() => {
      void usageGeneration.value;
      const epoch = ++usageEpoch;
      void Promise.all(records.map((record) => controller.scan(record))).then((value) => { if (usageEpoch === epoch) scans.value = value; });
      return () => { usageEpoch++; };
    });
  }
  const blocked = computed(() => !scans.value || scans.value.some((scan) => scan.status !== "complete" || scan.locations.length > 0 || (scan.additionalLocations?.length ?? 0) > 0));
  const parents = computed(() => folders.value.filter((folder) => folder.state === "active" && folder.id !== editing?.id));
  // Destination options follow the folder list; the select is rebuilt per option set.
  const destinationOptions = computed(() => [parents.value.map((folder) => ({ value: folder.id, label: assetFolderPath(folders.value, folder.id).join(" / ") }))]);
  const chooseDestination = (value: string) => {
    const next = folders.value.filter((folder) => folder.parentId === (value || null) && folder.state === "active" && folder.id !== editing?.id).length;
    batch(() => { destination.value = value; index.value = next; });
    // A numeric input has no model: write the recomputed position back explicitly.
    if (indexInput.current) indexInput.current.value = String(next);
  };
  const destinationSelect = <Field label="Destination folder">{(field) => <For each={destinationOptions} by={(options) => JSON.stringify(options)}>{(options) => {
    const valid = destination.value === "" || options.value.some((option) => option.value === destination.value);
    const model = signal(valid ? destination.value : "");
    return <Select field={field} modelValue={model} on:change={(event) => chooseDestination(event.currentTarget.value)}><option value="">Unfiled / root</option>{options.value.map((option) => <option value={option.value}>{option.label}</option>)}</Select>;
  }}</For>}</Field>;
  const submit = () => run(async () => {
    if (action.kind === "folder") {
      const position = index.value;
      const target = action.session ? action.session.resolveTarget() : position === null ? null : { parentId: destination.value || null, index: position };
      if (!target) throw new Error("The folder insertion point changed. Reopen the insertion control.");
      if (action.folder) await controller.updateFolder(action.folder.id, { name: name.value, parentId: target.parentId, index: target.index }, action.folder.revision, action.token);
      else { const folder = await controller.createFolder(name.value, target.parentId, target.index, action.token); action.session?.complete(folder.id); }
    } else if (action.kind === "move") await controller.move(action.records, destination.value || null);
    else if (action.kind === "trash") await controller.trash(action.records);
    close();
  });
  const saveDisabled = computed(() => state.value.phase !== "ready" || state.value.uncertain || state.value.busy || (action.kind === "trash" && blocked.value) || (action.kind === "folder" && (!name.value.trim() || (!action.session && index.value === null))));
  const title = action.kind === "folder" ? action.folder ? "Edit folder" : "New folder" : action.kind === "move" ? "Move assets" : "Move assets to trash?";
  const body = (): Child => {
    if (action.kind === "folder") return <><Field label="Folder name">{(field) => <Input field={field} modelValue={name} />}</Field>{!action.session ? <>{destinationSelect}<Field label="Sibling position">{(field) => <Input field={field} elementRef={indexInput} type="number" min="0" value={String(action.index)} aria-invalid={computed(() => (index.value === null ? "true" : undefined))} on:input={(event) => { const input = event.currentTarget; const parsed = input.value.trim() === "" || input.validity.badInput ? Number.NaN : Number(input.value); index.value = Number.isFinite(parsed) ? parsed : null; }} />}</Field></> : <p>Insert at position {action.index + 1} in {assetFolderPath(folders.value, action.parentId).join(" / ") || "root"}.</p>}</>;
    if (action.kind === "move") return destinationSelect;
    const records = action.records;
    return <><p>Records and every byte version are retained. Restore is available from Trash.</p><Rebuild value={scans}>{(current) => !current ? <p role="status">Checking all selected assets…</p> : current.map((scan, position) => <section><strong>{records[position]?.fileName}</strong><p>{scan.message}</p>{scan.locations.map((location) => <p>{usageHref ? <a href={usageHref(location)}>{location.modelName} / {location.entryTitle} / {location.fieldLabel}</a> : `${location.modelName} / ${location.entryTitle} / ${location.fieldLabel}`}</p>)}{scan.additionalLocations?.map(({ location, href }) => <p>{href ? <a href={href}>{location.providerId} / {location.sourceRecordId ?? location.recordId}</a> : <strong>{location.providerId} / {location.sourceRecordId ?? location.recordId}</strong>}<span> · {location.domain} · {location.fieldId ?? location.nodeId} · {location.valuePath.join(" / ")} {location.pathname}{location.markdown ? ` · Markdown ${location.markdown.from}–${location.markdown.to}` : ""}</span></p>)}</section>)}</Rebuild><Show when={blocked}>{() => <p>Trash is blocked until every authoritative scan is complete and no active project uses remain.</p>}</Show></>;
  };
  return <Dialog open title={title} onClose={close} dismissOnBackdrop={false} footer={<><Button disabled={computed(() => state.value.busy)} on:click={close}>Cancel</Button><Button variant="primary" disabled={saveDisabled} on:click={submit}>{action.kind === "trash" ? "Move to trash" : "Save"}</Button></>}>
    <Show when={computed(() => Boolean(error.value))}>{() => <Banner tone="err">{computed(() => error.value ?? "")}</Banner>}</Show>
    {body()}
  </Dialog>;
}
