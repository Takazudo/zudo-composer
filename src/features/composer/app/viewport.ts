// Canvas viewport widths + persistence for the central Composer app (Takazudo/zudo-sg#251).
//
// The Composer owns a Desktop/Tablet/Mobile/Fluid canvas viewport control. The
// choice sizes ONLY the preview iframe's width (which reflows the preview
// document) — it never changes the surrounding Composer responsive breakpoint
// (issue Takazudo/zudo-sg#251 scope item 5). The preview session protocol (Takazudo/zudo-sg#248) carries no
// viewport field, so the width is applied to the parent-side iframe host here,
// not sent as a message.
//
// The choice is persisted to localStorage (like the rail widths in
// resizer-contract.ts) so it survives a reload, and every access is guarded so
// blocked/private-mode storage degrades to the default rather than throwing.

import type { ComposerCanvasViewport } from "../chrome/controller-model";

/** All viewport choices, in toolbar order. */
export const COMPOSER_VIEWPORTS: readonly ComposerCanvasViewport[] = [
  "fluid",
  "desktop",
  "tablet",
  "mobile",
];

/**
 * Device-emulation widths (px) for the preview iframe. `fluid` is `null` — the
 * frame fills the canvas. The others are common desktop/tablet/mobile widths;
 * the frame caps to them and centers, so the preview document reflows exactly
 * as it would at that width.
 */
export const COMPOSER_VIEWPORT_WIDTHS: Record<ComposerCanvasViewport, number | null> = {
  fluid: null,
  desktop: 1280,
  tablet: 768,
  mobile: 390,
};

/** Human-readable labels for the viewport `<select>`. */
export const COMPOSER_VIEWPORT_LABELS: Record<ComposerCanvasViewport, string> = {
  fluid: "Fluid",
  desktop: "Desktop",
  tablet: "Tablet",
  mobile: "Mobile",
};

/** localStorage key for the persisted viewport choice. */
export const LS_COMPOSER_VIEWPORT = "zudo-composer-viewport";

/** Type guard: is `value` one of the known viewport choices? */
export function isComposerViewport(value: unknown): value is ComposerCanvasViewport {
  return typeof value === "string" && (COMPOSER_VIEWPORTS as readonly string[]).includes(value);
}

/** Read the persisted viewport, or `null` when absent/invalid/blocked. Never throws. */
export function getPersistedViewport(): ComposerCanvasViewport | null {
  try {
    const raw = localStorage.getItem(LS_COMPOSER_VIEWPORT);
    return isComposerViewport(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the viewport choice, never throwing (private mode / disabled storage). */
export function setPersistedViewport(viewport: ComposerCanvasViewport): void {
  try {
    localStorage.setItem(LS_COMPOSER_VIEWPORT, viewport);
  } catch {
    /* private mode / disabled storage — the in-memory choice still applies */
  }
}
