import type { JsonValue } from "@zudo-composer/component-contract";
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { encodeContentValuePath } from "../../app/route-intents";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon, WarningIcon } from "../../components/icons";
import { Button, Checkbox, Field, Input, Select, Switch, Textarea } from "../../components/ui";
import type { ContentEntryRef, ContentFieldDefinition, ContentAssetRef, ContentAssetUse, ContentValueSchema } from "../../content";
import type { ContentAuthoringController } from "./controller";
import { AssetUseCard } from "./asset-use-card";

type ContentAuthorRun = (action: () => void | Promise<void>) => void;
export type ContentAssetPickerRenderer = (request: {
  kind: ContentAssetUse["kind"];
  current?: ContentAssetRef;
  intent?: "upload";
  onSelect(use: ContentAssetUse): void;
  onClose(): void;
}) => ComponentChildren;

const text = (value: JsonValue | undefined) => typeof value === "string" || typeof value === "number" ? String(value) : "";

function ReferenceControl({ schema, value, path, label, multiple, controller, commit }: { schema: Extract<ContentValueSchema, { kind: "reference" | "reference-list" }>; value: JsonValue | undefined; path: readonly (string | number)[]; label: string; multiple: boolean; controller: ContentAuthoringController; commit(value: JsonValue | undefined): void }): JSX.Element {
  const [options, setOptions] = useState<Awaited<ReturnType<ContentAuthoringController["referenceEntries"]>>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; setError(null); void controller.referenceEntries(schema.target).then((items) => { if (live) setOptions(items); }, (cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : "Reference catalog unavailable."); }); return () => { live = false; }; }, [controller, schema.target.providerId, schema.target.recordId]);
  const selected = (multiple ? (Array.isArray(value) ? value : []) : value ? [value] : []) as unknown as ContentEntryRef[];
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const selectedIds = new Set(selected.map((ref) => ref.recordId));
  const stale = selected.filter((ref) => !options.some((option) => option.ref.providerId === ref.providerId && option.ref.modelId === ref.modelId && option.ref.recordId === ref.recordId));
  if (!multiple) return <div class="sg-content-reference"><Select aria-label={label} value={selected[0]?.recordId ?? ""} onChange={(event) => { const option = options.find((item) => item.ref.recordId === event.currentTarget.value); commit(option ? option.ref as unknown as JsonValue : undefined); }}><option value="">No Entry selected</option>{options.map((option) => <option key={option.ref.recordId} value={option.ref.recordId}>{option.label} · {option.lifecycle}</option>)}{stale.map((ref) => <option key={ref.recordId} value={ref.recordId}>Missing Entry · {ref.recordId}</option>)}</Select>{error ? <p class="sg-content-field-error"><WarningIcon size="xs" />{error}</p> : null}{stale.length ? <p class="sg-content-field-error">The selected Entry is stale. Choose another Entry or clear it.</p> : null}</div>;
  const reorder = (index: number, direction: -1 | 1) => { const next = [...selected], target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target]!, next[index]!]; commit(next as unknown as JsonValue); };
  return <div class="sg-content-reference-list">
    {error ? <p class="sg-content-field-error"><WarningIcon size="xs" />{error}</p> : null}
    <div class="sg-content-reference-options">{options.map((option) => <Checkbox id={`content-reference-${option.ref.providerId}-${option.ref.recordId}`} key={option.ref.recordId} label={<>{option.label} <small>{option.lifecycle}</small></>} checked={selectedIds.has(option.ref.recordId)} onCheckedChange={(checked) => { const current = selectedRef.current; const next = checked ? [...current.filter((ref) => ref.recordId !== option.ref.recordId), option.ref] : current.filter((ref) => ref.recordId !== option.ref.recordId); selectedRef.current = next; commit(next as unknown as JsonValue); }} />)}</div>
    {stale.map((ref) => <p class="sg-content-field-error" key={ref.recordId}>Missing referenced Entry: <code>{ref.recordId}</code> <Button size="xs" onClick={() => commit(selected.filter((item) => item.recordId !== ref.recordId) as unknown as JsonValue)}>Remove</Button></p>)}
    {selected.length > 0 ? <ol class="sg-content-order" data-ordered={schema.kind === "reference-list" && schema.ordered || undefined}>{selected.map((ref, index) => { const option = options.find((item) => item.ref.recordId === ref.recordId); return <li tabIndex={-1} data-content-value-path={encodeContentValuePath([...path, index])} key={ref.recordId}><span>{option?.label ?? `Missing Entry · ${ref.recordId}`}</span>{schema.kind === "reference-list" && schema.ordered ? <><Button iconOnly size="xs" aria-label={`Move ${option?.label ?? ref.recordId} up`} disabled={index === 0} onClick={() => reorder(index, -1)}><ArrowUpIcon size="xs" /></Button><Button iconOnly size="xs" aria-label={`Move ${option?.label ?? ref.recordId} down`} disabled={index === selected.length - 1} onClick={() => reorder(index, 1)}><ArrowDownIcon size="xs" /></Button></> : null}</li>; })}</ol> : null}
  </div>;
}

