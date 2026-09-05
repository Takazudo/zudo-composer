/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { CollectionIcon, FilterIcon, MinusIcon, PlusIcon, SortIcon } from "../../components/icons";
import { Banner, Button, Chip, EmptyState, Field, Input, PaneSection, Select } from "../../components/ui";
import type { ContentFieldDefinition, ContentModelRecord } from "../../content";
import { isScalarQueryField } from "../../mapping";
import type { MappingCollectionCondition, MappingCollectionConditionOperator, MappingCollectionQuery, MappingCollectionSort } from "../../mapping";
import type { MappingEditorState } from "./controller";
import { entryLabel, fieldKindLabel } from "./presentation";

export interface CollectionQueryPaneProps {
  state: MappingEditorState;
  onModeChange: (kind: "single" | "collection") => void;
  onQueryChange: (change: Partial<MappingCollectionQuery> | ((query: MappingCollectionQuery) => MappingCollectionQuery)) => void;
  onOpenPins: () => void;
}

const OPERATORS: readonly { value: MappingCollectionConditionOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not-equals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "exists" },
];

export function CollectionQueryPane({ state, onModeChange, onQueryChange, onOpenPins }: CollectionQueryPaneProps): JSX.Element | null {
  const mapping = state.mapping;
  if (!mapping) return null;
  const mode = mapping.document.mode;
  const model = state.definition?.contentModel ?? null;
  const query = mode.kind === "collection" ? mode.query : null;
  const fields = useMemo(() => queryFields(model), [model]);

  return (
    <PaneSection title="Query" class="cms-mapping-query" action={<Chip tone={mode.kind === "collection" ? "ok" : "neutral"}>{mode.kind === "collection" ? "Collection" : "Single"}</Chip>}>
      <Field label="Mode" help="Single maps one Entry; collection evaluates an ordered query.">
        <Select
          size="sm"
          aria-label="Mapping mode"
          value={mode.kind}
          onChange={(event) => onModeChange(event.currentTarget.value as "single" | "collection")}
        >
          <option value="single">Single Entry</option>
          <option value="collection">Collection</option>
        </Select>
      </Field>
      {query && model ? (
        <div class="cms-mapping-query__body">
          <Field label="Published entries" help="Choose whether drafts participate in the query.">
            <Select
              size="sm"
              aria-label="Published inclusion policy"
              value={query.publication}
              onChange={(event) => onQueryChange({ publication: event.currentTarget.value as MappingCollectionQuery["publication"] })}
            >
              <option value="published-only">Published only</option>
              <option value="include-drafts">Include drafts</option>
            </Select>
          </Field>
          <ConditionEditor query={query} fields={fields} onChange={onQueryChange} />
          <SortEditor query={query} fields={fields} onChange={onQueryChange} />
          <PaneSection title="Ordered pins" class="cms-mapping-query__nested" action={<Button size="sm" variant="ghost" onClick={onOpenPins}><PlusIcon size="sm" />Choose</Button>}>
            <p class="cms-mapping-query__help">Pinned records lead the filtered result, stay deduplicated, and count toward the limit.</p>
            {query.pins.length === 0 ? <p class="cms-mapping-query__empty">No pinned Entries.</p> : <ol class="cms-mapping-query__pins">{query.pins.map((pin, index) => <li key={`${pin.providerId}/${pin.modelId}/${pin.recordId}`}><span>{index + 1}. {pin.recordId}</span><Chip tone="neutral">{pin.providerId}</Chip></li>)}</ol>}
          </PaneSection>
          <Field label="Result limit" help="The limit applies after ordered pins and query results are deduplicated.">
            <Input size="sm" type="number" min={1} max={1000} step={1} aria-label="Result limit" value={String(query.limit)} onInput={(event) => onQueryChange({ limit: Number(event.currentTarget.value) })} />
          </Field>
          <div class="cms-mapping-query__result" aria-live="polite">
            <div class="cms-mapping-query__result-heading"><strong>Effective records</strong><Chip tone={state.collectionEvaluation?.status === "blocked" ? "err" : "ok"}>{state.collectionEvaluation?.entries.length ?? 0}</Chip></div>
            {state.collectionEvaluation?.entries.length ? <ol>{state.collectionEvaluation.entries.map((entry) => <li key={entry.id}><span>{entryLabel(entry, model)}</span><code>{entry.id}</code></li>)}</ol> : <EmptyState inline icon={CollectionIcon} title="No records match" description="Adjust filters, publication policy, pins or limit." />}
          </div>
          {state.collectionEvaluation?.diagnostics.length ? <div class="cms-mapping-query__diagnostics">{state.collectionEvaluation.diagnostics.map((diagnostic) => <Banner key={`${diagnostic.code}:${diagnostic.entryId ?? diagnostic.fieldId ?? ""}`} tone={diagnostic.severity === "blocking" ? "err" : "warn"} title={`${diagnostic.code}${diagnostic.fieldId ? ` · ${diagnostic.fieldId}` : ""}`}>{diagnostic.message}</Banner>)}</div> : null}
        </div>
      ) : query ? <EmptyState inline icon={CollectionIcon} title="Collection source unavailable" description="Resolve the Content model to author its query." /> : null}
    </PaneSection>
  );
}

