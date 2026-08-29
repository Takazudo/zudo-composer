/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Inline blocking scripts for the Composer workspace resizers (issue #247).
// Thin JSX wrapper — script text lives in resizer-scripts-source.ts (a plain
// .ts module so it can be unit-tested and import resizer-contract.ts's
// constants). Mirrors
// `src/features/styleguide/chrome/panel-scripts.tsx`.
//
//   ComposerResizerRestoreScript — rendered in <head>, before first paint.
//   ComposerResizerInitScript    — rendered at body-end.

import type { JSX } from "preact";
import { RESIZER_SCRIPT, RESTORE_SCRIPT } from "./resizer-scripts-source";

export function ComposerResizerRestoreScript(): JSX.Element {
  return <script dangerouslySetInnerHTML={{ __html: RESTORE_SCRIPT }} />;
}

export function ComposerResizerInitScript(): JSX.Element {
  return <script dangerouslySetInnerHTML={{ __html: RESIZER_SCRIPT }} />;
}
