/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The central Composer app's toolbar (issue Takazudo/zudo-sg#251). Reconciles the two toolbar
// assemblies: rather than reuse Takazudo/zudo-sg#247's monolithic `chrome/ComposerToolbar`
// (which predates the Export action and inlines its own mode toggle), this
// COMPOSES Takazudo/zudo-sg#249's presentational pieces — `ComposerStatusIndicator`,
// `ComposerModeToggle`, `ComposerToolbarActions` (Undo, Redo, Export) — plus the
// canvas-viewport `<select>` this issue owns. Purely presentational; every
// action is a typed callback the integration composes against the one
// controller. The status indicator keeps its `children` seam open for wave-6's
// clipboard chip (Takazudo/zudo-sg#255).

import type { JSX } from "preact";
import type { CompositionDerivedOutputOutcome, CompositionNode, CompositionPublication } from "../../../composer/browser";
import type {
  ComposerCanvasViewport,
  ComposerMode,
  ComposerSaveStatus,
} from "../chrome/controller-model";
import { DuplicateIcon, LibraryIcon, PreviewIcon } from "../../../components/icons";
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
  onRetrySave?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onExport: () => void;
  exportDisabled?: boolean;
  /** The session clipboard (issue Takazudo/zudo-sg#255) — renders as a chip beside the save status when non-empty. */
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
  onRetrySave,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onExport,
  exportDisabled = false,
  clipboard = null,
  titleFor = () => undefined,
  onNavigateToLibrary,
  onDuplicateComposition,
  duplicatingComposition = false,
}: ComposerToolbarBarProps): JSX.Element {
  return (
    <>
      <div class="sg-composer-toolbar-identity flex items-center gap-hsp-md min-w-0">
        {onNavigateToLibrary && (
          <button type="button" class="sg-composer-toolbar-button" onClick={onNavigateToLibrary}>
            <LibraryIcon size="sm" class="sg-composer-button-icon" />
            <span>Library</span>
          </button>
        )}
        {onDuplicateComposition && (
          <button
            type="button"
            class="sg-composer-toolbar-button"
            disabled={duplicatingComposition}
            onClick={onDuplicateComposition}
          >
            <DuplicateIcon size="sm" class="sg-composer-button-icon" />
            <span>{duplicatingComposition ? "Duplicating composition…" : "Duplicate composition"}</span>
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

      <div class="sg-composer-toolbar-controls flex flex-wrap items-center gap-hsp-sm">
        <label class="sg-composer-toolbar-field text-small text-muted">
          <PreviewIcon size="sm" class="sg-composer-button-icon" />
          <span class="sg-composer-toolbar-label">Viewport</span>
          <select
            class="sg-composer-inspector-control text-fg"
            aria-label="Canvas viewport"
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

        <ComposerToolbarActions
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onExport={onExport}
          exportDisabled={exportDisabled}
        />
      </div>
    </>
  );
}
