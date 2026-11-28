import { computed, For, getScope, Show, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { read, toSignal, type MaybeSignal } from "../components/reactive";
import { Rebuild } from "../components/rebuild";
import { createDomId } from "../components/use-dom-id";
import { Input, Select, Switch, Textarea } from "../components/ui/form-controls";
import { ContentScalarControl } from "../features/content/scalar-control";
import type { MarkdownEditorController } from "../features/content/markdown-source";
import { applyMarkdownFormat, type MarkdownFormat } from "../features/content/markdown-formatting";
import { externalDraft, stableComputed } from "../features/content/reactive-draft";
import type { ContentFieldDefinition, ContentValueSchema } from "../content/model/types";
import type { ContentEntryRef, HostedFieldPermission, HostedPolicy, HostedState, JsonValue } from "./types";

export interface HostedControlLabels {
  clear: string; addItem: string; removeItem: string; moveUp: string; moveDown: string;
  choose: string; none: string; unavailable: string; asset: string; item: string;
  bold: string; italic: string; link: string; heading: string;
  alt: string; caption: string; decorative: string; label: string; title: string; description: string; showSize: string; showType: string;
}
export const hostedControlLabels: HostedControlLabels = {
  clear: "Clear", addItem: "Add item", removeItem: "Remove item", moveUp: "Move up", moveDown: "Move down", choose: "Choose an option", none: "None", unavailable: "Unavailable", asset: "Approved asset", item: "Item",
  bold: "Bold", italic: "Italic", link: "Link", heading: "Heading", alt: "Alternative text", caption: "Caption", decorative: "Decorative image", label: "Label", title: "Title", description: "Description", showSize: "Show file size", showType: "Show file type",
};
const object = (value: JsonValue | undefined): Record<string, JsonValue> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
const key = (entry: ContentEntryRef) => JSON.stringify([entry.providerId, entry.modelId, entry.recordId]);
export function entryLabel(content: HostedState, ref: ContentEntryRef): string {
  const provider = content.providers.find((p) => p.providerId === ref.providerId);
  const entry = provider?.entries.find((e) => e.id === ref.recordId && e.modelId === ref.modelId);
  const model = provider?.models.find((m) => m.id === ref.modelId);
  const text = model?.document.fields.find((f) => f.kind === "text" && typeof entry?.values[f.id] === "string");
  return text ? String(entry!.values[text.id]) || model!.document.name : model?.document.name ?? "Unavailable";
}
export function fieldEditable(field: ContentValueSchema, permission: HostedFieldPermission | undefined): boolean {
  if (!permission || ["slug", "reference", "reference-list"].includes(field.kind)) return false;
  if (field.kind === "object") return field.fields.some((child) => fieldEditable(child, permission.children?.find((p) => p.fieldId === child.id) ?? (permission.replace ? { fieldId: child.id, replace: true, clear: permission.clear } : undefined)));
  if (field.kind === "asset-use") return !!permission.assetSelect || !!permission.assetDescription?.length;
  if (field.kind === "list") return fieldEditable(field.item, permission);
  return !!permission.replace || !!permission.clear;
}
export function fieldClearable(schema: ContentValueSchema, allowed: HostedFieldPermission | undefined): boolean {
  if (!allowed?.clear || ["slug", "reference", "reference-list", "list", "asset-use"].includes(schema.kind)) return false;
  if (schema.kind !== "object") return true;
  // Domain clearing an object requires explicit descendant clear permissions.
  return schema.fields.every((field) => fieldClearable(field, allowed.children?.find((child) => child.fieldId === field.id)));
}
function defaultValue(schema: ContentValueSchema): JsonValue {
  if (schema.kind === "boolean") return false;
  if (schema.kind === "number") return 0;
  if (schema.kind === "object") return {};
  if (schema.kind === "list" || schema.kind === "reference-list") return [];
  return "";
}
function protectedShape(schema: ContentValueSchema): boolean {
  return ["slug", "reference", "reference-list", "asset-use"].includes(schema.kind) || schema.kind === "object" && schema.fields.some(protectedShape) || schema.kind === "list" && protectedShape(schema.item);
}
/**
 * One CodeMirror source per mounted control. The editor module is imported on
 * activation, so a control removed before it arrives creates nothing; otherwise
 * the editor is created once and destroyed once, with the control's scope.
 */
function MarkdownSourceControl({ label, required, invalid, describedBy, value, onChange, labels }: { label: string; required: boolean; invalid?: MaybeSignal<boolean | undefined>; describedBy?: MaybeSignal<string | undefined>; value: ReadonlySignal<string>; onChange(value: string): void; labels: HostedControlLabels }) {
  const scope = getScope();
  const labelId = `hosted-markdown-${createDomId()}`;
  const mount: Ref<HTMLDivElement> = { current: null };
  let controller: MarkdownEditorController | null = null;
  const validity = computed(() => ({ invalid: Boolean(read(invalid)), describedBy: read(describedBy) }));
  scope.onCleanup(() => { controller?.destroy(); controller = null; });
  scope.onActivate(() => {
    void import("../features/content/markdown-source").then(({ createMarkdownEditor }) => {
      if (scope.abortSignal.aborted || !mount.current) return;
      controller = createMarkdownEditor({ parent: mount.current, value: value.value, labelledBy: labelId, required, ...validity.value, theme: "light", onChange: (next) => onChange(next) });
    });
  });
  scope.effect(() => { const next = value.value; controller?.setValue(next); });
  scope.effect(() => { const next = validity.value; controller?.setInvalid(next.invalid, next.describedBy); });
  const actions: { label: string; format: MarkdownFormat }[] = [{ label: labels.bold, format: "bold" }, { label: labels.italic, format: "italic" }, { label: labels.link, format: "link" }, { label: labels.heading, format: "heading" }];
  return <div class="hosted-content-editor__markdown"><span id={labelId} class="hosted-content-editor__sr-only">{label}</span><div class="hosted-content-editor__actions" role="toolbar" aria-label={label}>{actions.map((action) => <button type="button" on:pointerdown={(event) => event.preventDefault()} on:click={() => { if (controller) applyMarkdownFormat(controller.view, action.format); }}>{action.label}</button>)}</div><div ref={mount} /></div>;
}
interface ControlProps {
  /** Static for the control's lifetime; a schema change remounts it. */
  schema: ContentValueSchema; field: ContentFieldDefinition; value: MaybeSignal<JsonValue | undefined>; permission: HostedFieldPermission;
  identity: string; label: string; content: MaybeSignal<HostedState>; policy: HostedPolicy; labels: HostedControlLabels;
  disabledNumber?: MaybeSignal<boolean | undefined>;
  listItem?: boolean;
  /** Top-level text and Markdown controls only; nested controls never inherit it. */
  invalid?: MaybeSignal<boolean | undefined>;
  describedBy?: MaybeSignal<string | undefined>;
  /** Read inside a binding, so it may follow the session's live state. */
  hasIncompleteInput?(controlPrefix: string): boolean;
  onIncompleteNumber?(controlId: string, raw: string | null): void;
  onChange(value: JsonValue | undefined): void;
}
type DescriptiveName = "alt" | "decorative" | "caption" | "label" | "showSize" | "showType" | "title" | "description";
const SWITCHES: readonly string[] = ["decorative", "showSize", "showType"];
/**
 * Typed values only. No routes, provider constructors, upload, schema or source execution.
 * Object/list/asset controls are separate from the local StructuredValueEditor/AssetUseCard (#903 §6) because those
 * take the full ContentAuthoringController, route intents ("Open in Assets") and upload; scalars and Markdown source are shared.
 */
export function HostedFieldControl(props: ControlProps) {
  const { schema, field, permission, identity, label, policy, labels, onChange } = props;
  const scope = getScope();
  const value = toSignal(props.value);
  if (!permission.replace && !["object", "list", "asset-use", "reference", "reference-list"].includes(schema.kind)) return <output aria-label={label}>{computed(() => { const current = value.value; return current === undefined ? labels.none : typeof current === "string" ? current : JSON.stringify(current); })}</output>;
  if (schema.kind === "object") {
    const current = computed(() => object(value.value));
    return <fieldset class="hosted-content-editor__structured"><legend>{label}</legend>{schema.fields.map((child) => {
      const allowed = permission.children?.find((p) => p.fieldId === child.id) ?? (permission.replace ? { fieldId: child.id, replace: true, clear: permission.clear } : undefined);
      if (!allowed || !fieldEditable(child, allowed)) return null;
      const childId = `${identity}/${child.id}`;
      return <div class="hosted-content-editor__field"><span>{child.label}</span><HostedFieldControl {...props} invalid={undefined} describedBy={undefined} schema={child} field={child} label={`${label}: ${child.label}`} value={computed(() => current.value[child.id])} permission={allowed} identity={childId} onChange={(next) => { const updated = { ...current.value }; if (next === undefined) delete updated[child.id]; else updated[child.id] = next; onChange(updated); }} />{fieldClearable(child, allowed) ? <button type="button" disabled={computed(() => !!props.hasIncompleteInput?.(childId))} aria-label={`${labels.clear}: ${label}: ${child.label}`} on:click={() => { if (props.hasIncompleteInput?.(childId)) return; props.onIncompleteNumber?.(childId, null); const updated = { ...current.value }; delete updated[child.id]; onChange(updated); }}>{labels.clear}</button> : null}</div>;
    })}</fieldset>;
  }
  if (schema.kind === "list") {
    const items = computed(() => Array.isArray(value.value) ? value.value : []);
    const slots = stableComputed(() => items.value.map((_, index) => index), (indexes) => String(indexes.length));
    const shapeAllowed = permission.replace && !protectedShape(schema.item);
    const incomplete = computed(() => !!props.hasIncompleteInput?.(identity));
    return <div class="hosted-content-editor__list"><For each={slots} by={(index) => index}>{(slot) => {
      const index = slot.value;
      return <div class="hosted-content-editor__list-item"><HostedFieldControl {...props} invalid={undefined} describedBy={undefined} schema={schema.item} listItem value={computed(() => items.value[index])} label={`${label}: ${labels.item} ${index + 1}`} identity={`${identity}/${index}`} permission={{ ...permission, maxLength: undefined, clear: permission.listRemove }} onChange={(next) => { if (next === undefined) return; const updated = [...items.value]; updated[index] = next; onChange(updated); }} /><div class="hosted-content-editor__actions">
        {shapeAllowed && permission.listRemove ? <button type="button" disabled={incomplete} aria-label={`${labels.removeItem}: ${label} ${index + 1}`} on:click={() => onChange(items.value.filter((_, i) => i !== index))}>{labels.removeItem}</button> : null}
        {permission.listReorder && permission.replace && !protectedShape(schema.item) ? <><button type="button" disabled={computed(() => incomplete.value || index === 0)} aria-label={`${labels.moveUp}: ${label} ${index + 1}`} on:click={() => { const updated = [...items.value]; [updated[index - 1], updated[index]] = [updated[index]!, updated[index - 1]!]; onChange(updated); }}>{labels.moveUp}</button><button type="button" disabled={computed(() => incomplete.value || index === items.value.length - 1)} aria-label={`${labels.moveDown}: ${label} ${index + 1}`} on:click={() => { const updated = [...items.value]; [updated[index], updated[index + 1]] = [updated[index + 1]!, updated[index]!]; onChange(updated); }}>{labels.moveDown}</button></> : null}
      </div></div>;
    }}</For>{shapeAllowed && permission.listAdd ? <button type="button" disabled={computed(() => incomplete.value || permission.maxLength !== undefined && items.value.length >= permission.maxLength)} on:click={() => onChange([...items.value, defaultValue(schema.item)])}>{labels.addItem}: {label}</button> : null}</div>;
  }
  if (schema.kind === "reference" || schema.kind === "reference-list") {
    const refs = computed(() => (schema.kind === "reference-list" ? (Array.isArray(value.value) ? value.value : []) : value.value ? [value.value] : []) as unknown as ContentEntryRef[]);
    return <ul class="hosted-content-editor__references"><For each={refs} by={key}>{(ref) => <li>{computed(() => entryLabel(read(props.content), ref.value))}</li>}</For></ul>;
  }
  if (schema.kind === "asset-use") {
    const current = computed(() => object(value.value));
    const selected = computed(() => { const ref = object(current.value.asset); return policy.assets.find((asset) => asset.providerId === ref.providerId && asset.assetId === ref.assetId); });
    const descriptive: readonly DescriptiveName[] = schema.use === "image" ? ["alt", "decorative", "caption"] : schema.use === "download" ? ["label", "showSize", "showType"] : schema.use === "card" ? ["title", "description"] : ["label"];
    const patch = (name: string, next: JsonValue) => onChange({ ...current.value, [name]: next });
    const initialized = computed(() => !!current.value.kind);
    const canInitialize = computed(() => initialized.value || descriptive.every((name) => permission.assetDescription?.includes(name)));
    const assetKey = (asset: { providerId: string; assetId: string }) => key({ providerId: asset.providerId, modelId: "asset", recordId: asset.assetId });
    const textOf = (name: string) => computed(() => { const text = current.value[name]; return typeof text === "string" ? text : ""; });
    return <div class="hosted-content-editor__asset">
      {permission.assetSelect ? <Select aria-label={`${label}: ${labels.asset}`} modelValue={externalDraft(scope, computed(() => selected.value ? assetKey(selected.value) : ""))} on:change={(event) => {
        const asset = policy.assets.find((item) => assetKey(item) === event.currentTarget.value);
        if (!asset || !canInitialize.value) return;
        const initial: Record<string, JsonValue> = { kind: schema.use, asset: { providerId: asset.providerId, assetId: asset.assetId } };
        for (const name of descriptive) initial[name] = SWITCHES.includes(name) ? false : "";
        onChange(current.value.kind ? { ...current.value, asset: initial.asset! } : initial);
      }} disabled={computed(() => !canInitialize.value)}><option value="" disabled>{labels.none}</option>{policy.assets.map((asset) => <option value={assetKey(asset)}>{asset.label}</option>)}</Select> : <p>{computed(() => selected.value?.label ?? labels.unavailable)}</p>}
      {schema.use === "image" ? <Rebuild value={computed(() => selected.value?.url ?? null)}>{(url) => url === null ? null : <img class="hosted-content-editor__asset-image" src={url} alt="" />}</Rebuild> : null}
      <Show when={initialized}>{() => <>{descriptive.filter((name) => permission.assetDescription?.includes(name)).map((name) => <div class="hosted-content-editor__field"><span>{labels[name]}</span>{SWITCHES.includes(name) ? <Switch aria-label={`${label}: ${labels[name]}`} checked={computed(() => current.value[name] === true)} onCheckedChange={(next) => patch(name, next)} /> : name === "description" ? <Textarea aria-label={`${label}: ${labels.description}`} modelValue={externalDraft(getScope(), textOf(name))} on:input={(event) => patch(name, event.currentTarget.value)} /> : <Input aria-label={`${label}: ${labels[name]}`} modelValue={externalDraft(getScope(), textOf(name))} on:input={(event) => patch(name, event.currentTarget.value)} />}</div>)}</>}</Show>
    </div>;
  }
  if (schema.kind === "markdown") return <MarkdownSourceControl label={label} required={field.required} invalid={props.invalid} describedBy={props.describedBy} value={computed(() => typeof value.value === "string" ? value.value : "")} onChange={onChange} labels={labels} />;
  return <ContentScalarControl schema={schema} label={label} required={field.required} maxLength={permission.maxLength} value={value} emptyChoiceLabel={labels.choose} emptyChoiceDisabled={!permission.clear} disabled={schema.kind === "number" ? props.disabledNumber : undefined} invalid={props.invalid} describedBy={props.describedBy} retainIncompleteNumber allowEmptyNumber={!!permission.clear && !props.listItem} onIncompleteNumber={(raw) => props.onIncompleteNumber?.(identity, raw)} onChange={onChange} />;
}
