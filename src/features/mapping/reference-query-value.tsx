import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, Select } from "../../components/ui";
import type { ContentEntryRef } from "../../content";
import type { CollectionQueryPaneProps } from "./query-pane";
const key = (ref: ContentEntryRef) => JSON.stringify([ref.providerId, ref.modelId, ref.recordId]);
function reference(value: unknown): ContentEntryRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 3 && [record.providerId, record.modelId, record.recordId].every(item => typeof item === "string" && item.length > 0) ? record as unknown as ContentEntryRef : null;
}
/** Catalog loading and stale-value display are read-only. Only a deliberate selection edits the query. */
export function ReferenceQueryValue({ target, value, label, load, onChange }: {
  target: { providerId: string; recordId: string }; value: unknown; label: string;
  load: CollectionQueryPaneProps["referenceEntries"]; onChange(value: ContentEntryRef): void;
}): JSX.Element {
  const scope = JSON.stringify([target.providerId, target.recordId]);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{ scope: string; options: readonly { ref: ContentEntryRef; label: string }[]; error: string | null; loading: boolean }>({ scope, options: [], error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState({ scope, options: [], error: null, loading: true });
    void (async () => {
      if (!load) throw new Error("The reference Entry catalog is unavailable.");
      const options = await load(target);
      if (options.some(option => !reference(option.ref) || option.ref.providerId !== target.providerId || option.ref.modelId !== target.recordId)) throw new Error("The reference catalog returned a different provider or model.");
      if (new Set(options.map(option => key(option.ref))).size !== options.length) throw new Error("The reference catalog returned duplicate Entry identities.");
      if (live) setState({ scope, options, error: null, loading: false });
    })().catch(cause => { if (live) setState({ scope, options: [], error: cause instanceof Error ? cause.message : "Reference catalog unavailable.", loading: false }); });
    return () => { live = false; };
  }, [scope, load, refresh]);
  const options = state.scope === scope ? state.options : [], current = reference(value);
  const loading = state.scope !== scope || state.loading;
  const selected = current ? key(current) : "";
  const missing = current && !loading && !options.some(option => key(option.ref) === selected);
  return <div class="cms-mapping-query__reference">
    <Select size="sm" aria-label={label} disabled={loading || !!state.error} value={selected} onChange={event => {
      const option = options.find(item => key(item.ref) === event.currentTarget.value);
      if (option) onChange({ ...option.ref });
    }}>
      <option value="">{loading ? "Loading referenced Entries…" : "Choose referenced Entry"}</option>
      {current && !options.some(option => key(option.ref) === selected) && <option value={selected}>{loading ? "Current reference" : "Unavailable reference"} · {current.providerId}/{current.modelId}/{current.recordId}</option>}
      {options.map(option => <option key={key(option.ref)} value={key(option.ref)}>{option.label} · {option.ref.providerId}/{option.ref.modelId}/{option.ref.recordId}</option>)}
    </Select>
    <Button size="sm" variant="ghost" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh referenced Entries</Button>
    {state.error && <p role="alert">{state.error} The existing query value is retained.</p>}
    {missing && !state.error && <p role="alert">The referenced Entry is missing or belongs to a different provider/model. Choose an available Entry or change/remove this filter. The existing value is retained.</p>}
    {!current && !loading && <p role="status">Choose a qualified Entry for this reference condition. Entry labels and ordering are not identities.</p>}
  </div>;
}
