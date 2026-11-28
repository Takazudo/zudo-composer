import { downloadAsset } from "../../browser/asset-download.mjs";
import { computed, For, getScope, Show, signal, type Child, type ReadonlySignal, type Signal } from "@takazudo/zfb/zudo-react";
import { Dialog } from "../../components/overlay";
import { liveSlot } from "../../components/rebuild";
import { Banner, Button, Checkbox, Field, Input, Select, SegmentedControl, Textarea } from "../../components/ui";
import { ASSET_MAX_BYTE_LENGTH, assetDownloadFileName, assetTypeLabel, assetByteLabel, type AssetSummary } from "../../assets";
import type { AssetInsertionTarget, AssetUse } from "../../assets/integration/content";
import type { AssetLibraryController } from "./controller";
import { AssetPickerDialog, type AssetPickerDialogProps } from "./asset-picker-dialog";

const targetKey = (target: AssetInsertionTarget) => JSON.stringify([target.providerId, target.modelId, target.entryId, target.fieldId, target.valuePath]);
const targetLabel = (item: AssetInsertionTarget) => `${item.modelName} / ${item.entryTitle} / ${item.fieldLabel}${item.valuePath.length ? ` / ${item.valuePath.join(" / ")}` : ""}`;

export function AssetUsePicker({ record, controller, onClose }: { record: AssetSummary; controller: AssetLibraryController; onClose(): void }): Child {
  const scope = getScope();
  const targets = signal<readonly AssetInsertionTarget[]>([]);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const kind = signal<AssetUse["kind"]>(record.mimeType.startsWith("image/") ? "image" : record.mimeType === "application/pdf" ? "link" : "download");
  const selected = signal("");
  scope.onActivate(() => {
    const live = () => !scope.abortSignal.aborted;
    if (!controller.contentServices) {
      error.value = "Authoritative Content destinations are unavailable.";
      loading.value = false;
    } else void controller.contentServices.targets().then((value) => { if (live()) targets.value = value; }).catch((reason) => { if (live()) error.value = reason.message; }).finally(() => { if (live()) loading.value = false; });
  });
  const eligible = computed(() => targets.value.filter((target) => target.kind === kind.value));
  const target = computed(() => eligible.value.find((item) => targetKey(item) === selected.value) ?? eligible.value[0]);
  // The options of a select are static, so the whole select is rebuilt when the
  // eligible destinations change; each rebuild starts from the shown target.
  const optionSets = computed(() => [eligible.value.map((item) => ({ key: targetKey(item), label: targetLabel(item) }))]);
  const destination = () => (
    <Field label="Content destination" help={computed(() => (target.value?.append ? "Append to this asset list." : "Replace this single asset field."))}>
      {(field) => <For each={optionSets} by={(options) => JSON.stringify(options)}>{(options) => {
        const model = signal(target.value ? targetKey(target.value) : "");
        return <Select field={field} modelValue={model} on:change={(event) => { selected.value = event.currentTarget.value; }}>
          <option value="" disabled>Choose model / entry / field</option>
          {options.value.map((option) => <option value={option.key}>{option.label}</option>)}
        </Select>;
      }}</For>}
    </Field>
  );
  return <Dialog open title="Use this asset" onClose={onClose} dismissOnBackdrop={false}>
    <Show when={computed(() => Boolean(error.value))}>{() => <Banner tone="err">{computed(() => error.value ?? "")}</Banner>}</Show>
    <AssetUseForm record={record} providerId={controller.provider.descriptor.id} kind={kind} onKindChange={(next) => { kind.value = next; }} disabled={computed(() => loading.value || !target.value)} onClose={onClose} onSubmit={async (value) => { const chosen = target.value; if (!chosen) throw new Error("Choose an available Content destination."); await controller.insert(chosen, value); onClose(); }}>
      <Show when={loading} fallback={destination}>{() => <p role="status">Loading complete Content destinations…</p>}</Show>
      <Show when={computed(() => !loading.value && !eligible.value.length)}>{() => <p>{computed(() => `No writable ${kind.value} fields are available. Create a matching asset-use field in Content first.`)}</p>}</Show>
    </AssetUseForm>
  </Dialog>;
}

/** An explicit field integration: the caller receives a typed value and owns
 * its Content save session. No global selection or prototype state is used. */
export function AssetFieldPicker(props: AssetPickerDialogProps): Child {
  return <AssetPickerDialog {...props} />;
}

