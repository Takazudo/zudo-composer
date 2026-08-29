// Pure positioning math for the Composer's context menus (issue #256): where
// a menu should sit relative to the control that opened it, and how it
// clamps to the viewport once its own size is known. DOM-free so the clamp
// contract (the acceptance-critical "position clamps to viewport" behavior)
// is directly, deterministically testable — jsdom/happy-dom never lay out
// real boxes, so testing this only through a rendered component would leave
// the actual math unverified.

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MenuPoint {
  x: number;
  y: number;
}

/**
 * The menu's un-clamped anchor point: just below the trigger's own rect,
 * left-aligned to it, with a small gap — the same convention the #242
 * interaction prototype used (`x: rect.left, y: rect.bottom + gap`).
 */
export function anchorBelowRect(rect: RectLike, gap = 4): MenuPoint {
  return { x: rect.x, y: rect.y + rect.height + gap };
}

export interface ClampMenuPositionInput {
  x: number;
  y: number;
  /** The menu panel's own measured width/height (0 before it has ever painted). */
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Minimum distance from every viewport edge. Defaults to 8. */
  margin?: number;
}

/**
 * Clamp an anchor point so the menu's full box stays within the viewport
 * (minus `margin`). A menu bigger than the viewport still clamps to `margin`
 * rather than going negative — it may overflow, but never off past the edge
 * it is anchored from.
 */
export function clampMenuPosition(input: ClampMenuPositionInput): MenuPoint {
  const margin = input.margin ?? 8;
  const maxX = Math.max(margin, input.viewportWidth - input.width - margin);
  const maxY = Math.max(margin, input.viewportHeight - input.height - margin);
  return {
    x: Math.min(Math.max(input.x, margin), maxX),
    y: Math.min(Math.max(input.y, margin), maxY),
  };
}
