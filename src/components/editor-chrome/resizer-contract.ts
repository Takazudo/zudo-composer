/**
 * Editor-chrome rail geometry — the single source of truth for the two
 * resizable rails every record editor shares: their localStorage keys, CSS
 * custom properties, and the joint clamp that keeps the main column usable.
 *
 * Generalised from the Composer-only
 * `src/features/composer/chrome/resizer-contract.ts`. Two things changed:
 *
 * - Keys and defaults are derived from an `editorKey`, so Composer, Content,
 *   Mapping and Sitemapper each persist their own geometry through one module.
 * - The constants moved onto the epic #156 ladder (200/520 rails, main >= 320)
 *   and the CSS variables are the prototype's `--nav-w` / `--insp-w`, set on
 *   the editor body rather than on `document.documentElement`, so two editor
 *   bodies could coexist.
 *
 * The joint clamp is the reason this is a module and not two `Math.min` calls:
 * growing one rail is capped by how much width it would leave for the other
 * rail plus a minimum usable main column.
 */

export type EditorRail = "nav" | "insp";

/** Rail widths in px, read by `grid-template-columns` on the editor body. */
export const CSS_VAR_NAV_W = "--nav-w";
export const CSS_VAR_INSP_W = "--insp-w";

export const MIN_RAIL_W = 200;
export const MAX_RAIL_W = 520;
/** The main column must always keep at least this much width. */
export const MIN_MAIN_W = 320;
/** Width the two 1px resizer grid tracks take out of the row. */
export const RESIZER_TRACK_W = 2;
export const DEFAULT_NAV_W = 280;
export const DEFAULT_INSP_W = 300;
/** How far one arrow press moves a rail. */
export const RAIL_STEP_W = 16;

/** Dispatched on the editor body whenever a resizer commits a new width. */
export const WIDTH_CHANGE_EVENT = "cms-editor:width-change";

export interface EditorWidthChangeDetail {
  rail: EditorRail;
  width: number;
}

export interface EditorRailWidths {
  nav: number;
  insp: number;
}

export function cssVarForRail(rail: EditorRail): string {
  return rail === "nav" ? CSS_VAR_NAV_W : CSS_VAR_INSP_W;
}

/** Per-editor storage key, so every editor remembers its own geometry. */
export function railStorageKey(editorKey: string, rail: EditorRail): string {
  return `zudo-composer:editor:${editorKey}:${rail}-w`;
}

/** Read a persisted width, never throwing (private mode / disabled storage). */
export function getPersistedWidth(storageKey: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Persist a width, never throwing — the CSS var still updates live either way. */
export function setPersistedWidth(storageKey: string, px: number): void {
  try {
    localStorage.setItem(storageKey, String(Math.round(px)));
  } catch {
    /* private mode / disabled storage */
  }
}

/**
 * The joint clamp: the most a rail may grow to, given how much width the OTHER
 * rail currently occupies, so the main column never shrinks below `MIN_MAIN_W`
 * even with both rails maxed out.
 */
export function maxRailWidth(otherRailWidth: number, viewportWidth: number): number {
  return Math.max(
    MIN_RAIL_W,
    Math.min(MAX_RAIL_W, viewportWidth - otherRailWidth - MIN_MAIN_W - RESIZER_TRACK_W),
  );
}

/** Clamp a candidate rail width against `MIN_RAIL_W` and the joint max. */
export function clampRailWidth(px: number, otherRailWidth: number, viewportWidth: number): number {
  return Math.max(MIN_RAIL_W, Math.min(maxRailWidth(otherRailWidth, viewportWidth), px));
}

export interface ReadEditorWidthsOptions {
  nav?: number;
  insp?: number;
  viewportWidth?: number;
}

/**
 * The persisted geometry for one editor, already jointly clamped so a viewport
 * narrower than the one the widths were stored on cannot starve the main column.
 */
export function readEditorWidths(editorKey: string, options: ReadEditorWidthsOptions = {}): EditorRailWidths {
  const {
    nav: navFallback = DEFAULT_NAV_W,
    insp: inspFallback = DEFAULT_INSP_W,
    viewportWidth = typeof window === "undefined" ? MAX_RAIL_W * 4 : window.innerWidth,
  } = options;
  let nav = getPersistedWidth(railStorageKey(editorKey, "nav"), navFallback);
  let insp = getPersistedWidth(railStorageKey(editorKey, "insp"), inspFallback);
  nav = clampRailWidth(nav, insp, viewportWidth);
  insp = clampRailWidth(insp, nav, viewportWidth);
  return { nav, insp };
}
