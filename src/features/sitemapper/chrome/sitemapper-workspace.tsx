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
// Geometry lives in styles/shell.css: below 64rem this keeps one active panel
// column selected by the labelled roving tablist. All rails and both resizers
// remain in the DOM. The resizer init script is
// installed independently from the controlled product state; unconditional DOM
// presence plus its MutationObserver lets it wire replaced elements. At >=64rem the grid is
// tree rail | resizer | canvas (minmax(0, 1fr)) | resizer | inspector rail.

import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
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

/** Small, rail-safe fallback when a caller omits a typed surface. */
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
  const panes = ["outline", "canvas", "inspector"] as const;
  const panelIds = [ID_TREE_RAIL, "sg-sitemapper-canvas-panel", ID_INSPECTOR_RAIL] as const;
  const [activePane, setActivePane] = useState<(typeof panes)[number]>("canvas");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activateFromKey = (event: JSX.TargetedKeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const next = (index + delta + panes.length) % panes.length;
    setActivePane(panes[next]!);
    tabRefs.current[next]?.focus();
  };
  return (
    <div class="sg-sitemapper-shell">
      <div class="sg-sitemapper-toolbar" role="toolbar" aria-label="Sitemapper toolbar">
        {toolbar ?? (
          <SitemapperWorkspacePlaceholderPane
            label="Toolbar"
            note="No toolbar surface was supplied."
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
      <div class="sg-sitemapper-tabs" role="tablist" aria-label="Sitemapper panels">
        {panes.map((pane, index) => <button key={pane} ref={(element) => { tabRefs.current[index] = element; }} type="button" role="tab" aria-selected={activePane === pane} aria-controls={panelIds[index]} tabindex={activePane === pane ? 0 : -1} onClick={() => setActivePane(pane)} onKeyDown={(event) => activateFromKey(event, index)}>{pane[0]!.toUpperCase()}{pane.slice(1)}</button>)}
      </div>
      <div class="sg-sitemapper-grid" data-sg-sitemapper-grid data-active-pane={activePane}>
        <div
          class="sg-sitemapper-tree-rail sg-sitemapper-tree"
          id={ID_TREE_RAIL}
          aria-label="Outline"
          role="tabpanel"
        >
          {tree ?? (
            <SitemapperWorkspacePlaceholderPane
              label="Tree"
              note="No outline surface was supplied."
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
        <div class="sg-sitemapper-canvas" data-sg-sitemapper-canvas id="sg-sitemapper-canvas-panel" role="tabpanel">
          {canvas ?? (
            <SitemapperWorkspacePlaceholderPane
              label="Canvas"
              note="No canvas surface was supplied."
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
        <div class="sg-sitemapper-inspector" id={ID_INSPECTOR_RAIL} aria-label="Inspector" role="tabpanel">
          {inspector ?? (
            <SitemapperWorkspacePlaceholderPane
              label="Inspector"
              note="No inspector surface was supplied."
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default SitemapperWorkspace;
