import { batch, computed, For, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import type { AppServices } from "../../app/services";
import { ASSET_ACCEPT, ASSET_MAX_BYTE_LENGTH, ASSET_TYPES, ASSET_UPLOAD_HINT, assetFolderPath, assetKindForMime, summarizeAsset, type AssetFolder, type AssetProvider, type AssetSummary } from "../../assets";
import type { AssetUse } from "../../assets/integration/content";
import type { ContentAssetRef } from "../../content";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, FolderIcon, GridIcon, ListIcon, SearchIcon, UploadIcon, XMarkIcon } from "../../components/icons";
import { Dialog } from "../../components/overlay";
import { Banner, Button, Chip, Input, SegmentedControl, Select } from "../../components/ui";
import { nextEscapeAction, createAssetPickerPanes } from "./asset-picker-panes";
import { createAssetDimensions, type AssetDimensionStore } from "./assets-dimensions";
import { assetTypeLabel, formatBytes, formatPixelSize, isAssetImage } from "./assets-format";
import { ASSET_SORTS, ASSET_TYPE_FACET } from "./assets-library";
import { AssetThumb } from "./assets-thumb";
import { versionedAssetStore } from "./controller";
import { normalizedFilesFromTransfer } from "./upload-input";
import { createDomId } from "../../components/use-dom-id";
import { AssetView, LiveIcon } from "./live";

