import type { JsonValue } from "@zudo-composer/component-contract";
import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { ArrowRightIcon, PlusIcon, SearchIcon, WarningIcon } from "../../components/icons";
import { Button, Checkbox, Chip, DataTable, EmptyState, Input, SegmentedControl, type DataTableColumn } from "../../components/ui";
import { formatIntent } from "../../app/route-intents";
import type { ContentEntryRecord, ContentModelRecord, ContentValueSchema } from "../../content";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";
import { contentEntryLabel } from "./presentation";

type LifecycleFilter = "all" | ContentEntryRecord["lifecycle"] | "incomplete";

export function ContentEntriesWorkspace({ state, controller, run }: { state: ContentAuthoringState; controller: ContentAuthoringController; run(action: () => void | Promise<void>): void }): JSX.Element {
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<LifecycleFilter>("all");
  const fields = state.model!.document.fields;
  const entries = useMemo(() => state.entries.filter((entry) => {
    if (filter === "incomplete" && controller.completeness(entry).length === 0) return false;
    if (filter !== "all" && filter !== "incomplete" && entry.lifecycle !== filter) return false;
    return `${contentEntryLabel(entry, fields)} ${entry.id}`.toLowerCase().includes(query.trim().toLowerCase());
  }), [controller, fields, filter, query, state.entries]);
  const columns: DataTableColumn<ContentEntryRecord>[] = [{ key: "entry", header: "Entry", cell: (entry) => <button class="sg-content-entry-link" onClick={() => run(() => controller.openEntry(entry.id))}><strong>{contentEntryLabel(entry, fields)}</strong><small>{entry.id}</small></button> }, { key: "status", header: "Lifecycle", cell: (entry) => <Chip tone={entry.lifecycle === "published" ? "accent" : "plain"}>{entry.lifecycle}</Chip> }, { key: "complete", header: "Completeness", cell: (entry) => controller.completeness(entry).length ? <span class="sg-content-field-error"><WarningIcon size="xs" />Needs attention</span> : "Complete" }];
  return <div class="sg-content-collection"><div class="sg-content-collection__summary"><div><strong>{state.entryCounts[state.model!.id] ?? 0}</strong><span>entries</span></div><div><strong>{state.entries.filter((entry) => entry.lifecycle === "published").length}</strong><span>published on this page</span></div><Button variant="primary" disabled={state.model!.document.kind === "single" && state.entries.length > 0} onClick={() => run(() => controller.createEntry())}><PlusIcon size="sm" />New Entry</Button></div><div class="sg-content-collection__toolbar"><SegmentedControl<LifecycleFilter> label="Entry lifecycle" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "incomplete", label: "Needs attention" }]} /><Input icon={SearchIcon} aria-label="Search Entries" placeholder="Search Entries…" value={query} onInput={(event) => setQuery(event.currentTarget.value)} /></div>{entries.length ? <><DataTable caption={`Entries in ${state.model!.document.name}`} columns={columns} rows={entries} rowKey={(entry) => entry.id} />{state.nextCursor ? <Button onClick={() => run(() => controller.loadMoreEntries())}>Load more Entries</Button> : null}</> : <EmptyState inline title="No Entries match" description="Try another search or lifecycle filter." action={<Button onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button>} />}</div>;
}

