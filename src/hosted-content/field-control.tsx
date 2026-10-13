import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useDomId } from "../components/use-dom-id";
import { Input, Select, Switch, Textarea } from "../components/ui/form-controls";
import { ContentScalarControl } from "../features/content/scalar-control";
import { createMarkdownEditor, type MarkdownEditorController } from "../features/content/markdown-source";
import { applyMarkdownFormat, type MarkdownFormat } from "../features/content/markdown-formatting";
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
function MarkdownSourceControl({ identity, label, required, value, onChange, labels }: { identity: string; label: string; required: boolean; value: string; onChange(value: string): void; labels: HostedControlLabels }) {
  const labelId = `hosted-markdown-${useDomId()}`;
  const mount = useRef<HTMLDivElement>(null); const controller = useRef<MarkdownEditorController | null>(null); const callback = useRef(onChange); callback.current = onChange;
  useEffect(() => {
    if (!mount.current) return;
    const created = createMarkdownEditor({ parent: mount.current, value, labelledBy: labelId, required, theme: "light", onChange: (next) => callback.current(next) }); controller.current = created;
    return () => { controller.current = null; created.destroy(); };
  }, [identity, labelId, required]);
  useEffect(() => controller.current?.setValue(value), [identity, value]);
  const actions: { label: string; format: MarkdownFormat }[] = [{ label: labels.bold, format: "bold" }, { label: labels.italic, format: "italic" }, { label: labels.link, format: "link" }, { label: labels.heading, format: "heading" }];
  return <div class="hosted-content-editor__markdown"><span id={labelId} class="hosted-content-editor__sr-only">{label}</span><div class="hosted-content-editor__actions" role="toolbar" aria-label={label}>{actions.map((action) => <button type="button" key={action.format} onPointerDown={(event) => event.preventDefault()} onClick={() => { if (controller.current) applyMarkdownFormat(controller.current.view, action.format); }}>{action.label}</button>)}</div><div ref={mount} /></div>;
}
interface ControlProps {
  schema: ContentValueSchema; field: ContentFieldDefinition; value: JsonValue | undefined; permission: HostedFieldPermission;
  identity: string; label: string; content: HostedState; policy: HostedPolicy; labels: HostedControlLabels;
  disabledNumber?: boolean;
  listItem?: boolean;
  hasIncompleteInput?(controlPrefix: string): boolean;
  onIncompleteNumber?(controlId: string, raw: string | null): void;
  onChange(value: JsonValue | undefined): void;
}
/**
 * Typed values only. No routes, provider constructors, upload, schema or source execution.
 * Object/list/asset controls are separate from the local StructuredValueEditor/AssetUseCard (#903 §6) because those
 * take the full ContentAuthoringController, route intents ("Open in Assets") and upload; scalars and Markdown source are shared.
 */
