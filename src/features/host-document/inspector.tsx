import { batch, computed, For, Show, signal } from "@takazudo/zfb/zudo-react";
import { formatIntent } from "../../app/route-intents";
import type { ComponentManifest, JsonValue } from "@zudo-composer/component-contract";
import { validateFieldValue } from "@zudo-composer/component-contract";
import { Button } from "../../components/ui";
import { Rebuild } from "../../components/rebuild";
import { read, type MaybeSignal } from "../../components/reactive";
import { InspectorField } from "../composer/ui/inspector/inspector-field";
import { LiveSelect, when } from "../native-editing/live";
import type { HostDocumentTarget } from "../../../server/host-document/types";

/**
 * Field controls only stage a complete top-level prop. Explicit Save is the sole mutation path.
 * Each field control mounts with a static value and disabled state; a field remounts (showing
 * the staged draft, if it is the draft's field) when either changes, so the draft survives.
 */
export function HostInspector({ target: targetProp, component, disabled: disabledProp, saving: savingProp = false, onDirty, onSave }: {
  target: MaybeSignal<HostDocumentTarget>; component?: ComponentManifest; disabled: MaybeSignal<boolean>; saving?: MaybeSignal<boolean>;
  onDirty(value: boolean): void; onSave(change: unknown): Promise<unknown>;
}) {
  const target = computed(() => read(targetProp));
  const disabled = computed(() => read(disabledProp));
  const saving = computed(() => read(savingProp));
  const draft = signal<{ prop: string; value: JsonValue | undefined } | null>(null);
  let active: string | null = null;
  const invalidInputs = signal<ReadonlySet<string>>(new Set());
  const generation = signal(0);
  const slotId = signal(""), componentId = signal("");
  const capabilities = computed(() => target.value.capabilities);
  const fieldsAllowed = computed(() => !!capabilities.value?.fields.allowed);
  const reason = computed(() => capabilities.value?.fields.reason ?? (!capabilities.value ? "This captured target has no verified editing capabilities." : undefined));
  const discard = () => { active = null; batch(() => { draft.value = null; invalidInputs.value = new Set(); generation.value += 1; }); onDirty(false); };
  const stage = (prop: string, value: JsonValue | undefined) => {
    if (active && active !== prop) return;
    active = prop; draft.value = { prop, value }; onDirty(true);
  };
  const validation = computed(() => {
    const current = draft.value;
    if (!current) return null;
    const field = component?.fields.find(entry => entry.prop === current.prop);
    try { if (!field || current.value === undefined) throw new Error("A declared complete field value is required."); validateFieldValue(field, current.value); return null; }
    catch (cause) { return cause instanceof Error ? cause.message : "Invalid field value."; }
  });
  const hasDraft = when(() => draft.value);
  const structureLocked = (allowed: () => boolean | undefined) => computed(() => disabled.value || !!draft.value || !allowed());
  const fields = computed(() => (component?.fields ?? []).map(field => {
    const fieldDisabled = disabled.value || !fieldsAllowed.value || (!!draft.value && draft.value.prop !== field.prop);
    return { field, fieldDisabled, key: `${field.prop}:${generation.value}:${fieldDisabled}:${JSON.stringify(target.value.props[field.prop] ?? null)}` };
  }));
  const currentValue = (prop: string) => draft.value?.prop === prop ? draft.value.value : target.value.props[prop];
  const slots = computed(() => capabilities.value?.insertSlots ?? []);
  const slot = computed(() => slots.value.find(value => value.slotId === slotId.value));
  return <div class="cms-host-inspector">
    {!component && <p role="status">The installed component definition is unavailable; field editing is disabled.</p>}
    <Show when={when(() => reason.value)}>{() => <p role="status">{computed(() => reason.value ?? "")}</p>}</Show>
    <Rebuild value={computed(() => target.value.fieldSources)}>{sources => sources?.length ? <section aria-label="Bound field sources"><h3>Bound field sources</h3><p>Sources and affected uses in this saved capture. Arrangement uses are listed separately.</p>{sources.map(field => <section aria-label={`${field.label} source`}><h4>{field.label}</h4>{field.reason && <p>{field.reason}</p>}{field.sources.map(source => <div><p>{source.fieldLabel} — <code>{source.entry.providerId}/{source.entry.modelId}/{source.entry.recordId}{source.fieldId ? `/${source.fieldId}` : ""}</code></p>{source.reason && <p>{source.reason}</p>}<Show when={when(() => !disabled.value && !draft.value)}>{() => <a href={formatIntent({ route: "content", providerId: source.entry.providerId, modelId: source.entry.modelId, entryId: source.entry.recordId })}>Open {source.fieldLabel} source</a>}</Show><p>Affected saved pages</p><ul>{[...new Set(source.affectedUses.map(use => use.pathname))].map(pathname => <li>{pathname}</li>)}</ul></div>)}</section>)}</section> : null}</Rebuild>
    <Show when={hasDraft}>{() => <section aria-label="Unsaved component field"><p role="status">{computed(() => { const prop = draft.value?.prop ?? ""; return `Unsaved ${component?.fields.find(field => field.prop === prop)?.label ?? prop}. The preview still shows saved content.`; })}</p><Show when={when(() => validation.value)}>{() => <p role="alert">{computed(() => validation.value ?? "")}</p>}</Show><Show when={when(() => invalidInputs.value.size > 0)}>{() => <p role="alert">Correct the invalid numeric input or discard this draft before saving.</p>}</Show><Button disabled={computed(() => disabled.value || !fieldsAllowed.value || !!validation.value || invalidInputs.value.size > 0)} on:click={() => { const current = draft.value; if (current) void onSave({ kind: "field", prop: current.prop, value: current.value }); }}>Save field</Button><Button disabled={saving} on:click={discard}>Discard local draft</Button></section>}</Show>
    <fieldset disabled={computed(() => disabled.value || !fieldsAllowed.value)}><legend>Component fields</legend><For each={fields} by={entry => entry.key}>{entry => {
      const { field, fieldDisabled } = entry.value;
      const value = currentValue(field.prop);
      return <div class="cms-host-inspector-field" on:input={event => {
        if (disabled.value || !fieldsAllowed.value || (active && active !== field.prop)) return;
        // Typed controls own the complete value through onCommit. Never stage
        // the old prop in capture: a draft observer may render before the
        // target receives input, swallowing that event and saving the old value.
        const input = event.target;
        if (input instanceof HTMLInputElement && input.type === "number") {
          const invalid = !input.value.trim() || !input.validity.valid;
          // Invalid numeric drafts intentionally do not call onCommit. Track
          // their unsaved state after the control handled the input event.
          if (invalid) stage(field.prop, currentValue(field.prop));
          const next = new Set(invalidInputs.value); if (invalid) next.add(input.id); else next.delete(input.id);
          invalidInputs.value = next;
        }
      }}>
        {value === undefined ? <p>{field.label}: omitted. Adding or removing optional top-level properties is not supported here.</p> : <InspectorField field={field} value={value} disabled={fieldDisabled} onCommit={(next, _path, structural) => { if (structural) invalidInputs.value = new Set(); stage(field.prop, next); }} />}
      </div>;
    }}</For></fieldset>
    <Rebuild value={target}>{current => {
      const caps = current.capabilities;
      const arrangementLocked = structureLocked(() => caps?.structure.allowed);
      const removeLocked = structureLocked(() => caps?.remove?.allowed);
      const placementLocked = structureLocked(() => caps?.placement.allowed);
      const slotLocked = computed(() => disabled.value || !!draft.value);
      return <>
        <details><summary>Advanced saved properties</summary><dl>{Object.entries(current.props).filter(([key]) => !component?.fields.some(field => field.prop === key)).map(([key, value]) => <div><dt>{key}</dt><dd>{JSON.stringify(value)}</dd></div>)}</dl><p>Undeclared properties are read-only. Optional omission requires a separate supported operation.</p></details>
        <section aria-label="Local arrangement"><h3>Local arrangement</h3>{caps?.structure.reason && <p>{caps.structure.reason}</p>}<Button disabled={arrangementLocked} on:click={() => void onSave({ kind: "reorder", direction: "up" })}>Move up</Button><Button disabled={arrangementLocked} on:click={() => void onSave({ kind: "reorder", direction: "down" })}>Move down</Button></section>
        <section aria-label="Remove local component"><h3>Remove local component</h3><p>Owner: {current.providerId}/{current.recordId}/{current.nodeId}</p>{!caps?.remove?.allowed && <p>{caps?.remove?.reason ?? "Removal is not supported for this captured target."}</p>}<Button disabled={removeLocked} on:click={() => void onSave({ kind: "remove" })}>Remove component</Button></section>
        {current.placement && <section aria-label="Page placement"><h3>Page placement</h3><p>Moves the complete page-owned placement, without changing its shared contents.</p>{caps?.placement.reason && <p>{caps.placement.reason}</p>}<Button disabled={placementLocked} on:click={() => void onSave({ kind: "reorder-placement", direction: "up" })}>Move page placement up</Button><Button disabled={placementLocked} on:click={() => void onSave({ kind: "reorder-placement", direction: "down" })}>Move page placement down</Button></section>}
        <section aria-label="Insert local component"><h3>Insert local component</h3>{slots.value.length ? <><label>Named slot <LiveSelect class="cms-select" disabled={slotLocked} options={[{ value: "", label: "Choose slot" }, ...slots.value.map(value => ({ value: value.slotId, label: value.label }))]} value={slotId} onChange={value => batch(() => { slotId.value = value; componentId.value = ""; })} /></label><Rebuild value={slot}>{chosen => chosen ? <>{chosen.reason && <p>{chosen.reason}</p>}{chosen.components.length > 0 && <><label>Component <LiveSelect class="cms-select" disabled={slotLocked} options={[{ value: "", label: "Choose component" }, ...chosen.components.map(value => ({ value: value.id, label: value.title }))]} value={componentId} onChange={value => { componentId.value = value; }} /></label><Button disabled={computed(() => slotLocked.value || !componentId.value)} on:click={() => void onSave({ kind: "insert", slotId: slotId.value, componentId: componentId.value, nodeId: crypto.randomUUID() })}>Insert at start of slot</Button></>}</> : null}</Rebuild></> : <p>This component has no declared child slots. Page creation and root insertion are not available in this panel.</p>}</section>
      </>;
    }}</Rebuild>
  </div>;
}
