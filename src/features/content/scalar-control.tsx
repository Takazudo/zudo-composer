import { computed, getScope, signal, type Ref } from "@takazudo/zfb/zudo-react";
import type { JsonValue } from "@zudo-composer/component-contract";
import { externalDraft, followExternal, read, toSignal, type MaybeSignal } from "../../components/reactive";
import type { FieldControl } from "../../components/ui/field-context";
import { Input, Select, Textarea } from "../../components/ui/form-controls";
import type { ContentValueSchema } from "../../content/model/types";
import { ContentBooleanControl } from "./boolean-control";

export interface ContentScalarControlProps {
  schema: ContentValueSchema;
  /** A signal keeps the control mounted while its value follows the record. */
  value: MaybeSignal<JsonValue | undefined>;
  label?: string;
  required?: boolean;
  maxLength?: number;
  disabled?: MaybeSignal<boolean | undefined>;
  emptyChoiceLabel?: string;
  emptyChoiceDisabled?: boolean;
  /** Hosted opt-in: keep browser number intermediates while blocking typed saves. */
  retainIncompleteNumber?: boolean;
  allowEmptyNumber?: boolean;
  onIncompleteNumber?(raw: string | null): void;
  /** The owner explains the problem in the element named by `describedBy`. */
  invalid?: MaybeSignal<boolean | undefined>;
  describedBy?: MaybeSignal<string | undefined>;
  /** The wrapping `<Field>`'s wiring (id, help, error), when there is one. */
  field?: FieldControl;
  onChange(value: JsonValue | undefined): void;
}
const text = (value: JsonValue | undefined) => typeof value === "string" || typeof value === "number" ? String(value) : "";

/** The same primitive value widgets serve local structured forms and hosted forms. */
export function ContentScalarControl(props: ContentScalarControlProps) {
  const { schema, label, required, maxLength, disabled, emptyChoiceLabel = "Choose an option", emptyChoiceDisabled, retainIncompleteNumber, allowEmptyNumber = true, onIncompleteNumber, invalid, describedBy, field, onChange } = props;
  const scope = getScope();
  const value = toSignal(props.value);
  // Only what the owner supplied: an absent attribute leaves the field's wiring in charge.
  const common: Record<string, unknown> = { "aria-label": label, required, disabled: disabled === undefined ? undefined : computed(() => Boolean(read(disabled))) };
  if (invalid !== undefined) common["aria-invalid"] = computed(() => (read(invalid) ? "true" : undefined));
  if (describedBy !== undefined) common["aria-describedby"] = describedBy;
  const attrs = common as Record<string, never>;
  if (schema.kind === "choice") {
    const options = schema.options;
    const selected = computed(() => { const current = text(value.value); return options.some((option) => option.value === current) ? current : ""; });
    const draft = externalDraft(scope, selected);
    return <Select {...attrs} field={field} modelValue={draft} on:change={(event) => onChange(event.currentTarget.value || undefined)}><option value="" disabled={emptyChoiceDisabled}>{emptyChoiceLabel}</option>{options.map((option) => <option value={option.value}>{option.label}</option>)}</Select>;
  }
  if (schema.kind === "boolean") return <ContentBooleanControl label={label} value={value} required={required} disabled={disabled} describedBy={describedBy} field={field} onChange={onChange} />;
  if (schema.kind === "long-text") {
    const draft = externalDraft(scope, computed(() => text(value.value)));
    return <Textarea {...attrs} field={field} rows={5} maxlength={maxLength} modelValue={draft} on:input={(event) => onChange(event.currentTarget.value)} />;
  }
  if (schema.kind === "number" && retainIncompleteNumber) return <RetainedNumberControl value={value} label={label} required={required} disabled={disabled} invalid={invalid} describedBy={describedBy} field={field} allowEmpty={allowEmptyNumber} onIncomplete={onIncompleteNumber} onChange={onChange} />;
  if (schema.kind === "number" || schema.kind === "date" || schema.kind === "color") {
    // Number, date and color inputs take no model: the DOM is written when the
    // record changes from elsewhere, never echoing the author's own input back.
    const element: Ref<HTMLInputElement> = { current: null };
    let emitted: JsonValue | undefined = value.value;
    followExternal(scope, value, (next) => {
      if (Object.is(next, emitted)) return;
      emitted = next;
      if (element.current) element.current.value = text(next);
    });
    const emit = (next: JsonValue | undefined) => { emitted = next; onChange(next); };
    if (schema.kind === "number") return <Input {...attrs} field={field} elementRef={element} type="number" value={text(value.value)} on:input={(event) => emit(event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber)} />;
    return <Input {...attrs} field={field} elementRef={element} type={schema.kind} value={text(value.value)} on:input={(event) => emit(event.currentTarget.value)} />;
  }
  const draft = externalDraft(scope, computed(() => text(value.value)));
  return <Input {...attrs} field={field} maxlength={maxLength} type={schema.kind === "url" ? "url" : "text"} modelValue={draft} on:input={(event) => onChange(event.currentTarget.value)} />;
}

/** Transient invalid browser text stays local; only complete finite numbers reach Content. */
function RetainedNumberControl({ value, label, required, disabled, invalid, describedBy, field, allowEmpty, onIncomplete, onChange }: {
  value: MaybeSignal<JsonValue | undefined>; label?: string; required?: boolean; disabled?: MaybeSignal<boolean | undefined>; invalid?: MaybeSignal<boolean | undefined>; describedBy?: MaybeSignal<string | undefined>; field?: FieldControl; allowEmpty: boolean;
  onIncomplete?(raw: string | null): void; onChange(value: JsonValue | undefined): void;
}) {
  const scope = getScope();
  const current = toSignal(value);
  const element: Ref<HTMLInputElement> = { current: null };
  const incomplete = signal(false);
  let emitted: JsonValue | undefined = current.value;
  // A value that differs from the last one emitted came from elsewhere (a
  // reload, a discard): write it into the uncontrolled input explicitly.
  followExternal(scope, current, (next) => {
    if (Object.is(next, emitted)) return;
    if (element.current) element.current.value = text(next);
  });
  return <Input type="number" step="any" field={field} elementRef={element} aria-label={label} required={required} disabled={computed(() => Boolean(read(disabled)))}
    aria-invalid={computed(() => (incomplete.value || read(invalid) ? "true" : undefined))} aria-describedby={describedBy} value={text(current.value)} on:input={(event) => {
      const control = event.currentTarget; const raw = control.value; const numeric = control.valueAsNumber;
      if (raw === "" && allowEmpty && !control.validity.badInput) { emitted = undefined; incomplete.value = false; onIncomplete?.(null); onChange(undefined); return; }
      if (raw === "" || !Number.isFinite(numeric)) { incomplete.value = true; onIncomplete?.(raw); return; }
      emitted = numeric; incomplete.value = false; onIncomplete?.(null); onChange(numeric);
    }} />;
}
