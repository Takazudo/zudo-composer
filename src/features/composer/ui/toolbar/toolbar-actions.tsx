/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Reusable Export toolbar action — a pure callback with no persistence or
// preview-bridge logic. The integration layer generates JSX and owns the dialog.

import type { JSX } from "preact";
import { DownloadIcon } from "../../../../components/icons";

export interface ComposerToolbarActionsProps {
  onExport: () => void;
  exportLabel?: string;
  exportDisabled?: boolean;
}

export function ComposerToolbarActions({
  onExport,
  exportLabel = "Export JSX",
  exportDisabled = false,
}: ComposerToolbarActionsProps): JSX.Element {
  return (
    <div class="flex items-center gap-hsp-sm">
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
