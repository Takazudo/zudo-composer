import { computed, For, getScope, Show, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { JsonValue } from "@zudo-composer/component-contract";
import { encodeContentValuePath } from "../../app/route-intents";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, WarningIcon } from "../../components/icons";
import { Rebuild } from "../../components/rebuild";
import { externalDraft, keyedBy, toSignal, type MaybeSignal } from "../../components/reactive";
import { Button, Checkbox, Field, Select, type FieldControl } from "../../components/ui";
import type { ContentEntryRef, ContentFieldDefinition, ContentAssetRef, ContentAssetUse, ContentValueSchema } from "../../content";
import type { ContentAuthoringController } from "./controller";
import { ContentScalarControl } from "./scalar-control";
import { AssetUseCard } from "./asset-use-card";

type ContentAuthorRun = (action: () => void | Promise<void>) => void;
export type ContentAssetPickerRenderer = (request: {
  kind: ContentAssetUse["kind"];
  current?: ContentAssetRef;
  intent?: "upload";
  onSelect(use: ContentAssetUse): void;
  onClose(): void;
}) => Child;

type ReferenceOption = Awaited<ReturnType<ContentAuthoringController["referenceEntries"]>>[number];

function ReferenceControl({ schema, value, path, label, multiple, controller, commit }: { schema: Extract<ContentValueSchema, { kind: "reference" | "reference-list" }>; value: ReadonlySignal<JsonValue | undefined>; path: readonly (string | number)[]; label: string; multiple: boolean; controller: ContentAuthoringController; commit(value: JsonValue | undefined): void }) {
  const scope = getScope();
  const options = signal<readonly ReferenceOption[]>([]);
  const error = signal<string | null>(null);
  scope.onActivate(() => {
    void controller.referenceEntries(schema.target).then((items) => { if (!scope.abortSignal.aborted) options.value = items; }, (cause: unknown) => { if (!scope.abortSignal.aborted) error.value = cause instanceof Error ? cause.message : "Reference catalog unavailable."; });
  });
  const selected = computed(() => (multiple ? (Array.isArray(value.value) ? value.value : []) : value.value ? [value.value] : []) as unknown as ContentEntryRef[]);
  // Committed synchronously by each toggle, so two clicks before the record
  // round-trips build on each other rather than on a stale selection.
  let latest = selected.value;
  scope.effect(() => { latest = selected.value; });
  const stale = computed(() => selected.value.filter((ref) => !options.value.some((option) => option.ref.providerId === ref.providerId && option.ref.modelId === ref.modelId && option.ref.recordId === ref.recordId)));
  const errorLine = <Show when={computed(() => error.value !== null)}>{() => <p class="sg-content-field-error"><WarningIcon size="xs" />{computed(() => error.value ?? "")}</p>}</Show>;
  if (!multiple) {
    // A select takes static options, so it is rebuilt whenever the choices change.
    const choices = keyedBy(() => ({ options: options.value, stale: stale.value }), (current) => JSON.stringify([current.options.map((option) => [option.ref.recordId, option.label, option.lifecycle]), current.stale.map((ref) => ref.recordId)]));
    return <div class="sg-content-reference">
      <Rebuild value={choices}>{(current) => <SingleReferenceSelect label={label} selected={selected} options={current.options} stale={current.stale} onChange={(recordId) => { const option = options.value.find((item) => item.ref.recordId === recordId); commit(option ? option.ref as unknown as JsonValue : undefined); }} />}</Rebuild>
      {errorLine}
      <Show when={computed(() => stale.value.length > 0)}>{() => <p class="sg-content-field-error">The selected Entry is stale. Choose another Entry or clear it.</p>}</Show>
    </div>;
  }
  const ordered = schema.kind === "reference-list" && schema.ordered;
  const labelOf = (ref: ContentEntryRef) => options.value.find((item) => item.ref.recordId === ref.recordId)?.label;
  const reorder = (index: number, direction: -1 | 1) => { const next = [...selected.value], target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target]!, next[index]!]; commit(next as unknown as JsonValue); };
  return <div class="sg-content-reference-list">
    {errorLine}
    <div class="sg-content-reference-options"><For each={options} by={(option) => option.ref.recordId}>{(option) => {
      const ref = option.value.ref;
      return <Checkbox id={`content-reference-${ref.providerId}-${ref.recordId}`} label={<>{option.value.label} <small>{option.value.lifecycle}</small></>} checked={computed(() => selected.value.some((item) => item.recordId === ref.recordId))} onCheckedChange={(checked) => { const current = latest; const next = checked ? [...current.filter((item) => item.recordId !== ref.recordId), ref] : current.filter((item) => item.recordId !== ref.recordId); latest = next; commit(next as unknown as JsonValue); }} />;
    }}</For></div>
    <For each={stale} by={(ref) => ref.recordId}>{(ref) => <p class="sg-content-field-error">Missing referenced Entry: <code>{ref.value.recordId}</code> <Button size="xs" on:click={() => commit(selected.value.filter((item) => item.recordId !== ref.value.recordId) as unknown as JsonValue)}>Remove</Button></p>}</For>
    <Show when={computed(() => selected.value.length > 0)}>{() => <ol class="sg-content-order" data-ordered={ordered || undefined}><For each={selected} by={(ref) => ref.recordId}>{(ref, index) => {
      const name = computed(() => labelOf(ref.value) ?? ref.value.recordId);
      return <li tabindex={-1} data-content-value-path={computed(() => encodeContentValuePath([...path, index.value]))}><span>{computed(() => labelOf(ref.value) ?? `Missing Entry · ${ref.value.recordId}`)}</span>{ordered ? <><Button iconOnly size="xs" aria-label={computed(() => `Move ${name.value} up`)} disabled={computed(() => index.value === 0)} on:click={() => reorder(index.value, -1)}><ArrowUpIcon size="xs" /></Button><Button iconOnly size="xs" aria-label={computed(() => `Move ${name.value} down`)} disabled={computed(() => index.value === selected.value.length - 1)} on:click={() => reorder(index.value, 1)}><ArrowDownIcon size="xs" /></Button></> : null}</li>;
    }}</For></ol>}</Show>
  </div>;
}

