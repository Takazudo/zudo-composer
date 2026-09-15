import type { ComponentChildren, JSX } from "preact";
import { cx } from "../../lib/cx";

export type StackDirection = "vertical" | "horizontal";
export type StackGap = "xs" | "sm" | "md" | "lg" | "xl";
export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackJustify = "start" | "center" | "end" | "between";

const VERTICAL_GAP_CLASS: Record<StackGap, string> = {
  xs: "gap-y-vsp-xs",
  sm: "gap-y-vsp-sm",
  md: "gap-y-vsp-md",
  lg: "gap-y-vsp-lg",
  xl: "gap-y-vsp-xl",
};

const HORIZONTAL_GAP_CLASS: Record<StackGap, string> = {
  xs: "gap-x-hsp-xs",
  sm: "gap-x-hsp-sm",
  md: "gap-x-hsp-md",
  lg: "gap-x-hsp-lg",
  xl: "gap-x-hsp-xl",
};

const ALIGN_CLASS: Record<StackAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

const JUSTIFY_CLASS: Record<StackJustify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};

export type StackProps = {
  /** Flex direction. Defaults to vertical. */
  direction?: StackDirection;
  /** Gap between children, along the active direction's axis. Defaults to md. */
  gap?: StackGap;
  /** Cross-axis alignment. Defaults to stretch. */
  align?: StackAlign;
  /** Main-axis justification. Defaults to start. */
  justify?: StackJustify;
  /** Wrapping element tag. Defaults to div. */
  as?: keyof JSX.IntrinsicElements;
  class?: string;
  children?: ComponentChildren;
};

/**
 * Generic flex stack — vertical (default) or horizontal — with bounded gap,
 * cross-axis alignment, and main-axis justification. A horizontal stack
 * always wraps (`flex-wrap`) so it can never force horizontal overflow the
 * way an unwrapped row of unknown-width children would.
 */
export function Stack({
  direction = "vertical",
  gap = "md",
  align = "stretch",
  justify = "start",
  as: Tag = "div",
  class: cls,
  children,
}: StackProps) {
  const gapClass = direction === "horizontal" ? HORIZONTAL_GAP_CLASS[gap] : VERTICAL_GAP_CLASS[gap];
  return (
    <Tag
      class={cx(
        "flex",
        direction === "horizontal" ? "flex-row flex-wrap" : "flex-col",
        gapClass,
        ALIGN_CLASS[align],
        JUSTIFY_CLASS[justify],
        cls,
      )}
    >
      {children}
    </Tag>
  );
}
