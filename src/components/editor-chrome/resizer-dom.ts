/**
 * Pointer and keyboard wiring for one rail resizer.
 *
 * Generalised from `src/features/composer/chrome/resizer-dom.ts`, with three
 * deliberate differences:
 *
 * - It takes the handle and its host element instead of scanning the document
 *   for data-attributes behind a `MutationObserver`. `EditorBody` renders both,
 *   so a ref is exact where the observer was a guess.
 * - Dragging is delta-based (start width plus pointer travel) rather than
 *   absolute (`clientX` measured from the viewport edge). The Composer rails
 *   happened to sit flush against the viewport; a shared editor body sits
 *   inside the shell, where absolute maths would jump on the first move.
 * - Width lives on the host element, so the geometry is per editor rather than
 *   per document.
 *
 * The handle owns its own `aria-valuenow` for the same reason the old one did:
 * a drag must not re-render the editor on every pointer move.
 */

import {
  DEFAULT_INSP_W,
  DEFAULT_NAV_W,
  MIN_RAIL_W,
  RAIL_STEP_W,
  WIDTH_CHANGE_EVENT,
  clampRailWidth,
  cssVarForRail,
  maxRailWidth,
  railStorageKey,
  setPersistedWidth,
} from "./resizer-contract";
import type { EditorRail } from "./resizer-contract";

export interface RailResizerOptions {
  /** Element carrying the `--nav-w` / `--insp-w` custom properties. */
  host: HTMLElement;
  rail: EditorRail;
  editorKey: string;
  /** Called with every committed width, so the owner can keep its own copy. */
  onChange?: (width: number) => void;
  /** Enter on a separator collapses or restores the rail, per the ARIA splitter pattern. */
  onToggleCollapse?: () => void;
}

/** Inline first: it is where every commit writes, and jsdom resolves it there. */
function readRailVar(host: HTMLElement, cssVar: string, fallback: number): number {
  const inline = Number.parseFloat(host.style.getPropertyValue(cssVar));
  if (Number.isFinite(inline)) return inline;
  const computed = Number.parseFloat(getComputedStyle(host).getPropertyValue(cssVar));
  return Number.isFinite(computed) ? computed : fallback;
}

/** Wire one `role="separator"` handle. Returns the listener teardown. */
export function installRailResizer(handle: HTMLElement, options: RailResizerOptions): () => void {
  const { host, rail, editorKey, onChange, onToggleCollapse } = options;
  const cssVar = cssVarForRail(rail);
  const otherVar = cssVarForRail(rail === "nav" ? "insp" : "nav");
  const storageKey = railStorageKey(editorKey, rail);
  const fallback = rail === "nav" ? DEFAULT_NAV_W : DEFAULT_INSP_W;
  const otherFallback = rail === "nav" ? DEFAULT_INSP_W : DEFAULT_NAV_W;

  const width = () => readRailVar(host, cssVar, fallback);
  const otherWidth = () => readRailVar(host, otherVar, otherFallback);

  const apply = (candidate: number) => {
    const value = clampRailWidth(candidate, otherWidth(), window.innerWidth);
    host.style.setProperty(cssVar, `${value}px`);
    handle.setAttribute("aria-valuenow", String(Math.round(value)));
    setPersistedWidth(storageKey, value);
    onChange?.(value);
    host.dispatchEvent(new CustomEvent(WIDTH_CHANGE_EVENT, { detail: { rail, width: value }, bubbles: true }));
  };

  // The nav rail grows rightwards and the inspector leftwards, so one key means
  // "wider" on one side and "narrower" on the other.
  const grow = rail === "nav" ? 1 : -1;

  const keydown = (event: KeyboardEvent) => {
    if (event.key === "ArrowRight") apply(width() + RAIL_STEP_W * grow);
    else if (event.key === "ArrowLeft") apply(width() - RAIL_STEP_W * grow);
    else if (event.key === "Home") apply(MIN_RAIL_W);
    else if (event.key === "End") apply(maxRailWidth(otherWidth(), window.innerWidth));
    else if (event.key === "Enter" && onToggleCollapse) onToggleCollapse();
    else return;
    event.preventDefault();
  };

  const pointerdown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width();
    const move = (next: PointerEvent) => apply(startWidth + (next.clientX - startX) * grow);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  handle.addEventListener("keydown", keydown);
  handle.addEventListener("pointerdown", pointerdown);
  return () => {
    handle.removeEventListener("keydown", keydown);
    handle.removeEventListener("pointerdown", pointerdown);
  };
}
