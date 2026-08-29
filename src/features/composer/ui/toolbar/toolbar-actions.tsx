/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Reusable Reset/Export toolbar actions (issue #249) — pure callbacks, no
// persistence or bridge logic in here. `onExport` just signals "the user
// wants to export"; the caller (#251) decides what that means (e.g. open the
// JSX preview dialog with a freshly generated #245 result) — see
// ui/export/use-composer-export.ts for a ready-made hook that does exactly
// that.

import type { JSX } from "preact";

export interface ComposerToolbarActionsProps {
  onReset: () => void;
  onExport: () => void;
  resetLabel?: string;
  exportLabel?: string;
  exportDisabled?: boolean;
}

export function ComposerToolbarActions({
  onReset,
  onExport,
  resetLabel = "Reset sample",
  exportLabel = "Export JSX",
  exportDisabled = false,
}: ComposerToolbarActionsProps): JSX.Element {
  return (
    <div class="flex items-center gap-hsp-sm">
      <button type="button" class="sg-composer-toolbar-button" onClick={onReset}>
        {resetLabel}
      </button>
      <button
        type="button"
        class="sg-composer-toolbar-button"
        onClick={onExport}
        disabled={exportDisabled}
        aria-disabled={exportDisabled}
      >
        {exportLabel}
      </button>
    </div>
  );
}
