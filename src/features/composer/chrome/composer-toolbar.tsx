/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer toolbar (issue #247): document name, honest save status,
// Edit/Preview mode, canvas viewport choice, and Reset sample. Deliberately
// does NOT include an Export JSX action — that belongs to the inspector/
// export components issue (#249), out of this issue's scope.
//
// Plain props (not the whole ComposerController) so this stays independently
// testable and doesn't couple to the controller hook's exact shape.

import type { JSX } from "preact";
import type { ComposerCanvasViewport, ComposerMode, ComposerSaveStatus } from "./controller-model";
import { describeSaveStatus } from "./controller-model";

export interface ComposerToolbarProps {
  documentName: string;
  mode: ComposerMode;
  viewport: ComposerCanvasViewport;
  saveStatus: ComposerSaveStatus;
  onSetMode: (mode: ComposerMode) => void;
  onSetViewport: (viewport: ComposerCanvasViewport) => void;
  onReset: () => void;
  onRetrySave?: () => void;
}

const VIEWPORTS: { value: ComposerCanvasViewport; label: string }[] = [
  { value: "fluid", label: "Fluid" },
  { value: "desktop", label: "Desktop" },
  { value: "tablet", label: "Tablet" },
  { value: "mobile", label: "Mobile" },
];

export function ComposerToolbar({
  documentName,
  mode,
  viewport,
  saveStatus,
  onSetMode,
  onSetViewport,
  onReset,
  onRetrySave,
}: ComposerToolbarProps): JSX.Element {
  return (
    <>
      <div class="flex items-center gap-hsp-md min-w-0">
        <div class="min-w-0">
          <p class="text-xs text-muted uppercase tracking-wide">Composition</p>
          <strong class="block truncate text-fg text-small font-semibold">{documentName}</strong>
        </div>
        <span
          class="sg-composer-save-status"
          data-sg-status={saveStatus.kind}
          aria-live="polite"
          title={saveStatus.kind === "error" ? saveStatus.reason : undefined}
        >
          {describeSaveStatus(saveStatus)}
        </span>
        {saveStatus.kind === "error" && onRetrySave && (
          <button type="button" class="sg-composer-toolbar-button" onClick={onRetrySave}>
            Retry
          </button>
        )}
      </div>

      <div class="flex items-center gap-hsp-sm">
        <div class="sg-composer-mode-toggle" role="group" aria-label="Composer mode">
          <button
            type="button"
            aria-pressed={mode === "edit"}
            onClick={() => onSetMode("edit")}
          >
            Edit
          </button>
          <button
            type="button"
            aria-pressed={mode === "preview"}
            onClick={() => onSetMode("preview")}
          >
            Preview
          </button>
        </div>

        <label class="flex items-center gap-hsp-2xs text-small text-muted">
          <span class="sr-only">Canvas viewport</span>
          <select
            class="border border-border rounded-md bg-surface px-hsp-xs py-vsp-3xs text-fg"
            value={viewport}
            onChange={(e) => {
              if (e.target instanceof HTMLSelectElement) {
                onSetViewport(e.target.value as ComposerCanvasViewport);
              }
            }}
          >
            {VIEWPORTS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <button type="button" class="sg-composer-toolbar-button" onClick={onReset}>
          Reset sample
        </button>
      </div>
    </>
  );
}
