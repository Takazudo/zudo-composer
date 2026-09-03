/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useMemo } from "preact/hooks";
import { ComposerIcon, MappingIcon } from "../../../../components/icons";
import { Chip, DataTable, Pane, PaneBody, PaneHeader, type DataTableColumn } from "../../../../components/ui";
import type { SitemapDocument, SitemapNode } from "../../../../sitemapper/model";
import type { SitemapNodeRouteInfo } from "../../../../sitemapper/routes";
import { SitemapCanvas } from "./sitemap-canvas";
import { describeRouteStatus, type PageSourceLabels } from "./page-source";

export type SitemapView = "tree" | "canvas";

export interface CanvasPaneProps {
  document: SitemapDocument;
  routes: ReadonlyMap<string, string>;
  sources: PageSourceLabels;
  routeInfo: ReadonlyMap<string, SitemapNodeRouteInfo>;
  view: SitemapView;
  selectedId: string | null;
  zoom: number;
  /** The load/recovery notice, drawn above the surface it applies to. */
  notice?: JSX.Element | null;
  onZoomChange: (zoom: number) => void;
  onSelect: (id: string) => void;
  onAddChild: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateRoot: () => void;
}

function flatten(nodes: readonly SitemapNode[], rows: SitemapNode[] = []): SitemapNode[] {
  for (const node of nodes) {
    rows.push(node);
    flatten(node.children, rows);
  }
  return rows;
}

export function CanvasPane({
  document,
  routes,
  sources,
  routeInfo,
  view,
  selectedId,
  zoom,
  notice,
  onZoomChange,
  onSelect,
  onAddChild,
  onDuplicate,
  onDelete,
  onCreateRoot,
}: CanvasPaneProps): JSX.Element {
  const rows = useMemo(() => flatten(document.root), [document]);

  const columns: readonly DataTableColumn<SitemapNode>[] = [
    { key: "title", header: "Title", variant: "name", cell: (row) => row.title },
    {
      key: "route",
      header: "Route",
      variant: "muted",
      cell: (row) => <code class="sg-sitemapper-route">{routes.get(row.id) ?? "/"}</code>,
    },
    {
      key: "source",
      header: "Source",
      cell: (row) => {
        const source = sources.get(row.id);
        if (!source) return <span class="sg-sitemapper-blank" aria-hidden="true">—</span>;
        const Icon = source.kind === "mapping" ? MappingIcon : ComposerIcon;
        return (
          <span class="sg-sitemapper-source-cell">
            <Icon size="sm" />
            {source.name}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        if (row.source.kind === "unassigned") return <Chip tone="warn" dot>Unassigned</Chip>;
        if (row.source.kind === "composition") return <Chip tone="ok" dot>Assigned</Chip>;
        const status = routeInfo.get(row.id)?.status;
        return status === undefined
          ? <Chip dot>Resolving…</Chip>
          : <Chip tone={status === "ready" ? "ok" : "warn"} dot>{describeRouteStatus(status)}</Chip>;
      },
    },
  ];

  return (
    <Pane variant="canvas" label="Sitemap canvas" class="sg-sitemapper-main">
      <PaneHeader
        class="sg-sitemapper-main__header"
        title={view === "canvas" ? `Canvas · ${Math.round(zoom * 100)}%` : "Tree"}
      />
      <PaneBody class="sg-sitemapper-main__body">
        {/* Always rendered: the body is a two-row grid, and a missing first row
            would drop the canvas into the `auto` track and collapse it. */}
        <div class="sg-sitemapper-main__notice">{notice}</div>
        {view === "canvas" ? (
          <SitemapCanvas
            document={document}
            routes={routes}
            sources={sources}
            selectedId={selectedId}
            zoom={zoom}
            onZoomChange={onZoomChange}
            onSelect={onSelect}
            onAddChild={onAddChild}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onCreateRoot={onCreateRoot}
          />
        ) : (
          <div class="sg-sitemapper-tree-view">
            <DataTable
              caption="Pages"
              density="compact"
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              rowActions={(row) => (
                <button
                  type="button"
                  class="cms-btn cms-btn--ghost cms-btn--xs"
                  aria-pressed={selectedId === row.id}
                  onClick={() => onSelect(row.id)}
                >
                  Select
                </button>
              )}
            />
          </div>
        )}
      </PaneBody>
    </Pane>
  );
}
