import { useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { JsonValue } from "@zudo-composer/component-contract";
import type { ContentValueSchema } from "../../content/model/types";
import { Input, Select, Switch, Textarea } from "../../components/ui/form-controls";

export interface ContentScalarControlProps {
  schema: ContentValueSchema;
  value: JsonValue | undefined;
  label?: string;
  required?: boolean;
  maxLength?: number;
  disabled?: boolean;
  emptyChoiceLabel?: string;
  emptyChoiceDisabled?: boolean;
  /** Hosted opt-in: keep browser number intermediates while blocking typed saves. */
  retainIncompleteNumber?: boolean;
  allowEmptyNumber?: boolean;
  onIncompleteNumber?(raw: string | null): void;
  onChange(value: JsonValue | undefined): void;
}
const text = (value: JsonValue | undefined) => typeof value === "string" || typeof value === "number" ? String(value) : "";
/** The same primitive value widgets serve local structured forms and hosted forms. */
export function ContentScalarControl({ schema, value, label, required, maxLength, disabled, emptyChoiceLabel = "Choose an option", emptyChoiceDisabled, retainIncompleteNumber, allowEmptyNumber = true, onIncompleteNumber, onChange }: ContentScalarControlProps): JSX.Element {
  const common = { "aria-label": label, required, disabled };
  if (schema.kind === "choice") return <Select {...common} value={text(value)} onChange={(event) => onChange(event.currentTarget.value || undefined)}><option value="" disabled={emptyChoiceDisabled}>{emptyChoiceLabel}</option>{schema.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>;
  if (schema.kind === "boolean") return <Switch label={label ?? "Boolean"} aria-label={label} checked={value === true} disabled={disabled} onCheckedChange={onChange} />;
  if (schema.kind === "long-text") return <Textarea {...common} rows={5} maxLength={maxLength} value={text(value)} onInput={(event) => onChange(event.currentTarget.value)} />;
  if (schema.kind === "number" && retainIncompleteNumber) return <RetainedNumberControl value={value} label={label} required={required} disabled={disabled} allowEmpty={allowEmptyNumber} onIncomplete={onIncompleteNumber} onChange={onChange} />;
  if (schema.kind === "number") return <Input {...common} type="number" value={text(value)} onInput={(event) => onChange(event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber)} />;
  return <Input {...common} maxLength={maxLength} type={schema.kind === "date" ? "date" : schema.kind === "color" ? "color" : schema.kind === "url" ? "url" : "text"} value={text(value)} onInput={(event) => onChange(event.currentTarget.value)} />;
}

/** Transient invalid browser text stays local; only complete finite numbers reach Content. */
function RetainedNumberControl({ value, label, required, disabled, allowEmpty, onIncomplete, onChange }: {
  value: JsonValue | undefined; label?: string; required?: boolean; disabled?: boolean; allowEmpty: boolean;
  onIncomplete?(raw: string | null): void; onChange(value: JsonValue | undefined): void;
}) {
  const [draft, setDraft] = useState(text(value));
  const [incomplete, setIncomplete] = useState(false);
  const external = useRef(value); const emitted = useRef<JsonValue | undefined>(value);
  if (external.current !== value) {
    external.current = value;
    if (emitted.current !== value) setDraft(text(value));
  }
  return <Input type="number" step="any" aria-label={label} required={required} disabled={disabled} aria-invalid={incomplete ? "true" : undefined} value={draft} onInput={(event) => {
    const control = event.currentTarget; const raw = control.value; const numeric = control.valueAsNumber; setDraft(raw);
    if (raw === "" && allowEmpty && !control.validity.badInput) { emitted.current = undefined; setIncomplete(false); onIncomplete?.(null); onChange(undefined); return; }
    if (raw === "" || !Number.isFinite(numeric)) { setIncomplete(true); onIncomplete?.(raw); return; }
    emitted.current = numeric; setIncomplete(false); onIncomplete?.(null); onChange(numeric);
  }} />;
}