function ConditionEditor({ query, fields, onChange }: { query: MappingCollectionQuery; fields: readonly ContentFieldDefinition[]; onChange: CollectionQueryPaneProps["onQueryChange"] }): JSX.Element {
  return (
    <PaneSection title="Filters" class="cms-mapping-query__nested" action={<Button size="sm" variant="ghost" disabled={fields.length === 0} onClick={() => onChange((current) => ({ ...current, conditions: [...current.conditions, createCondition(fields[0]!, "equals")] }))}><FilterIcon size="sm" />Add filter</Button>}>
      {query.conditions.length === 0 ? <p class="cms-mapping-query__empty">No filters. The query includes eligible records.</p> : <div class="cms-mapping-query__rows">{query.conditions.map((condition, index) => <ConditionRow key={`${index}:${condition.fieldId}`} condition={condition} index={index} fields={fields} onChange={onChange} />)}</div>}
    </PaneSection>
  );
}

function ConditionRow({ condition, index, fields, onChange }: { condition: MappingCollectionCondition; index: number; fields: readonly ContentFieldDefinition[]; onChange: CollectionQueryPaneProps["onQueryChange"] }): JSX.Element {
  const field = fields.find((candidate) => candidate.id === condition.fieldId);
  const fieldValue = field ?? missingField(condition.fieldId);
  return <div class="cms-mapping-query__row" data-query-row="condition">
    <Select size="sm" aria-label={`Filter ${index + 1} field`} value={condition.fieldId} onChange={(event) => { const next = fields.find((candidate) => candidate.id === event.currentTarget.value); if (next) onChange((query) => ({ ...query, conditions: query.conditions.map((item, candidate) => candidate === index ? createCondition(next, "equals") : item) })); }}>
      {field ? null : <option value={condition.fieldId}>{fieldValue.label} · stale</option>}{fields.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {fieldKindLabel(candidate.kind)}</option>)}
    </Select>
    <Select size="sm" aria-label={`Filter ${index + 1} operator`} value={condition.operator} onChange={(event) => onChange((query) => ({ ...query, conditions: query.conditions.map((item, candidate) => candidate === index ? createCondition(fieldValue, event.currentTarget.value as MappingCollectionConditionOperator) : item) }))}>
      {OPERATORS.filter((operator) => fieldValue.kind === "list" ? operator.value === "contains" : operator.value !== "contains" || ["text", "long-text", "markdown", "slug", "url"].includes(fieldValue.kind)).map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
    </Select>
    {condition.operator === "exists" ? <span class="cms-mapping-query__exists">has a value</span> : <ConditionValue field={fieldValue} condition={condition} index={index} onChange={onChange} />}
    <Button iconOnly variant="ghost" size="sm" aria-label={`Remove filter ${index + 1}`} onClick={() => onChange((query) => ({ ...query, conditions: query.conditions.filter((_, candidate) => candidate !== index) }))}><MinusIcon size="sm" /></Button>
  </div>;
}

