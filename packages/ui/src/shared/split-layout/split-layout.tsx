import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../lib/cx";

export type SplitLayoutRatio = "50/50" | "40/60" | "60/40" | "33/67" | "67/33";
export type SplitLayoutGap = "sm" | "md" | "lg";

// Tailwind v4 only generates utilities for literal class strings found in
// source, so each ratio's pair is spelled out rather than composed from a
// template string (mirrors AutoGrid's FIT_COLS/FILL_COLS maps).
//
// Grow ratios (flex-grow), not percentage widths: two 50%-width columns plus
// a `gap` would overflow by exactly the gap amount, because percentage
// widths resolve against the container's full width, not the width already
// reduced by `gap`. flex-grow distributes space AFTER `gap` is subtracted,
// so it has no such overflow failure mode.
const RATIO_CLASS: Record<SplitLayoutRatio, { left: string; right: string }> = {
  "50/50": { left: "md:flex-1", right: "md:flex-1" },
  "40/60": { left: "md:flex-[2_1_0%]", right: "md:flex-[3_1_0%]" },
  "60/40": { left: "md:flex-[3_1_0%]", right: "md:flex-[2_1_0%]" },
  "33/67": { left: "md:flex-[1_1_0%]", right: "md:flex-[2_1_0%]" },
  "67/33": { left: "md:flex-[2_1_0%]", right: "md:flex-[1_1_0%]" },
};

const GAP_X_CLASS: Record<SplitLayoutGap, string> = {
  sm: "gap-x-hsp-lg",
  md: "gap-x-hsp-xl",
  lg: "gap-x-hsp-2xl",
};

const GAP_Y_CLASS: Record<SplitLayoutGap, string> = {
  sm: "gap-y-vsp-md",
  md: "gap-y-vsp-lg",
  lg: "gap-y-vsp-xl",
};

export type SplitLayoutProps = {
  /** Content for the left pane. */
  left?: ComponentChildren;
  /** Content for the right pane — pass multiple children for an ordered list. */
  right?: ComponentChildren;
  /** Left:right width ratio once panes sit side by side (at the `md` breakpoint). Defaults to 50/50. */
  ratio?: SplitLayoutRatio;
  /** Gap between panes. Defaults to md. */
  gap?: SplitLayoutGap;
  /** Wrapping element tag. Defaults to div. */
  as?: keyof JSX.IntrinsicElements;
  class?: string;
};

/**
 * Two-pane layout: stacked, full-width panes below the `md` breakpoint (the
 * narrow collapse); side-by-side panes sized by `ratio` at `md` and above.
 * `min-w-0` on both panes keeps unbreakable content (long words, images)
 * from forcing horizontal overflow.
 */
export function SplitLayout({
  left,
  right,
  ratio = "50/50",
  gap = "md",
  as: Tag = "div",
  class: cls,
}: SplitLayoutProps) {
  const ratioClass = RATIO_CLASS[ratio];
  return (
    <Tag class={cx("flex flex-col items-stretch md:flex-row", GAP_X_CLASS[gap], GAP_Y_CLASS[gap], cls)}>
      <div class={cx("min-w-0", ratioClass.left)}>{left}</div>
      <div class={cx("min-w-0", ratioClass.right)}>{right}</div>
    </Tag>
  );
}
