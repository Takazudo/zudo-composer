import { computed, getScope, signal, type Child, type InputProps as NativeInputProps, type ReadonlySignal, type Ref, type SelectProps as NativeSelectProps, type TextareaProps as NativeTextareaProps } from "@takazudo/zfb/zudo-react";
import { ChevronDownIcon } from "../icons";
import type { IconComponent } from "../icons";
import { read, type MaybeSignal } from "../reactive";
import { cx } from "./class-names";
import type { FieldControl } from "./field-context";

/** `md` is the 30px chrome control height; `sm` is the 26px toolbar height. */
export type ControlSize = "sm" | "md";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A DOM ref, or a callback told the element on activation and `null` on cleanup. */
export type ElementRef<T extends Element> = Ref<T> | ((element: T | null) => void);

/** Resolves an `ElementRef` to a plain `Ref` the JSX `ref` prop accepts. */
export function useElementRef<T extends Element>(elementRef: ElementRef<T> | undefined): Ref<T> {
  if (elementRef === undefined) return { current: null };
  if (typeof elementRef !== "function") return elementRef;
  const ref: Ref<T> = { current: null };
  const scope = getScope();
  scope.onActivate(() => {
    elementRef(ref.current);
    return () => elementRef(null);
  });
  return ref;
}

/** The wiring a `<Field>` hands its control: pass it as the control's `field` prop. */
function fieldAttributes(field: FieldControl | undefined, own: Record<string, unknown>) {
  return {
    id: (own.id as string | undefined) ?? field?.controlId,
    "aria-describedby": own["aria-describedby"] ?? field?.describedBy,
    "aria-invalid": own["aria-invalid"] ?? (field ? computed(() => (field.invalid.value ? "true" : undefined)) : undefined),
    required: own.required ?? field?.required,
  };
}

export type InputProps = DistributiveOmit<NativeInputProps, "size" | "ref" | "class"> & {
  size?: ControlSize;
  /** Decorative leading icon; the input reserves its inline start padding. */
  icon?: IconComponent;
  /** Ref onto the rendered `<input>` (components take no `ref` of their own). */
  elementRef?: ElementRef<HTMLInputElement>;
  /** The wrapping `<Field>`'s wiring: id, description, invalid and required. */
  field?: FieldControl;
  class?: string;
};

