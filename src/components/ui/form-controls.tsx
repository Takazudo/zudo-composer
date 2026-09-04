import type { ComponentChildren, JSX, Ref } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { ChevronDownIcon } from "../icons";
import type { IconComponent } from "../icons";
import { cx } from "./class-names";
import type { WithPlainClass } from "./class-names";
import { useFieldControl } from "./field-context";

/** `md` is the 30px chrome control height; `sm` is the 26px toolbar height. */
export type ControlSize = "sm" | "md";

export interface InputProps extends WithPlainClass<Omit<JSX.IntrinsicElements["input"], "size" | "ref">> {
  size?: ControlSize;
  /** Decorative leading icon; the input reserves its inline start padding. */
  icon?: IconComponent;
  /**
   * Ref onto the rendered `<input>`. Preact strips `ref` from a function
   * component rather than forwarding it, so callers that must focus or select
   * the control take it through this prop rather than wrapping the component in
   * a `<div ref>` and reaching in with `querySelector("input")`.
   */
  elementRef?: Ref<HTMLInputElement>;
}

/** `class` lands on the outermost node: the input, or the wrapper an icon adds. */
export function Input({ size = "md", icon: Icon, class: className, elementRef, ...rest }: InputProps) {
  const field = useFieldControl();
  const input = (
    <input
      {...rest}
      ref={elementRef}
      class={cx("cms-input", size === "sm" && "cms-input--sm", !Icon && className)}
      id={rest.id ?? field?.controlId}
      aria-describedby={rest["aria-describedby"] ?? field?.describedBy}
      aria-invalid={rest["aria-invalid"] ?? (field?.invalid ? "true" : undefined)}
      required={rest.required ?? field?.required}
    />
  );
  if (!Icon) return input;
  return (
    <span class={cx("cms-input-wrap", className)}>
      <Icon size="sm" class="cms-input__icon" />
      {input}
    </span>
  );
}

export interface SelectProps extends WithPlainClass<Omit<JSX.IntrinsicElements["select"], "size" | "ref">> {
  size?: ControlSize;
}

/**
 * The caret is a real icon rather than a background image: a data-URI SVG could
 * not take its stroke from a colour token, and no component may carry a literal.
 * `class` lands on the wrapper, which is what callers lay out.
 */
export function Select({ size = "md", class: className, children, ...rest }: SelectProps) {
  const field = useFieldControl();
  return (
    <span class={cx("cms-select-wrap", className)}>
      <select
        {...rest}
        class={cx("cms-select", size === "sm" && "cms-select--sm")}
        id={rest.id ?? field?.controlId}
        aria-describedby={rest["aria-describedby"] ?? field?.describedBy}
        aria-invalid={rest["aria-invalid"] ?? (field?.invalid ? "true" : undefined)}
        required={rest.required ?? field?.required}
      >
        {children}
      </select>
      <ChevronDownIcon size="sm" class="cms-select__caret" />
    </span>
  );
}

export type TextareaProps = WithPlainClass<Omit<JSX.IntrinsicElements["textarea"], "ref">>;

export function Textarea({ class: className, ...rest }: TextareaProps) {
  const field = useFieldControl();
  return (
    <textarea
      {...rest}
      class={cx("cms-textarea", className)}
      id={rest.id ?? field?.controlId}
      aria-describedby={rest["aria-describedby"] ?? field?.describedBy}
      aria-invalid={rest["aria-invalid"] ?? (field?.invalid ? "true" : undefined)}
      required={rest.required ?? field?.required}
    />
  );
}

interface ToggleBaseProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  id?: string;
  class?: string;
  "aria-describedby"?: string;
}

/** A toggle with no visible label must name itself through `aria-label`. */
type ToggleProps<Extra> = ToggleBaseProps &
  Extra &
  ({ label: ComponentChildren } | { "aria-label": string; label?: undefined });

export type SwitchProps = ToggleProps<Record<never, never>>;

export function Switch(props: SwitchProps) {
  const { checked, onCheckedChange, disabled, name, id, class: className, label, ...aria } = props;
  const field = useFieldControl();
  return (
    <label class={cx("cms-switch", disabled && "cms-switch--disabled", className)}>
      <input
        {...aria}
        type="checkbox"
        role="switch"
        class="cms-switch__input"
        checked={checked}
        disabled={disabled}
        name={name}
        id={id ?? field?.controlId}
        aria-describedby={aria["aria-describedby"] ?? field?.describedBy}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      <span class="cms-switch__track" aria-hidden="true" />
      {label === undefined ? null : <span class="cms-switch__label">{label}</span>}
    </label>
  );
}

export type CheckboxProps = ToggleProps<{
  /** Mixed state for a "select all" box whose rows are partly selected. */
  indeterminate?: boolean;
}>;

export function Checkbox(props: CheckboxProps) {
  const { checked, onCheckedChange, disabled, name, id, class: className, label, indeterminate = false, ...aria } = props;
  const field = useFieldControl();
  const inputRef = useRef<HTMLInputElement>(null);
  // `indeterminate` is a DOM property with no attribute counterpart, and the
  // browser clears it the moment the box is clicked. Reapplying on every render
  // — not on a dependency change — is what keeps a still-mixed box mixed after a
  // click the parent answers without changing either prop.
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  });

  return (
    <label class={cx("cms-check", disabled && "cms-check--disabled", className)}>
      <input
        {...aria}
        ref={inputRef}
        type="checkbox"
        class="cms-check__input"
        checked={checked}
        disabled={disabled}
        name={name}
        id={id ?? field?.controlId}
        aria-describedby={aria["aria-describedby"] ?? field?.describedBy}
        onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      {label === undefined ? null : <span class="cms-check__label">{label}</span>}
    </label>
  );
}
