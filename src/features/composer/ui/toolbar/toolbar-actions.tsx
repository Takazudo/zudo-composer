/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Reusable toolbar actions — pure callbacks with no persistence, history, or
// preview-bridge logic. The integration layer owns their availability and the
// Export dialog.

import type { JSX } from "preact";
import { DownloadIcon, RedoIcon, UndoIcon } from "../../../../components/icons";

export interface ComposerToolbarActionsProps {
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onExport: () => void;
  exportLabel?: string;
  exportDisabled?: boolean;
}

export function ComposerToolbarActions({
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onExport,
  exportLabel = "Export JSX",
  exportDisabled = false,
}: ComposerToolbarActionsProps): JSX.Element {
  return (
    <div class="flex items-center gap-hsp-sm">
      {onUndo && (
        <button
          type="button"
          class="sg-composer-toolbar-button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          title="Undo (Cmd+Z / Ctrl+Z)"
        >
          <UndoIcon size="sm" class="sg-composer-button-icon" />
        </button>
      )}
      {onRedo && (
        <button
          type="button"
          class="sg-composer-toolbar-button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          title="Redo (Cmd+Shift+Z / Ctrl+Shift+Z or Ctrl+Y)"
        >
          <RedoIcon size="sm" class="sg-composer-button-icon" />
        </button>
      )}
      <button
        type="button"
        class="sg-composer-toolbar-button"
        onClick={onExport}
        disabled={exportDisabled}
        aria-disabled={exportDisabled}
      >
        <DownloadIcon size="sm" class="sg-composer-button-icon" />
        {exportLabel}
      </button>
    </div>
  );
}
