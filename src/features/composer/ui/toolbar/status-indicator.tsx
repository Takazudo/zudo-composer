/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Reusable Composer save-status indicator. Clipboard and other orthogonal
// status chips render through `children` without changing canonical save state.

import type { ComponentChildren, JSX } from "preact";
import type { CompositionDerivedOutputOutcome } from "../../../../composer/browser";
import type { ComposerSaveStatus } from "../../chrome/controller-model";
import { describeSaveStatus } from "../../chrome/controller-model";

export interface ComposerStatusIndicatorProps {
  saveStatus: ComposerSaveStatus;
  onRetry?: () => void;
  /** Kept separate from canonical save state so Saved remains truthful. */
  derivedOutput?: CompositionDerivedOutputOutcome | null;
  /** Composability seam for clipboard and other non-save status chips. */
  children?: ComponentChildren;
}

export function ComposerStatusIndicator({
  saveStatus,
  onRetry,
  derivedOutput = null,
  children,
}: ComposerStatusIndicatorProps): JSX.Element {
  const blocked = derivedOutput?.records.find((record) => record.status === "blocked");
  return (
    <div class="flex items-center gap-hsp-2xs">
      <span
        class="sg-composer-save-status"
        data-sg-status={saveStatus.kind}
        aria-live="polite"
        title={saveStatus.kind === "error" ? saveStatus.reason : undefined}
      >
        {describeSaveStatus(saveStatus)}
      </span>
      {saveStatus.kind === "error" && onRetry && (
        <button type="button" class="sg-composer-toolbar-button" onClick={onRetry}>
          Retry
        </button>
      )}
      {blocked && (
        <span
          class="sg-composer-save-status"
          data-sg-generated-output="blocked"
          aria-live="polite"
          title={blocked.staleArtifact === undefined ? blocked.reason : `${blocked.reason} ${blocked.staleArtifact}`}
        >
          Generated output blocked
        </span>
      )}
      {children}
    </div>
  );
}
