/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Reusable, composable Composer save-status indicator (issue #249). Mirrors
// the #247 toolbar's inline status span (`describeSaveStatus`) but extracted
// so a later status chip (wave-6 clipboard status, #255) can render beside
// it via `children` without editing the central Composer app entry — that's
// the "keep the status seam composable" synthesis note on this issue.

import type { ComponentChildren, JSX } from "preact";
import type { CompositionDerivedOutputOutcome } from "../../../../composer/browser";
import type { ComposerSaveStatus } from "../../chrome/controller-model";
import { describeSaveStatus } from "../../chrome/controller-model";

export interface ComposerStatusIndicatorProps {
  saveStatus: ComposerSaveStatus;
  onRetry?: () => void;
  /** Kept separate from canonical save state so Saved remains truthful. */
  derivedOutput?: CompositionDerivedOutputOutcome | null;
  /** Composability seam — e.g. wave-6's clipboard status chip renders here. */
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