function ConditionValue({ field, condition, index, onChange }: { field: ContentFieldDefinition; condition: MappingCollectionCondition; index: number; onChange: CollectionQueryPaneProps["onQueryChange"] }): JSX.Element {
  const value = condition.value;
  const update = (next: unknown) => onChange((query) => ({ ...query, conditions: query.conditions.map((item, candidate) => candidate === index ? { ...item, value: next as MappingCollectionCondition["value"] } : item) }));
  if (field.kind === "list") return <Input size="sm" type={field.item.kind === "number" ? "number" : "text"} aria-label={`Filter ${index + 1} value`} value={value === undefined || value === null ? "" : String(value)} onInput={(event) => update(field.item.kind === "number" ? Number(event.currentTarget.value) : event.currentTarget.value)} />;
  if (field.kind === "choice") return <Select size="sm" aria-label={`Filter ${index + 1} value`} value={typeof value === "string" ? value : ""} onChange={(event) => update(event.currentTarget.value)}>{field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>;
  if (field.kind === "boolean") return <Select size="sm" aria-label={`Filter ${index + 1} value`} value={typeof value === "boolean" ? String(value) : "false"} onChange={(event) => update(event.currentTarget.value === "true")}><option value="true">True</option><option value="false">False</option></Select>;
  return <Input size="sm" type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"} aria-label={`Filter ${index + 1} value`} value={value === undefined || value === null ? "" : String(value)} onInput={(event) => update(field.kind === "number" ? Number(event.currentTarget.value) : event.currentTarget.value)} />;
}

function SortEditor({ query, fields, onChange }: { query: MappingCollectionQuery; fields: readonly ContentFieldDefinition[]; onChange: CollectionQueryPaneProps["onQueryChange"] }): JSX.Element {
  const sortable = fields.filter((field) => isScalarQueryField(field));
  return <PaneSection title="Sort order" class="cms-mapping-query__nested" action={<Button size="sm" variant="ghost" disabled={sortable.length === 0} onClick={() => onChange((current) => ({ ...current, sort: [...current.sort, { fieldId: sortable[0]!.id, direction: "asc" }] }))}><SortIcon size="sm" />Add sort</Button>}>
    {query.sort.length === 0 ? <p class="cms-mapping-query__empty">Stable Entry ID order is used when no sort is configured.</p> : <div class="cms-mapping-query__rows">{query.sort.map((sort, index) => <SortRow key={`${index}:${sort.fieldId}`} sort={sort} index={index} fields={sortable} allFields={fields} onChange={onChange} />)}</div>}
  </PaneSection>;
}

function SortRow({ sort, index, fields, allFields, onChange }: { sort: MappingCollectionSort; index: number; fields: readonly ContentFieldDefinition[]; allFields: readonly ContentFieldDefinition[]; onChange: CollectionQueryPaneProps["onQueryChange"] }): JSX.Element {
  const stale = allFields.find((field) => field.id === sort.fieldId) ?? missingField(sort.fieldId);
  return <div class="cms-mapping-query__row" data-query-row="sort">
    <Select size="sm" aria-label={`Sort ${index + 1} field`} value={sort.fieldId} onChange={(event) => onChange((query) => ({ ...query, sort: query.sort.map((item, candidate) => candidate === index ? { ...item, fieldId: event.currentTarget.value } : item) }))}>{fields.some((field) => field.id === sort.fieldId) ? null : <option value={sort.fieldId}>{stale.label} · stale</option>}{fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</Select>
    <Select size="sm" aria-label={`Sort ${index + 1} direction`} value={sort.direction} onChange={(event) => onChange((query) => ({ ...query, sort: query.sort.map((item, candidate) => candidate === index ? { ...item, direction: event.currentTarget.value as MappingCollectionSort["direction"] } : item) }))}><option value="asc">Ascending</option><option value="desc">Descending</option></Select>
    <Button iconOnly variant="ghost" size="sm" aria-label={`Remove sort ${index + 1}`} onClick={() => onChange((query) => ({ ...query, sort: query.sort.filter((_, candidate) => candidate !== index) }))}><MinusIcon size="sm" /></Button>
  </div>;
}

function queryFields(model: ContentModelRecord | null): readonly ContentFieldDefinition[] {
  return model?.document.fields.filter((field) => isScalarQueryField(field) || field.kind === "list") ?? [];
}

function createCondition(field: ContentFieldDefinition, operator: MappingCollectionConditionOperator): MappingCollectionCondition {
  const normalized = field.kind === "list" ? "contains" : operator;
  return normalized === "exists" ? { fieldId: field.id, operator: normalized } : { fieldId: field.id, operator: normalized, value: defaultFieldValue(field) };
}

function defaultFieldValue(field: ContentFieldDefinition): string | number | boolean | string[] {
  if (field.kind === "boolean") return false;
  if (field.kind === "number") return 0;
  if (field.kind === "choice") return field.options[0]?.value ?? "";
  if (field.kind === "list") return "";
  return "";
}

function missingField(id: string): ContentFieldDefinition {
  return { id, key: id, label: `Missing field (${id})`, required: false, kind: "text" };
}
