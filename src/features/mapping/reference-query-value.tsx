import { computed, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../../components/reactive";
import { Keyed } from "../../runtime";
import { Button, Select } from "../../components/ui";
import type { ContentEntryRef } from "../../content";
import type { CollectionQueryPaneProps } from "./query-pane";
import { followModel } from "./signals";
const key = (ref: ContentEntryRef) => JSON.stringify([ref.providerId, ref.modelId, ref.recordId]);
function reference(value: unknown): ContentEntryRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3 && [record.providerId, record.modelId, record.recordId].every(item => typeof item === "string" && item.length > 0) ? record as unknown as ContentEntryRef : null;
}
type Target = { providerId: string; recordId: string };
type Option = { ref: ContentEntryRef; label: string };
/** Catalog loading and stale-value display are read-only. Only a deliberate selection edits the query. */
export function ReferenceQueryValue({ target, value, label, load, onChange }: {
  target: MaybeSignal<Target>; value: MaybeSignal<unknown>; label: string;
  load: CollectionQueryPaneProps["referenceEntries"]; onChange(value: ContentEntryRef): void;
}): Child {
  const currentTarget = computed(() => read(target));
  const scope = computed(() => JSON.stringify([currentTarget.value.providerId, currentTarget.value.recordId]));
  const refresh = signal(0);
  const state = signal<{ scope: string; options: readonly Option[]; error: string | null; loading: boolean }>({ scope: scope.value, options: [], error: null, loading: true });
  getScope().effect(() => {
    const requested = scope.value;
    const owner = currentTarget.value;
    void refresh.value;
    let live = true;
    state.value = { scope: requested, options: [], error: null, loading: true };
    void (async () => {
      if (!load) throw new Error("The reference Entry catalog is unavailable.");
      const options = await load(owner);
      if (options.some(option => !reference(option.ref) || option.ref.providerId !== owner.providerId || option.ref.modelId !== owner.recordId)) throw new Error("The reference catalog returned a different provider or model.");
      if (new Set(options.map(option => key(option.ref))).size !== options.length) throw new Error("The reference catalog returned duplicate Entry identities.");
      if (live) state.value = { scope: requested, options, error: null, loading: false };
    })().catch(cause => { if (live) state.value = { scope: requested, options: [], error: cause instanceof Error ? cause.message : "Reference catalog unavailable.", loading: false }; });
    return () => { live = false; };
  });
  const options = computed(() => state.value.scope === scope.value ? state.value.options : []);
  const current = computed(() => reference(read(value)));
  const loading = computed(() => state.value.scope !== scope.value || state.value.loading);
  const selected = computed(() => current.value ? key(current.value) : "");
  const listed = computed(() => options.value.some(option => key(option.ref) === selected.value));
  const missing = computed(() => Boolean(current.value) && !loading.value && !listed.value);
  // The select's options are static, so it is rebuilt whenever they change.
  const optionsKey = computed(() => JSON.stringify([loading.value, selected.value, listed.value, options.value.map(option => [key(option.ref), option.label])]));
  return <div class="cms-mapping-query__reference">
    <Keyed value={optionsKey} by={k => k}>{() => {
      const model = followModel(() => selected.value);
      const list = options.value, ref = current.value, busy = loading.value;
      return <Select size="sm" aria-label={label} disabled={computed(() => loading.value || !!state.value.error)} modelValue={model} on:change={event => {
        const option = options.value.find(item => key(item.ref) === event.currentTarget.value);
        if (option) onChange({ ...option.ref });
        // A choice the query did not take shows the stored value again.
        else model.value = selected.value;
      }}>
        <option value="">{busy ? "Loading referenced Entries…" : "Choose referenced Entry"}</option>
        {ref && !list.some(option => key(option.ref) === key(ref)) ? <option value={key(ref)}>{`${busy ? "Current reference" : "Unavailable reference"} · ${ref.providerId}/${ref.modelId}/${ref.recordId}`}</option> : null}
        {list.map(option => <option key={key(option.ref)} value={key(option.ref)}>{`${option.label} · ${option.ref.providerId}/${option.ref.modelId}/${option.ref.recordId}`}</option>)}
      </Select>;
    }}</Keyed>
    <Button size="sm" variant="ghost" disabled={loading} on:click={() => { refresh.value += 1; }}>Refresh referenced Entries</Button>
    <Show when={computed(() => !!state.value.error)}>{() => <p role="alert">{computed(() => state.value.error ?? "")} The existing query value is retained.</p>}</Show>
    <Show when={computed(() => missing.value && !state.value.error)}>{() => <p role="alert">The referenced Entry is missing or belongs to a different provider/model. Choose an available Entry or change/remove this filter. The existing value is retained.</p>}</Show>
    <Show when={computed(() => !current.value && !loading.value)}>{() => <p role="status">Choose a qualified Entry for this reference condition. Entry labels and ordering are not identities.</p>}</Show>
  </div>;
}