function SingleReferenceSelect({ label, selected, options, stale, onChange }: { label: string; selected: ReadonlySignal<ContentEntryRef[]>; options: readonly ReferenceOption[]; stale: readonly ContentEntryRef[]; onChange(recordId: string): void }) {
  const draft = externalDraft(getScope(), computed(() => selected.value[0]?.recordId ?? ""));
  return <Select aria-label={label} modelValue={draft} on:change={(event) => onChange(event.currentTarget.value)}><option value="">No Entry selected</option>{options.map((option) => <option value={option.ref.recordId}>{`${option.label} · ${option.lifecycle}`}</option>)}{stale.map((ref) => <option value={ref.recordId}>{`Missing Entry · ${ref.recordId}`}</option>)}</Select>;
}

export interface StructuredValueEditorProps {
  /** Static for the editor's lifetime; a schema change remounts the form. */
  schema: ContentValueSchema;
  field: ContentFieldDefinition;
  value: MaybeSignal<JsonValue | undefined>;
  path: readonly (string | number)[];
  controller: ContentAuthoringController;
  run: ContentAuthorRun;
  renderAssetPicker?: ContentAssetPickerRenderer;
  assetPickerCapabilities?: { upload: boolean };
  /** The wiring of the `<Field>` this editor sits in, for its scalar control. */
  fieldControl?: FieldControl;
  commit(value: JsonValue | undefined): void;
}

export function StructuredValueEditor({ schema, field, path, controller, run, renderAssetPicker, assetPickerCapabilities, fieldControl, commit, ...props }: StructuredValueEditorProps) {
  const value = toSignal(props.value);
  const invoke = (next: JsonValue | undefined) => run(() => commit(next));
  const nested = { controller, run, renderAssetPicker, assetPickerCapabilities };
  if (schema.kind === "choice") return <ContentScalarControl schema={schema} value={value} field={fieldControl} onChange={invoke} />;
  if (schema.kind === "reference" || schema.kind === "reference-list") return <ReferenceControl schema={schema} value={value} path={path} label={field.label} multiple={schema.kind === "reference-list"} controller={controller} commit={invoke} />;
  if (schema.kind === "asset-use") return <AssetUseCard kind={schema.use} value={value} controller={controller} renderAssetPicker={renderAssetPicker} assetPickerCapabilities={assetPickerCapabilities} commit={invoke} />;
  if (schema.kind === "object") {
    const object = computed(() => value.value && typeof value.value === "object" && !Array.isArray(value.value) ? value.value as Record<string, JsonValue> : {});
    return <fieldset class="sg-content-structured"><legend>{field.label}</legend>{schema.fields.map((child) => <div data-content-value-path={encodeContentValuePath([...path, child.id])}><Field controlId={`content-entry-${field.id}-${[...path, child.id].join("-")}`} label={child.label} required={child.required}>{(control) => <StructuredValueEditor schema={child} field={child} value={computed(() => object.value[child.id])} path={[...path, child.id]} {...nested} fieldControl={control} commit={(next) => { const updated = { ...object.value }; if (next === undefined || next === "") delete updated[child.id]; else updated[child.id] = next; invoke(updated); }} />}</Field></div>)}</fieldset>;
  }
  if (schema.kind === "list") {
    const list = computed(() => Array.isArray(value.value) ? value.value : []);
    const indexes = keyedBy(() => list.value.map((_, index) => index), (items) => String(items.length));
    return <div class="sg-content-list"><For each={indexes} by={(index) => index}>{(slot) => {
      const index = slot.value;
      return <div class="sg-content-list__item" data-content-value-path={encodeContentValuePath([...path, index])}><StructuredValueEditor schema={schema.item} field={field} value={computed(() => list.value[index])} path={[...path, index]} {...nested} commit={(next) => { const updated = [...list.value]; if (next === undefined) updated.splice(index, 1); else updated[index] = next; invoke(updated); }} /><Button iconOnly size="sm" aria-label={`Remove item ${index + 1}`} on:click={() => { const updated = [...list.value]; updated.splice(index, 1); invoke(updated); }}><TrashIcon size="xs" /></Button></div>;
    }}</For><Button size="sm" on:click={() => invoke([...list.value, emptyValue(schema.item)])}><PlusIcon size="xs" />Add item</Button></div>;
  }
  return <ContentScalarControl schema={schema} value={value} label={schema.kind === "boolean" ? field.label : undefined} field={fieldControl} onChange={invoke} />;
}

function emptyValue(schema: ContentValueSchema): JsonValue {
  if (schema.kind === "boolean") return false;
  if (schema.kind === "number") return 0;
  if (schema.kind === "object") return {};
  if (schema.kind === "list" || schema.kind === "reference-list") return [];
  return "";
}
