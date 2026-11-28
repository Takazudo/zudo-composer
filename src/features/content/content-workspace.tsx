import type { JsonValue } from "@zudo-composer/component-contract";
import { computed, For, getScope, Show, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { ArrowRightIcon, PlusIcon, SearchIcon, WarningIcon } from "../../components/icons";
import { read, toSignal, type MaybeSignal } from "../../components/reactive";
import { Rebuild } from "../../components/rebuild";
import { Button, Checkbox, Chip, DataTable, EmptyState, Input, SegmentedControl, type DataTableColumn } from "../../components/ui";
import { formatIntent } from "../../app/route-intents";
import type { ContentEntryRecord, ContentModelRecord, ContentValueSchema } from "../../content";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";
import { contentEntryLabel } from "./presentation";
import { stableComputed } from "./reactive-draft";

type LifecycleFilter = "all" | ContentEntryRecord["lifecycle"] | "incomplete";

export function ContentEntriesWorkspace({ state, controller, run }: { state: ReadonlySignal<ContentAuthoringState>; controller: ContentAuthoringController; run(action: () => void | Promise<void>): void }) {
  const query = signal(""), filter = signal<LifecycleFilter>("all");
  let lastModel = state.value.model!;
  const model = computed(() => { const current = state.value.model; if (current) lastModel = current; return lastModel; });
  const fields = computed(() => model.value.document.fields);
  const entries = computed(() => state.value.entries.filter((entry) => {
    if (filter.value === "incomplete" && controller.completeness(entry).length === 0) return false;
    if (filter.value !== "all" && filter.value !== "incomplete" && entry.lifecycle !== filter.value) return false;
    return `${contentEntryLabel(entry, fields.value)} ${entry.id}`.toLowerCase().includes(query.value.trim().toLowerCase());
  }));
  const columns: DataTableColumn<ContentEntryRecord>[] = [{ key: "entry", header: "Entry", cell: (entry) => <button type="button" class="sg-content-entry-link" on:click={() => run(() => controller.openEntry(entry.id))}><strong>{contentEntryLabel(entry, fields.value)}</strong><small>{entry.id}</small></button> }, { key: "status", header: "Lifecycle", cell: (entry) => <Chip tone={entry.lifecycle === "published" ? "accent" : "plain"}>{entry.lifecycle}</Chip> }, { key: "complete", header: "Completeness", cell: (entry) => controller.completeness(entry).length ? <span class="sg-content-field-error"><WarningIcon size="xs" />Needs attention</span> : "Complete" }];
  return <div class="sg-content-collection"><div class="sg-content-collection__summary"><div><strong>{computed(() => state.value.entryCounts[model.value.id] ?? 0)}</strong><span>entries</span></div><div><strong>{computed(() => state.value.entries.filter((entry) => entry.lifecycle === "published").length)}</strong><span>published on this page</span></div><Button variant="primary" disabled={computed(() => model.value.document.kind === "single" && state.value.entries.length > 0)} on:click={() => run(() => controller.createEntry())}><PlusIcon size="sm" />New Entry</Button></div><div class="sg-content-collection__toolbar"><SegmentedControl<LifecycleFilter> label="Entry lifecycle" value={filter} onChange={(next) => { filter.value = next; }} options={[{ value: "all", label: "All" }, { value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "incomplete", label: "Needs attention" }]} /><Input icon={SearchIcon} aria-label="Search Entries" placeholder="Search Entries…" modelValue={query} /></div><Show when={computed(() => entries.value.length > 0)} fallback={() => <EmptyState inline title="No Entries match" description="Try another search or lifecycle filter." action={<Button on:click={() => { query.value = ""; filter.value = "all"; }}>Clear filters</Button>} />}>{() => <><Rebuild value={computed(() => model.value.document.name)}>{(name) => <DataTable caption={`Entries in ${name}`} columns={columns} rows={entries} rowKey={(entry) => entry.id} />}</Rebuild><Show when={computed(() => Boolean(state.value.nextCursor))}>{() => <Button on:click={() => run(() => controller.loadMoreEntries())}>Load more Entries</Button>}</Show></>}</Show></div>;
}

function humanValue(schema: ContentValueSchema, value: JsonValue | undefined): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (schema.kind === "object" && value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(schema.fields.flatMap((field) => { const resolved = humanValue(field, (value as Record<string, JsonValue>)[field.id]); return resolved === undefined ? [] : [[field.key, resolved]]; }));
  if (schema.kind === "list" && Array.isArray(value)) return value.map((item) => humanValue(schema.item, item) ?? null);
  return value;
}

export function ContentRawView({ model, entry }: { model: MaybeSignal<ContentModelRecord>; entry: MaybeSignal<ContentEntryRecord> }) {
  const human = computed(() => { const current = read(entry); return JSON.stringify(Object.fromEntries(read(model).document.fields.flatMap((field) => { const value = humanValue(field, current.values[field.id]); return value === undefined ? [] : [[field.key, value]]; })), null, 2); });
  return <div class="sg-content-raw"><section><h3>Resolved values</h3><p class="sg-content-hint">Human-readable field keys, resolved recursively from this schema.</p><pre>{human}</pre></section><section><h3>Exact field-ID storage</h3><p class="sg-content-hint">The canonical persisted envelope. Field IDs are not rewritten.</p><pre>{computed(() => JSON.stringify(read(entry), null, 2))}</pre></section></div>;
}

type OwnerOption = Awaited<ReturnType<ContentAuthoringController["referenceEntries"]>>[number];

function InverseEditor({ state, controller, inverseId }: { state: ReadonlySignal<ContentAuthoringState>; controller: ContentAuthoringController; inverseId: string }) {
  const scope = getScope();
  const inverse = state.value.model?.document.presentation?.inverses.find((item) => item.id === inverseId);
  if (!inverse) return null;
  const owners = signal<readonly OwnerOption[]>([]), selected = signal<readonly string[]>([]), error = signal<string | null>(null), saving = signal(false);
  let load = 0;
  let seenIncoming: ContentAuthoringState["incoming"] | null = null;
  // The owning Entries are re-read whenever the incoming edges change.
  scope.effect(() => {
    const incoming = state.value.incoming;
    if (incoming === seenIncoming) return;
    seenIncoming = incoming;
    const token = ++load;
    const live = () => token === load && !scope.abortSignal.aborted;
    void controller.referenceEntries(inverse.source).then((items) => { if (!live()) return; owners.value = items; selected.value = incoming.filter((edge) => edge.owner.entry.providerId === inverse.source.providerId && edge.owner.entry.modelId === inverse.source.recordId && edge.owner.fieldId === inverse.fieldId).map((edge) => edge.owner.entry.recordId); }, (cause: unknown) => { if (live()) error.value = cause instanceof Error ? cause.message : "Inverse catalog unavailable."; });
  });
  return <section class="sg-content-inverse"><h3>{inverse.label}</h3><p class="sg-content-hint">Choose owning Entries. Apply commits every edge in one provider transaction.</p><Show when={computed(() => error.value !== null)}>{() => <p class="sg-content-field-error">{computed(() => error.value ?? "")}</p>}</Show><div><For each={owners} by={(owner) => owner.ref.recordId}>{(owner) => { const id = owner.value.ref.recordId; return <Checkbox label={owner.value.label} checked={computed(() => selected.value.includes(id))} onCheckedChange={(checked) => { selected.value = checked ? [...selected.value, id] : selected.value.filter((item) => item !== id); }} />; }}</For></div><Button size="sm" variant="primary" disabled={computed(() => saving.value || state.value.graphStatus !== "ready")} on:click={() => { saving.value = true; error.value = null; void controller.applyInverse(inverse.id, selected.value).catch((cause: unknown) => { if (!scope.abortSignal.aborted) error.value = cause instanceof Error ? cause.message : "Inverse update failed."; }).finally(() => { if (!scope.abortSignal.aborted) saving.value = false; }); }}>{computed(() => (saving.value ? "Applying…" : "Apply relationships"))}</Button></section>;
}

export function ContentUsedByView({ state: suppliedState, controller }: { state: MaybeSignal<ContentAuthoringState>; controller: ContentAuthoringController }) {
  const state = toSignal(suppliedState);
  const inverseIds = computed(() => (state.value.model?.document.presentation?.inverses ?? []).map((inverse) => inverse.id));
  const inverseEditors = <For each={inverseIds} by={(id) => id}>{(id) => <InverseEditor state={state} controller={controller} inverseId={id.value} />}</For>;
  const view = stableComputed(() => ({ status: state.value.graphStatus, message: state.value.graphMessage, incoming: state.value.incoming }), (current) => JSON.stringify(current));
  const summary = <Rebuild value={view}>{({ status, message, incoming }) => {
    if (status === "unavailable") return <EmptyState inline title="Usage is unavailable" description={message || "Connect every Content provider and retry the graph scan before making destructive claims."} />;
    return incoming.length ? <ul class="sg-content-used-by">{incoming.map(({ owner, ordered }) => { const topFieldId = typeof owner.path[0] === "string" ? owner.path[0] : owner.fieldId; return <li><a href={formatIntent({ route: "content", providerId: owner.entry.providerId, modelId: owner.entry.modelId, entryId: owner.entry.recordId, fieldId: topFieldId, ...(owner.path.length > 1 ? { valuePath: owner.path.slice(1) } : {}) })}><span><strong>{owner.entry.recordId}</strong><small>{ordered ? "Ordered reference" : "Reference"} · {owner.entry.providerId}</small></span><ArrowRightIcon size="sm" /></a></li>; })}</ul> : <EmptyState inline title="No incoming Content references" description="No canonical Content relationship currently points to this Entry." />;
  }}</Rebuild>;
  return <Show when={computed(() => state.value.graphStatus !== "idle")} fallback={() => <p role="status" class="sg-content-hint">Resolving the complete Content graph…</p>}>{() => <div>{summary}{inverseEditors}</div>}</Show>;
}

export function ContentRelationshipsView({ state }: { state: MaybeSignal<ContentAuthoringState> }) {
  return <Rebuild value={computed(() => read(state).model!)}>{(model) => {
    const refs = model.document.fields.filter((field) => field.kind === "reference" || field.kind === "reference-list");
    const inverses = model.document.presentation?.inverses ?? [];
    return <div class="sg-content-relationships"><section><h3>Outgoing relationships</h3>{refs.length ? <ul>{refs.map((field) => <li><strong>{field.label}</strong><code>{field.target.providerId}/{field.target.recordId}</code><span>{field.kind === "reference-list" ? field.ordered ? "Many · ordered" : "Many" : "One"}</span></li>)}</ul> : <p class="sg-content-hint">Add a Reference or References field to connect this model.</p>}</section><section><h3>Inverse relationships</h3>{inverses.length ? <ul>{inverses.map((inverse) => <li><strong>{inverse.label}</strong><code>{inverse.source.providerId}/{inverse.source.recordId}/{inverse.fieldId}</code><span>Edited atomically at the owning field</span></li>)}</ul> : <p class="sg-content-hint">No declarative inverse views are defined for this model.</p>}</section></div>;
  }}</Rebuild>;
}
