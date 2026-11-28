import { computed, Show } from "@takazudo/zfb/zudo-react";
import type { JsonValue } from "@zudo-composer/component-contract";
import { read, toSignal, type MaybeSignal } from "../../components/reactive";
import { Button } from "../../components/ui/button";
import type { FieldControl } from "../../components/ui/field-context";
import { Switch } from "../../components/ui/form-controls";
import { createDomId } from "../../components/use-dom-id";

/** Absence stays absent until the author explicitly chooses Yes or No. */
export function ContentBooleanControl({ value, label = "Boolean", id, required, disabled = false, describedBy, field, class: className, onChange }: {
  value: MaybeSignal<JsonValue | undefined>;
  label?: string;
  id?: string;
  required?: boolean;
  disabled?: MaybeSignal<boolean | undefined>;
  describedBy?: MaybeSignal<string | undefined>;
  /** The wrapping `<Field>`'s wiring; its help and error join the description. */
  field?: FieldControl;
  class?: string;
  onChange(value: boolean): void;
}) {
  const unsetId = createDomId();
  const current = toSignal(value);
  const unset = computed(() => current.value === undefined);
  const description = computed(() => [read(describedBy) ?? field?.describedBy.value, unset.value ? unsetId : undefined].filter(Boolean).join(" ") || undefined);
  const isDisabled = computed(() => Boolean(read(disabled)));
  return <div>
    <Switch id={id ?? field?.controlId} class={className} aria-label={label} label={<>{label}{required ? <span class="sg-content-req" aria-hidden="true"> *</span> : null}</>}
      checked={computed(() => current.value === true)} disabled={isDisabled}
      // Switch forwards a signal description to the input unchanged.
      aria-describedby={description as unknown as string} onCheckedChange={onChange} />
    <Show when={unset}>{() => <div><span id={unsetId}>Not set</span>{" "}<Button size="sm" disabled={isDisabled} aria-label={`Set ${label} to No`} on:click={() => { if (!isDisabled.value) onChange(false); }}>Set to No</Button></div>}</Show>
  </div>;
}
