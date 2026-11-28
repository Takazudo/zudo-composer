import { hostDocumentAvailable } from "../../../native-editing/session";
import { computed, type Child } from "@takazudo/zfb/zudo-react";
import { Banner, Button, Chip, Pane, PaneBody, PaneHeader, type DataTableColumn, DataTable } from "../../../../components/ui";
import { toSignal, type MaybeSignal } from "../../../../components/reactive";
import { liveSlot, Rebuild, type LiveChild } from "../../../../components/rebuild";
import { indexDocument, type SitemapDocument } from "../../../../sitemapper/model";
import type { DerivedSitemapRoute, SitemapRouteDiagnostic, SitemapRouteExpansion } from "../../../../sitemapper/routes";

export interface RoutePreviewPaneProps {
  document: MaybeSignal<SitemapDocument>;
  authoredRoutes: MaybeSignal<ReadonlyMap<string, string>>;
  expansion: MaybeSignal<SitemapRouteExpansion | null>;
  selectedId: MaybeSignal<string | null>;
  onSelect: (nodeId: string) => void;
  notice?: LiveChild;
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

export function RoutePreviewPane({ document: documentProp, authoredRoutes: authoredRoutesProp, expansion: expansionProp, selectedId: selectedIdProp, onSelect, notice }: RoutePreviewPaneProps): Child {
  const document = toSignal(documentProp);
  const authoredRoutes = toSignal(authoredRoutesProp);
  const expansion = toSignal(expansionProp);
  const selectedId = toSignal(selectedIdProp);
  // The table is read-only; it rebuilds when its inputs change, while selection only toggles `aria-pressed`.
  let last: { document: SitemapDocument; authoredRoutes: ReadonlyMap<string, string>; expansion: SitemapRouteExpansion | null } | null = null;
  const inputs = computed(() => {
    const next = { document: document.value, authoredRoutes: authoredRoutes.value, expansion: expansion.value };
    if (!last || last.document !== next.document || last.authoredRoutes !== next.authoredRoutes || last.expansion !== next.expansion) last = next;
    return last;
  });
  const diagnosticBanner = (diagnostic: SitemapRouteDiagnostic): Child => (
    <Banner
      tone={diagnostic.severity === "nonblocking" ? "warn" : "err"}
      action={diagnostic.nodeId ? <Button size="xs" variant="ghost" on:click={() => onSelect(diagnostic.nodeId)}>Inspect node</Button> : undefined}
    >
      {diagnostic.message}
    </Banner>
  );

  return (
    <Pane variant="canvas" label="Route preview" class="sg-sitemapper-main sg-sitemapper-route-preview">
      <PaneHeader title="Route preview" count={computed(() => expansion.value?.derivedRouteCount ?? 0)} />
      <PaneBody class="sg-sitemapper-main__body">
        <div class="sg-sitemapper-main__notice">{liveSlot(notice)}</div>
        <Rebuild value={inputs}>{({ document: current, authoredRoutes: routesByNode, expansion: currentExpansion }) => {
          if (currentExpansion === null) {
            return <div class="sg-sitemapper-view-empty"><p role="status">Route expansion is unavailable until the Mapping catalog is ready.</p></div>;
          }
          const routes = currentExpansion.routes;
          const diagnostics = currentExpansion.diagnostics;
          const nodes = indexDocument(current).byId;
          const columns: readonly DataTableColumn<DerivedSitemapRoute>[] = [
            {
              key: "pattern",
              header: "Pattern",
              variant: "muted",
              cell: (route) => <code class="sg-sitemapper-route">{routesByNode.get(route.nodeId) ?? "/"}</code>,
            },
            {
              key: "concrete",
              header: "Concrete path",
              variant: "name",
              cell: (route) => <button type="button" class="sg-sitemapper-route-link" on:click={() => onSelect(route.nodeId)}>{route.pathname}</button>,
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
          return (
            <>
              {globalDiagnostics.length || orphanDiagnostics.length ? (
                <div class="sg-sitemapper-route-preview__diagnostics">
                  {globalDiagnostics.map((diagnostic) => diagnosticBanner(diagnostic))}
                  {orphanDiagnostics.map((diagnostic) => diagnosticBanner(diagnostic))}
                </div>
              ) : null}
              <div class="sg-sitemapper-route-preview__table">
                <DataTable
                  caption={`${current.name} concrete routes`}
                  density="compact"
                  columns={columns}
                  rows={routes}
                  rowKey={routeIdentity}
                  rowActions={(route) => <>{hostDocumentAvailable ? <a href={`/composer?native=1&sitemap=${encodeURIComponent(current.id)}&page=${encodeURIComponent(route.nodeId)}`}>Open page</a> : null}<Button size="xs" variant="ghost" aria-pressed={computed(() => (selectedId.value === route.nodeId ? "true" : "false"))} on:click={() => onSelect(route.nodeId)}>Inspect</Button></>}
                  rowDetail={(route) => {
                    const details = routeDiagnostics(route, diagnostics);
                    return details.length ? <div class="sg-sitemapper-route-preview__row-detail">{details.map((diagnostic) => <button type="button" class="sg-sitemapper-diagnostic-link" on:click={() => onSelect(route.nodeId)}>{diagnostic.message}</button>)}</div> : null;
                  }}
                  empty={<p>No concrete routes are currently derived.</p>}
                />
              </div>
            </>
          );
        }}</Rebuild>
      </PaneBody>
    </Pane>
  );
}

export default RoutePreviewPane;
