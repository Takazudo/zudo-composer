import { computed, getScope, Show, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { JsonValue } from "@zudo-composer/component-contract";
import { formatIntent } from "../../app/route-intents";
import { assetByteLabel, assetTypeLabel } from "../../assets/model";
import { CopyIcon, ExternalLinkIcon, FileIcon, LibraryIcon, RefreshIcon, TrashIcon, UploadIcon, WarningIcon } from "../../components/icons";
import { Rebuild } from "../../components/rebuild";
import { Button, Chip, Field, Input, Select, Switch, Textarea } from "../../components/ui";
import type { ContentAssetUse } from "../../content";
import type { ContentAssetCatalogItem, ContentAuthoringController } from "./controller";
import { externalDraft, stableComputed } from "./reactive-draft";
import type { ContentAssetPickerRenderer } from "./structured-field-editor";

interface AssetUseCardProps {
  kind: ContentAssetUse["kind"];
  value: ReadonlySignal<JsonValue | undefined>;
  controller: ContentAuthoringController;
  renderAssetPicker?: ContentAssetPickerRenderer;
  assetPickerCapabilities?: { upload: boolean };
  commit(value: JsonValue | undefined): void;
}

function ImagePlaceholder() {
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
const present = (value: unknown) => computed(() => Boolean(typeof value === "function" ? (value as () => unknown)() : value));

/** Content owns the resting card; the host supplies the picker through callbacks. */
export function AssetUseCard({ kind, value, controller, renderAssetPicker, assetPickerCapabilities, commit }: AssetUseCardProps) {
  const scope = getScope();
  const assets = signal<readonly ContentAssetCatalogItem[]>([]);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const picker = signal<{ intent?: "upload" } | null>(null);
  const fallbackOpen = signal(false);
  const pixels = signal<{ url: string; width: number; height: number } | null>(null);
  const failedPreview = signal<string | null>(null);
  const use = computed(() => value.value && typeof value.value === "object" && !Array.isArray(value.value) ? value.value as unknown as ContentAssetUse : null);
  const assetKey = computed(() => use.value ? `${use.value.asset.providerId}\u0000${use.value.asset.assetId}` : "");

  // Reload after the picker closes: it may have uploaded or replaced a file.
  scope.effect(() => {
    if (picker.value) return undefined;
    void assetKey.value;
    let live = true;
    loading.value = true;
    error.value = null;
    void controller.assetAssets().then((items) => {
      if (live && !scope.abortSignal.aborted) { assets.value = items; loading.value = false; }
    }, (cause: unknown) => {
      if (live && !scope.abortSignal.aborted) { assets.value = []; loading.value = false; error.value = cause instanceof Error ? cause.message : "Asset catalog unavailable."; }
    });
    return () => { live = false; };
  });

  const asset = computed(() => { const current = use.value; return current ? assets.value.find((item) => item.providerId === current.asset.providerId && item.assetId === current.asset.assetId) : undefined; });
  const activeAssets = computed(() => assets.value.filter((item) => item.state === "active"));
  const selectedActive = computed(() => asset.value?.state === "active");
  const warning = computed(() => Boolean(use.value && (asset.value?.state === "trash" || (!asset.value && !loading.value))));
  const typeLabel = computed(() => { const item = asset.value; return item ? item.mimeType === "image/webp" ? "WebP" : assetTypeLabel(item.mimeType) : ""; });
  const image = computed(() => Boolean(asset.value?.mimeType.startsWith("image/")));
  const knownPixels = computed(() => image.value && pixels.value?.url === asset.value?.url && failedPreview.value !== asset.value?.url ? pixels.value : null);
  const canUpload = assetPickerCapabilities?.upload === true;
  const select = (next: ContentAssetUse) => {
    const current = use.value;
    commit((current ? { ...current, asset: next.asset } : next) as unknown as JsonValue);
    failedPreview.value = null;
    picker.value = null;
    fallbackOpen.value = false;
  };
  const unavailableOption = computed(() => use.value ? `unavailable:${use.value.asset.providerId}:${use.value.asset.assetId}` : "");
  const update = (patch: object) => { const current = use.value; if (current) commit({ ...current, ...patch } as unknown as JsonValue); };
  const choose = (intent?: "upload") => { if (renderAssetPicker) picker.value = intent ? { intent } : {}; else fallbackOpen.value = true; };
  const remove = () => { commit(undefined); failedPreview.value = null; fallbackOpen.value = false; picker.value = null; };
  const copy = async () => {
    const item = asset.value;
    if (!item) return;
    try { await navigator.clipboard?.writeText(item.authoringUrl); }
    catch { /* Clipboard access can be blocked by the browser. */ }
  };
  // The fallback select's options are static, so it is rebuilt with them.
  const fallbackChoices = stableComputed(() => ({ active: activeAssets.value, unavailable: use.value && !selectedActive.value ? { value: unavailableOption.value, label: asset.value?.state === "trash" ? `In trash · ${asset.value.fileName}` : `Unavailable asset · ${use.value.asset.assetId}` } : null }), (current) => JSON.stringify([current.active.map((item) => [item.assetId, item.label]), current.unavailable]));
  const fallback = () => <Rebuild value={fallbackChoices}>{(choices) => <FallbackSelect choices={choices} current={computed(() => selectedActive.value ? asset.value!.assetId : unavailableOption.value)} onChange={(next) => {
    if (next === "") { remove(); return; }
    const item = activeAssets.value.find((candidate) => candidate.assetId === next);
    if (item) select(makeUse(kind, item));
  }} />}</Rebuild>;
  const thumbnailKey = stableComputed(() => ({ asset: asset.value, loading: loading.value, image: image.value, failed: failedPreview.value === asset.value?.url }), (current) => JSON.stringify([current.asset?.url ?? null, current.asset?.fileName ?? null, current.asset?.mimeType ?? null, current.loading, current.image, current.failed]));
  const extension = (item: ContentAssetCatalogItem) => item.fileName.includes(".") ? item.fileName.split(".").pop()!.toUpperCase() || typeLabel.value : typeLabel.value;
  const label = (name: string) => computed(() => { const current = use.value as unknown as Record<string, unknown> | null; const text = current?.[name]; return typeof text === "string" ? text : ""; });
  const textField = (fieldLabel: string, name: string, multiline = false, extra: Record<string, unknown> = {}) => <TextUseField fieldLabel={fieldLabel} value={label(name)} multiline={multiline} extra={extra} onInput={(next) => update({ [name]: next })} />;
  const flag = (name: "decorative" | "showSize" | "showType") => computed(() => (use.value as unknown as Record<string, unknown> | null)?.[name] === true);

  return <div class="sg-content-asset-use">
    <Show when={present(() => use.value)} fallback={() => <div class="sg-content-asset-card sg-content-asset-card--empty">
      <ImagePlaceholder />
      <p class="sg-content-asset-card__empty-message">{kind === "image" ? "No image chosen." : "No asset chosen."}</p>
      <div class="sg-content-asset-card__empty-actions">{renderAssetPicker ? <>
        <Button variant="primary" on:click={() => choose()}><LibraryIcon size="xs" />Choose from Assets</Button>
        {canUpload ? <Button on:click={() => choose("upload")}><UploadIcon size="xs" />Upload…</Button> : null}
      </> : fallback()}</div>
    </div>}>{() => <div class="sg-content-asset-card" data-warning={computed(() => warning.value || undefined)} aria-busy={computed(() => loading.value || undefined)}>
      <Rebuild value={thumbnailKey}>{({ asset: item, loading: pending, image: isImage, failed }) => <div class="sg-content-asset-card__thumbnail" data-checker={isImage || undefined}>
        {!item ? pending ? <ImagePlaceholder /> : <WarningIcon size="lg" /> : isImage ? (
          failed ? <><ImagePlaceholder /><span class="sg-content-asset-card__preview-error">Preview unavailable</span></> : <img
            class="sg-content-asset-card__image"
            src={item.url}
            alt=""
            on:load={(event) => {
              const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
              if (width > 0 && height > 0) pixels.value = { url: item.url, width, height };
            }}
            on:error={() => { failedPreview.value = item.url; }}
          />
        ) : <><FileIcon size="lg" /><span class="sg-content-asset-card__extension" title={extension(item)}>{extension(item)}</span></>}
      </div>}</Rebuild>
      <div class="sg-content-asset-card__body">
        <div class="sg-content-asset-card__name">
          <span class="sg-content-asset-card__filename" title={computed(() => asset.value?.fileName ?? use.value?.asset.assetId ?? "")}>{computed(() => asset.value?.fileName ?? (loading.value ? "Loading asset…" : `Unavailable asset · ${use.value?.asset.assetId ?? ""}`))}</span>
          <Show when={computed(() => asset.value?.state === "trash")}>{() => <Chip tone="warn" class="sg-content-asset-card__trash">In trash</Chip>}</Show>
        </div>
        <Show when={present(() => asset.value)}>{() => <p class="sg-content-asset-card__meta">{computed(() => { const item = asset.value; if (!item) return ""; const known = knownPixels.value; return `${typeLabel.value} · ${assetByteLabel(item.byteLength)}${known ? ` · ${known.width} × ${known.height}` : ""} · uploaded ${uploadedDate.format(new Date(item.createdAt))}`; })}</p>}</Show>
        <Show when={computed(() => asset.value?.state === "trash")}>{() => <p class="sg-content-asset-card__warning"><WarningIcon size="xs" /><span>This asset was moved to Trash in Assets. Choose another {kind === "image" ? "image" : "asset"} or restore it in Assets.</span></p>}</Show>
        <div class="sg-content-asset-card__actions">
          <Button size="sm" on:click={() => choose()}><RefreshIcon size="xs" />Replace…</Button>
          <Show when={present(() => asset.value)}>{() => <a class="cms-btn cms-btn--sm" href={computed(() => { const item = asset.value; return item ? formatIntent({ route: "assets", providerId: item.providerId, assetId: item.assetId }) : null; })}><ExternalLinkIcon size="xs" />Open in Assets</a>}</Show>
          <Button variant="danger" size="sm" class="cms-btn--ghost sg-content-asset-card__remove" on:click={remove}><TrashIcon size="xs" />Remove</Button>
        </div>
        <Show when={present(() => asset.value)}>{() => <div class="sg-content-asset-card__url"><span>Authoring URL</span><code title={computed(() => asset.value?.authoringUrl ?? "")}>{computed(() => asset.value?.authoringUrl ?? "")}</code><Button variant="ghost" size="xs" iconOnly aria-label="Copy authoring URL" on:click={() => void copy()}><CopyIcon size="xs" /></Button></div>}</Show>
        {!renderAssetPicker ? <Show when={fallbackOpen}>{fallback}</Show> : null}
      </div>
    </div>}</Show>
    <Show when={computed(() => error.value !== null)}>{() => <p class="sg-content-field-error"><WarningIcon size="xs" />{computed(() => error.value ?? "")}</p>}</Show>
    <Show when={present(() => use.value)}>{() => <div class="sg-content-asset-card__fields">
      {kind === "image" ? <>
        {textField("Alt text", "alt", false, { disabled: flag("decorative"), error: computed(() => { const current = use.value; return current?.kind === "image" && !current.decorative && !current.alt.trim() ? "Add alt text or mark the image decorative" : undefined; }) })}
        <Field label="Decorative image">{(control) => <Switch field={control} aria-label="Decorative image" checked={flag("decorative")} onCheckedChange={(decorative) => update({ decorative, ...(decorative ? { alt: "" } : {}) })} />}</Field>
        {textField("Image caption", "caption")}
      </> : kind === "download" ? <>
        {textField("Download label", "label")}
        <Field label="Show file size">{(control) => <Switch field={control} aria-label="Show file size" checked={flag("showSize")} onCheckedChange={(showSize) => update({ showSize })} />}</Field>
        <Field label="Show file type">{(control) => <Switch field={control} aria-label="Show file type" checked={flag("showType")} onCheckedChange={(showType) => update({ showType })} />}</Field>
      </> : kind === "link" ? textField("Link label", "label") : <>
        {textField("Card title", "title")}
        {textField("Card description", "description", true)}
      </>}
    </div>}</Show>
    <Show when={computed(() => picker.value !== null && renderAssetPicker !== undefined)}>{() => {
      const intent = picker.value?.intent;
      return renderAssetPicker!({ kind, current: use.value?.asset, ...(intent ? { intent } : {}), onSelect: select, onClose: () => { picker.value = null; } });
    }}</Show>
  </div>;
}

function FallbackSelect({ choices, current, onChange }: { choices: { active: readonly ContentAssetCatalogItem[]; unavailable: { value: string; label: string } | null }; current: ReadonlySignal<string>; onChange(value: string): void }) {
  const draft = externalDraft(getScope(), current);
  return <Select aria-label="Asset" modelValue={draft} on:change={(event) => onChange(event.currentTarget.value)}>
    <option value="">No asset selected</option>
    {choices.active.map((item) => <option value={item.assetId}>{item.label}</option>)}
    {choices.unavailable ? <option value={choices.unavailable.value} disabled>{choices.unavailable.label}</option> : null}
  </Select>;
}

function TextUseField({ fieldLabel, value, multiline, extra, onInput }: { fieldLabel: string; value: ReadonlySignal<string>; multiline: boolean; extra: Record<string, unknown>; onInput(next: string): void }) {
  const draft = externalDraft(getScope(), value);
  const { error, disabled } = extra as { error?: ReadonlySignal<string | undefined>; disabled?: ReadonlySignal<boolean> };
  return <Field label={fieldLabel} error={error}>{(control) => multiline
    ? <Textarea field={control} modelValue={draft} on:input={(event) => onInput(event.currentTarget.value)} />
    : <Input field={control} disabled={disabled} modelValue={draft} on:input={(event) => onInput(event.currentTarget.value)} />}</Field>;
}
