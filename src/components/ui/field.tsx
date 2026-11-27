import { computed, Show, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { ErrorIcon } from "../icons";
import { isSignal } from "../reactive";
import { cx } from "./class-names";
import type { FieldControl } from "./field-context";
import { createDomId } from "../use-dom-id";

/** Error text: a static child, or a signal for a validation message that comes and goes. */
export type FieldError = Child | ReadonlySignal<string | null | undefined>;

export interface FieldProps {
  label: Child;
  required?: boolean;
  /** Right-aligned muted hint naming the value's kind, e.g. "Markdown" or "Slug". */
  kind?: Child;
  help?: Child;
  /** Present error text switches the field — and the control it wraps — to the invalid state. */
  error?: FieldError;
  /** Explicit control id; otherwise a generated one is handed to the control. */
  controlId?: string;
  class?: string;
  /** The wrapped control. A function receives the wiring to pass as the control's `field` prop. */
  children?: Child | ((field: FieldControl) => Child);
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false && value !== "";
}

export function Field({ label, required = false, kind, help, error, controlId, class: className, children }: FieldProps) {
  const id = controlId ?? createDomId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const errorSignal = isSignal(error) ? (error as ReadonlySignal<string | null | undefined>) : null;
  const invalid = computed(() => (errorSignal ? present(errorSignal.value) : present(error)));
  const describedBy = computed(() => cx(present(help) ? helpId : undefined, invalid.value ? errorId : undefined) || undefined);
  const control: FieldControl = { controlId: id, describedBy, invalid, required };
  const errorText = (content: Child) => (
    <p class="cms-field__error" id={errorId}>
      <ErrorIcon size="sm" class="cms-field__error-icon" />
      {content}
    </p>
  );

  return (
    <div class={cx("cms-field", className)}>
      <label class="cms-field__label" for={id}>
        <span class="cms-field__label-text">{label}</span>
        {required ? (
          <span class="cms-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
        {/* aria-hidden for the same reason as the required mark above: this sits
            inside the <label>, so it joins the control's accessible name —
            `<Field label="Title" kind="Short text">` computed as "TitleShort text",
            and a separating space does not survive accname's per-node trim. The
            control's own role already conveys the distinction the hint describes. */}
        {kind ? (
          <span class="cms-field__kind" aria-hidden="true">
            {kind}
          </span>
        ) : null}
      </label>
      {typeof children === "function" ? children(control) : children}
      {help ? (
        <p class="cms-field__help" id={helpId}>
          {help}
        </p>
      ) : null}
      {errorSignal
        ? <Show when={invalid}>{() => errorText(errorSignal as Child)}</Show>
        : present(error) ? errorText(error as Child) : null}
    </div>
  );
}