export interface AssetPickerDialogProps {
  /** Passed by the shell with every field picker; the picker itself needs none of it. */
  services?: AppServices;
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

type DragOn = DragEvent & { currentTarget: HTMLElement };

export function AssetPickerDialog({ provider, kind, current, intent, onSelect, onClose }: AssetPickerDialogProps): Child {
  const scope = getScope();
  const records = signal<readonly AssetSummary[]>([]);
  const folders = signal<readonly AssetFolder[] | null>(null);
  const selectedId = signal("");
  const pickerScope = signal("all");
  const search = signal("");
  const type = signal("all");
  const sort = signal("name");
  const view = signal<"grid" | "list">("grid");
  const loading = signal(Boolean(provider));
  const busy = signal(false);
  const dragActive = signal(false);
  const error = signal<string | null>(null);
  let submitting = false;
  let uploading = false;
  const searchRef: Ref<HTMLInputElement> = { current: null };
  const uploadInputRef: Ref<HTMLInputElement> = { current: null };
  const itemRefs = new Map<string, HTMLButtonElement>();
  let scrollAfterUpload: string | null = null;
  let libraryRequest = 0;
  const dimensions = createAssetDimensions();
  const panes = createAssetPickerPanes();
  const id = createDomId();
  const sideId = `sg-assets-picker-library-${id}`;
  const detailId = `sg-assets-picker-details-${id}`;
  const title = kind === "image" ? "Choose an image" : "Choose an asset";
  const uploadStore = provider ? versionedAssetStore(provider) : undefined;
  const canUpload = uploadStore?.capabilities.replace === true && typeof uploadStore.upload === "function";
  const uploadAccept = kind === "image" ? IMAGE_ASSET_ACCEPT : ASSET_ACCEPT;
  const uploadHint = kind === "image" ? IMAGE_ASSET_HINT : ASSET_UPLOAD_HINT;
  const live = () => !scope.abortSignal.aborted;

  async function refreshLibrary(selectId?: string): Promise<readonly AssetSummary[]> {
    if (!provider) return [];
    const request = ++libraryRequest;
    loading.value = true;
    try {
      const store = versionedAssetStore(provider);
      const [listed, snapshot] = await Promise.all([provider.store.list(), store?.snapshot()]);
      if (!live() || request !== libraryRequest) return [];
      const available = listed.filter((record) => record.state === "active" && (kind !== "image" || isAssetImage(record)));
      const mapped = available.map((record) => ({ ...record, url: provider.previewUrl?.(record.url) ?? record.url }));
      batch(() => {
        records.value = mapped;
        folders.value = snapshot?.folders ?? null;
        if (selectId !== undefined && mapped.some(({ id: recordId }) => recordId === selectId)) selectedId.value = selectId;
      });
      return mapped;
    } finally {
      if (live() && request === libraryRequest) loading.value = false;
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
    if (!canUpload || !uploadStore || uploading || submitting) return;
    const validationError = uploadValidationError(file);
    if (validationError) { error.value = validationError; return; }
    uploading = true;
    busy.value = true;
    error.value = null;
    try {
      const folder = pickerScope.value;
      const uploaded = await uploadStore.upload(file, { folderId: folder === "all" || folder === "unfiled" ? null : folder });
      if (!live()) return;
      scrollAfterUpload = uploaded.id;
      await refreshLibrary(uploaded.id);
    } catch (reason) {
      if (live()) error.value = reason instanceof Error ? reason.message : "This file could not be uploaded. Try again.";
    } finally {
      uploading = false;
      if (live()) busy.value = false;
    }
  }

  scope.onActivate(() => {
    if (!provider) return;
    const request = ++libraryRequest;
    const store = versionedAssetStore(provider);
    void Promise.all([provider.store.list(), store?.snapshot()]).then(([listed, snapshot]) => {
      if (!live() || request !== libraryRequest) return;
      const available = listed.filter((record) => record.state === "active" && (kind !== "image" || isAssetImage(record)));
      batch(() => {
        records.value = available.map((record) => ({ ...record, url: provider.previewUrl?.(record.url) ?? record.url }));
        folders.value = snapshot?.folders ?? null;
        selectedId.value = current?.providerId === provider.descriptor.id && available.some(({ id }) => id === current.assetId) ? current.assetId : "";
      });
    }).catch((reason: unknown) => {
      if (live() && request === libraryRequest) error.value = reason instanceof Error ? reason.message : "The Assets library could not be loaded.";
    }).finally(() => { if (live() && request === libraryRequest) loading.value = false; });
  });

  scope.onActivate(() => {
    if (intent === "upload" && canUpload) uploadInputRef.current?.click();
  });

  // After an upload, bring the new item into view once both its row and its
  // selection exist; whichever lands last (the row's activation or this
  // effect) performs the scroll.
  function scrollToUploaded(): void {
    const idToScroll = scrollAfterUpload;
    if (idToScroll === null || idToScroll !== selectedId.value) return;
    const element = itemRefs.get(idToScroll);
    if (!element) return;
    element.scrollIntoView?.({ block: "nearest" });
    scrollAfterUpload = null;
  }
  scope.effect(() => { void records.value; void selectedId.value; scrollToUploaded(); });

  const selected = computed(() => records.value.find(({ id }) => id === selectedId.value));
  const isCurrent = (record: AssetSummary) => current?.providerId === provider?.descriptor.id && current?.assetId === record.id;
  const folderItems = computed(() => (folders.value ?? []).filter((folder) => folder.state === "active").map((folder) => ({ folder, path: assetFolderPath(folders.value ?? [], folder.id) }))
    .sort((a, b) => a.path.join("/").localeCompare(b.path.join("/"))));
  const scopeLabel = computed(() => {
    const value = pickerScope.value;
    return value === "all" ? "All assets" : value === "unfiled" ? "Unfiled" : folderItems.value.find(({ folder }) => folder.id === value)?.path.join(" / ") ?? "Folder";
  });
  const query = computed(() => search.value.trim().toLocaleLowerCase());
  const visible = computed(() => {
    const folder = pickerScope.value;
    const typeFacet = ASSET_TYPE_FACET.options.find(({ id }) => id === type.value);
    return records.value.filter((record) => (folder === "all" || (folder === "unfiled" ? record.folderId === null : record.folderId === folder))
      && `${record.fileName} ${record.note}`.toLocaleLowerCase().includes(query.value)
      && (kind === "image" || !typeFacet?.match || typeFacet.match(record)))
      .sort(PICKER_SORTS.find(({ id }) => id === sort.value)?.compare);
  });
  const filtering = computed(() => Boolean(query.value) || type.value !== "all");

  async function useSelection(record: AssetSummary | undefined = selected.value) {
    if (!provider || !record || submitting) return;
    submitting = true; busy.value = true; error.value = null;
    try {
      const loaded = await provider.store.get(record.id);
      if (!live()) return;
      if (loaded.status !== "loaded" || loaded.record.document.state !== "active") throw new Error("This asset is no longer available. Choose another asset.");
      const latest = summarizeAsset(loaded.record);
      if (kind === "image" && !isAssetImage(latest)) throw new Error("The selected asset is no longer an image.");
      await onSelect(freshUse(kind, provider.descriptor.id, latest));
      if (!live()) return;
      onClose();
    } catch (reason) {
      if (live()) error.value = reason instanceof Error ? reason.message : "This asset could not be selected. Try again.";
    } finally { submitting = false; if (live()) busy.value = false; }
  }

  function chooseScope(value: string) {
    pickerScope.value = value;
    if (panes.tier.value.sideOverlay) panes.closeSide();
  }

  function handleUploadDragOver(event: DragOn) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dragActive.value = true;
  }

  function handleUploadDragLeave(event: DragOn) {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return;
    dragActive.value = false;
  }

  function handleUploadDrop(event: DragOn) {
    event.preventDefault();
    dragActive.value = false;
    const file = event.dataTransfer ? normalizedFilesFromTransfer(event.dataTransfer)[0] : undefined;
    if (file) void uploadFile(file);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      const state = panes.panes.value;
      const action = nextEscapeAction({ ...panes.tier.value, sideOpen: state.side, detailOpen: state.detail });
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

  const sideOpen = computed(() => panes.panes.value.side);
  const detailOpen = computed(() => panes.panes.value.detail);
  const sideChevron = computed(() => (sideOpen.value ? ChevronLeftIcon : ChevronRightIcon));
  const detailChevron = computed(() => (panes.tier.value.detailDrawer ? (detailOpen.value ? ChevronDownIcon : ChevronUpIcon)
    : (detailOpen.value ? ChevronRightIcon : ChevronLeftIcon)));
  const count = (match: (record: AssetSummary) => boolean) => computed(() => String(records.value.filter(match).length));

  return (
    <Dialog open size="wide" label={title} class="sg-assets-picker-dialog" initialFocusRef={searchRef} onClose={onClose} dismissOnBackdrop={false}
      header={<header class="sg-assets-picker-header" on:keydown={handleKeyDown}>
        <h2>{title}</h2><Chip>for {kind}</Chip>
        <Button variant="ghost" size="sm" iconOnly aria-label="Close" class="sg-assets-picker-close" on:click={onClose}><XMarkIcon size="sm" /></Button>
      </header>}>
      <div ref={panes.bodyRef} class="sg-assets-picker" data-side-open={computed(() => String(sideOpen.value))} data-detail-open={computed(() => String(detailOpen.value))}
        style={computed(() => ({ "--sg-assets-picker-side-w": `${panes.panes.value.sideWidth}px` }))} on:keydown={handleKeyDown}>
        <Show when={computed(() => !provider || Boolean(error.value))}>{() => <div class="sg-assets-picker-notices">
          {!provider ? <Banner tone="info">The Assets library and upload authoring are available only under the local development server (<code>pnpm dev</code>). Committed files under <code>publicAssetsDir</code> are still served from <code>/uploaded-assets/</code>.</Banner> : null}
          <Show when={computed(() => Boolean(error.value))}>{() => <Banner tone="err">{computed(() => error.value ?? "")}</Banner>}</Show>
        </div>}</Show>
        <div class="sg-assets-picker-workspace">
          <aside ref={panes.sideRef} id={sideId} class="sg-assets-picker-library" aria-label="Library" inert={computed(() => !sideOpen.value)} aria-hidden={computed(() => String(!sideOpen.value))}>
            <h3>Library</h3>
            {canUpload ? <Button variant="ghost" class="sg-assets-picker-upload-action" disabled={busy} on:click={() => uploadInputRef.current?.click()}><UploadIcon size="sm" />Upload new file…</Button> : null}
            <Button variant="ghost" class="sg-assets-picker-facet" aria-pressed={computed(() => pickerScope.value === "all")} on:click={() => chooseScope("all")}><span>All assets</span>{" "}<span>{count(() => true)}</span></Button>
            <Button variant="ghost" class="sg-assets-picker-facet" aria-pressed={computed(() => pickerScope.value === "unfiled")} on:click={() => chooseScope("unfiled")}><span>Unfiled</span>{" "}<span>{count(({ folderId }) => folderId === null)}</span></Button>
            <Show when={computed(() => folders.value !== null)}>{() => <section class="sg-assets-picker-folders" aria-label="Folders">
              <h3>Folders</h3>
              <For each={folderItems} by={({ folder }) => folder.id}>{(item) => {
                const folderId = item.value.folder.id;
                const path = computed(() => item.value.path);
                return <Button variant="ghost" class="sg-assets-picker-facet" aria-pressed={computed(() => pickerScope.value === folderId)}
                  title={computed(() => path.value.join(" / "))} style={computed(() => ({ "--sg-assets-picker-folder-depth": path.value.length - 1 }))} on:click={() => chooseScope(folderId)}>
                  <FolderIcon size="sm" /><span class="sg-assets-picker-folder-name">{computed(() => item.value.folder.name)}</span>{" "}<span>{count(({ folderId: recordFolder }) => recordFolder === folderId)}</span>
                </Button>;
              }}</For>
            </section>}</Show>
            <p class="sg-assets-picker-library-note">Assets are global. Metadata changes keep stable asset IDs and every byte version.</p>
          </aside>
          <div {...panes.separatorProps} class="sg-assets-picker-separator" aria-controls={sideId} />
          <section class="sg-assets-picker-main" aria-label="Choose from assets">
            <div class="sg-assets-picker-toolbar">
              <Input elementRef={searchRef} type="search" aria-label="Search assets" placeholder="Search assets" icon={SearchIcon} class="sg-assets-picker-search" modelValue={search} />
              {kind !== "image" ? <Select aria-label="Asset type" modelValue={type}>
                {ASSET_TYPE_FACET.options.map((option) => <option value={option.id}>{option.id === "all" ? "All types" : option.label}</option>)}
              </Select> : null}
              <Select aria-label="Sort assets" modelValue={sort}>
                {PICKER_SORTS.map((option) => <option value={option.id}>{option.label}</option>)}
              </Select>
              <SegmentedControl label="Asset view" size="sm" value={view} onChange={(next) => { view.value = next; }} options={[
                { value: "grid", ariaLabel: "Grid view", icon: GridIcon },
                { value: "list", ariaLabel: "List view", icon: ListIcon },
              ]} />
            </div>
            <p class="sg-assets-picker-scope" role="status">{computed(() => `${scopeLabel.value} · ${visible.value.length} shown`)}</p>
            {canUpload ? <div class={computed(() => `sg-assets-picker-drop${dragActive.value ? " sg-assets-picker-drop--drag-active" : ""}`)} on:dragover={handleUploadDragOver} on:dragleave={handleUploadDragLeave} on:drop={handleUploadDrop}>
              <UploadIcon size="sm" />
              <span>Drop a file here to upload and use it</span>
              <small>{` · ${uploadHint} · up to ${formatBytes(ASSET_MAX_BYTE_LENGTH)}`}</small>
            </div> : null}
            <div class="sg-assets-picker-results">
              <Show when={loading} fallback={() => (
                <Show when={computed(() => visible.value.length > 0)} fallback={() => <div class="sg-assets-picker-empty">
                  <p>{computed(() => (filtering.value ? "No assets match these filters." : "No assets in this location."))}</p>
                  <Show when={filtering}>{() => <Button on:click={() => { batch(() => { search.value = ""; type.value = "all"; }); searchRef.current?.focus(); }}>Clear search</Button>}</Show>
                </div>}>
                  {() => <ul class="sg-assets-picker-items" data-view={view} aria-label="Assets">
                    <For each={visible} by={(record) => record.id}>{(item) => <PickerItem record={item} dimensions={dimensions} selectedId={selectedId} busy={busy} current={isCurrent(item.value)}
                      register={(recordId, element) => { if (element) { itemRefs.set(recordId, element); scrollToUploaded(); } else itemRefs.delete(recordId); }}
                      onChoose={(record) => { selectedId.value = record.id; }}
                      onUse={(record) => { selectedId.value = record.id; void useSelection(record); }} />}</For>
                  </ul>}
                </Show>
              )}>{() => <p class="sg-assets-picker-empty" role="status">Loading assets…</p>}</Show>
            </div>
          </section>
          <aside ref={panes.detailRef} id={detailId} class="sg-assets-picker-details" aria-label="Asset details" inert={computed(() => !detailOpen.value)} aria-hidden={computed(() => String(!detailOpen.value))} tabindex={-1}>
            <h3>Asset details</h3>
            <Show when={computed(() => selected.value !== undefined)} fallback={() => <p class="sg-assets-picker-detail-empty">Select an asset to see its details.</p>}>
              {() => <AssetView record={selected as ReadonlySignal<AssetSummary>}>{(record) => <>
                <div class="sg-assets-picker-preview"><AssetThumb record={record} dimensions={dimensions} detail /></div>
                <h4>{record.fileName}</h4>
                <dl class="sg-assets-picker-facts">
                  <div><dt>Type</dt><dd>{assetTypeLabel(record.mimeType)} <span>({record.mimeType})</span></dd></div>
                  <div><dt>Size</dt><dd>{formatBytes(record.byteLength)}</dd></div>
                  <div><dt>Pixels</dt><dd>{computed(() => { const pixels = dimensions.get(record.versionId); return pixels ? formatPixelSize(pixels) : isAssetImage(record) ? "Not decoded" : "—"; })}</dd></div>
                  <div><dt>Uploaded</dt><dd><time datetime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time></dd></div>
                  <div><dt>Asset ID</dt><dd><code>{record.id}</code></dd></div>
                  {record.note.trim() ? <div><dt>Note</dt><dd>{record.note}</dd></div> : null}
                </dl>
              </>}</AssetView>}
            </Show>
          </aside>
          <Button elementRef={panes.sideTabRef} iconOnly size="sm" class="sg-assets-picker-side-tab" aria-label={computed(() => (sideOpen.value ? "Hide library" : "Show library"))}
            aria-expanded={computed(() => String(sideOpen.value))} aria-controls={sideId} on:click={panes.toggleSide}><LiveIcon icon={sideChevron} size="sm" /></Button>
          <Button elementRef={panes.detailTabRef} iconOnly size="sm" class="sg-assets-picker-detail-tab" aria-label={computed(() => (detailOpen.value ? "Hide asset details" : "Show asset details"))}
            aria-expanded={computed(() => String(detailOpen.value))} aria-controls={detailId} on:click={panes.toggleDetail}><LiveIcon icon={detailChevron} size="sm" /></Button>
        </div>
        <footer class="sg-assets-picker-footer">
          <div class="sg-assets-picker-selection"><Show when={computed(() => selected.value !== undefined)} fallback={() => "Nothing selected"}>
            {() => <AssetView record={selected as ReadonlySignal<AssetSummary>}>{(record) => <><span class="sg-assets-picker-selection-thumb"><AssetThumb record={record} dimensions={dimensions} /></span><span>{record.fileName}</span></>}</AssetView>}
          </Show></div>
          <span class="sg-assets-picker-hints"><kbd>Enter</kbd> use · <kbd>Esc</kbd> close</span>
          <div class="sg-assets-picker-actions"><Button on:click={onClose}>Cancel</Button><Button variant="primary" disabled={computed(() => !selected.value)} busy={busy} on:click={() => { void useSelection(); }}>
            {computed(() => (kind === "image" ? selected.value && isCurrent(selected.value) ? "Keep this image" : "Use this image" : "Use this asset"))}
          </Button></div>
        </footer>
        {canUpload ? <input ref={uploadInputRef} class="sg-assets-picker-upload-input" aria-label="Upload new file" type="file" accept={uploadAccept} on:change={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          input.value = "";
          if (file) void uploadFile(file);
        }} /> : null}
      </div>
    </Dialog>
  );
}

interface PickerItemProps {
  record: ReadonlySignal<AssetSummary>;
  dimensions: AssetDimensionStore;
  selectedId: ReadonlySignal<string>;
  busy: ReadonlySignal<boolean>;
  current: boolean;
  register(recordId: string, element: HTMLButtonElement | null): void;
  onChoose(record: AssetSummary): void;
  onUse(record: AssetSummary): void;
}

function PickerItem({ record, dimensions, selectedId, busy, current, register, onChoose, onUse }: PickerItemProps): Child {
  const recordId = record.value.id;
  const button: Ref<HTMLButtonElement> = { current: null };
  getScope().onActivate(() => {
    register(recordId, button.current);
    return () => register(recordId, null);
  });
  const isSelected = computed(() => selectedId.value === recordId);
  return <li>
    <button ref={button} type="button" class="sg-assets-picker-item" aria-label={computed(() => record.value.fileName)} aria-pressed={computed(() => String(isSelected.value))} disabled={busy}
      on:click={() => onChoose(record.value)} on:dblclick={() => onUse(record.value)}>
      <AssetView record={record}>{(value) => <>
        <span class="sg-assets-picker-thumb"><AssetThumb record={value} dimensions={dimensions} /></span>
        <span class="sg-assets-picker-item-copy"><strong>{value.fileName}</strong><small>{computed(() => assetMeta(value, dimensions))}</small></span>
      </>}</AssetView>
      {current ? <Chip class="sg-assets-picker-current">Current</Chip> : null}
      <Show when={isSelected}>{() => <span class="sg-assets-picker-check"><CheckIcon size="sm" /></span>}</Show>
    </button>
  </li>;
}
