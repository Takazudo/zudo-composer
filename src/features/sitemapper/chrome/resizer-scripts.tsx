/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Thin JSX wrappers for the Sitemapper's inline resizer scripts (issue #409).
// The source strings live in resizer-scripts-source.ts so their interpolated
// contract values can be unit-tested without a DOM or runtime imports.

import type { JSX } from "preact";
import { RESIZER_SCRIPT, RESTORE_SCRIPT } from "./resizer-scripts-source";

/** Render in <head>, before first paint, to restore persisted rail widths. */
export function SitemapperResizerRestoreScript(): JSX.Element {
  return <script dangerouslySetInnerHTML={{ __html: RESTORE_SCRIPT }} />;
}

/** Render at body-end to wire hydrated rails and keyboard/pointer resizing. */
export function SitemapperResizerInitScript(): JSX.Element {
  return <script dangerouslySetInnerHTML={{ __html: RESIZER_SCRIPT }} />;
}

export default SitemapperResizerInitScript;
