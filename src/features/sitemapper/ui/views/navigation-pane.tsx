import { computed, For, Show, signal, type Child, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { toSignal, type MaybeSignal } from "../../../../components/reactive";
import { liveSlot, Rebuild, type LiveChild } from "../../../../components/rebuild";
import { Keyed } from "../../../../runtime";
import { derive, followModel } from "../../../mapping/signals";
import { Button, Checkbox, Field, Input, Pane, PaneBody, PaneHeader, PaneSection, Select } from "../../../../components/ui";
import { createUuidIdFactory } from "../../../../shared";
import type { SitemapDocument, SitemapNavigationDestination, SitemapNavigationItem } from "../../../../sitemapper/model";
import { safeNavigationUrl } from "../../../../sitemapper/model/validate";
import { resolveSitemapNavigation, sameSitemapEntry } from "../../../../sitemapper/routes/navigation";
import type { DerivedSitemapRoute, SitemapRouteExpansion } from "../../../../sitemapper/routes";
import { routeIdentity } from "./route-preview-pane";
import type { SitemapperNavigationPatch } from "../../app/use-sitemapper-controller";

type Menu = "primary" | "footer";

export interface NavigationPaneProps {
  document: MaybeSignal<SitemapDocument>;
  expansion: MaybeSignal<SitemapRouteExpansion | null>;
  selectedId: MaybeSignal<string | null>;
  onSelect: (nodeId: string) => void;
  onEdit: (menu: "primary" | "footer", command: { kind: "put"; item: SitemapNavigationItem; index: number } | { kind: "remove"; id: string }) => void;
  onDraft?: (menu: "primary" | "footer", itemId: string, patch: SitemapperNavigationPatch) => void;
  onFlush?: () => void;
  notice?: LiveChild;
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

export function NavigationPane({ document: documentInput, expansion: expansionInput, selectedId: selectedInput, onSelect, onEdit, onDraft, onFlush, notice }: NavigationPaneProps): Child {
  const document = toSignal(documentInput);
  const expansion = toSignal(expansionInput);
  const selectedId = toSignal(selectedInput);
  const routes = computed(() => expansion.value?.routes ?? []);
  const drafts: Record<string, string> = {};
  const externalUrl = signal("");
  const externalError = signal<string | null>(null);
  const idFactory = createUuidIdFactory();

  const routeByKey = derive(() => [routes.value] as const, (list) => new Map(list.map((route) => [routeIdentity(route), route])));
  const navigationResolution = derive(() => [document.value.navigation, routes.value] as const, resolveSitemapNavigation);
  const firstRoute = computed(() => routes.value[0]);

  function updateItem(menu: Menu, item: SitemapNavigationItem, patch: Partial<SitemapNavigationItem>): void {
    const current = document.value.navigation[menu].findIndex((candidate) => candidate.id === item.id);
    if (current < 0) return;
    onEdit(menu, { kind: "put", item: { ...item, ...patch }, index: current });
  }

  function commitText(menu: Menu, item: SitemapNavigationItem, field: "label" | "url"): void {
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

  function addRoute(menu: Menu): void {
    const route = firstRoute.value;
    if (!route) return;
    const item: SitemapNavigationItem = { id: idFactory("navigation"), label: route.displayTitle, visible: true, destination: destinationForRoute(route) };
    onEdit(menu, { kind: "put", item, index: document.value.navigation[menu].length });
  }

  function addExternal(menu: Menu): void {
    const url = externalUrl.value;
    if (!safeNavigationUrl(url)) {
      externalError.value = "Use a complete http(s) URL without credentials.";
      return;
    }
    const item: SitemapNavigationItem = { id: idFactory("navigation"), label: url, visible: true, destination: { kind: "external", url } };
    onEdit(menu, { kind: "put", item, index: document.value.navigation[menu].length });
    externalUrl.value = "";
    externalError.value = null;
  }

  /** One menu row, kept by item id so a focused label survives the edits it makes. */
  function NavigationItem({ menu, item, index }: { menu: Menu; item: ReadonlySignal<SitemapNavigationItem>; index: ReadonlySignal<number> }): Child {
    const id = item.value.id;
    const labelKey = `${menu}:${id}:label`;
    const urlKey = `${menu}:${id}:url`;
    const label = computed(() => item.value.label);
    const labelModel = followDraft(labelKey, () => item.value.label);
    const destinationValue = computed(() => destinationKey(item.value.destination, routes.value));
    const selectedRoute = computed(() => item.value.destination.kind === "route" ? routeByKey.value.get(destinationValue.value) : undefined);
    const diagnostic = computed(() => itemDiagnostic(item.value, menu, navigationResolution.value.diagnostics));
    const isExternal = computed(() => item.value.destination.kind === "external");
    // The destination select is rebuilt when its options change.
    const destinationOptions = computed(() => `${isExternal.value}|${destinationValue.value === "stale"}|${routes.value.map((route) => `${routeIdentity(route)}\u0000${routeTitle(route)}`).join("\u0001")}`);
    return (
      <li class="sg-sitemapper-navigation__item">
        <div class="sg-sitemapper-navigation__row">
          <span class="sg-sitemapper-navigation__order" aria-label={computed(() => `Menu position ${index.value + 1}`)}>{computed(() => String(index.value + 1))}</span>
          <Input
            size="sm"
            aria-label={`${menu} menu label for ${id}`}
            modelValue={labelModel}
            on:input={(event) => {
              const value = event.currentTarget.value;
              drafts[labelKey] = value;
              onDraft?.(menu, id, { label: value });
            }}
            on:blur={() => onDraft ? onFlush?.() : commitText(menu, item.value, "label")}
          />
          <Rebuild value={label}>{(current) => (
            <Checkbox
              checked={computed(() => item.value.visible)}
              aria-label={`${current} visible`}
              onCheckedChange={(visible) => updateItem(menu, item.value, { visible })}
            />
          )}</Rebuild>
          <Button size="xs" variant="ghost" disabled={computed(() => index.value === 0)} aria-label={computed(() => `Move ${label.value} up`)} on:click={() => {
            const current = item.value, at = index.value;
            onEdit(menu, { kind: "remove", id: current.id });
            onEdit(menu, { kind: "put", item: current, index: at - 1 });
          }}>↑</Button>
          <Button size="xs" variant="ghost" disabled={computed(() => index.value === document.value.navigation[menu].length - 1)} aria-label={computed(() => `Move ${label.value} down`)} on:click={() => {
            const current = item.value, at = index.value;
            onEdit(menu, { kind: "remove", id: current.id });
            onEdit(menu, { kind: "put", item: current, index: at + 1 });
          }}>↓</Button>
          <Button size="xs" variant="ghost" aria-label={computed(() => `Remove ${label.value}`)} on:click={() => onEdit(menu, { kind: "remove", id })}>Remove</Button>
        </div>
        <div class="sg-sitemapper-navigation__destination">
          <Field label="Destination">{(field) => (
            <Keyed value={destinationOptions} by={(key) => key}>{() => {
              const current = item.value;
              const value = destinationValue.value;
              const model = signal(value);
              return (
                <Select
                  size="sm"
                  field={field}
                  aria-label={computed(() => `${label.value} destination`)}
                  modelValue={model}
                  disabled={computed(() => expansion.value === null && item.value.destination.kind === "route")}
                  on:change={(event) => {
                    const next = event.currentTarget.value;
                    if (next === "external") return;
                    const route = routeByKey.value.get(next);
                    if (route) updateItem(menu, item.value, { destination: destinationForRoute(route) });
                    else model.value = destinationValue.value;
                  }}
                >
                  {current.destination.kind === "external" ? <option value="external">External link</option> : null}
                  {value === "stale" ? <option value="stale">Stale route selection</option> : null}
                  {routes.value.map((route) => <option key={routeIdentity(route)} value={routeIdentity(route)}>{routeTitle(route)}</option>)}
                </Select>
              );
            }}</Keyed>
          )}</Field>
          <Show when={isExternal}>{() => {
            const urlModel = followDraft(urlKey, () => item.value.destination.kind === "external" ? item.value.destination.url : "");
            return (
              <Input
                size="sm"
                aria-label={computed(() => `${label.value} external URL`)}
                modelValue={urlModel}
                on:input={(event) => {
                  const value = event.currentTarget.value;
                  drafts[urlKey] = value;
                  onDraft?.(menu, id, { destination: { kind: "external", url: value } });
                }}
                on:blur={() => onDraft ? onFlush?.() : commitText(menu, item.value, "url")}
              />
            );
          }}</Show>
          <Show when={computed(() => !isExternal.value)}>{() => (
            <>
              <Rebuild value={selectedRoute}>{(route) => route ? <Button size="xs" variant="ghost" aria-pressed={computed(() => selectedId.value === route.nodeId ? "true" : "false")} on:click={() => onSelect(route.nodeId)}>Inspect page</Button> : null}</Rebuild>
              <Show when={computed(() => { const destination = item.value.destination; return destination.kind === "route" && (destination.entry !== undefined || Boolean(destination.ancestors?.length)); })}>{() => (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={computed(() => expansion.value === null)}
                  on:click={() => { const current = item.value; updateItem(menu, current, { destination: { kind: "route", nodeId: current.destination.kind === "route" ? current.destination.nodeId : "" } }); }}
                >Clear generated selection</Button>
              )}</Show>
            </>
          )}</Show>
        </div>
        <Show when={computed(() => diagnostic.value !== null)}>{() => <p class="sg-sitemapper-navigation__diagnostic" role="alert">{computed(() => diagnostic.value ?? "")}</p>}</Show>
      </li>
    );
  }

  /** The typed draft wins over the stored value until the stored value moves on. */
  function followDraft(key: string, stored: () => string) {
    const model = followModel(stored);
    if (drafts[key] !== undefined) model.value = drafts[key]!;
    return model;
  }

  function renderMenu(menu: Menu, label: string): Child {
    const items = computed(() => document.value.navigation[menu]);
    return (
      <PaneSection title={label} action={<Button size="xs" variant="ghost" disabled={computed(() => !firstRoute.value)} on:click={() => addRoute(menu)}>Add route</Button>}>
        <ol class="sg-sitemapper-navigation__list">
          <For each={items} by={(item) => item.id}>{(item, index) => <NavigationItem menu={menu} item={item} index={index} />}</For>
        </ol>
        <Show when={computed(() => items.value.length === 0)}>{() => <p class="sg-sitemapper-navigation__empty">No menu items. Add a real route or external destination.</p>}</Show>
      </PaneSection>
    );
  }

  return (
    <Pane variant="canvas" label="Navigation" class="sg-sitemapper-main sg-sitemapper-navigation">
      <PaneHeader title="Navigation" count={computed(() => document.value.navigation.primary.length + document.value.navigation.footer.length)} />
      <PaneBody class="sg-sitemapper-main__body">
        <div class="sg-sitemapper-main__notice">{liveSlot(notice)}</div>
        <div class="sg-sitemapper-navigation__body">
          {renderMenu("primary", "Primary menu")}
          {renderMenu("footer", "Footer menu")}
          <PaneSection title="External destination">
            <Field label="URL" help="Only safe http(s) URLs are accepted.">
              {(field) => <Input size="sm" field={field} modelValue={externalUrl} aria-label="New external URL" />}
            </Field>
            <Show when={computed(() => externalError.value !== null)}>{() => <p class="sg-sitemapper-navigation__diagnostic" role="alert">{computed(() => externalError.value ?? "")}</p>}</Show>
            <div class="sg-sitemapper-navigation__add-external">
              <Button size="sm" variant="ghost" disabled={computed(() => !safeNavigationUrl(externalUrl.value))} on:click={() => { addExternal("primary"); }}>Add to primary</Button>
              <Button size="sm" variant="ghost" disabled={computed(() => !safeNavigationUrl(externalUrl.value))} on:click={() => { addExternal("footer"); }}>Add to footer</Button>
            </div>
          </PaneSection>
          <Show when={computed(() => expansion.value === null)}>{() => <p class="sg-sitemapper-navigation__empty" role="status">Route destinations are unavailable until the Mapping catalog is ready.</p>}</Show>
        </div>
      </PaneBody>
    </Pane>
  );
}

export default NavigationPane;