export function StructuredValueEditor({ schema, field, value, path, controller, run, renderAssetPicker, assetPickerCapabilities, commit }: { schema: ContentValueSchema; field: ContentFieldDefinition; value: JsonValue | undefined; path: readonly (string | number)[]; controller: ContentAuthoringController; run: ContentAuthorRun; renderAssetPicker?: ContentAssetPickerRenderer; assetPickerCapabilities?: { upload: boolean }; commit(value: JsonValue | undefined): void }): JSX.Element {
  const invoke = (next: JsonValue | undefined) => run(() => commit(next));
  if (schema.kind === "choice") return <Select value={text(value)} onChange={(event) => invoke(event.currentTarget.value || undefined)}><option value="">Choose an option</option>{schema.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>;
  if (schema.kind === "reference" || schema.kind === "reference-list") return <ReferenceControl schema={schema} value={value} path={path} label={field.label} multiple={schema.kind === "reference-list"} controller={controller} commit={invoke} />;
  if (schema.kind === "asset-use") return <AssetUseCard kind={schema.use} value={value} controller={controller} renderAssetPicker={renderAssetPicker} assetPickerCapabilities={assetPickerCapabilities} commit={invoke} />;
  if (schema.kind === "object") { const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : {}; return <fieldset class="sg-content-structured"><legend>{field.label}</legend>{schema.fields.map((child) => <div data-content-value-path={encodeContentValuePath([...path, child.id])} key={child.id}><Field controlId={`content-entry-${field.id}-${[...path, child.id].join("-")}`} label={child.label} required={child.required}><StructuredValueEditor schema={child} field={child} value={object[child.id]} path={[...path, child.id]} controller={controller} run={run} renderAssetPicker={renderAssetPicker} assetPickerCapabilities={assetPickerCapabilities} commit={(next) => { const updated = { ...object }; if (next === undefined || next === "") delete updated[child.id]; else updated[child.id] = next; invoke(updated); }} /></Field></div>)}</fieldset>; }
  if (schema.kind === "list") { const list = Array.isArray(value) ? value : []; return <div class="sg-content-list">{list.map((item, index) => <div class="sg-content-list__item" data-content-value-path={encodeContentValuePath([...path, index])} key={index}><StructuredValueEditor schema={schema.item} field={field} value={item} path={[...path, index]} controller={controller} run={run} renderAssetPicker={renderAssetPicker} assetPickerCapabilities={assetPickerCapabilities} commit={(next) => { const updated = [...list]; if (next === undefined) updated.splice(index, 1); else updated[index] = next; invoke(updated); }} /><Button iconOnly size="sm" aria-label={`Remove item ${index + 1}`} onClick={() => { const updated = [...list]; updated.splice(index, 1); invoke(updated); }}><TrashIcon size="xs" /></Button></div>)}<Button size="sm" onClick={() => invoke([...list, emptyValue(schema.item)])}><PlusIcon size="xs" />Add item</Button></div>; }
  if (schema.kind === "boolean") return <Switch label={field.label} checked={value === true} onCheckedChange={(checked) => invoke(checked)} />;
  if (schema.kind === "long-text") return <Textarea rows={5} value={text(value)} onInput={(event) => invoke(event.currentTarget.value)} />;
  if (schema.kind === "number") return <Input type="number" value={text(value)} onInput={(event) => invoke(event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber)} />;
  return <Input type={schema.kind === "date" ? "date" : schema.kind === "color" ? "color" : schema.kind === "url" ? "url" : "text"} value={text(value)} onInput={(event) => invoke(event.currentTarget.value)} />;
}

function emptyValue(schema: ContentValueSchema): JsonValue {
  if (schema.kind === "boolean") return false;
  if (schema.kind === "number") return 0;
  if (schema.kind === "object") return {};
  if (schema.kind === "list" || schema.kind === "reference-list") return [];
  return "";
}
