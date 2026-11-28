import { computed, For, Show, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { CollectionIcon, FilterIcon, MinusIcon, PlusIcon, SortIcon } from "../../components/icons";
import { read, type MaybeSignal } from "../../components/reactive";
import { Rebuild } from "../../components/rebuild";
import { Keyed } from "../../runtime";
import { Banner, Button, Chip, EmptyState, Field, Input, PaneSection, Select } from "../../components/ui";
import type { ContentFieldDefinition, ContentModelRecord, ContentValueSchema } from "../../content";
import { isScalarQueryField } from "../../mapping";
import type { MappingCollectionCondition, MappingCollectionConditionOperator, MappingCollectionQuery, MappingCollectionSort } from "../../mapping";
import type { MappingEditorState } from "./controller";
import { ReferenceQueryValue } from "./reference-query-value";
import { entryLabel, fieldKindLabel } from "./presentation";
import { derive, followModel, memo, writeDomValue } from "./signals";

export interface CollectionQueryPaneProps {
  referenceEntries?: (target: { providerId: string; recordId: string }) => Promise<readonly { ref: { providerId: string; modelId: string; recordId: string }; label: string }[]>;
  state: MaybeSignal<MappingEditorState>;
  onModeChange: (kind: "single" | "collection") => void;
  onQueryChange: (change: Partial<MappingCollectionQuery> | ((query: MappingCollectionQuery) => MappingCollectionQuery)) => void;
  onOpenPins: () => void;
}

type QueryChange = CollectionQueryPaneProps["onQueryChange"];
type ReferenceLoader = CollectionQueryPaneProps["referenceEntries"];

const OPERATORS: readonly { value: MappingCollectionConditionOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not-equals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "exists" },
];

/** Identity of a field list as far as option rows go. */
function fieldsKey(fields: readonly ContentFieldDefinition[]): string {
  return fields.map((field) => `${field.id}\u0000${field.label}\u0000${field.kind}`).join("\u0001");
}

/**
 * A select with static options, rebuilt as a whole when `options` (its key)
 * changes; its model follows the stored value in between.
 */
function LiveSelect({ rebuildKey, value, label, onChange, children }: { rebuildKey: ReadonlySignal<string>; value: () => string; label: string; onChange: (value: string, model: { value: string }) => void; children: () => Child }): Child {
  return <Keyed value={rebuildKey} by={(key) => key}>{() => {
    const model = followModel(value);
    return <Select size="sm" aria-label={label} modelValue={model} on:change={(event) => onChange(event.currentTarget.value, model)}>{children()}</Select>;
  }}</Keyed>;
}

