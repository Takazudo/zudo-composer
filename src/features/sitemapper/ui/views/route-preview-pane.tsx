/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { Banner, Button, Chip, Pane, PaneBody, PaneHeader, type DataTableColumn, DataTable } from "../../../../components/ui";
import { indexDocument, type SitemapDocument } from "../../../../sitemapper/model";
import type { DerivedSitemapRoute, SitemapRouteDiagnostic, SitemapRouteExpansion } from "../../../../sitemapper/routes";

export interface RoutePreviewPaneProps {
  document: SitemapDocument;
  authoredRoutes: ReadonlyMap<string, string>;
  expansion: SitemapRouteExpansion | null;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  notice?: JSX.Element | null;
}

export function routeIdentity(route: DerivedSitemapRoute): string {
  const entry = route.selectedEntry;
  const entryKey = entry ? `${entry.providerId}:${entry.modelId}:${entry.recordId}` : "";
  return `${route.nodeId}|${route.pathname}|${entryKey}`;
}

function routeDiagnostics(route: DerivedSitemapRoute, diagnostics: readonly SitemapRouteDiagnostic[]): SitemapRouteDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.nodeId === route.nodeId
    && (diagnostic.entryId === undefined || diagnostic.entryId === route.entryId)
    && (diagnostic.path === undefined || diagnostic.path === route.pathname));
}

function sourceLabel(route: DerivedSitemapRoute): string {
  switch (route.sourceKind) {
    case "mapping": return "Mapping route family";
    case "composition": return "Composition";
    case "unassigned": return "Unassigned";
  }
}

function contextLabel(route: DerivedSitemapRoute): string {
  if (!route.ancestors.length) return "Root";
  return route.ancestors.map((ancestor) => ancestor.displayTitle).join(" › ");
}

function statusFor(route: DerivedSitemapRoute, diagnostics: readonly SitemapRouteDiagnostic[]): "ready" | "blocked" {
  return routeDiagnostics(route, diagnostics).some((diagnostic) => diagnostic.severity !== "nonblocking") ? "blocked" : "ready";
}

export function RoutePreviewPane({ document, authoredRoutes, expansion, selectedId, onSelect, notice }: RoutePreviewPaneProps): JSX.Element {
  const routes = expansion?.routes ?? [];
  const diagnostics = expansion?.diagnostics ?? [];
  const nodes = indexDocument(document).byId;
  const columns: readonly DataTableColumn<DerivedSitemapRoute>[] = [
    {
      key: "pattern",
      header: "Pattern",
      variant: "muted",
      cell: (route) => <code class="sg-sitemapper-route">{authoredRoutes.get(route.nodeId) ?? "/"}</code>,
    },
    {
      key: "concrete",
      header: "Concrete path",
      variant: "name",
      cell: (route) => <button type="button" class="sg-sitemapper-route-link" onClick={() => onSelect(route.nodeId)}>{route.pathname}</button>,
    },
    {
      key: "source",
      header: "Source",
      cell: (route) => <span class="sg-sitemapper-route-source"><strong>{sourceLabel(route)}</strong><span>{nodes.get(route.nodeId)?.node.title ?? route.nodeId}</span></span>,
    },
    {
      key: "entry",
      header: "Entry",
      variant: "muted",
      cell: (route) => route.selectedEntry
        ? <code class="sg-sitemapper-route">{`${route.selectedEntry.providerId}:${route.selectedEntry.modelId}:${route.selectedEntry.recordId}`}</code>
        : <span class="sg-sitemapper-blank">—</span>,
    },
    {
      key: "context",
      header: "Context",
      variant: "muted",
      cell: (route) => contextLabel(route),
    },
    {
      key: "status",
      header: "Status",
      cell: (route) => statusFor(route, diagnostics) === "ready"
        ? <Chip tone="ok" dot>Ready</Chip>
        : <Chip tone="err" dot>Blocked</Chip>,
    },
  ];

  const globalDiagnostics = diagnostics.filter((diagnostic) => diagnostic.nodeId === "");
  const orphanDiagnostics = diagnostics.filter((diagnostic) => diagnostic.nodeId !== "" && !routes.some((route) => route.nodeId === diagnostic.nodeId && (diagnostic.entryId === undefined || diagnostic.entryId === route.entryId) && (diagnostic.path === undefined || diagnostic.path === route.pathname)));
  const diagnosticBanner = (diagnostic: SitemapRouteDiagnostic, key: string): JSX.Element => (
    <Banner
      key={key}
      tone={diagnostic.severity === "nonblocking" ? "warn" : "err"}
      action={diagnostic.nodeId ? <Button size="xs" variant="ghost" onClick={() => onSelect(diagnostic.nodeId)}>Inspect node</Button> : undefined}
    >
      {diagnostic.message}
    </Banner>
  );

  return (
    <Pane variant="canvas" label="Route preview" class="sg-sitemapper-main sg-sitemapper-route-preview">
      <PaneHeader title="Route preview" count={expansion?.derivedRouteCount ?? 0} />
      <PaneBody class="sg-sitemapper-main__body">
        <div class="sg-sitemapper-main__notice">{notice}</div>
        {expansion === null ? (
          <div class="sg-sitemapper-view-empty"><p role="status">Route expansion is unavailable until the Mapping catalog is ready.</p></div>
        ) : (
          <>
            {globalDiagnostics.length || orphanDiagnostics.length ? (
              <div class="sg-sitemapper-route-preview__diagnostics">
                {globalDiagnostics.map((diagnostic, index) => diagnosticBanner(diagnostic, `${diagnostic.code}:${index}`))}
                {orphanDiagnostics.map((diagnostic, index) => diagnosticBanner(diagnostic, `orphan:${diagnostic.code}:${index}`))}
              </div>
            ) : null}
            <div class="sg-sitemapper-route-preview__table">
              <DataTable
                caption={`${document.name} concrete routes`}
                density="compact"
                columns={columns}
                rows={routes}
                rowKey={routeIdentity}
                rowActions={(route) => <Button size="xs" variant="ghost" aria-pressed={selectedId === route.nodeId} onClick={() => onSelect(route.nodeId)}>Inspect</Button>}
                rowDetail={(route) => {
                  const details = routeDiagnostics(route, diagnostics);
                  return details.length ? <div class="sg-sitemapper-route-preview__row-detail">{details.map((diagnostic, index) => <button type="button" class="sg-sitemapper-diagnostic-link" key={`${diagnostic.code}:${index}`} onClick={() => onSelect(route.nodeId)}>{diagnostic.message}</button>)}</div> : null;
                }}
                empty={<p>No concrete routes are currently derived.</p>}
              />
            </div>
          </>
        )}
      </PaneBody>
    </Pane>
  );
}

export default RoutePreviewPane;
