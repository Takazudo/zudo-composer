import type { JSX } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { ASSET_ACCEPT, ASSET_MAX_BYTE_LENGTH, ASSET_TYPES, ASSET_UPLOAD_HINT, assetFolderPath, assetKindForMime, summarizeAsset, type AssetFolder, type AssetProvider, type AssetSummary } from "../../assets";
import type { AssetUse } from "../../assets/integration/content";
import type { ContentAssetRef } from "../../content";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, FolderIcon, GridIcon, ListIcon, SearchIcon, UploadIcon, XMarkIcon } from "../../components/icons";
import { Dialog } from "../../components/overlay";
import { Banner, Button, Chip, Input, SegmentedControl, Select } from "../../components/ui";
import { nextEscapeAction, useAssetPickerPanes } from "./asset-picker-panes";
import { useAssetDimensions, type AssetDimensionStore } from "./assets-dimensions";
import { assetTypeLabel, formatBytes, formatPixelSize, isAssetImage } from "./assets-format";
import { ASSET_SORTS, ASSET_TYPE_FACET } from "./assets-library";
import { AssetThumb } from "./assets-thumb";
import { versionedAssetStore } from "./controller";
import { normalizedFilesFromTransfer } from "./upload-input";

export interface AssetPickerDialogProps {
  provider?: AssetProvider;
  kind: AssetUse["kind"];
  current?: ContentAssetRef;
  intent?: "upload";
  onSelect(value: AssetUse): void | Promise<void>;
  onClose(): void;
}

const PICKER_SORTS = [
  { id: "name", label: "Name A–Z" },
  { id: "newest", label: "Newest" },
  { id: "size", label: "Largest first" },
].map((sort) => ({ ...sort, compare: ASSET_SORTS.find(({ id }) => id === sort.id)!.compare }));

const IMAGE_ASSET_TYPES = ASSET_TYPES.filter((mimeType) => mimeType.startsWith("image/"));
const IMAGE_ASSET_ACCEPT = IMAGE_ASSET_TYPES.join(",");
const IMAGE_ASSET_HINT = IMAGE_ASSET_TYPES.map(assetTypeLabel).join(", ");

function freshUse(kind: AssetUse["kind"], providerId: string, record: AssetSummary): AssetUse {
  const asset = { providerId, assetId: record.id };
  switch (kind) {
    case "image": return { kind, asset, alt: "", decorative: false, caption: "" };
    case "link": return { kind, asset, label: record.fileName };
    case "download": return { kind, asset, label: record.fileName, showSize: true, showType: true };
    case "card": return { kind, asset, title: record.fileName, description: "" };
  }
}

function assetMeta(record: AssetSummary, dimensions: AssetDimensionStore): string {
  const pixels = dimensions.get(record.versionId);
  return [assetTypeLabel(record.mimeType), formatBytes(record.byteLength), pixels ? formatPixelSize(pixels) : undefined].filter(Boolean).join(" · ");
}