export function CollectionQueryPane({ state: given, onModeChange, onQueryChange, onOpenPins, referenceEntries }: CollectionQueryPaneProps): Child {
  const state = computed(() => read(given));
  const mapping = computed(() => state.value.mapping);
  const modeKind = computed(() => mapping.value?.document.mode.kind ?? "single");
  const model = computed(() => state.value.definition?.contentModel ?? null);
  const query = computed(() => { const mode = mapping.value?.document.mode; return mode?.kind === "collection" ? mode.query : null; });
  const fields = memo(() => queryFields(model.value) as readonly ContentFieldDefinition[]);
  const queryFieldList = computed(() => fields.value);
  const unsupportedFields = derive(() => [model.value] as const, (current) => current?.document.fields.filter((field) => !isSupportedQueryField(field)) ?? []);
  const shape = computed(() => !mapping.value ? "none" : query.value && model.value ? "body" : query.value ? "unavailable" : "single");
  const evaluation = computed(() => state.value.collectionEvaluation);

  return (
    <Show when={computed(() => shape.value !== "none")}>{() => (
      <PaneSection title="Query" class="cms-mapping-query" action={<Rebuild value={modeKind}>{(kind) => <Chip tone={kind === "collection" ? "ok" : "neutral"}>{kind === "collection" ? "Collection" : "Single"}</Chip>}</Rebuild>}>
        <Field label="Mode" help="Single maps one Entry; collection evaluates an ordered query.">
          {(field) => (
            <Select
              size="sm"
              field={field}
              aria-label="Mapping mode"
              modelValue={followModel(() => modeKind.value)}
              on:change={(event) => onModeChange(event.currentTarget.value as "single" | "collection")}
            >
              <option value="single">Single Entry</option>
              <option value="collection">Collection</option>
            </Select>
          )}
        </Field>
        <Keyed value={shape} by={(value) => value}>{(current) => current.value === "body" ? (
          <div class="cms-mapping-query__body">
            <Field label="Published entries" help="Choose whether drafts participate in the query.">
              {(field) => (
                <Select
                  size="sm"
                  field={field}
                  aria-label="Published inclusion policy"
                  modelValue={followModel(() => query.value?.publication ?? "published-only")}
                  on:change={(event) => onQueryChange({ publication: event.currentTarget.value as MappingCollectionQuery["publication"] })}
                >
                  <option value="published-only">Published only</option>
                  <option value="include-drafts">Include drafts</option>
                </Select>
              )}
            </Field>
            <Rebuild value={unsupportedFields}>{(unsupported) => unsupported.length ? <p class="cms-mapping-query__help" role="status">Structured, asset and reference-list fields are unavailable for deterministic query authoring: {unsupported.map((field) => field.label).join(", ")}.</p> : null}</Rebuild>
            <ConditionEditor referenceEntries={referenceEntries} query={query} fields={queryFieldList} onChange={onQueryChange} />
            <SortEditor query={query} fields={queryFieldList} onChange={onQueryChange} />
            <PaneSection title="Ordered pins" class="cms-mapping-query__nested" action={<Button size="sm" variant="ghost" on:click={() => onOpenPins()}><PlusIcon size="sm" />Choose</Button>}>
              <p class="cms-mapping-query__help">Pinned records lead the filtered result, stay deduplicated, and count toward the limit.</p>
              <Rebuild value={computed(() => query.value?.pins ?? [])}>{(pins) => pins.length === 0 ? <p class="cms-mapping-query__empty">No pinned Entries.</p> : <ol class="cms-mapping-query__pins">{pins.map((pin, index) => <li key={`${pin.providerId}/${pin.modelId}/${pin.recordId}`}><span>{index + 1}. {pin.recordId}</span><Chip tone="neutral">{pin.providerId}</Chip></li>)}</ol>}</Rebuild>
            </PaneSection>
            <Field label="Result limit" help="The limit applies after ordered pins and query results are deduplicated.">
              {(field) => <LimitInput field={field} limit={computed(() => query.value?.limit ?? 0)} onChange={(limit) => onQueryChange({ limit })} />}
            </Field>
            <div class="cms-mapping-query__result" aria-live="polite">
              <Rebuild value={memo(() => [evaluation.value, model.value] as const)}>{([result, source]) => <>
                <div class="cms-mapping-query__result-heading"><strong>Effective records</strong><Chip tone={result?.status === "blocked" ? "err" : "ok"}>{result?.entries.length ?? 0}</Chip></div>
                {result?.entries.length ? <ol>{result.entries.map((entry) => <li key={entry.id}><span>{entryLabel(entry, source)}</span><code>{entry.id}</code></li>)}</ol> : <EmptyState inline icon={CollectionIcon} title="No records match" description="Adjust filters, publication policy, pins or limit." />}
              </>}</Rebuild>
            </div>
            <Rebuild value={evaluation}>{(result) => result?.diagnostics.length ? <div class="cms-mapping-query__diagnostics">{result.diagnostics.map((diagnostic) => <Banner key={`${diagnostic.code}:${diagnostic.entryId ?? diagnostic.fieldId ?? ""}`} tone={diagnostic.severity === "blocking" ? "err" : "warn"} title={`${diagnostic.code}${diagnostic.fieldId ? ` · ${diagnostic.fieldId}` : ""}`}>{diagnostic.message}</Banner>)}</div> : null}</Rebuild>
          </div>
        ) : current.value === "unavailable" ? <EmptyState inline icon={CollectionIcon} title="Collection source unavailable" description="Resolve the Content model to author its query." /> : null}</Keyed>
      </PaneSection>
    )}</Show>
  );
}

/** Number inputs take a static value; the DOM is rewritten when the stored limit changes elsewhere. */
function LimitInput({ field, limit, onChange }: { field: Parameters<typeof Input>[0]["field"]; limit: ReadonlySignal<number>; onChange: (limit: number) => void }): Child {
  const ref: Ref<HTMLInputElement> = { current: null };
  writeDomValue(ref, () => String(limit.value));
  return <Input size="sm" type="number" field={field} elementRef={ref} min="1" max="1000" step="1" aria-label="Result limit" value={String(limit.value)} on:input={(event) => onChange(Number(event.currentTarget.value))} />;
}

