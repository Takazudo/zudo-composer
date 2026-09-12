import { HOVER_INVERT } from "./tone";

interface StepperProps {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange(value: number): void;
}

const STEP = `inline-flex h-shop-control-h w-shop-control-h items-center justify-center font-shop-mono text-shop-body text-shop-faint ${HOVER_INVERT} disabled:cursor-not-allowed disabled:hover:bg-shop-bg disabled:hover:text-shop-faint`;

/** Square − value + control; the value is announced as it changes. */
export function Stepper({ value, min, max, label, onChange }: StepperProps) {
  const subject = label.charAt(0).toLowerCase() + label.slice(1);
  return (
    <div role="group" aria-label={label} class="inline-flex items-center border border-shop-border bg-shop-bg">
      <button type="button" aria-label={`Decrease ${subject}`} disabled={value <= min} onClick={() => onChange(value - 1)} class={STEP}>−</button>
      <span aria-live="polite" class="inline-flex h-shop-control-h min-w-[2.5rem] items-center justify-center border-x border-shop-border font-shop-mono tabular-nums text-shop-body text-shop-fg-strong">
        {value}
      </span>
      <button type="button" aria-label={`Increase ${subject}`} disabled={value >= max} onClick={() => onChange(value + 1)} class={STEP}>+</button>
    </div>
  );
}
