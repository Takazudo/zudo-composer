// Composer workspace resizer contract — the single source of truth for the
// tree/inspector rail localStorage keys, CSS custom-property names, and
// data-attributes (issue #247). Mirrors
// `src/features/styleguide/chrome/panel-contract.ts`'s split between pure
// constants/DOM helpers (safe from SSR) and the inline scripts built in
// `resizer-scripts-source.ts`.
//
// Unlike the single code-panel resizer, the Composer workspace has TWO
// resizable rails either side of a `minmax(0, 1fr)` canvas. They share one
// joint clamp: growing one rail is capped by how much width it would leave
// for the other rail plus a minimum usable canvas — see `resizer-scripts-
// source.ts`'s `clampFor`.

// ── localStorage keys ──────────────────────────────────────────────────────
export const LS_TREE_WIDTH = "sg-composer-tree-width";
export const LS_INSPECTOR_WIDTH = "sg-composer-inspector-width";

// ── CSS custom properties (rail widths, px once the resizer script runs) ───
export const CSS_VAR_TREE_W = "--sg-composer-tree-w";
export const CSS_VAR_INSPECTOR_W = "--sg-composer-inspector-w";

// ── Min/max/joint constraints (px) ──────────────────────────────────────────
export const MIN_RAIL_W = 220;
export const MAX_RAIL_W = 480;
/**
 * Fresh-session default width for the tree rail (Composer Polish S3, #265) —
 * distinct from MIN_RAIL_W, which stays the drag/keyboard floor. 220px truncated
 * common component names ('SectionHeading') at depth; this default lets them fit
 * untruncated while long names still ellipsize. Only the tree defaults to this;
 * the inspector still falls back to MIN_RAIL_W. Users can still resize down to
 * MIN_RAIL_W — this only changes where an un-persisted tree rail starts.
 *
 * Sized against the WIDEST font-rendering environment, not local: 'SectionHeading'
 * at depth-2 measures ~96px on local (WSL) fonts but ~110px on the CI Linux
 * runner's fonts. 280px left only ~101px for the title area there, so the
 * #270 untruncation contract failed CI-only. 300px gave ~121px (≈11px CI margin)
 * — but the Composer UI Parity epic (#282) then added a leading node-type glyph
 * (12px + gap) to every tree row, consuming ~14px of the title column and
 * re-truncating 'SectionHeading' on CI. 320px restores a comfortable CI margin
 * (~17px) with the glyph present; keep it in sync with `--sg-composer-tree-w`.
 */
export const DEFAULT_TREE_W = 320;
/** The canvas must always keep at least this much width — "a useful center". */
export const MIN_CANVAS_W = 320;
/** Rough width reserved by the two resizer grid tracks themselves. */
export const RESIZER_TRACK_W = 24;

// ── Element ids / data-attributes ───────────────────────────────────────────
export const ID_TREE_RAIL = "sg-composer-tree";
export const ID_INSPECTOR_RAIL = "sg-composer-inspector";
export const ATTR_TREE_RESIZER = "data-sg-composer-tree-resizer";
export const ATTR_INSPECTOR_RESIZER = "data-sg-composer-inspector-resizer";

/** Custom event dispatched on `document` whenever a resizer commits a new width. */
export const WIDTH_CHANGE_EVENT = "sg-composer:width-change";

export interface ComposerWidthChangeDetail {
  rail: "tree" | "inspector";
  width: number;
}

// ── Client-only DOM helpers ─────────────────────────────────────────────────

/** Read a persisted width, never throwing (private mode / disabled storage). */
export function getPersistedWidth(lsKey: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
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
 * The joint clamp: the max a rail may grow to, given how much width the
 * OTHER rail currently occupies, so the canvas never shrinks below
 * `MIN_CANVAS_W` even when both rails are maxed out.
 */
export function maxRailWidth(otherRailWidth: number, viewportWidth: number): number {
  return Math.max(
    MIN_RAIL_W,
    Math.min(MAX_RAIL_W, viewportWidth - otherRailWidth - MIN_CANVAS_W - RESIZER_TRACK_W),
  );
}

/** Clamp a candidate rail width against MIN_RAIL_W and the joint max. */
export function clampRailWidth(px: number, otherRailWidth: number, viewportWidth: number): number {
  return Math.max(MIN_RAIL_W, Math.min(maxRailWidth(otherRailWidth, viewportWidth), px));
}
