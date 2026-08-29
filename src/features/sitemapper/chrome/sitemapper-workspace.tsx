/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Sitemapper toolbar + five-track workspace shell.
//
// This component is deliberately presentational. The controller owns the
// document, selection, persistence, and navigation predicate and provides
// those pieces through typed `toolbar`, `banner`, `tree`, `canvas`, and
// `inspector` slots. Keeping the shell free of controller state means those
// surfaces can be assembled without changing the workspace geometry.
//
// Geometry lives in styles/shell.css: below 64rem this keeps one canvas-only
// column while the tree/inspector rails and both resizers remain in the DOM
// (CSS hides them rather than omitting them). The resizer init script is
// mounted at the end of the document and may therefore run before a
// when="load" island hydrates; unconditional DOM presence plus its
// MutationObserver lets it wire the late elements. At >=64rem the grid is
// tree rail | resizer | canvas (minmax(0, 1fr)) | resizer | inspector rail.

import type { ComponentChildren, JSX } from "preact";
import {
  ATTR_INSPECTOR_RESIZER,
  ATTR_TREE_RESIZER,
  DEFAULT_INSPECTOR_W,
  DEFAULT_TREE_W,
  ID_INSPECTOR_RAIL,
  ID_TREE_RAIL,
  MAX_RAIL_W,
  MIN_RAIL_W,
} from "./resizer-contract";

export interface SitemapperWorkspacePlaceholderPaneProps {
  label: string;
  note?: string;
}

/** Small, rail-safe fallback used until a typed surface is assembled. */
export function SitemapperWorkspacePlaceholderPane({
  label,
  note,
}: SitemapperWorkspacePlaceholderPaneProps): JSX.Element {
  return (
    <div
      class="sg-sitemapper-workspace-placeholder sg-sitemapper-placeholder-pane"
      data-sg-sitemapper-placeholder={label}
    >
      <strong>{label}</strong>
      {note && <span>{note}</span>}
    </div>
  );
}

export interface SitemapperWorkspaceProps {
  /** The Sitemapper toolbar. Defaults to a labeled placeholder for the shell seam. */
  toolbar?: ComponentChildren;
  /** Optional load/recovery banner between toolbar and workspace grid. */
  banner?: ComponentChildren;
  /** Outline/tree rail. Defaults to a labeled placeholder. */
  tree?: ComponentChildren;
  /** Sitemap canvas. Defaults to a labeled placeholder. */
  canvas?: ComponentChildren;
  /** Inspector rail. Defaults to a labeled placeholder. */
  inspector?: ComponentChildren;
  /** SSR-default aria-valuenow for the tree resizer, in px. */
  treeWidthPx?: number;
  /** SSR-default aria-valuenow for the inspector resizer, in px. */
  inspectorWidthPx?: number;
}

export function SitemapperWorkspace({
  toolbar,
  banner,
  tree,
  canvas,
  inspector,
  treeWidthPx = DEFAULT_TREE_W,
  inspectorWidthPx = DEFAULT_INSPECTOR_W,
}: SitemapperWorkspaceProps): JSX.Element {
  return (
    <div class="sg-sitemapper-shell">
      <div class="sg-sitemapper-toolbar" role="toolbar" aria-label="Sitemapper toolbar">
        {toolbar ?? (
          <SitemapperWorkspacePlaceholderPane
            label="Toolbar"
            note="Sitemapper controls mount here once the authoring controller is assembled."
          />
        )}
      </div>
      {banner === undefined ? (
        <SitemapperWorkspacePlaceholderPane
          label="Banner"
          note="Load and recovery notices mount here when a record needs attention."
        />
      ) : (
        banner
      )}
      <div class="sg-sitemapper-grid" data-sg-sitemapper-grid>
        <div
          class="sg-sitemapper-tree-rail sg-sitemapper-tree"
          id={ID_TREE_RAIL}
          aria-label="Outline"
        >
          {tree ?? (
            <SitemapperWorkspacePlaceholderPane
              label="Tree"
              note="The outline tree mounts here in a later Sitemapper wave."
            />
          )}
        </div>
        <div
          class="sg-sitemapper-resizer"
          {...{ [ATTR_TREE_RESIZER]: "" }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize outline panel"
          aria-controls={ID_TREE_RAIL}
          aria-valuemin={MIN_RAIL_W}
          aria-valuemax={MAX_RAIL_W}
          aria-valuenow={treeWidthPx}
          tabindex={0}
        />
        <div class="sg-sitemapper-canvas" data-sg-sitemapper-canvas>
          {canvas ?? (
            <SitemapperWorkspacePlaceholderPane
              label="Canvas"
              note="The sitemap canvas mounts here once the Sitemapper controller is assembled."
            />
          )}
        </div>
        <div
          class="sg-sitemapper-resizer"
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
        <div class="sg-sitemapper-inspector" id={ID_INSPECTOR_RAIL} aria-label="Inspector">
          {inspector ?? (
            <SitemapperWorkspacePlaceholderPane
              label="Inspector"
              note="Page properties mount here in a later Sitemapper wave."
            />
          )}
        </div>
      </div>
      <div class="sg-sitemapper-narrow-note" data-sg-sitemapper-narrow-note>
        <strong>Canvas-only view</strong>
        <span>Use a wider window to edit the tree and properties.</span>
      </div>
    </div>
  );
}

export default SitemapperWorkspace;