export function HostedFieldControl(props: ControlProps): JSX.Element {
  const { schema, field, value, permission, identity, label, content, policy, labels, onChange } = props;
  if (!permission.replace && !["object", "list", "asset-use", "reference", "reference-list"].includes(schema.kind)) return <output aria-label={label}>{value === undefined ? labels.none : typeof value === "string" ? value : JSON.stringify(value)}</output>;
  if (schema.kind === "object") {
    const current = object(value);
    return <fieldset class="hosted-content-editor__structured"><legend>{label}</legend>{schema.fields.map((child) => {
      const allowed = permission.children?.find((p) => p.fieldId === child.id) ?? (permission.replace ? { fieldId: child.id, replace: true, clear: permission.clear } : undefined);
      if (!allowed || !fieldEditable(child, allowed)) return null;
      return <div class="hosted-content-editor__field" key={child.id}><span>{child.label}</span><HostedFieldControl {...props} schema={child} field={child} label={`${label}: ${child.label}`} value={current[child.id]} permission={allowed} identity={`${identity}/${child.id}`} onChange={(next) => { const updated = { ...current }; if (next === undefined) delete updated[child.id]; else updated[child.id] = next; onChange(updated); }} />{fieldClearable(child, allowed) ? <button type="button" disabled={!!props.hasIncompleteInput?.(`${identity}/${child.id}`)} aria-label={`${labels.clear}: ${label}: ${child.label}`} onClick={() => { if (props.hasIncompleteInput?.(`${identity}/${child.id}`)) return; props.onIncompleteNumber?.(`${identity}/${child.id}`, null); const updated = { ...current }; delete updated[child.id]; onChange(updated); }}>{labels.clear}</button> : null}</div>;
    })}</fieldset>;
  }
  if (schema.kind === "list") {
    const items = Array.isArray(value) ? value : [];
    const shapeAllowed = permission.replace && !protectedShape(schema.item);
    const incomplete = !!props.hasIncompleteInput?.(identity);
    return <div class="hosted-content-editor__list">{items.map((item, index) => <div class="hosted-content-editor__list-item" key={index}><HostedFieldControl {...props} schema={schema.item} listItem value={item} label={`${label}: ${labels.item} ${index + 1}`} identity={`${identity}/${index}`} permission={{ ...permission, maxLength: undefined, clear: permission.listRemove }} onChange={(next) => { if (next === undefined) return; const updated = [...items]; updated[index] = next; onChange(updated); }} /><div class="hosted-content-editor__actions">
      {shapeAllowed && permission.listRemove ? <button type="button" disabled={incomplete} aria-label={`${labels.removeItem}: ${label} ${index + 1}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>{labels.removeItem}</button> : null}
      {permission.listReorder && permission.replace && !protectedShape(schema.item) ? <><button type="button" disabled={incomplete || index === 0} aria-label={`${labels.moveUp}: ${label} ${index + 1}`} onClick={() => { const updated = [...items]; [updated[index - 1], updated[index]] = [updated[index]!, updated[index - 1]!]; onChange(updated); }}>{labels.moveUp}</button><button type="button" disabled={incomplete || index === items.length - 1} aria-label={`${labels.moveDown}: ${label} ${index + 1}`} onClick={() => { const updated = [...items]; [updated[index], updated[index + 1]] = [updated[index + 1]!, updated[index]!]; onChange(updated); }}>{labels.moveDown}</button></> : null}
    </div></div>)}{shapeAllowed && permission.listAdd ? <button type="button" disabled={incomplete || permission.maxLength !== undefined && items.length >= permission.maxLength} onClick={() => onChange([...items, defaultValue(schema.item)])}>{labels.addItem}: {label}</button> : null}</div>;
  }
  if (schema.kind === "reference" || schema.kind === "reference-list") {
    const refs = (schema.kind === "reference-list" ? (Array.isArray(value) ? value : []) : value ? [value] : []) as unknown as ContentEntryRef[];
    return <ul class="hosted-content-editor__references">{refs.map((ref) => <li key={key(ref)}>{entryLabel(content, ref)}</li>)}</ul>;
  }
  if (schema.kind === "asset-use") {
    const current = object(value);
    const currentRef = object(current.asset);
    const selected = policy.assets.find((asset) => asset.providerId === currentRef.providerId && asset.assetId === currentRef.assetId);
    const descriptive = schema.use === "image" ? ["alt", "decorative", "caption"] : schema.use === "download" ? ["label", "showSize", "showType"] : schema.use === "card" ? ["title", "description"] : ["label"];
    const patch = (name: string, next: JsonValue) => onChange({ ...current, [name]: next });
    const canInitialize = !!current.kind || descriptive.every((name) => permission.assetDescription?.includes(name));
    return <div class="hosted-content-editor__asset">
      {permission.assetSelect ? <Select aria-label={`${label}: ${labels.asset}`} value={selected ? key({ providerId: selected.providerId, modelId: "asset", recordId: selected.assetId }) : ""} onChange={(event) => {
        const asset = policy.assets.find((item) => key({ providerId: item.providerId, modelId: "asset", recordId: item.assetId }) === event.currentTarget.value);
        if (!asset || !canInitialize) return;
        const initial: Record<string, JsonValue> = { kind: schema.use, asset: { providerId: asset.providerId, assetId: asset.assetId } };
        for (const name of descriptive) initial[name] = ["decorative", "showSize", "showType"].includes(name) ? false : "";
        onChange(current.kind ? { ...current, asset: initial.asset! } : initial);
      }} disabled={!canInitialize}><option value="" disabled>{labels.none}</option>{policy.assets.map((asset) => <option key={`${asset.providerId}/${asset.assetId}`} value={key({ providerId: asset.providerId, modelId: "asset", recordId: asset.assetId })}>{asset.label}</option>)}</Select> : <p>{selected?.label ?? labels.unavailable}</p>}
      {selected && schema.use === "image" ? <img class="hosted-content-editor__asset-image" src={selected.url} alt="" /> : null}
      {current.kind ? descriptive.filter((name) => permission.assetDescription?.includes(name)).map((name) => <div class="hosted-content-editor__field" key={name}><span>{labels[name as keyof HostedControlLabels]}</span>{["decorative", "showSize", "showType"].includes(name) ? <Switch aria-label={`${label}: ${labels[name as keyof HostedControlLabels]}`} checked={current[name] === true} onCheckedChange={(next) => patch(name, next)} /> : name === "description" ? <Textarea aria-label={`${label}: ${labels.description}`} value={typeof current[name] === "string" ? current[name] : ""} onInput={(event) => patch(name, event.currentTarget.value)} /> : <Input aria-label={`${label}: ${labels[name as keyof HostedControlLabels]}`} value={typeof current[name] === "string" ? current[name] : ""} onInput={(event) => patch(name, event.currentTarget.value)} />}</div>) : null}
    </div>;
  }
  if (schema.kind === "markdown") return <MarkdownSourceControl identity={identity} label={label} required={field.required} value={typeof value === "string" ? value : ""} onChange={onChange} labels={labels} />;
  return <ContentScalarControl schema={schema} label={label} required={field.required} maxLength={permission.maxLength} value={value} emptyChoiceLabel={labels.choose} emptyChoiceDisabled={!permission.clear} disabled={schema.kind === "number" ? props.disabledNumber : undefined} retainIncompleteNumber allowEmptyNumber={!!permission.clear && !props.listItem} onIncompleteNumber={(raw) => props.onIncompleteNumber?.(identity, raw)} onChange={onChange} />;
}
