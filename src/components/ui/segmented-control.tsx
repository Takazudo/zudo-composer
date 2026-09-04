import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import type { IconComponent } from "../icons";
import { cx } from "./class-names";
import type { ControlSize } from "./form-controls";
import { nextRovingIndex } from "./roving";

interface SegmentedOptionBase<Value extends string> {
  value: Value;
  icon?: IconComponent;
  disabled?: boolean;
}

/** An icon-only segment carries no text, so it must name itself. */
export type SegmentedOption<Value extends string> = SegmentedOptionBase<Value> &
  ({ label: ComponentChildren } | { ariaLabel: string; label?: undefined });

export interface SegmentedControlProps<Value extends string> {
  /** Accessible name of the whole group. */
  label: string;
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /**
   * `radio` (default) is a single-choice radiogroup where selection follows
   * focus; `pressed` is a toggle-button group where arrows only move focus.
   */
  mode?: "radio" | "pressed";
  size?: ControlSize;
  class?: string;
}

export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  mode = "radio",
  size = "md",
  class: className,
}: SegmentedControlProps<Value>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  // With no match the roving entry point falls back to the first segment.
  const tabStopIndex = selectedIndex === -1 ? 0 : selectedIndex;

  function handleKeyDown(event: KeyboardEvent, index: number) {
    const next = nextRovingIndex(event.key, index, options.length, {
      orientation: mode === "radio" ? "both" : "horizontal",
      isDisabled: (candidate) => Boolean(options[candidate].disabled),
    });
    if (next === null) return;
    event.preventDefault();
    buttons.current[next]?.focus();
    if (mode === "radio") onChange(options[next].value);
  }

  return (
    <div
      class={cx("cms-seg", size === "sm" && "cms-seg--sm", className)}
      role={mode === "radio" ? "radiogroup" : "group"}
      aria-label={label}
    >
      {options.map((option, index) => {
        const Icon = option.icon;
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            class="cms-seg__option"
            ref={(element) => {
              buttons.current[index] = element;
            }}
            role={mode === "radio" ? "radio" : undefined}
            aria-checked={mode === "radio" ? selected : undefined}
            aria-pressed={mode === "pressed" ? selected : undefined}
            aria-label={"ariaLabel" in option ? option.ariaLabel : undefined}
            disabled={option.disabled}
            tabIndex={index === tabStopIndex ? 0 : -1}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={() => onChange(option.value)}
          >
            {Icon ? <Icon size="sm" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
