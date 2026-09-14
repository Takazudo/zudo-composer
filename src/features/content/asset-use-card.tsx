import type { JsonValue } from "@zudo-composer/component-contract";
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { formatIntent } from "../../app/route-intents";
import { assetByteLabel, assetTypeLabel } from "../../assets/model";
import { CopyIcon, ExternalLinkIcon, FileIcon, LibraryIcon, RefreshIcon, TrashIcon, WarningIcon } from "../../components/icons";
import { Button, Chip, Field, Input, Select, Switch, Textarea } from "../../components/ui";
import type { ContentAssetUse } from "../../content";
import type { ContentAssetCatalogItem, ContentAuthoringController } from "./controller";
import type { ContentAssetPickerRenderer } from "./structured-field-editor";

interface AssetUseCardProps {
  kind: ContentAssetUse["kind"];
  value: JsonValue | undefined;
  controller: ContentAuthoringController;
  renderAssetPicker?: ContentAssetPickerRenderer;
  assetPickerCapabilities?: { upload: boolean };
  commit(value: JsonValue | undefined): void;
}

function ImagePlaceholder(): JSX.Element {
  return <svg class="sg-content-asset-card__image-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="2" y="2" width="12" height="12" rx="1" /><circle cx="5.5" cy="5.5" r="1" /><path d="m2 11 3-3 3 3 3-5 3 5" /></svg>;
}

function makeUse(kind: ContentAssetUse["kind"], item: ContentAssetCatalogItem): ContentAssetUse {
  const asset = { providerId: item.providerId, assetId: item.assetId };
  switch (kind) {
    case "image": return { kind, asset, alt: "", decorative: false, caption: "" };
    case "link": return { kind, asset, label: item.label };
    case "download": return { kind, asset, label: item.label, showSize: true, showType: true };
    case "card": return { kind, asset, title: item.label, description: "" };
  }
}

const uploadedDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Content owns the resting card; the host supplies the picker through callbacks. */
export function AssetUseCard({ kind, value, controller, renderAssetPicker, commit }: AssetUseCardProps): JSX.Element {
  const [assets, setAssets] = useState<readonly ContentAssetCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [pixels, setPixels] = useState<{ url: string; width: number; height: number } | null>(null);
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const use = value && typeof value === "object" && !Array.isArray(value) ? value as unknown as ContentAssetUse : null;

  useEffect(() => {
    // Reload after the picker closes: it may have uploaded or replaced a file.
    if (pickerOpen) return;
    let live = true;
    setLoading(true);
    setError(null);
    void controller.assetAssets().then((items) => {
      if (live) { setAssets(items); setLoading(false); }
    }, (cause: unknown) => {
      if (live) { setAssets([]); setLoading(false); setError(cause instanceof Error ? cause.message : "Asset catalog unavailable."); }
    });
    return () => { live = false; };
  }, [controller, pickerOpen, use?.asset.providerId, use?.asset.assetId]);

  const asset = use ? assets.find((item) => item.providerId === use.asset.providerId && item.assetId === use.asset.assetId) : undefined;
  const activeAssets = assets.filter((item) => item.state === "active");
  const selectedActive = asset?.state === "active";
  const warning = use && (asset?.state === "trash" || (!asset && !loading));
  const typeLabel = asset ? asset.mimeType === "image/webp" ? "WebP" : assetTypeLabel(asset.mimeType) : "";
  const extension = asset?.fileName.includes(".") ? asset.fileName.split(".").pop()!.toUpperCase() || typeLabel : typeLabel;
  const image = asset?.mimeType.startsWith("image/");
  const knownPixels = image && pixels?.url === asset?.url && failedPreview !== asset?.url ? pixels : null;
  const select = (next: ContentAssetUse) => {
    commit((use ? { ...use, asset: next.asset } : next) as unknown as JsonValue);
    setFailedPreview(null);
    setPickerOpen(false);
    setFallbackOpen(false);
  };
  const unavailableOption = use ? `unavailable:${use.asset.providerId}:${use.asset.assetId}` : "";
  const update = (patch: object) => { if (use) commit({ ...use, ...patch } as unknown as JsonValue); };
  const choose = () => { if (renderAssetPicker) setPickerOpen(true); else setFallbackOpen(true); };
  const remove = () => { commit(undefined); setFailedPreview(null); setFallbackOpen(false); setPickerOpen(false); };
  const copy = async () => {
    if (!asset) return;
    try { await navigator.clipboard?.writeText(asset.authoringUrl); }
    catch { /* Clipboard access can be blocked by the browser. */ }
  };
  const fallback = <Select aria-label="Asset" value={selectedActive ? asset.assetId : unavailableOption} onChange={(event) => {
    if (event.currentTarget.value === "") { remove(); return; }
    const next = activeAssets.find((item) => item.assetId === event.currentTarget.value);
    if (next) select(makeUse(kind, next));
  }}>
    <option value="">No asset selected</option>
    {activeAssets.map((item) => <option key={item.assetId} value={item.assetId}>{item.label}</option>)}
    {use && !selectedActive ? <option value={unavailableOption} disabled>{asset?.state === "trash" ? `In trash · ${asset.fileName}` : `Unavailable asset · ${use.asset.assetId}`}</option> : null}
  </Select>;

  return <div class="sg-content-asset-use">
    {use ? <div class="sg-content-asset-card" data-warning={warning || undefined} aria-busy={loading || undefined}>
      <div class="sg-content-asset-card__thumbnail" data-checker={image || undefined}>
        {!asset ? loading ? <ImagePlaceholder /> : <WarningIcon size="lg" /> : image ? (
          failedPreview === asset.url ? <><ImagePlaceholder /><span class="sg-content-asset-card__preview-error">Preview unavailable</span></> : <img
            key={asset.url}
            class="sg-content-asset-card__image"
            src={asset.url}
            alt=""
            onLoad={(event) => {
              const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
              if (width > 0 && height > 0) setPixels({ url: asset.url, width, height });
            }}
            onError={() => setFailedPreview(asset.url)}
          />
        ) : <><FileIcon size="lg" /><span class="sg-content-asset-card__extension" title={extension}>{extension}</span></>}
      </div>
      <div class="sg-content-asset-card__body">
        <div class="sg-content-asset-card__name">
          <span class="sg-content-asset-card__filename" title={asset?.fileName ?? use.asset.assetId}>{asset?.fileName ?? (loading ? "Loading asset…" : `Unavailable asset · ${use.asset.assetId}`)}</span>
          {asset?.state === "trash" ? <Chip tone="warn" class="sg-content-asset-card__trash">In trash</Chip> : null}
        </div>
        {asset ? <p class="sg-content-asset-card__meta">{typeLabel} · {assetByteLabel(asset.byteLength)}{knownPixels ? ` · ${knownPixels.width} × ${knownPixels.height}` : ""} · uploaded {uploadedDate.format(new Date(asset.createdAt))}</p> : null}
        {asset?.state === "trash" ? <p class="sg-content-asset-card__warning"><WarningIcon size="xs" /><span>This asset was moved to Trash in Assets. Choose another {kind === "image" ? "image" : "asset"} or restore it in Assets.</span></p> : null}
        <div class="sg-content-asset-card__actions">
          <Button size="sm" onClick={choose}><RefreshIcon size="xs" />Replace…</Button>
          {asset ? <a class="cms-btn cms-btn--sm" href={formatIntent({ route: "assets", providerId: asset.providerId, assetId: asset.assetId })}><ExternalLinkIcon size="xs" />Open in Assets</a> : null}
          <Button variant="danger" size="sm" class="cms-btn--ghost sg-content-asset-card__remove" onClick={remove}><TrashIcon size="xs" />Remove</Button>
        </div>
        {asset ? <div class="sg-content-asset-card__url"><span>Authoring URL</span><code title={asset.authoringUrl}>{asset.authoringUrl}</code><Button variant="ghost" size="xs" iconOnly aria-label="Copy authoring URL" onClick={() => void copy()}><CopyIcon size="xs" /></Button></div> : null}
        {!renderAssetPicker && fallbackOpen ? fallback : null}
      </div>
    </div> : <div class="sg-content-asset-card sg-content-asset-card--empty">
      <ImagePlaceholder />
      <p class="sg-content-asset-card__empty-message">{kind === "image" ? "No image chosen." : "No asset chosen."}</p>
      <div class="sg-content-asset-card__empty-actions">{renderAssetPicker ? <Button variant="primary" onClick={choose}><LibraryIcon size="xs" />Choose from Assets</Button> : fallback}</div>
    </div>}
    {error ? <p class="sg-content-field-error"><WarningIcon size="xs" />{error}</p> : null}
    {use ? <div class="sg-content-asset-card__fields">
      {use.kind === "image" ? <>
        <Field label="Alt text" error={!use.decorative && !use.alt.trim() ? "Add alt text or mark the image decorative" : undefined}><Input disabled={use.decorative} value={use.alt} onInput={(event) => update({ alt: event.currentTarget.value })} /></Field>
        <Field label="Decorative image"><Switch aria-label="Decorative image" checked={use.decorative} onCheckedChange={(decorative) => update({ decorative, ...(decorative ? { alt: "" } : {}) })} /></Field>
        <Field label="Image caption"><Input value={use.caption} onInput={(event) => update({ caption: event.currentTarget.value })} /></Field>
      </> : use.kind === "download" ? <>
        <Field label="Download label"><Input value={use.label} onInput={(event) => update({ label: event.currentTarget.value })} /></Field>
        <Field label="Show file size"><Switch aria-label="Show file size" checked={use.showSize} onCheckedChange={(showSize) => update({ showSize })} /></Field>
        <Field label="Show file type"><Switch aria-label="Show file type" checked={use.showType} onCheckedChange={(showType) => update({ showType })} /></Field>
      </> : use.kind === "link" ? <Field label="Link label"><Input value={use.label} onInput={(event) => update({ label: event.currentTarget.value })} /></Field> : <>
        <Field label="Card title"><Input value={use.title} onInput={(event) => update({ title: event.currentTarget.value })} /></Field>
        <Field label="Card description"><Textarea value={use.description} onInput={(event) => update({ description: event.currentTarget.value })} /></Field>
      </>}
    </div> : null}
    {pickerOpen && renderAssetPicker ? renderAssetPicker({ kind, current: use?.asset, onSelect: select, onClose: () => setPickerOpen(false) }) : null}
  </div>;
}