function humanValue(schema: ContentValueSchema, value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (schema.kind === "object" && value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(schema.fields.flatMap((field) => { const resolved = humanValue(field, (value as Record<string, JsonValue>)[field.id]); return resolved === undefined ? [] : [[field.key, resolved]]; }));
  if (schema.kind === "list" && Array.isArray(value)) return value.map((item) => humanValue(schema.item, item) ?? null);
  return value;
}

export function ContentRawView({ model, entry }: { model: ContentModelRecord; entry: ContentEntryRecord }): JSX.Element {
  const human = Object.fromEntries(model.document.fields.flatMap((field) => { const value = humanValue(field, entry.values[field.id]); return value === undefined ? [] : [[field.key, value]]; }));
  return <div class="sg-content-raw"><section><h3>Resolved values</h3><p class="sg-content-hint">Human-readable field keys, resolved recursively from this schema.</p><pre>{JSON.stringify(human, null, 2)}</pre></section><section><h3>Exact field-ID storage</h3><p class="sg-content-hint">The canonical persisted envelope. Field IDs are not rewritten.</p><pre>{JSON.stringify(entry, null, 2)}</pre></section></div>;
}

function InverseEditor({ state, controller, inverseId }: { state: ContentAuthoringState; controller: ContentAuthoringController; inverseId: string }): JSX.Element | null {
  const inverse = state.model?.document.presentation?.inverses.find((item) => item.id === inverseId);
  const [owners, setOwners] = useState<Awaited<ReturnType<ContentAuthoringController["referenceEntries"]>>>([]), [selected, setSelected] = useState<readonly string[]>([]), [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
  useEffect(() => { if (!inverse) return; let live = true; void controller.referenceEntries(inverse.source).then((items) => { if (!live) return; setOwners(items); setSelected(state.incoming.filter((edge) => edge.owner.entry.providerId === inverse.source.providerId && edge.owner.entry.modelId === inverse.source.recordId && edge.owner.fieldId === inverse.fieldId).map((edge) => edge.owner.entry.recordId)); }, (cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : "Inverse catalog unavailable."); }); return () => { live = false; }; }, [controller, inverse?.fieldId, inverse?.source.providerId, inverse?.source.recordId, state.incoming]);
  if (!inverse) return null;
  return <section class="sg-content-inverse"><h3>{inverse.label}</h3><p class="sg-content-hint">Choose owning Entries. Apply commits every edge in one provider transaction.</p>{error ? <p class="sg-content-field-error">{error}</p> : null}<div>{owners.map((owner) => <Checkbox key={owner.ref.recordId} label={owner.label} checked={selected.includes(owner.ref.recordId)} onCheckedChange={(checked) => setSelected(checked ? [...selected, owner.ref.recordId] : selected.filter((id) => id !== owner.ref.recordId))} />)}</div><Button size="sm" variant="primary" disabled={saving || state.graphStatus !== "ready"} onClick={() => { setSaving(true); setError(null); void controller.applyInverse(inverse.id, selected).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Inverse update failed.")).finally(() => setSaving(false)); }}>{saving ? "Applying…" : "Apply relationships"}</Button></section>;
}

export function ContentUsedByView({ state, controller }: { state: ContentAuthoringState; controller: ContentAuthoringController }): JSX.Element {
  const inverses = state.model?.document.presentation?.inverses ?? [];
  const inverseEditors = inverses.map((inverse) => <InverseEditor key={inverse.id} state={state} controller={controller} inverseId={inverse.id} />);
  if (state.graphStatus === "idle") return <p role="status" class="sg-content-hint">Resolving the complete Content graph…</p>;
  if (state.graphStatus === "unavailable") return <><EmptyState inline title="Usage is unavailable" description={state.graphMessage || "Connect every Content provider and retry the graph scan before making destructive claims."} />{inverseEditors}</>;
  return <div>{state.incoming.length ? <ul class="sg-content-used-by">{state.incoming.map(({ owner, ordered }) => { const topFieldId = typeof owner.path[0] === "string" ? owner.path[0] : owner.fieldId; return <li key={`${owner.entry.providerId}/${owner.entry.recordId}/${owner.path.join("/")}`}><a href={formatIntent({ route: "content", providerId: owner.entry.providerId, modelId: owner.entry.modelId, entryId: owner.entry.recordId, fieldId: topFieldId, ...(owner.path.length > 1 ? { valuePath: owner.path.slice(1) } : {}) })}><span><strong>{owner.entry.recordId}</strong><small>{ordered ? "Ordered reference" : "Reference"} · {owner.entry.providerId}</small></span><ArrowRightIcon size="sm" /></a></li>; })}</ul> : <EmptyState inline title="No incoming Content references" description="No canonical Content relationship currently points to this Entry." />}{inverseEditors}</div>;
}

export function ContentRelationshipsView({ state }: { state: ContentAuthoringState }): JSX.Element {
  const refs = state.model!.document.fields.filter((field) => field.kind === "reference" || field.kind === "reference-list");
  const inverses = state.model!.document.presentation?.inverses ?? [];
  return <div class="sg-content-relationships"><section><h3>Outgoing relationships</h3>{refs.length ? <ul>{refs.map((field) => <li key={field.id}><strong>{field.label}</strong><code>{field.target.providerId}/{field.target.recordId}</code><span>{field.kind === "reference-list" ? field.ordered ? "Many · ordered" : "Many" : "One"}</span></li>)}</ul> : <p class="sg-content-hint">Add a Reference or References field to connect this model.</p>}</section><section><h3>Inverse relationships</h3>{inverses.length ? <ul>{inverses.map((inverse) => <li key={inverse.id}><strong>{inverse.label}</strong><code>{inverse.source.providerId}/{inverse.source.recordId}/{inverse.fieldId}</code><span>Edited atomically at the owning field</span></li>)}</ul> : <p class="sg-content-hint">No declarative inverse views are defined for this model.</p>}</section></div>;
}
