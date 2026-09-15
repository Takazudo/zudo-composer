import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../lib/cx";

export type AutoGridMin = "11rem" | "13rem" | "14rem" | "15rem" | "16rem" | "18rem";
export type AutoGridGap = "sm" | "md" | "split";
type AutoGridAs = "div" | "ul" | "ol";

// Tailwind v4 only generates utilities for literal class strings found in
// source — `minmax(${min}rem,1fr)` can't be composed dynamically — so each
// `min` step needs its own literal class below instead of an interpolated one.
const FIT_COLS: Record<AutoGridMin, string> = {
  "11rem": "grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]",
  "13rem": "grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]",
  "14rem": "grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]",
  "15rem": "grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]",
  "16rem": "grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]",
  "18rem": "grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]",
};

// auto-fill keeps empty tracks (vs. auto-fit collapsing them into existing
// columns) — for listings that want a stable column count even when sparse.
const FILL_COLS: Record<AutoGridMin, string> = {
  "11rem": "grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]",
  "13rem": "grid-cols-[repeat(auto-fill,minmax(13rem,1fr))]",
  "14rem": "grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]",
  "15rem": "grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]",
  "16rem": "grid-cols-[repeat(auto-fill,minmax(16rem,1fr))]",
  "18rem": "grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]",
};

const GAP_CLASS: Record<AutoGridGap, string> = {
  sm: "gap-hsp-sm",
  md: "gap-hsp-md",
  // Separate horizontal/vertical rhythm for listings where columns and rows
  // should not share one gap value.
  split: "gap-x-hsp-md gap-y-vsp-sm",
};

export type AutoGridProps = {
  /** Minimum width of one track before it wraps. Defaults to 15rem. */
  min?: AutoGridMin;
  /** Use auto-fill (keep empty tracks) instead of the default auto-fit. */
  fill?: boolean;
  /** Gap variant. Defaults to md. */
  gap?: AutoGridGap;
  /** Root element. Use `ul`/`ol` for list semantics (adds `list-none p-0`). */
  as?: AutoGridAs;
  "aria-label"?: string;
  class?: string;
  children?: ComponentChildren;
};

/**
 * Auto-fit/auto-fill responsive grid primitive shared by card-style listings,
 * so the `grid-cols-[repeat(auto-fit,minmax(...))]` pattern lives in one
 * place instead of being repeated per listing component.
 */
export function AutoGrid({
  min = "15rem",
  fill = false,
  gap = "md",
  as = "div",
  class: className,
  children,
  ...rest
}: AutoGridProps) {
  const cols = (fill ? FILL_COLS : FIT_COLS)[min];
  const list = as === "ul" || as === "ol" ? "list-none p-0" : "";
  const Tag = as as keyof JSX.IntrinsicElements;
  return (
    <Tag class={cx("grid", cols, GAP_CLASS[gap], list, className)} {...rest}>
      {children}
    </Tag>
  );
}