/** `class` lands on the outermost node: the input, or the wrapper an icon adds. */
export function Input(props: InputProps) {
  const { size = "md", icon: Icon, class: className, elementRef, field, ...rest } = props;
  const ref = useElementRef(elementRef);
  const own = rest as Record<string, unknown>;
  const input = (
    <input
      {...(rest as NativeInputProps)}
      ref={ref}
      class={cx("cms-input", size === "sm" && "cms-input--sm", !Icon && className)}
      {...(fieldAttributes(field, own) as unknown as Record<string, never>)}
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

export type SelectProps = Omit<NativeSelectProps, "size" | "ref" | "class"> & {
  size?: ControlSize;
  field?: FieldControl;
  class?: string;
};

/**
 * The caret is a real icon rather than a background image: a data-URI SVG could
 * not take its stroke from a colour token, and no component may carry a literal.
 * `class` lands on the wrapper, which is what callers lay out. Options are the
 * select's static `<option>` children; rebuild the whole `Select` (keyed) when
 * they change.
 */
export function Select(props: SelectProps) {
  const { size = "md", class: className, children, field, ...rest } = props;
  return (
    <span class={cx("cms-select-wrap", className)}>
      <select
        {...rest}
        class={cx("cms-select", size === "sm" && "cms-select--sm")}
        {...(fieldAttributes(field, rest as Record<string, unknown>) as unknown as Record<string, never>)}
      >
        {children}
      </select>
      <ChevronDownIcon size="sm" class="cms-select__caret" />
    </span>
  );
}

export type TextareaProps = DistributiveOmit<NativeTextareaProps, "ref" | "class"> & {
  field?: FieldControl;
  elementRef?: ElementRef<HTMLTextAreaElement>;
  class?: string;
};

export function Textarea(props: TextareaProps) {
  const { class: className, field, elementRef, ...rest } = props;
  const ref = useElementRef(elementRef);
  return (
    <textarea
      {...(rest as NativeTextareaProps)}
      ref={ref}
      class={cx("cms-textarea", className)}
      {...(fieldAttributes(field, rest as Record<string, unknown>) as unknown as Record<string, never>)}
    />
  );
}

interface ToggleBaseProps {
  checked: MaybeSignal<boolean>;
  onCheckedChange: (checked: boolean) => void;
  disabled?: MaybeSignal<boolean>;
  name?: string;
  id?: string;
  class?: string;
  "aria-describedby"?: string;
  field?: FieldControl;
}

/** A toggle with no visible label must name itself through `aria-label`. */
type ToggleProps<Extra> = ToggleBaseProps &
  Extra &
  ({ label: Child } | { "aria-label": string; label?: undefined });

export type SwitchProps = ToggleProps<Record<never, never>>;

/**
 * The checkbox model follows `checked`; a click the parent has not answered yet
 * keeps the browser's toggled state, as an uncontrolled-in-between control does.
 */
function useToggleModel(checked: MaybeSignal<boolean>) {
  const model = signal(read(checked));
  getScope().effect(() => {
    model.value = read(checked);
  });
  return model;
}

function disabledClass(base: string, disabled: MaybeSignal<boolean> | undefined, className: string | undefined): ReadonlySignal<string> {
  return computed(() => cx(base, disabled !== undefined && read(disabled) && `${base}--disabled`, className));
}

export function Switch(props: SwitchProps) {
  const { checked, onCheckedChange, disabled, name, id, class: className, label, field, ...aria } = props;
  const model = useToggleModel(checked);
  return (
    <label class={disabledClass("cms-switch", disabled, className)}>
      <input
        {...aria}
        type="checkbox"
        role="switch"
        class="cms-switch__input"
        modelChecked={model}
        disabled={disabled}
        name={name}
        id={id ?? field?.controlId}
        aria-describedby={aria["aria-describedby"] ?? field?.describedBy}
        on:change={(event) => onCheckedChange(event.currentTarget.checked)}
      />
      <span class="cms-switch__track" aria-hidden="true" />
      {label === undefined ? null : <span class="cms-switch__label">{label}</span>}
    </label>
  );
}

export type CheckboxProps = ToggleProps<{
  /** Mixed state for a "select all" box whose rows are partly selected. */
  indeterminate?: MaybeSignal<boolean>;
}>;

export function Checkbox(props: CheckboxProps) {
  const { checked, onCheckedChange, disabled, name, id, class: className, label, indeterminate = false, field, ...aria } = props;
  const model = useToggleModel(checked);
  const inputRef: Ref<HTMLInputElement> = { current: null };
  // `indeterminate` is a DOM property with no attribute counterpart, and the
  // browser clears it the moment the box is clicked. It is reapplied whenever
  // either input changes and after every change event, which is what keeps a
  // still-mixed box mixed after a click the parent answers without changing it.
  const apply = () => {
    if (inputRef.current) inputRef.current.indeterminate = read(indeterminate);
  };
  const scope = getScope();
  scope.onActivate(apply);
  scope.effect(() => {
    read(indeterminate);
    model.value;
    apply();
  });

  return (
    <label class={disabledClass("cms-check", disabled, className)}>
      <input
        {...aria}
        ref={inputRef}
        type="checkbox"
        class="cms-check__input"
        modelChecked={model}
        disabled={disabled}
        name={name}
        id={id ?? field?.controlId}
        aria-describedby={aria["aria-describedby"] ?? field?.describedBy}
        on:change={(event) => {
          onCheckedChange(event.currentTarget.checked);
          apply();
        }}
      />
      <span class="cms-check__box" aria-hidden="true" />
      {label === undefined ? null : <span class="cms-check__label">{label}</span>}
    </label>
  );
}