function AssetUseForm({ record, providerId, kind, onKindChange, onSubmit, onClose, disabled = false, children }: {
  record: AssetSummary; providerId: string; kind: Signal<AssetUse["kind"]>; onKindChange?(kind: AssetUse["kind"]): void;
  onSubmit(value: AssetUse): Promise<void>; onClose(): void; disabled?: boolean | ReadonlySignal<boolean>; children?: Child;
}): Child {
  const scope = getScope();
  const text = signal(""); const label = signal(record.fileName); const decorative = signal(false);
  const busy = signal(false); const error = signal<string | null>(null);
  const showSize = signal(true); const showType = signal(true);
  const asset = { providerId, assetId: record.id };
  const value = computed((): AssetUse => {
    const current = kind.value;
    return current === "image" ? { kind: current, asset, alt: decorative.value ? "" : text.value, decorative: decorative.value, caption: label.value }
      : current === "download" ? { kind: current, asset, label: label.value, showSize: showSize.value, showType: showType.value } : current === "link" ? { kind: current, asset, label: label.value } : { kind: current, asset, title: label.value, description: text.value };
  });
  const valid = computed(() => (kind.value === "image" ? decorative.value || text.value.trim().length > 0 : label.value.trim().length > 0));
  const blocked = computed(() => (typeof disabled === "boolean" ? disabled : disabled.value));
  const preview = computed((): Child => {
    const current = kind.value;
    if (current === "image") return <img src={record.url} alt={decorative.value ? "" : text.value} />;
    if (current === "download") {
      const name = [label.value, showType.value ? assetTypeLabel(record.mimeType) : "", showSize.value ? assetByteLabel(record.byteLength) : ""].filter(Boolean).join(" · ");
      return <a aria-label={name} href={record.url} download={assetDownloadFileName(record.fileName, record.mimeType)} on:click={(event) => { void downloadAsset(event, ASSET_MAX_BYTE_LENGTH); }}>{label.value}{showType.value ? ` · ${assetTypeLabel(record.mimeType)}` : ""}{showSize.value ? ` · ${assetByteLabel(record.byteLength)}` : ""}</a>;
    }
    if (current === "link") return <a href={record.url} target="_blank" rel="noreferrer">{label.value}</a>;
    return <article><strong>{label.value}</strong><p>{text.value}</p></article>;
  });
  const describes = computed(() => kind.value === "image" || kind.value === "card");
  const describeLabel = computed(() => (kind.value === "image" ? "Alternative text for this usage" : "Card description"));
  const labelText = computed(() => (kind.value === "image" ? "Caption" : kind.value === "download" ? "Download label" : kind.value === "link" ? "Link label" : "Card title"));
  const submit = () => {
    busy.value = true; error.value = null;
    void onSubmit(value.value)
      .catch((reason) => { if (!scope.abortSignal.aborted) error.value = reason.message; })
      .finally(() => { if (!scope.abortSignal.aborted) busy.value = false; });
  };
  return <fieldset class="sg-assets-use-form" disabled={busy}>
    {onKindChange ? <SegmentedControl label="Asset presentation" value={kind} onChange={onKindChange} options={[{ value: "image", label: "Image", disabled: !record.mimeType.startsWith("image/") }, { value: "link", label: "Link" }, { value: "card", label: "Card" }, { value: "download", label: "Download" }]} /> : null}
    <div class="sg-assets-use-preview">{liveSlot(preview)}</div>
    <Show when={describes}>{() => <Field label={describeLabel} help="Saved on this Content usage, independently of the asset's internal note.">{(field) => <Textarea field={field} modelValue={text} disabled={computed(() => busy.value || (kind.value === "image" && decorative.value))} />}</Field>}</Show>
    <Show when={computed(() => kind.value === "image")}>{() => <label class="sg-assets-actions"><Checkbox aria-label="Decorative image" checked={decorative} disabled={busy} onCheckedChange={(next) => { decorative.value = next; }} /> Decorative image</label>}</Show>
    <Field label={labelText}>{(field) => <Input field={field} modelValue={label} disabled={busy} />}</Field>
    <Show when={computed(() => kind.value === "download")}>{() => <><label><Checkbox aria-label="Show file size" checked={showSize} onCheckedChange={(next) => { showSize.value = next; }} /> Show file size</label><label><Checkbox aria-label="Show file type" checked={showType} onCheckedChange={(next) => { showType.value = next; }} /> Show file type</label></>}</Show>
    {children}
    <Show when={computed(() => Boolean(error.value))}>{() => <Banner tone="err">{computed(() => error.value ?? "")}</Banner>}</Show>
    <div class="sg-assets-actions"><Button disabled={busy} on:click={onClose}>Cancel</Button><Button variant="primary" disabled={computed(() => blocked.value || busy.value || !valid.value)} on:click={submit}>{computed(() => (busy.value ? "Saving usage…" : "Use in content"))}</Button></div>
  </fieldset>;
}
