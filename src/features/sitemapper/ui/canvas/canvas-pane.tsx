import { computed, type Child } from "@takazudo/zfb/zudo-react";
import { toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Rebuild } from "../../../../components/rebuild";
import { ComposerIcon, MappingIcon } from "../../../../components/icons";
import { Chip, DataTable, Pane, PaneBody, PaneHeader, type DataTableColumn } from "../../../../components/ui";
import type { SitemapDocument, SitemapNode } from "../../../../sitemapper/model";
import type { SitemapNodeRouteInfo } from "../../../../sitemapper/routes";
import { SitemapCanvas, type CanvasLayoutPreference } from "./sitemap-canvas";
import { describeRouteStatus, type PageSourceLabels } from "./page-source";

export type SitemapView = "canvas" | "outline" | "routes" | "navigation";

export interface CanvasPaneProps {
  document: MaybeSignal<SitemapDocument>;
  routes: MaybeSignal<ReadonlyMap<string, string>>;
  sources: MaybeSignal<PageSourceLabels>;
  routeInfo: MaybeSignal<ReadonlyMap<string, SitemapNodeRouteInfo>>;
  /** Static for the pane's lifetime. */
  view: SitemapView;
  selectedId: MaybeSignal<string | null>;
  zoom: MaybeSignal<number>;
  layoutPreference?: MaybeSignal<CanvasLayoutPreference>;
  onLayoutPreferenceChange?: (preference: CanvasLayoutPreference) => void;
  /** The load/recovery notice, drawn above the surface it applies to. */
  notice?: Child;
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
  document: documentInput,
  routes: routesInput,
  sources: sourcesInput,
  routeInfo: routeInfoInput,
  view,
  selectedId: selectedInput,
  zoom: zoomInput,
  layoutPreference,
  onLayoutPreferenceChange,
  notice,
  onZoomChange,
  onSelect,
  onAddChild,
  onDuplicate,
  onDelete,
  onCreateRoot,
}: CanvasPaneProps): Child {
  const document = toSignal(documentInput);
  const routes = toSignal(routesInput);
  const sources = toSignal(sourcesInput);
  const routeInfo = toSignal(routeInfoInput);
  const selectedId = toSignal(selectedInput);
  const zoom = toSignal(zoomInput);
  const rows = computed(() => flatten(document.value.root));

  // The table view is rebuilt with its rows; its cells read the current labels.
  const columns: readonly DataTableColumn<SitemapNode>[] = [
    { key: "title", header: "Title", variant: "name", cell: (row) => row.title },
    {
      key: "route",
      header: "Route",
      variant: "muted",
      cell: (row) => <code class="sg-sitemapper-route">{computed(() => routes.value.get(row.id) ?? "/")}</code>,
    },
    {
      key: "source",
      header: "Source",
      cell: (row) => <Rebuild value={computed(() => sources.value.get(row.id))}>{(source) => {
        if (!source) return <span class="sg-sitemapper-blank" aria-hidden="true">—</span>;
        const Icon = source.kind === "mapping" ? MappingIcon : ComposerIcon;
        return (
          <span class="sg-sitemapper-source-cell">
            <Icon size="sm" />
            {source.name}
          </span>
        );
      }}</Rebuild>,
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        if (row.source.kind === "unassigned") return <Chip tone="warn" dot>Unassigned</Chip>;
        if (row.source.kind === "composition") return <Chip tone="ok" dot>Assigned</Chip>;
        return <Rebuild value={computed(() => routeInfo.value.get(row.id)?.status)}>{(status) => status === undefined
          ? <Chip dot>Resolving…</Chip>
          : <Chip tone={status === "ready" ? "ok" : "warn"} dot>{describeRouteStatus(status)}</Chip>}</Rebuild>;
      },
    },
  ];

  return (
    <Pane variant="canvas" label="Sitemap canvas" class="sg-sitemapper-main">
      <PaneHeader
        class="sg-sitemapper-main__header"
        title={computed(() => `Canvas · ${Math.round(zoom.value * 100)}%`)}
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
            layoutPreference={layoutPreference}
            onLayoutPreferenceChange={onLayoutPreferenceChange}
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
                  aria-pressed={computed(() => selectedId.value === row.id ? "true" : "false")}
                  on:click={() => onSelect(row.id)}
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