function ConditionEditor({ query, fields, onChange, referenceEntries }: { referenceEntries: ReferenceLoader; query: ReadonlySignal<MappingCollectionQuery | null>; fields: ReadonlySignal<readonly ContentFieldDefinition[]>; onChange: QueryChange }): Child {
  const conditions = computed(() => (query.value?.conditions ?? []).map((condition, index) => ({ condition, index })));
  return (
    <PaneSection title="Filters" class="cms-mapping-query__nested" action={<Button size="sm" variant="ghost" disabled={computed(() => fields.value.length === 0)} on:click={() => { const first = fields.value[0]!; onChange((current) => ({ ...current, conditions: [...current.conditions, createCondition(first, first.kind === "reference" ? "exists" : "equals")] })); }}><FilterIcon size="sm" />Add filter</Button>}>
      <Show when={computed(() => conditions.value.length > 0)} fallback={() => <p class="cms-mapping-query__empty">No filters. The query includes eligible records.</p>}>{() => (
        <div class="cms-mapping-query__rows"><For each={conditions} by={(row) => `${row.index}:${row.condition.fieldId}`}>{(row) => <ConditionRow referenceEntries={referenceEntries} condition={computed(() => row.value.condition)} index={row.value.index} fields={fields} onChange={onChange} />}</For></div>
      )}</Show>
    </PaneSection>
  );
}

