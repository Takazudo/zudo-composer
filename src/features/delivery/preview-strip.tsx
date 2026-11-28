import { computed, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { Keyed, mountOwned, type OwnedRoot } from "../../runtime";
import { read, toSignal, type MaybeSignal } from "../../components/reactive";
import type { SiteCompiledRoute } from "../../site-project/compiler";
import { HOSTED_DEMO_NOTICE_COPY, HOSTED_DEMO_NOTICE_TITLE } from "./hosted-demo-notice-copy";
import { deliveryRoutePathname, toDeliveryHref, type DeliveryBasePath } from "./routing";
import stripStyles from "./preview-strip.css?inline";

export interface PreviewStripProps {
  label: string;
  basePath: DeliveryBasePath;
  /** Follows in-place navigation when passed as a signal. */
  pathname: MaybeSignal<string>;
  hostedDemo: boolean;
  /** Only a ready build has routes to pick from; every other state omits them. */
  routes?: MaybeSignal<readonly SiteCompiledRoute[] | undefined>;
  /** Working preview only: an editor tab is holding unsaved writes. */
  pending?: MaybeSignal<boolean>;
  /** Working preview only: a re-capture of the working draft is in flight. */
  refreshing?: MaybeSignal<boolean>;
  /** Working preview only: why the last re-capture failed, with the previous render still on screen. */
  error?: MaybeSignal<string | undefined>;
}

export const PREVIEW_PENDING_COPY = "The editor has unsaved changes — this preview updates when they are saved.";
export const PREVIEW_REFRESHING_COPY = "Updating…";

/**
 * A picked page is an in-place navigation, never a reload: the hosted demo's
 * preview document receives its project through a one-use `#demoPreview` token
 * that is consumed and stripped on arrival, so reloading this document would
 * silently drop the authored snapshot and fall back to the bundled public
 * sample. `installVisitorNavigation` owns the `popstate` re-mount for exactly
 * the routes this picker offers.
 */
function pickRoute(href: string): void {
  if (!href || href === window.location.pathname) return;
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

const routeListIds = new WeakMap<readonly SiteCompiledRoute[], number>();
let nextRouteListId = 1;
function routeListKey(routes: readonly SiteCompiledRoute[] | undefined): number {
  if (!routes) return 0;
  let id = routeListIds.get(routes);
  if (id === undefined) { id = nextRouteListId++; routeListIds.set(routes, id); }
  return id;
}

/** One static option list: the select is rebuilt whenever the build's route list changes. */
function RoutePicker({ routes, basePath, current }: { routes: readonly SiteCompiledRoute[]; basePath: DeliveryBasePath; current: ReadonlySignal<string | undefined> }): Child {
  const scope = getScope();
  const hrefs = new Set(routes.map((route) => toDeliveryHref(route.pathname, basePath)));
  const options = routes.map((route) => <option value={toDeliveryHref(route.pathname, basePath)}>{route.displayTitle}</option>);
  const onChange = (event: Event): void => { pickRoute((event.currentTarget as HTMLSelectElement).value); };
  const initial = current.value;
  if (initial === undefined || !hrefs.has(initial)) {
    // No compiled route matches this address, so no option is selected.
    const select: Ref<HTMLSelectElement> = { current: null };
    scope.onActivate(() => { if (select.current) select.current.selectedIndex = -1; });
    return <select ref={select} class="zc-preview-strip__select" on:change={onChange}>{options}</select>;
  }
  const model = signal(initial);
  // Navigation within this route list moves the selection; an address outside
  // it waits for the rebuild that brings its options.
  scope.effect(() => { const next = current.value; if (next !== undefined && hrefs.has(next)) model.value = next; });
  return <select class="zc-preview-strip__select" modelValue={model} on:change={onChange}>{options}</select>;
}

function StripContent({ label, basePath, pathname, hostedDemo, routes, pending, refreshing, error }: PreviewStripProps): Child {
  const path = toSignal(pathname);
  const routeList = computed(() => read(routes));
  // Match through the compiler's own pathname so an equivalent address such as
  // `/site/` still selects the route it resolves to.
  const current = computed(() => {
    const routePath = deliveryRoutePathname(path.value, basePath);
    const match = routeList.value?.find((route) => route.pathname === routePath);
    return match ? toDeliveryHref(match.pathname, basePath) : undefined;
  });
  // Only the working preview reports freshness, and its region stays mounted
  // through every message: a live region added along with its text is not
  // reliably announced. An activated release passes none of these and gets no
  // region at all.
  const reportsFreshness = pending !== undefined || refreshing !== undefined || error !== undefined;
  const message = computed(() => read(error) ?? (read(refreshing) ? PREVIEW_REFRESHING_COPY : read(pending) ? PREVIEW_PENDING_COPY : ""));
  const hasRoutes = computed(() => routeList.value !== undefined);
  return <div class="zc-preview-strip__inner">
    <span class="zc-preview-strip__label">{label}</span>
    <Show when={hasRoutes}>{() => <label class="zc-preview-strip__picker">
      Page
      <Keyed value={routeList} by={routeListKey}>{(list) => list.value ? <RoutePicker routes={list.value} basePath={basePath} current={current} /> : null}</Keyed>
    </label>}</Show>
    {reportsFreshness ? <p class="zc-preview-strip__status" role="status" aria-live="polite">{message}</p> : null}
    {hostedDemo ? <p class="zc-preview-strip__notice"><strong>{HOSTED_DEMO_NOTICE_TITLE}</strong> {HOSTED_DEMO_NOTICE_COPY}</p> : null}
  </div>;
}

/**
 * The only tool-owned UI inside a preview document. Both the host stylesheet
 * and the component pack are untrusted and declare the same token names the
 * editor does, so the strip renders into an open shadow root that carries its
 * own reset and sheet rather than into the site's document tree. The shadow
 * content is its own caller-owned root, owned by this component's scope; the
 * props are passed through as signals, so it follows the delivery state live.
 */
export function PreviewStrip(props: PreviewStripProps): Child {
  const scope = getScope();
  const host: Ref<HTMLDivElement> = { current: null };
  scope.onActivate(() => {
    const node = host.current;
    if (!node) return;
    const shadow = node.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = stripStyles;
    const container = document.createElement("div");
    shadow.append(style, container);
    const root: OwnedRoot = mountOwned(StripContent, { ...props }, { parent: container, name: "PreviewStripContent" });
    return () => { root.stop(); };
  });
  return <div class="zc-preview-strip" ref={host} />;
}
