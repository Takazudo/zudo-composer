import { h, type CSSProperties } from "@takazudo/zfb/zudo-react";
import { cx } from "../../lib/cx";
import { slotChild, type SlotChildren } from "../../lib/slot";

export type ContainerProps = {
  /** Wrapping element tag. Defaults to div. */
  as?: keyof HTMLElementTagNameMap;
  class?: string;
  children?: SlotChildren;
};

// The library's shared structural width for a page's single content column;
// left as an arbitrary value rather than a token since it's a one-off layout
// dimension, not a value other components need to share.
const MAX_WIDTH = "max-w-[88rem]";

// marginInline:auto as inline style rather than the `mx-auto` utility: at this
// nesting depth `mx-auto` has lost to a competing margin rule under some
// cascade orders and collapsed back to left-aligned — the inline style always
// wins, which is also why the fluid inline padding below is inline too.
const CONTAINER_STYLE: CSSProperties = {
  "margin-inline": "auto",
  "padding-inline": "clamp(var(--spacing-hsp-md), 4vw, var(--spacing-hsp-2xl))",
};

/**
 * Centers page content in a single ~88rem-wide column with fluid inline
 * padding — tight on narrow viewports, roomier on wide ones.
 */
export function Container({ as = "div", class: cls, children }: ContainerProps) {
  return h(as, { class: cx(MAX_WIDTH, cls), style: CONTAINER_STYLE }, slotChild(children));
}
