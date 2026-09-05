/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { Button, Checkbox, Field, Input, Pane, PaneBody, PaneHeader, PaneSection, Select } from "../../../../components/ui";
import { createUuidIdFactory } from "../../../../shared";
import type { SitemapDocument, SitemapNavigationDestination, SitemapNavigationItem } from "../../../../sitemapper/model";
import { safeNavigationUrl } from "../../../../sitemapper/model/validate";
import { resolveSitemapNavigation, sameSitemapEntry } from "../../../../sitemapper/routes/navigation";
import type { DerivedSitemapRoute, SitemapRouteExpansion } from "../../../../sitemapper/routes";
import { routeIdentity } from "./route-preview-pane";

export interface NavigationPaneProps {
  document: SitemapDocument;
  expansion: SitemapRouteExpansion | null;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onEdit: (menu: "primary" | "footer", command: { kind: "put"; item: SitemapNavigationItem; index: number } | { kind: "remove"; id: string }) => void;
}

function destinationForRoute(route: DerivedSitemapRoute): SitemapNavigationDestination {
  return {
    kind: "route",
    nodeId: route.nodeId,
    ...(route.selectedEntry ? { entry: route.selectedEntry } : {}),
    ...(route.ancestors.some((ancestor) => ancestor.selectedEntry)
      ? { ancestors: route.ancestors.flatMap((ancestor) => ancestor.selectedEntry ? [{ nodeId: ancestor.nodeId, entry: ancestor.selectedEntry }] : []) }
      : {}),
  };
}

function sameAncestors(destination: Extract<SitemapNavigationDestination, { kind: "route" }>, route: DerivedSitemapRoute): boolean {
  const expected = destination.ancestors ?? [];
  const actual = route.ancestors.filter((ancestor) => ancestor.selectedEntry).map((ancestor) => ({ nodeId: ancestor.nodeId, entry: ancestor.selectedEntry! }));
  return expected.length === actual.length && expected.every((ancestor, index) => ancestor.nodeId === actual[index]?.nodeId && sameSitemapEntry(ancestor.entry, actual[index]?.entry));
}

function destinationKey(destination: SitemapNavigationDestination, routes: readonly DerivedSitemapRoute[]): string {
  if (destination.kind === "external") return "external";
  const route = routes.find((candidate) => candidate.nodeId === destination.nodeId
    && sameSitemapEntry(candidate.selectedEntry, destination.entry)
    && sameAncestors(destination, candidate));
  return route ? routeIdentity(route) : "stale";
}

function itemDiagnostic(item: SitemapNavigationItem, menu: "primary" | "footer", diagnostics: ReturnType<typeof resolveSitemapNavigation>["diagnostics"]): string | null {
  return diagnostics.find((diagnostic) => diagnostic.menu === menu && diagnostic.itemId === item.id)?.message ?? null;
}

function routeTitle(route: DerivedSitemapRoute): string {
  return `${route.pathname} · ${route.displayTitle}${route.selectedEntry ? ` · ${route.selectedEntry.recordId}` : ""}`;
}