function ConditionRow({ condition, index, fields, onChange, referenceEntries }: { referenceEntries: ReferenceLoader; condition: ReadonlySignal<MappingCollectionCondition>; index: number; fields: ReadonlySignal<readonly ContentFieldDefinition[]>; onChange: QueryChange }): Child {
  const field = computed(() => fields.value.find((candidate) => candidate.id === condition.value.fieldId));
  const fieldValue = computed(() => field.value ?? missingField(condition.value.fieldId));
  const fieldOptions = computed(() => `${field.value ? "" : condition.value.fieldId}|${fieldsKey(fields.value)}`);
  const operatorOptions = computed(() => `${fieldValue.value.kind}|${fieldValue.value.kind === "reference" && condition.value.operator === "contains"}`);
  const valueShape = computed(() => `${condition.value.operator === "exists"}|${condition.value.operator === "contains"}|${fieldsKey([fieldValue.value])}|${JSON.stringify(fieldValue.value)}`);
  return <div class="cms-mapping-query__row" data-query-row="condition">
    <LiveSelect rebuildKey={fieldOptions} label={`Filter ${index + 1} field`} value={() => condition.value.fieldId} onChange={(value) => { const next = fields.value.find((candidate) => candidate.id === value); if (next) onChange((query) => ({ ...query, conditions: query.conditions.map((item, candidate) => candidate === index ? createCondition(next, next.kind === "reference" ? "exists" : "equals") : item) })); }}>
      {() => <>{field.value ? null : <option value={condition.value.fieldId}>{`${fieldValue.value.label} · stale`}</option>}{fields.value.map((candidate) => <option key={candidate.id} value={candidate.id}>{`${candidate.label} · ${fieldKindLabel(candidate.kind)}`}</option>)}</>}
    </LiveSelect>
    <LiveSelect rebuildKey={operatorOptions} label={`Filter ${index + 1} operator`} value={() => condition.value.operator} onChange={(value) => { const operator = value as MappingCollectionConditionOperator; const kind = fieldValue.value; onChange((query) => ({ ...query, conditions: query.conditions.map((item, candidate) => candidate === index ? kind.kind === "reference" && operator !== "exists" && item.value !== undefined ? { ...item, operator } : createCondition(kind, operator) : item) })); }}>
      {() => { const kind = fieldValue.value; return <>
        {kind.kind === "reference" && condition.value.operator === "contains" ? <option value="contains" disabled>contains · unsupported for references</option> : null}
        {OPERATORS.filter((operator) => kind.kind === "list" ? operator.value === "contains" : operator.value !== "contains" || ["text", "long-text", "markdown", "slug", "url"].includes(kind.kind)).map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
      </>; }}
    </LiveSelect>
    <Keyed value={valueShape} by={(key) => key}>{() => condition.value.operator === "exists" ? <span class="cms-mapping-query__exists">has a value</span> : <ConditionValue referenceEntries={referenceEntries} field={fieldValue.value} condition={condition} index={index} onChange={onChange} />}</Keyed>
    <Button iconOnly variant="ghost" size="sm" aria-label={`Remove filter ${index + 1}`} on:click={() => onChange((query) => ({ ...query, conditions: query.conditions.filter((_, candidate) => candidate !== index) }))}><MinusIcon size="sm" /></Button>
  </div>;
}

/** A free value: text-like inputs bind a model, number/date/colour inputs a static value plus `on:input`. */
function ValueInput({ type, value, label, onInput }: { type: ReturnType<typeof queryInputType>; value: ReadonlySignal<unknown>; label: string; onInput: (raw: string) => void }): Child {
  const text = () => (value.value === undefined || value.value === null ? "" : String(value.value));
  if (type === "text" || type === "url") {
    return <Input size="sm" type={type} aria-label={label} modelValue={followModel(text)} on:input={(event) => onInput(event.currentTarget.value)} />;
  }
  const ref: Ref<HTMLInputElement> = { current: null };
  writeDomValue(ref, text);
  return <Input size="sm" type={type} elementRef={ref} aria-label={label} value={text()} on:input={(event) => onInput(event.currentTarget.value)} />;
}

function ConditionValue({ field, condition, index, onChange, referenceEntries }: { referenceEntries: ReferenceLoader; field: ContentFieldDefinition; condition: ReadonlySignal<MappingCollectionCondition>; index: number; onChange: QueryChange }): Child {
  const value = computed(() => condition.value.value);
  const label = `Filter ${index + 1} value`;
  const update = (next: unknown) => onChange((query) => ({ ...query, conditions: query.conditions.map((item, candidate) => candidate === index ? { ...item, value: next as MappingCollectionCondition["value"] } : item) }));
  const choice = (options: readonly { value: string; label: string }[]) => <Select size="sm" aria-label={label} modelValue={followModel(() => (typeof value.value === "string" ? value.value : ""))} on:change={(event) => update(event.currentTarget.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>;
  const boolean = () => <Select size="sm" aria-label={label} modelValue={followModel(() => (typeof value.value === "boolean" ? String(value.value) : "false"))} on:change={(event) => update(event.currentTarget.value === "true")}><option value="true">True</option><option value="false">False</option></Select>;
  if (field.kind === "reference" && condition.value.operator === "contains") return <span class="cms-mapping-query__exists">Reference conditions support equals, does not equal and exists; choose a supported operator.</span>;
  if (field.kind === "reference") return <ReferenceQueryValue target={field.target} value={value} label={label} load={referenceEntries} onChange={update} />;
  if (field.kind === "list") {
    if (!isPrimitiveQuerySchema(field.item)) return <span class="cms-mapping-query__exists">Structured list values are unsupported; remove this filter.</span>;
    if (field.item.kind === "choice") return choice(field.item.options);
    if (field.item.kind === "boolean") return boolean();
    const item = field.item;
    return <ValueInput type={queryInputType(item)} value={value} label={label} onInput={(raw) => update(item.kind === "number" ? Number(raw) : raw)} />;
  }
  if (field.kind === "choice") return choice(field.options);
  if (field.kind === "boolean") return boolean();
  return <ValueInput type={queryInputType(field)} value={value} label={label} onInput={(raw) => update(field.kind === "number" ? Number(raw) : raw)} />;
}

function queryInputType(schema: ContentValueSchema): "text" | "number" | "date" | "color" | "url" {
  if (schema.kind === "number" || schema.kind === "date" || schema.kind === "color" || schema.kind === "url") return schema.kind;
  return "text";
}

function SortEditor({ query, fields, onChange }: { query: ReadonlySignal<MappingCollectionQuery | null>; fields: ReadonlySignal<readonly ContentFieldDefinition[]>; onChange: QueryChange }): Child {
  const sortable = computed(() => fields.value.filter((field) => isScalarQueryField(field)));
  const sorts = computed(() => (query.value?.sort ?? []).map((sort, index) => ({ sort, index })));
  return <PaneSection title="Sort order" class="cms-mapping-query__nested" action={<Button size="sm" variant="ghost" disabled={computed(() => sortable.value.length === 0)} on:click={() => { const first = sortable.value[0]!; onChange((current) => ({ ...current, sort: [...current.sort, { fieldId: first.id, direction: "asc" }] })); }}><SortIcon size="sm" />Add sort</Button>}>
    <Show when={computed(() => sorts.value.length > 0)} fallback={() => <p class="cms-mapping-query__empty">Stable Entry ID order is used when no sort is configured.</p>}>{() => (
      <div class="cms-mapping-query__rows"><For each={sorts} by={(row) => `${row.index}:${row.sort.fieldId}`}>{(row) => <SortRow sort={computed(() => row.value.sort)} index={row.value.index} fields={sortable} allFields={fields} onChange={onChange} />}</For></div>
    )}</Show>
  </PaneSection>;
}

function SortRow({ sort, index, fields, allFields, onChange }: { sort: ReadonlySignal<MappingCollectionSort>; index: number; fields: ReadonlySignal<readonly ContentFieldDefinition[]>; allFields: ReadonlySignal<readonly ContentFieldDefinition[]>; onChange: QueryChange }): Child {
  const listed = computed(() => fields.value.some((field) => field.id === sort.value.fieldId));
  const stale = computed(() => allFields.value.find((field) => field.id === sort.value.fieldId) ?? missingField(sort.value.fieldId));
  const options = computed(() => `${listed.value ? "" : `${sort.value.fieldId}\u0000${stale.value.label}`}|${fieldsKey(fields.value)}`);
  return <div class="cms-mapping-query__row" data-query-row="sort">
    <LiveSelect rebuildKey={options} label={`Sort ${index + 1} field`} value={() => sort.value.fieldId} onChange={(value) => onChange((query) => ({ ...query, sort: query.sort.map((item, candidate) => candidate === index ? { ...item, fieldId: value } : item) }))}>
      {() => <>{listed.value ? null : <option value={sort.value.fieldId}>{`${stale.value.label} · stale`}</option>}{fields.value.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</>}
    </LiveSelect>
    <Select size="sm" aria-label={`Sort ${index + 1} direction`} modelValue={followModel(() => sort.value.direction)} on:change={(event) => onChange((query) => ({ ...query, sort: query.sort.map((item, candidate) => candidate === index ? { ...item, direction: event.currentTarget.value as MappingCollectionSort["direction"] } : item) }))}><option value="asc">Ascending</option><option value="desc">Descending</option></Select>
    <Button iconOnly variant="ghost" size="sm" aria-label={`Remove sort ${index + 1}`} on:click={() => onChange((query) => ({ ...query, sort: query.sort.filter((_, candidate) => candidate !== index) }))}><MinusIcon size="sm" /></Button>
  </div>;
}

function queryFields(model: ContentModelRecord | null): readonly ContentFieldDefinition[] {
  return model?.document.fields.filter(isSupportedQueryField) ?? [];
}

function isPrimitiveQuerySchema(schema: ContentValueSchema): boolean {
  return ["text", "long-text", "markdown", "number", "boolean", "date", "slug", "color", "url", "choice"].includes(schema.kind);
}

function isSupportedQueryField(field: ContentFieldDefinition): boolean {
  return field.kind === "reference" || isScalarQueryField(field) || (field.kind === "list" && isPrimitiveQuerySchema(field.item));
}

function createCondition(field: ContentFieldDefinition, operator: MappingCollectionConditionOperator): MappingCollectionCondition {
  const normalized = field.kind === "list" ? "contains" : operator;
  return normalized === "exists" ? { fieldId: field.id, operator: normalized } : { fieldId: field.id, operator: normalized, value: defaultFieldValue(field) };
}

function defaultFieldValue(field: ContentFieldDefinition): string | number | boolean | string[] {
  if (field.kind === "boolean") return false;
  if (field.kind === "number") return 0;
  if (field.kind === "choice") return field.options[0]?.value ?? "";
  if (field.kind === "list") {
    if (field.item.kind === "boolean") return false;
    if (field.item.kind === "number") return 0;
    if (field.item.kind === "choice") return field.item.options[0]?.value ?? "";
    return "";
  }
  return "";
}

function missingField(id: string): ContentFieldDefinition {
  return { id, key: id, label: `Missing field (${id})`, required: false, kind: "text" };
}