export function AssetPickerDialog({ provider, kind, current, intent, onSelect, onClose }: AssetPickerDialogProps): JSX.Element {
  const [records, setRecords] = useState<readonly AssetSummary[]>([]);
  const [folders, setFolders] = useState<readonly AssetFolder[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("name");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState(Boolean(provider));
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const uploading = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrollAfterUpload = useRef<string | null>(null);
  const libraryRequest = useRef(0);
  const dimensions = useAssetDimensions();
  const panes = useAssetPickerPanes();
  const id = useId();
  const sideId = `sg-assets-picker-library-${id}`;
  const detailId = `sg-assets-picker-details-${id}`;
  const title = kind === "image" ? "Choose an image" : "Choose an asset";
  const uploadStore = provider ? versionedAssetStore(provider) : undefined;
  const canUpload = uploadStore?.capabilities.replace === true && typeof uploadStore.upload === "function";
  const uploadAccept = kind === "image" ? IMAGE_ASSET_ACCEPT : ASSET_ACCEPT;
  const uploadHint = kind === "image" ? IMAGE_ASSET_HINT : ASSET_UPLOAD_HINT;

  async function refreshLibrary(selectId?: string): Promise<readonly AssetSummary[]> {
    if (!provider) return [];
    const request = ++libraryRequest.current;
    setLoading(true);
    try {
      const store = versionedAssetStore(provider);
      const [listed, snapshot] = await Promise.all([provider.store.list(), store?.snapshot()]);
      if (request !== libraryRequest.current) return [];
      const available = listed.filter((record) => record.state === "active" && (kind !== "image" || isAssetImage(record)));
      const mapped = available.map((record) => ({ ...record, url: provider.previewUrl?.(record.url) ?? record.url }));
      setRecords(mapped);
      setFolders(snapshot?.folders ?? null);
      if (selectId !== undefined && mapped.some(({ id: recordId }) => recordId === selectId)) setSelectedId(selectId);
      return mapped;
    } finally {
      if (request === libraryRequest.current) setLoading(false);
    }
  }

  function uploadValidationError(file: File): string | null {
    if (file.size > ASSET_MAX_BYTE_LENGTH) return `Upload exceeds the ${formatBytes(ASSET_MAX_BYTE_LENGTH)} limit. Choose a smaller file.`;
    const declaredMimeType = file.type.split(";", 1)[0]?.trim().toLowerCase();
    const descriptor = declaredMimeType ? assetKindForMime(declaredMimeType) : undefined;
    if (kind === "image" && descriptor && descriptor.kind !== "image") return "Choose an image file for this picker.";
    return null;
  }

  async function uploadFile(file: File): Promise<void> {
    if (!canUpload || !uploadStore || uploading.current || submitting.current) return;
    const validationError = uploadValidationError(file);
    if (validationError) { setError(validationError); return; }
    uploading.current = true;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadStore.upload(file, { folderId: scope === "all" || scope === "unfiled" ? null : scope });
      scrollAfterUpload.current = uploaded.id;
      await refreshLibrary(uploaded.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This file could not be uploaded. Try again.");
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    let live = true;
    const request = ++libraryRequest.current;
    setRecords([]); setFolders(null); setSelectedId(""); setScope("all"); setError(null);
    setLoading(Boolean(provider));
    if (provider) {
      const store = versionedAssetStore(provider);
      void Promise.all([provider.store.list(), store?.snapshot()]).then(([listed, snapshot]) => {
        if (!live || request !== libraryRequest.current) return;
        const available = listed.filter((record) => record.state === "active" && (kind !== "image" || isAssetImage(record)));
        setRecords(available.map((record) => ({ ...record, url: provider.previewUrl?.(record.url) ?? record.url })));
        setFolders(snapshot?.folders ?? null);
        setSelectedId(current?.providerId === provider.descriptor.id && available.some(({ id }) => id === current.assetId) ? current.assetId : "");
      }).catch((reason: unknown) => {
        if (live && request === libraryRequest.current) setError(reason instanceof Error ? reason.message : "The Assets library could not be loaded.");
      }).finally(() => { if (live && request === libraryRequest.current) setLoading(false); });
    }
    return () => { live = false; };
  }, [provider, kind, current?.providerId, current?.assetId]);

  useEffect(() => {
    if (intent === "upload" && canUpload) uploadInputRef.current?.click();
  }, [canUpload, intent]);

  useEffect(() => {
    const idToScroll = scrollAfterUpload.current;
    if (idToScroll === null || idToScroll !== selectedId) return;
    itemRefs.current.get(idToScroll)?.scrollIntoView?.({ block: "nearest" });
    scrollAfterUpload.current = null;
  }, [records, selectedId]);

  const selected = records.find(({ id }) => id === selectedId);
  const isCurrent = (record: AssetSummary) => current?.providerId === provider?.descriptor.id && current?.assetId === record.id;
  const folderItems = (folders ?? []).filter((folder) => folder.state === "active").map((folder) => ({ folder, path: assetFolderPath(folders ?? [], folder.id) }))
    .sort((a, b) => a.path.join("/").localeCompare(b.path.join("/")));
  const scopeLabel = scope === "all" ? "All assets" : scope === "unfiled" ? "Unfiled" : folderItems.find(({ folder }) => folder.id === scope)?.path.join(" / ") ?? "Folder";
  const typeFacet = ASSET_TYPE_FACET.options.find(({ id }) => id === type);
  const query = search.trim().toLocaleLowerCase();
  const visible = records.filter((record) => (scope === "all" || (scope === "unfiled" ? record.folderId === null : record.folderId === scope))
    && `${record.fileName} ${record.note}`.toLocaleLowerCase().includes(query)
    && (kind === "image" || !typeFacet?.match || typeFacet.match(record)))
    .sort(PICKER_SORTS.find(({ id }) => id === sort)?.compare);

  async function useSelection(record: AssetSummary | undefined = selected) {
    if (!provider || !record || submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      const loaded = await provider.store.get(record.id);
      if (loaded.status !== "loaded" || loaded.record.document.state !== "active") throw new Error("This asset is no longer available. Choose another asset.");
      const latest = summarizeAsset(loaded.record);
      if (kind === "image" && !isAssetImage(latest)) throw new Error("The selected asset is no longer an image.");
      await onSelect(freshUse(kind, provider.descriptor.id, latest));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This asset could not be selected. Try again.");
    } finally { submitting.current = false; setBusy(false); }
  }

  function chooseScope(value: string) {
    setScope(value);
    if (panes.tier.sideOverlay) panes.closeSide();
  }

  function handleUploadDragOver(event: JSX.TargetedDragEvent<HTMLElement>) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleUploadDragLeave(event: JSX.TargetedDragEvent<HTMLElement>) {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDragActive(false);
  }

  function handleUploadDrop(event: JSX.TargetedDragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer ? normalizedFilesFromTransfer(event.dataTransfer)[0] : undefined;
    if (file) void uploadFile(file);
  }

  function handleKeyDown(event: JSX.TargetedKeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      const action = nextEscapeAction({ ...panes.tier, sideOpen: panes.panes.side, detailOpen: panes.panes.detail });
      if (action === "dialog") return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "detail") panes.closeDetail();
      else panes.closeSide();
    } else if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey
      && event.target instanceof Element && !event.target.closest("button, select, textarea, [contenteditable=true]")) {
      event.preventDefault();
      void useSelection();
    }
  }

  const SideChevron = panes.panes.side ? ChevronLeftIcon : ChevronRightIcon;
  const DetailChevron = panes.tier.detailDrawer ? (panes.panes.detail ? ChevronDownIcon : ChevronUpIcon)
    : (panes.panes.detail ? ChevronRightIcon : ChevronLeftIcon);

  return (
    <Dialog open size="wide" label={title} class="sg-assets-picker-dialog" initialFocusRef={searchRef} onClose={onClose} dismissOnBackdrop={false}
      header={<header class="sg-assets-picker-header" onKeyDown={handleKeyDown}>
        <h2>{title}</h2><Chip>for {kind}</Chip>
        <Button variant="ghost" size="sm" iconOnly aria-label="Close" class="sg-assets-picker-close" onClick={onClose}><XMarkIcon size="sm" /></Button>
      </header>}>
      <div ref={panes.bodyRef} class="sg-assets-picker" data-side-open={panes.panes.side} data-detail-open={panes.panes.detail}
        style={{ "--sg-assets-picker-side-w": `${panes.panes.sideWidth}px` }} onKeyDown={handleKeyDown}>
        {!provider || error ? <div class="sg-assets-picker-notices">
          {!provider ? <Banner tone="info">The Assets library and upload authoring are available only under the local development server (<code>pnpm dev</code>). Committed files under <code>publicAssetsDir</code> are still served from <code>/uploaded-assets/</code>.</Banner> : null}
          {error ? <Banner tone="err">{error}</Banner> : null}
        </div> : null}
        <div class="sg-assets-picker-workspace">
          <aside ref={panes.sideRef} id={sideId} class="sg-assets-picker-library" aria-label="Library" inert={!panes.panes.side} aria-hidden={!panes.panes.side}>
            <h3>Library</h3>
            {canUpload ? <Button variant="ghost" class="sg-assets-picker-upload-action" disabled={busy} onClick={() => uploadInputRef.current?.click()}><UploadIcon size="sm" />Upload new file…</Button> : null}
            <Button variant="ghost" class="sg-assets-picker-facet" aria-pressed={scope === "all"} onClick={() => chooseScope("all")}><span>All assets</span>{" "}<span>{records.length}</span></Button>
            <Button variant="ghost" class="sg-assets-picker-facet" aria-pressed={scope === "unfiled"} onClick={() => chooseScope("unfiled")}><span>Unfiled</span>{" "}<span>{records.filter(({ folderId }) => folderId === null).length}</span></Button>
            {folders !== null ? <section class="sg-assets-picker-folders" aria-label="Folders">
              <h3>Folders</h3>
              {folderItems.map(({ folder, path }) => <Button key={folder.id} variant="ghost" class="sg-assets-picker-facet" aria-pressed={scope === folder.id}
                title={path.join(" / ")} style={{ "--sg-assets-picker-folder-depth": path.length - 1 }} onClick={() => chooseScope(folder.id)}>
                <FolderIcon size="sm" /><span class="sg-assets-picker-folder-name">{folder.name}</span>{" "}<span>{records.filter(({ folderId }) => folderId === folder.id).length}</span>
              </Button>)}
            </section> : null}
            <p class="sg-assets-picker-library-note">Assets are global. Metadata changes keep stable asset IDs and every byte version.</p>
          </aside>
          <div {...panes.separatorProps} class="sg-assets-picker-separator" aria-controls={sideId} />
          <section class="sg-assets-picker-main" aria-label="Choose from assets">
            <div class="sg-assets-picker-toolbar">
              <Input elementRef={searchRef} type="search" aria-label="Search assets" placeholder="Search assets" icon={SearchIcon} class="sg-assets-picker-search" value={search} onInput={(event) => setSearch(event.currentTarget.value)} />
              {kind !== "image" ? <Select aria-label="Asset type" value={type} onChange={(event) => setType(event.currentTarget.value)}>
                {ASSET_TYPE_FACET.options.map((option) => <option key={option.id} value={option.id}>{option.id === "all" ? "All types" : option.label}</option>)}
              </Select> : null}
              <Select aria-label="Sort assets" value={sort} onChange={(event) => setSort(event.currentTarget.value)}>
                {PICKER_SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </Select>
              <SegmentedControl label="Asset view" size="sm" value={view} onChange={setView} options={[
                { value: "grid", ariaLabel: "Grid view", icon: GridIcon },
                { value: "list", ariaLabel: "List view", icon: ListIcon },
              ]} />
            </div>
            <p class="sg-assets-picker-scope" role="status">{scopeLabel} · {visible.length} shown</p>
            {canUpload ? <div class={`sg-assets-picker-drop${dragActive ? " sg-assets-picker-drop--drag-active" : ""}`} onDragOver={handleUploadDragOver} onDragLeave={handleUploadDragLeave} onDrop={handleUploadDrop}>
              <UploadIcon size="sm" />
              <span>Drop a file here to upload and use it</span>
              <small>{` · ${uploadHint} · up to ${formatBytes(ASSET_MAX_BYTE_LENGTH)}`}</small>
            </div> : null}
            <div class="sg-assets-picker-results">
              {loading ? <p class="sg-assets-picker-empty" role="status">Loading assets…</p> : visible.length ? <ul class="sg-assets-picker-items" data-view={view} aria-label="Assets">
                {visible.map((record) => <li key={record.id}>
                  <button ref={(element) => { if (element) itemRefs.current.set(record.id, element); else itemRefs.current.delete(record.id); }} type="button" class="sg-assets-picker-item" aria-label={record.fileName} aria-pressed={selectedId === record.id} disabled={busy}
                    onClick={() => setSelectedId(record.id)} onDblClick={() => { setSelectedId(record.id); void useSelection(record); }}>
                    <span class="sg-assets-picker-thumb"><AssetThumb record={record} dimensions={dimensions} /></span>
                    <span class="sg-assets-picker-item-copy"><strong>{record.fileName}</strong><small>{assetMeta(record, dimensions)}</small></span>
                    {isCurrent(record) ? <Chip class="sg-assets-picker-current">Current</Chip> : null}
                    {selectedId === record.id ? <span class="sg-assets-picker-check"><CheckIcon size="sm" /></span> : null}
                  </button>
                </li>)}
              </ul> : <div class="sg-assets-picker-empty">
                <p>{query || type !== "all" ? "No assets match these filters." : "No assets in this location."}</p>
                {query || type !== "all" ? <Button onClick={() => { setSearch(""); setType("all"); searchRef.current?.focus(); }}>Clear search</Button> : null}
              </div>}
            </div>
          </section>
          <aside ref={panes.detailRef} id={detailId} class="sg-assets-picker-details" aria-label="Asset details" inert={!panes.panes.detail} aria-hidden={!panes.panes.detail} tabIndex={-1}>
            <h3>Asset details</h3>
            {selected ? <>
              <div class="sg-assets-picker-preview"><AssetThumb record={selected} dimensions={dimensions} detail /></div>
              <h4>{selected.fileName}</h4>
              <dl class="sg-assets-picker-facts">
                <div><dt>Type</dt><dd>{assetTypeLabel(selected.mimeType)} <span>({selected.mimeType})</span></dd></div>
                <div><dt>Size</dt><dd>{formatBytes(selected.byteLength)}</dd></div>
                <div><dt>Pixels</dt><dd>{dimensions.get(selected.versionId) ? formatPixelSize(dimensions.get(selected.versionId)!) : isAssetImage(selected) ? "Not decoded" : "—"}</dd></div>
                <div><dt>Uploaded</dt><dd><time dateTime={selected.createdAt}>{new Date(selected.createdAt).toLocaleString()}</time></dd></div>
                <div><dt>Asset ID</dt><dd><code>{selected.id}</code></dd></div>
                {selected.note.trim() ? <div><dt>Note</dt><dd>{selected.note}</dd></div> : null}
              </dl>
            </> : <p class="sg-assets-picker-detail-empty">Select an asset to see its details.</p>}
          </aside>
          <Button elementRef={panes.sideTabRef} iconOnly size="sm" class="sg-assets-picker-side-tab" aria-label={panes.panes.side ? "Hide library" : "Show library"}
            aria-expanded={panes.panes.side} aria-controls={sideId} onClick={panes.toggleSide}><SideChevron size="sm" /></Button>
          <Button elementRef={panes.detailTabRef} iconOnly size="sm" class="sg-assets-picker-detail-tab" aria-label={panes.panes.detail ? "Hide asset details" : "Show asset details"}
            aria-expanded={panes.panes.detail} aria-controls={detailId} onClick={panes.toggleDetail}><DetailChevron size="sm" /></Button>
        </div>
        <footer class="sg-assets-picker-footer">
          <div class="sg-assets-picker-selection">{selected ? <><span class="sg-assets-picker-selection-thumb"><AssetThumb record={selected} dimensions={dimensions} /></span><span>{selected.fileName}</span></> : "Nothing selected"}</div>
          <span class="sg-assets-picker-hints"><kbd>Enter</kbd> use · <kbd>Esc</kbd> close</span>
          <div class="sg-assets-picker-actions"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!selected} busy={busy} onClick={() => { void useSelection(); }}>
            {kind === "image" ? selected && isCurrent(selected) ? "Keep this image" : "Use this image" : "Use this asset"}
          </Button></div>
        </footer>
        {canUpload ? <input ref={uploadInputRef} class="sg-assets-picker-upload-input" aria-label="Upload new file" type="file" accept={uploadAccept} onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void uploadFile(file);
        }} /> : null}
      </div>
    </Dialog>
  );
}
