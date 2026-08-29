/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The central Composer app's toolbar (issue #251). Reconciles the two toolbar
// assemblies: rather than reuse #247's monolithic `chrome/ComposerToolbar`
// (which predates the Export action and inlines its own mode toggle), this
// COMPOSES #249's presentational pieces — `ComposerStatusIndicator`,
// `ComposerModeToggle`, `ComposerToolbarActions` (Reset + Export) — plus the
// canvas-viewport `<select>` this issue owns. Purely presentational; every
// action is a typed callback the integration composes against the one
// controller. The status indicator keeps its `children` seam open for wave-6's
// clipboard chip (#255).
//
// Reset requires an explicit confirm (issue #269, folding in #260 — Reset
// used to wipe the whole document on a single click). The confirm state lives
// HERE rather than inside `ComposerToolbarActions`, which is deliberately kept
// a pure-callback component with no internal state (see its own header
// comment) — `onReset` passed down just flips `confirmingReset`, and the real
// `onReset` prop only fires once the reused `InlineConfirm` bar is confirmed.

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import type { CompositionDerivedOutputOutcome, CompositionNode, CompositionPublication } from "../../../composer";
import type {
  ComposerCanvasViewport,
  ComposerMode,
  ComposerSaveStatus,
} from "../chrome/controller-model";
import { InlineConfirm } from "../ui/shared/inline-confirm";
import { ComposerModeToggle } from "../ui/toolbar/mode-toggle";
import { ComposerStatusIndicator } from "../ui/toolbar/status-indicator";
import { ComposerToolbarActions } from "../ui/toolbar/toolbar-actions";
import { ComposerClipboardChip } from "./composer-clipboard-chip";
import { COMPOSER_VIEWPORTS, COMPOSER_VIEWPORT_LABELS } from "./viewport";

export interface ComposerToolbarBarProps {
  documentName: string;
  /** Reuse remains a role on this same document, not a second record type. */
  publication?: CompositionPublication;
  saveStatus: ComposerSaveStatus;
  derivedOutput?: CompositionDerivedOutputOutcome | null;
  mode: ComposerMode;
  viewport: ComposerCanvasViewport;
  onSetMode: (mode: ComposerMode) => void;
  onSetViewport: (viewport: ComposerCanvasViewport) => void;
  onReset: () => void;
  onRetrySave?: () => void;
  onExport: () => void;
  exportDisabled?: boolean;
  /** The session clipboard (issue #255) — renders as a chip beside the save status when non-empty. */
  clipboard?: CompositionNode | null;
  /** Friendly display name for a component id — required only when `clipboard` is passed. */
  titleFor?: (componentId: string) => string | undefined;
  /** Record-scoped production navigation; omitted in isolated editor tests. */
  onNavigateToLibrary?: () => void;
  /** Record-level duplicate; distinct from duplicating a selected tree node. */
  onDuplicateComposition?: () => void;
  duplicatingComposition?: boolean;
}

export function ComposerToolbarBar({
  documentName,
  publication,
  saveStatus,
  derivedOutput = null,
  mode,
  viewport,
  onSetMode,
  onSetViewport,
  onReset,
  onRetrySave,
  onExport,
  exportDisabled = false,
  clipboard = null,
  titleFor = () => undefined,
  onNavigateToLibrary,
  onDuplicateComposition,
  duplicatingComposition = false,
}: ComposerToolbarBarProps): JSX.Element {
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <>
      <div class="flex items-center gap-hsp-md min-w-0">
        {onNavigateToLibrary && (
          <button type="button" class="sg-composer-toolbar-button" onClick={onNavigateToLibrary}>
            Library
          </button>
        )}
        {onDuplicateComposition && (
          <button
            type="button"
            class="sg-composer-toolbar-button"
            disabled={duplicatingComposition}
            onClick={onDuplicateComposition}
          >
            {duplicatingComposition ? "Duplicating composition…" : "Duplicate composition"}
          </button>
        )}
        <div class="min-w-0">
          <p class="text-xs text-muted uppercase tracking-wide">Composition</p>
          <strong class="block truncate text-fg text-small font-semibold">{documentName}</strong>
          {publication && (
            <span class="sg-composer-tree-badge" data-sg-composer-publication={publication.kind}>
              {publication.kind === "pattern"
                ? "Pattern · Saved composition"
                : `Global template${publication.outlet.label ? ` · ${publication.outlet.label}` : ""}`}
            </span>
          )}
        </div>
        <ComposerStatusIndicator saveStatus={saveStatus} derivedOutput={derivedOutput} onRetry={onRetrySave}>
          <ComposerClipboardChip clipboard={clipboard} titleFor={titleFor} />
        </ComposerStatusIndicator>
      </div>

      <div class="flex flex-wrap items-center gap-hsp-sm">
        <label class="flex items-center gap-hsp-2xs text-small text-muted">
          <span class="sr-only">Canvas viewport</span>
          <select
            class="sg-composer-inspector-control border border-border rounded-md bg-surface px-hsp-xs py-vsp-3xs text-fg"
            value={viewport}
            onChange={(e) => {
              if (e.target instanceof HTMLSelectElement) {
                onSetViewport(e.target.value as ComposerCanvasViewport);
              }
            }}
          >
            {COMPOSER_VIEWPORTS.map((v) => (
              <option key={v} value={v}>
                {COMPOSER_VIEWPORT_LABELS[v]}
              </option>
            ))}
          </select>
        </label>

        <ComposerModeToggle mode={mode} onSetMode={onSetMode} />

        {confirmingReset ? (
          <InlineConfirm
            tone="toolbar"
            ariaLabel="Confirm resetting the sample"
            message="Reset the sample? This discards the current document and can't be undone."
            confirmLabel="Confirm reset"
            onCancel={() => setConfirmingReset(false)}
            onConfirm={() => {
              setConfirmingReset(false);
              onReset();
            }}
          />
        ) : (
          <ComposerToolbarActions
            onReset={() => setConfirmingReset(true)}
            onExport={onExport}
            exportDisabled={exportDisabled}
          />
        )}
      </div>
    </>
  );
}
