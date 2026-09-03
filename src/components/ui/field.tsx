import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { ErrorIcon } from "../icons";
import { cx } from "./class-names";
import { FieldContext } from "./field-context";

export interface FieldProps {
  label: ComponentChildren;
  required?: boolean;
  /** Right-aligned muted hint naming the value's kind, e.g. "Markdown" or "Slug". */
  kind?: ComponentChildren;
  help?: ComponentChildren;
  /** Present error text switches the field — and the control it wraps — to the invalid state. */
  error?: ComponentChildren;
  /** Explicit control id; otherwise a generated one is shared through context. */
  controlId?: string;
  class?: string;
  children?: ComponentChildren;
}

export function Field({ label, required = false, kind, help, error, controlId, class: className, children }: FieldProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = cx(help ? helpId : undefined, error ? errorId : undefined) || undefined;

  return (
    <div class={cx("cms-field", className)}>
      <label class="cms-field__label" for={id}>
        <span class="cms-field__label-text">{label}</span>
        {required ? (
          <span class="cms-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
        {kind ? <span class="cms-field__kind">{kind}</span> : null}
      </label>
      <FieldContext.Provider value={{ controlId: id, describedBy, invalid: Boolean(error), required }}>
        {children}
      </FieldContext.Provider>
      {help ? (
        <p class="cms-field__help" id={helpId}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p class="cms-field__error" id={errorId}>
          <ErrorIcon size="sm" class="cms-field__error-icon" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
