// Pure placement math for the CMS `Menu` (issue #159). The menu paints in a
// body-level portal with `position: fixed`, so every number here is in
// viewport coordinates — the same space `getBoundingClientRect()` reports.
//
// Kept DOM-free on purpose: jsdom never lays out real boxes, so the clamping
// contract (the acceptance-critical "never clipped inside a scrolling table"
// behaviour) can only be verified deterministically against a pure function.

/** The trigger's box in viewport coordinates — `DOMRect` satisfies this. */
export interface MenuAnchorRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/** The menu panel's own measured box. */
export interface MenuSize {
  readonly width: number;
  readonly height: number;
}

export interface MenuViewport {
  readonly width: number;
  readonly height: number;
}

export type MenuAlign = "start" | "end";
export type MenuSide = "bottom" | "top";

export interface MenuPlacement {
  /** Inline edge the menu lines up with: `start` = anchor's left, `end` = anchor's right. */
  readonly align?: MenuAlign;
  /** Preferred block side. Flips to the other side when that one has more room. */
  readonly side?: MenuSide;
  /** Distance between the anchor and the menu. */
  readonly gap?: number;
  /** Minimum distance the menu keeps from every viewport edge. */
  readonly margin?: number;
}

export interface MenuPosition {
  readonly left: number;
  readonly top: number;
  /** Cap for the panel so an over-long list scrolls instead of overflowing the viewport. */
  readonly maxHeight: number;
  /** The side actually used, after any flip. */
  readonly side: MenuSide;
}

export const MENU_GAP = 4;
export const MENU_VIEWPORT_MARGIN = 8;

/**
 * A menu squeezed against an edge still needs to show something. Below this
 * the panel keeps its height and the `top` clamp takes over, so it overlaps
 * the anchor rather than collapsing to an unusable sliver.
 */
export const MENU_MIN_HEIGHT = 64;

function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(Math.max(value, lowest), Math.max(lowest, highest));
}

/**
 * Place a menu of `size` against `anchor` inside `viewport`, keeping the whole
 * panel within `margin` of every edge. The block side flips when the preferred
 * one cannot hold the panel and the opposite side has more room; after that the
 * result is clamped on all four edges, so a panel larger than the viewport
 * lands on the margin instead of hanging off it.
 */
export function computeMenuPosition(
  anchor: MenuAnchorRect,
  size: MenuSize,
  viewport: MenuViewport,
  placement: MenuPlacement = {},
): MenuPosition {
  const gap = placement.gap ?? MENU_GAP;
  const margin = placement.margin ?? MENU_VIEWPORT_MARGIN;
  const align = placement.align ?? "start";
  const preferredSide = placement.side ?? "bottom";

  const anchorBottom = anchor.top + anchor.height;
  const roomBelow = viewport.height - anchorBottom - gap - margin;
  const roomAbove = anchor.top - gap - margin;

  const preferredRoom = preferredSide === "bottom" ? roomBelow : roomAbove;
  const oppositeRoom = preferredSide === "bottom" ? roomAbove : roomBelow;
  const side: MenuSide =
    size.height > preferredRoom && oppositeRoom > preferredRoom
      ? preferredSide === "bottom"
        ? "top"
        : "bottom"
      : preferredSide;

  const maxHeight = Math.max(side === "bottom" ? roomBelow : roomAbove, MENU_MIN_HEIGHT);
  const height = Math.min(size.height, maxHeight);
  const unclampedTop = side === "bottom" ? anchorBottom + gap : anchor.top - gap - height;
  const top = clamp(unclampedTop, margin, viewport.height - height - margin);

  const unclampedLeft = align === "end" ? anchor.left + anchor.width - size.width : anchor.left;
  const left = clamp(unclampedLeft, margin, viewport.width - size.width - margin);

  return { left, top, maxHeight, side };
}