export function NavigationPane({ document, expansion, selectedId, onSelect, onEdit }: NavigationPaneProps): JSX.Element {
  const routes = expansion?.routes ?? [];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [externalUrl, setExternalUrl] = useState("");
  const [externalError, setExternalError] = useState<string | null>(null);
  const idFactory = useRef(createUuidIdFactory());

  const routeByKey = useMemo(() => new Map(routes.map((route) => [routeIdentity(route), route])), [routes]);
  const navigationResolution = useMemo(() => resolveSitemapNavigation(document.navigation, routes), [document.navigation, routes]);
  const firstRoute = routes[0];

  function updateItem(menu: "primary" | "footer", item: SitemapNavigationItem, patch: Partial<SitemapNavigationItem>): void {
    const current = document.navigation[menu].findIndex((candidate) => candidate.id === item.id);
    if (current < 0) return;
    onEdit(menu, { kind: "put", item: { ...item, ...patch }, index: current });
  }

  function commitText(menu: "primary" | "footer", item: SitemapNavigationItem, field: "label" | "url"): void {
    const key = `${menu}:${item.id}:${field}`;
    const value = drafts[key] ?? (field === "label" ? item.label : item.destination.kind === "external" ? item.destination.url : "");
    if (field === "label") {
      if (!value.trim()) return;
      updateItem(menu, item, { label: value });
      return;
    }
    if (item.destination.kind !== "external" || !safeNavigationUrl(value)) return;
    updateItem(menu, item, { destination: { kind: "external", url: value } });
  }

  function addRoute(menu: "primary" | "footer"): void {
    if (!firstRoute) return;
    const item: SitemapNavigationItem = { id: idFactory.current("navigation"), label: firstRoute.displayTitle, visible: true, destination: destinationForRoute(firstRoute) };
    onEdit(menu, { kind: "put", item, index: document.navigation[menu].length });
  }

  function addExternal(menu: "primary" | "footer"): void {
    if (!safeNavigationUrl(externalUrl)) {
      setExternalError("Use a complete http(s) URL without credentials.");
      return;
    }
    const item: SitemapNavigationItem = { id: idFactory.current("navigation"), label: externalUrl, visible: true, destination: { kind: "external", url: externalUrl } };
    onEdit(menu, { kind: "put", item, index: document.navigation[menu].length });
    setExternalUrl("");
    setExternalError(null);
  }

  function renderItem(menu: "primary" | "footer", item: SitemapNavigationItem, index: number): JSX.Element {
    const labelKey = `${menu}:${item.id}:label`;
    const urlKey = `${menu}:${item.id}:url`;
    const diagnostic = itemDiagnostic(item, menu, navigationResolution.diagnostics);
    const selectedRoute = item.destination.kind === "route" ? routeByKey.get(destinationKey(item.destination, routes)) : undefined;
    const destinationValue = destinationKey(item.destination, routes);
    return (
      <li key={item.id} class="sg-sitemapper-navigation__item">
        <div class="sg-sitemapper-navigation__row">
          <span class="sg-sitemapper-navigation__order" aria-label={`Menu position ${index + 1}`}>{index + 1}</span>
          <Input
            size="sm"
            aria-label={`${menu} menu label for ${item.id}`}
            value={drafts[labelKey] ?? item.label}
            onInput={(event) => setDrafts((current) => ({ ...current, [labelKey]: event.currentTarget.value }))}
            onBlur={() => commitText(menu, item, "label")}
          />
          <Checkbox
            checked={item.visible}
            aria-label={`${item.label} visible`}
            onCheckedChange={(visible) => updateItem(menu, item, { visible })}
          />
          <Button size="xs" variant="ghost" disabled={index === 0} aria-label={`Move ${item.label} up`} onClick={() => {
            onEdit(menu, { kind: "remove", id: item.id });
            onEdit(menu, { kind: "put", item, index: index - 1 });
          }}>↑</Button>
          <Button size="xs" variant="ghost" disabled={index === document.navigation[menu].length - 1} aria-label={`Move ${item.label} down`} onClick={() => {
            onEdit(menu, { kind: "remove", id: item.id });
            onEdit(menu, { kind: "put", item, index: index + 1 });
          }}>↓</Button>
          <Button size="xs" variant="ghost" aria-label={`Remove ${item.label}`} onClick={() => onEdit(menu, { kind: "remove", id: item.id })}>Remove</Button>
        </div>
        <div class="sg-sitemapper-navigation__destination">
          <Field label="Destination">
            <Select
              size="sm"
              aria-label={`${item.label} destination`}
              value={destinationValue}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === "external") return;
                const route = routeByKey.get(value);
                if (route) updateItem(menu, item, { destination: destinationForRoute(route) });
              }}
            >
              {item.destination.kind === "external" ? <option value="external">External link</option> : null}
              {destinationValue === "stale" ? <option value="stale">Stale route selection</option> : null}
              {routes.map((route) => <option key={routeIdentity(route)} value={routeIdentity(route)}>{routeTitle(route)}</option>)}
            </Select>
          </Field>
          {item.destination.kind === "external" ? (
            <Input
              size="sm"
              aria-label={`${item.label} external URL`}
              value={drafts[urlKey] ?? item.destination.url}
              onInput={(event) => setDrafts((current) => ({ ...current, [urlKey]: event.currentTarget.value }))}
              onBlur={() => commitText(menu, item, "url")}
            />
          ) : (
            <>
              {selectedRoute ? <Button size="xs" variant="ghost" aria-pressed={selectedId === selectedRoute.nodeId} onClick={() => onSelect(selectedRoute.nodeId)}>Inspect page</Button> : null}
              {(item.destination.entry !== undefined || item.destination.ancestors?.length) ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => updateItem(menu, item, { destination: { kind: "route", nodeId: item.destination.kind === "route" ? item.destination.nodeId : "" } })}
                >Clear generated selection</Button>
              ) : null}
            </>
          )}
        </div>
        {diagnostic ? <p class="sg-sitemapper-navigation__diagnostic" role="alert">{diagnostic}</p> : null}
      </li>
    );
  }

  function renderMenu(menu: "primary" | "footer", label: string): JSX.Element {
    const items = document.navigation[menu];
    return (
      <PaneSection title={label} action={<Button size="xs" variant="ghost" disabled={!firstRoute} onClick={() => addRoute(menu)}>Add route</Button>}>
        <ol class="sg-sitemapper-navigation__list">
          {items.map((item, index) => renderItem(menu, item, index))}
        </ol>
        {!items.length ? <p class="sg-sitemapper-navigation__empty">No menu items. Add a real route or external destination.</p> : null}
      </PaneSection>
    );
  }

  return (
    <Pane variant="canvas" label="Navigation" class="sg-sitemapper-main sg-sitemapper-navigation">
      <PaneHeader title="Navigation" count={document.navigation.primary.length + document.navigation.footer.length} />
      <PaneBody class="sg-sitemapper-main__body">
        <div class="sg-sitemapper-navigation__body">
          {renderMenu("primary", "Primary menu")}
          {renderMenu("footer", "Footer menu")}
          <PaneSection title="External destination">
            <Field label="URL" help="Only safe http(s) URLs are accepted.">
              <Input size="sm" value={externalUrl} aria-label="New external URL" onInput={(event) => setExternalUrl(event.currentTarget.value)} />
            </Field>
            {externalError ? <p class="sg-sitemapper-navigation__diagnostic" role="alert">{externalError}</p> : null}
            <div class="sg-sitemapper-navigation__add-external">
              <Button size="sm" variant="ghost" disabled={!safeNavigationUrl(externalUrl)} onClick={() => { addExternal("primary"); }}>Add to primary</Button>
              <Button size="sm" variant="ghost" disabled={!safeNavigationUrl(externalUrl)} onClick={() => { addExternal("footer"); }}>Add to footer</Button>
            </div>
          </PaneSection>
          {expansion === null ? <p class="sg-sitemapper-navigation__empty" role="status">Route destinations are unavailable until the Mapping catalog is ready.</p> : null}
        </div>
      </PaneBody>
    </Pane>
  );
}

export default NavigationPane;
