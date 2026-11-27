import { cx } from "./class-names";
import type { NativeProps } from "./class-names";

/** `neutral` is the bordered default; `plain` is the borderless filled variant. */
export type ChipTone = "neutral" | "ok" | "warn" | "err" | "accent" | "plain";

export interface ChipProps extends NativeProps<HTMLSpanElement> {
  tone?: ChipTone;
  /** Leading status dot, inheriting the chip's tone colour. */
  dot?: boolean;
}

export function Chip({ tone = "neutral", dot = false, class: className, children, ...rest }: ChipProps) {
  return (
    <span class={cx("cms-chip", tone !== "neutral" && `cms-chip--${tone}`, className)} {...rest}>
      {dot ? <span class="cms-chip__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
