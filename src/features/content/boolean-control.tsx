import { useFieldControl } from "../../components/ui/field-context";
import { useDomId } from "../../components/use-dom-id";
import type { JsonValue } from "@zudo-composer/component-contract";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/form-controls";

/** Absence stays absent until the author explicitly chooses Yes or No. */
export function ContentBooleanControl({ value, label = "Boolean", id, required, disabled, describedBy, class: className, onChange }: {
  value: JsonValue | undefined;
  label?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  describedBy?: string;
  class?: string;
  onChange(value: boolean): void;
}) {
  const unsetId = useDomId();
  const field = useFieldControl();
  const description = [describedBy ?? field?.describedBy, value === undefined ? unsetId : undefined].filter(Boolean).join(" ") || undefined;
  return <div>
    <Switch id={id} class={className} aria-label={label} label={<>{label}{required ? <span class="sg-content-req" aria-hidden="true"> *</span> : null}</>}
      checked={value === true} disabled={disabled} aria-describedby={description} onCheckedChange={onChange} />
    {value === undefined ? <div><span id={unsetId}>Not set</span>{" "}<Button size="sm" disabled={disabled} aria-label={`Set ${label} to No`} onClick={() => { if (!disabled) onChange(false); }}>Set to No</Button></div> : null}
  </div>;
}
