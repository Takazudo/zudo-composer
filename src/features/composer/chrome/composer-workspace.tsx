/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer document shell's toolbar + five-track workspace (issue #247).
//
// Purely presentational — no state of its own. This is the exact "typed
// slots" seam #248 (preview iframe), #249 (inspector), #250 (structure tree
// + chooser), and #251 (central integration) plug into WITHOUT rewriting
// this shell: `tree` / `canvas` / `inspector` are plain `ComponentChildren`
// props, each defaulting to a `ComposerPlaceholderPane` at this stage (per
// the issue's Definition of Done: "a placeholder in the canvas is fine and
// expected"). `toolbar` and `banner` are likewise free-form slots so the
// toolbar (owned by this issue) can evolve without this file changing.
//
// Geometry lives entirely in src/features/composer/styles.css: below 64rem
// this renders a single canvas-only column (tree/inspector/resizers hidden
// via CSS, not omitted from the DOM — see that file's header for why: DOM
// presence keeps the resizer script's `querySelector` wiring unconditional).
// At >=64rem it becomes the five-track grid: tree rail | resizer | canvas
// (minmax(0,1fr)) | resizer | inspector rail.
//
// The resizer `<div role="separator">` elements are inert markup here —
// pointer/keyboard dragging and the ARIA `aria-valuenow`/`aria-valuemax`
// live-updates are wired by the vanilla-JS ComposerResizerInitScript
// (resizer-scripts.tsx), matching the code-panel resizer precedent
// (src/features/styleguide/chrome/panel-scripts.tsx). The SSR `aria-value*`
// defaults below match this file's CSS `:root` rail-width defaults.

import type { ComponentChildren, JSX } from "preact";
import {
  ATTR_INSPECTOR_RESIZER,
  ATTR_TREE_RESIZER,
  ID_INSPECTOR_RAIL,
  ID_TREE_RAIL,
  MAX_RAIL_W,
  MIN_RAIL_W,
} from "./resizer-contract";
import { ComposerPlaceholderPane } from "./composer-placeholder-pane";

export interface ComposerWorkspaceProps {
  /** The Composer toolbar (document name, save status, mode, viewport, reset). */
  toolbar: ComponentChildren;
  /** Optional banner above the grid — e.g. a recovered/quarantined load notice. */
  banner?: ComponentChildren;
  /** Structure tree region (#250). Defaults to a placeholder. */
  tree?: ComponentChildren;
  /** Canvas / preview region (#248). Defaults to a placeholder. */
  canvas?: ComponentChildren;
  /** Inspector region (#249). Defaults to a placeholder. */
  inspector?: ComponentChildren;
  /** SSR-default aria-valuenow for the tree resizer, in px. */
  treeWidthPx?: number;
  /** SSR-default aria-valuenow for the inspector resizer, in px. */
  inspectorWidthPx?: number;
}

export function ComposerWorkspace({
  toolbar,
  banner,
  tree,
  canvas,
  inspector,
  treeWidthPx = 288,
  inspectorWidthPx = 320,
}: ComposerWorkspaceProps): JSX.Element {
  return (
    <div class="sg-composer-shell">
      <div class="sg-composer-toolbar" role="toolbar" aria-label="Composer toolbar">
        {toolbar}
      </div>
      {banner}
      <div class="sg-composer-grid" data-sg-composer-grid>
        <div class="sg-composer-tree-rail" id={ID_TREE_RAIL} aria-label="Structure">
          {tree ?? <ComposerPlaceholderPane label="Structure" note="The tree rail mounts here in a later Composer wave." />}
        </div>
        <div
          class="sg-composer-resizer"
          {...{ [ATTR_TREE_RESIZER]: "" }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize structure panel"
          aria-controls={ID_TREE_RAIL}
          aria-valuemin={MIN_RAIL_W}
          aria-valuemax={MAX_RAIL_W}
          aria-valuenow={treeWidthPx}
          tabindex={0}
        />
        <div class="sg-composer-canvas" data-sg-composer-canvas>
          {canvas ?? (
            <ComposerPlaceholderPane
              label="Canvas"
              note="The preview surface mounts here once the isolated preview runtime (#248) is wired in."
            />
          )}
        </div>
        <div
          class="sg-composer-resizer"
          {...{ [ATTR_INSPECTOR_RESIZER]: "" }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize inspector panel"
          aria-controls={ID_INSPECTOR_RAIL}
          aria-valuemin={MIN_RAIL_W}
          aria-valuemax={MAX_RAIL_W}
          aria-valuenow={inspectorWidthPx}
          tabindex={0}
        />
        <div class="sg-composer-inspector" id={ID_INSPECTOR_RAIL} aria-label="Inspector">
          {inspector ?? <ComposerPlaceholderPane label="Inspector" note="The prop inspector mounts here in a later Composer wave." />}
        </div>
      </div>
      {/* The canvas-only narrow-seam copy, matching the epic's now-retired
          prototype text verbatim (no code import). CSS-only visible below
          the 64rem seam. */}
      <div class="sg-composer-narrow-note" data-sg-composer-narrow-note>
        <strong>Canvas-only view</strong>
        <span>Use a wider window to edit the tree and properties.</span>
      </div>
    </div>
  );
}
