// Sitemapper workspace resizer contract — the single source of truth for the
// outline/inspector rail localStorage keys, CSS custom-property names, and
// data-attributes (issue Takazudo/zudo-sg#409).
//
// This intentionally mirrors the Composer workspace contract without sharing
// its identifiers. Sitemapper and Composer can be mounted during the same SPA
// session, so a bare key, custom property, or event would make one app's
// resizer silently retarget the other app.

// ── localStorage keys ──────────────────────────────────────────────────────
export const LS_TREE_WIDTH = "sg-sitemapper-tree-width";
export const LS_INSPECTOR_WIDTH = "sg-sitemapper-inspector-width";

// ── CSS custom properties (rail widths, px once the resizer script runs) ───
export const CSS_VAR_TREE_W = "--sg-sitemapper-tree-w";
export const CSS_VAR_INSPECTOR_W = "--sg-sitemapper-inspector-w";

// ── Min/max/joint constraints (px) ─────────────────────────────────────────
export const MIN_RAIL_W = 220;
export const MAX_RAIL_W = 480;
/** Fresh-session default for the outline rail. */
export const DEFAULT_TREE_W = 320;
/** Fresh-session default for the inspector rail. */
export const DEFAULT_INSPECTOR_W = 320;
/** The canvas keeps at least this width as a useful center surface. */
export const MIN_CANVAS_W = 320;
/** Width reserved by the two resizer grid tracks together. */
export const RESIZER_TRACK_W = 24;

// ── Element ids / data-attributes ───────────────────────────────────────────
export const ID_TREE_RAIL = "sg-sitemapper-tree";
export const ID_INSPECTOR_RAIL = "sg-sitemapper-inspector";
export const ATTR_TREE_RESIZER = "data-sg-sitemapper-tree-resizer";
export const ATTR_INSPECTOR_RESIZER = "data-sg-sitemapper-inspector-resizer";

/** Dispatched on `document` whenever a resizer commits a new width. */
export const WIDTH_CHANGE_EVENT = "sg-sitemapper:width-change";

export interface SitemapperWidthChangeDetail {
  rail: "tree" | "inspector";
  width: number;
}

export type SitemapperResizerWidthChangeDetail = SitemapperWidthChangeDetail;

// ── Client-only DOM helpers ─────────────────────────────────────────────────

/** Read a persisted width, never throwing (private mode / disabled storage). */
export function getPersistedWidth(lsKey: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return fallback;
    const width = Number(raw);
    return Number.isFinite(width) ? width : fallback;
  } catch {
    return fallback;
  }
}

/** Persist a width, never throwing — the CSS var still updates live either way. */
export function setPersistedWidth(lsKey: string, px: number): void {
  try {
    localStorage.setItem(lsKey, String(Math.round(px)));
  } catch {
    /* private mode / disabled storage */
  }
}

/**
 * The joint clamp: the maximum width a rail may occupy while leaving the
 * other rail, both resizer tracks, and a useful canvas center in the viewport.
 */
export function maxRailWidth(otherRailWidth: number, viewportWidth: number): number {
  return Math.max(
    MIN_RAIL_W,
    Math.min(MAX_RAIL_W, viewportWidth - otherRailWidth - MIN_CANVAS_W - RESIZER_TRACK_W),
  );
}

/** Clamp a candidate rail width against the minimum and joint maximum. */
export function clampRailWidth(px: number, otherRailWidth: number, viewportWidth: number): number {
  const candidate = Number.isFinite(px) ? px : MIN_RAIL_W;
  return Math.max(MIN_RAIL_W, Math.min(maxRailWidth(otherRailWidth, viewportWidth), candidate));
}
