import { useRef, useState } from "preact/hooks";
import type { ComponentManifest, JsonValue } from "@zudo-composer/component-contract";
import { validateFieldValue } from "@zudo-composer/component-contract";
import { Button } from "../../components/ui";
import { InspectorField } from "../composer/ui/inspector/inspector-field";
import type { HostDocumentTarget } from "../../../server/host-document/types";

/** Field controls only stage a complete top-level prop. Explicit Save is the sole mutation path. */
export function HostInspector({ target, component, disabled, saving = false, onDirty, onSave }: {
  target: HostDocumentTarget; component?: ComponentManifest; disabled: boolean; saving?: boolean;
  onDirty(value: boolean): void; onSave(change: unknown): Promise<unknown>;
}) {
  const [draft, setDraft] = useState<{ prop: string; value: JsonValue | undefined } | null>(null);
  const active = useRef<string | null>(null);
  const [invalidInputs, setInvalidInputs] = useState<ReadonlySet<string>>(new Set());
  const [generation, setGeneration] = useState(0);
  const [slotId, setSlotId] = useState("");
  const [componentId, setComponentId] = useState("");
  const capabilities = target.capabilities;
  const reason = capabilities?.fields.reason ?? (!capabilities ? "This captured target has no verified editing capabilities." : undefined);
  const discard = () => { active.current = null; setDraft(null); setInvalidInputs(new Set()); setGeneration(value => value + 1); onDirty(false); };
  const stage = (prop: string, value: JsonValue | undefined) => {
    if (active.current && active.current !== prop) return;
    active.current = prop; setDraft({ prop, value }); onDirty(true);
  };
  let validation: string | null = null;
  if (draft) {
    const field = component?.fields.find(field => field.prop === draft.prop);
    try { if (!field || draft.value === undefined) throw new Error("A declared complete field value is required."); validateFieldValue(field, draft.value); }
    catch (cause) { validation = cause instanceof Error ? cause.message : "Invalid field value."; }
  }
  const slots = capabilities?.insertSlots ?? [], slot = slots.find(value => value.slotId === slotId);
  return <div class="cms-host-inspector">
    {!component && <p role="status">The installed component definition is unavailable; field editing is disabled.</p>}
    {reason && <p role="status">{reason}</p>}
    {draft && <section aria-label="Unsaved component field"><p role="status">Unsaved {component?.fields.find(field => field.prop === draft.prop)?.label ?? draft.prop}. The preview still shows saved content.</p>{validation && <p role="alert">{validation}</p>}{invalidInputs.size > 0 && <p role="alert">Correct the invalid numeric input or discard this draft before saving.</p>}<Button disabled={disabled || !capabilities?.fields.allowed || !!validation || invalidInputs.size > 0} onClick={() => void onSave({ kind: "field", prop: draft.prop, value: draft.value })}>Save field</Button><Button disabled={saving} onClick={discard}>Discard local draft</Button></section>}
    <fieldset disabled={disabled || !capabilities?.fields.allowed}><legend>Component fields</legend>{component?.fields.map(field => {
      const value = draft?.prop === field.prop ? draft.value : target.props[field.prop];
      const omitted = value === undefined;
      return <div key={`${field.prop}:${generation}`} class="cms-host-inspector-field" onInputCapture={event => {
        if (disabled || !capabilities?.fields.allowed || (active.current && active.current !== field.prop)) return;
        stage(field.prop, value);
        const input = event.target;
        if (input instanceof HTMLInputElement && input.type === "number") setInvalidInputs(previous => { const next = new Set(previous); if (!input.value.trim() || !input.validity.valid) next.add(input.id); else next.delete(input.id); return next; });
      }}>
        {omitted ? <p>{field.label}: omitted. Adding or removing optional top-level properties is not supported here.</p> : <InspectorField field={field} value={value} disabled={disabled || !capabilities?.fields.allowed || (!!draft && draft.prop !== field.prop)} onCommit={(next, _path, structural) => { if (structural) setInvalidInputs(new Set()); stage(field.prop, next); }} />}
      </div>;
    })}</fieldset>
    <details><summary>Advanced saved properties</summary><dl>{Object.entries(target.props).filter(([key]) => !component?.fields.some(field => field.prop === key)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{JSON.stringify(value)}</dd></div>)}</dl><p>Undeclared properties are read-only. Optional omission requires a separate supported operation.</p></details>
    <section aria-label="Local arrangement"><h3>Local arrangement</h3>{capabilities?.structure.reason && <p>{capabilities.structure.reason}</p>}<Button disabled={disabled || !!draft || !capabilities?.structure.allowed} onClick={() => void onSave({ kind: "reorder", direction: "up" })}>Move up</Button><Button disabled={disabled || !!draft || !capabilities?.structure.allowed} onClick={() => void onSave({ kind: "reorder", direction: "down" })}>Move down</Button></section>
    {target.placement && <section aria-label="Page placement"><h3>Page placement</h3><p>Moves the complete page-owned placement, without changing its shared contents.</p>{capabilities?.placement.reason && <p>{capabilities.placement.reason}</p>}<Button disabled={disabled || !!draft || !capabilities?.placement.allowed} onClick={() => void onSave({ kind: "reorder-placement", direction: "up" })}>Move page placement up</Button><Button disabled={disabled || !!draft || !capabilities?.placement.allowed} onClick={() => void onSave({ kind: "reorder-placement", direction: "down" })}>Move page placement down</Button></section>}
    <section aria-label="Insert local component"><h3>Insert local component</h3>{slots.length ? <><label>Named slot <select class="cms-select" disabled={disabled || !!draft} value={slotId} onChange={event => { setSlotId(event.currentTarget.value); setComponentId(""); }}><option value="">Choose slot</option>{slots.map(value => <option key={value.slotId} value={value.slotId}>{value.label}</option>)}</select></label>{slot?.reason && <p>{slot.reason}</p>}{slot && slot.components.length > 0 && <><label>Component <select class="cms-select" disabled={disabled || !!draft} value={componentId} onChange={event => setComponentId(event.currentTarget.value)}><option value="">Choose component</option>{slot.components.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}</select></label><Button disabled={disabled || !!draft || !componentId} onClick={() => void onSave({ kind: "insert", slotId, componentId, nodeId: crypto.randomUUID() })}>Insert at start of slot</Button></>}</> : <p>This component has no declared child slots. Page creation, removal and root insertion are not available in this panel.</p>}</section>
  </div>;
}
