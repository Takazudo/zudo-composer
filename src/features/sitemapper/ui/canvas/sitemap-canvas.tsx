import { computed, For, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { SitemapperIcon } from "../../../../components/icons";
import { toSignal, type MaybeSignal } from "../../../../components/reactive";
import { Button, EmptyState, SegmentedControl } from "../../../../components/ui";
import type { SitemapDocument, SitemapNode as SitemapNodeModel } from "../../../../sitemapper/model";
import SitemapConnectors from "./connectors";
import {
  buildLogicalTree,
  DESKTOP_MEDIA_QUERY,
  layoutSitemap,
  NODE_MIN_HEIGHT,
  type CanvasLayout,
  type CanvasLayoutMode,
  type NodeHeights,
} from "./layout";
import type { PageSourceLabels } from "./page-source";
import SitemapNode from "./sitemap-node";

export const MIN_CANVAS_ZOOM = 0.4;
export const MAX_CANVAS_ZOOM = 1.5;

export type CanvasLayoutPreference = "auto" | CanvasLayoutMode;

export interface SitemapCanvasProps {
  document: MaybeSignal<SitemapDocument>;
  /** Authored route per page id. */
  routes: MaybeSignal<ReadonlyMap<string, string>>;
  sources: MaybeSignal<PageSourceLabels>;
  selectedId: MaybeSignal<string | null>;
  zoom: MaybeSignal<number>;
  onZoomChange: (zoom: number) => void;
  onSelect: (id: string) => void;
  onAddChild: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateRoot: () => void;
  /** Auto follows the responsive seam; the other choices remain author-controlled. */
  layoutPreference?: MaybeSignal<CanvasLayoutPreference>;
  onLayoutPreferenceChange?: (preference: CanvasLayoutPreference) => void;
  class?: string;
}

interface Measurements {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly heights: NodeHeights;
}

function modeFromMediaQuery(query: Pick<MediaQueryList, "matches"> | undefined): CanvasLayoutMode {
  return query?.matches ? "cluster" : "outline";
}

function sameHeights(previous: NodeHeights, heights: NodeHeights): boolean {
  if (previous.size !== heights.size) return false;
  for (const [id, height] of heights) {
    if (previous.get(id) !== height) return false;
  }
  return true;
}

function contentBox(scroller: HTMLElement): { width: number; height: number } {
  const style = getComputedStyle(scroller);
  const pixels = (value: string): number => Number.parseFloat(value) || 0;
  // client dimensions include padding. Feeding that padding back into the
  // child viewport grows an intrinsically sized scroller on every observation.
  return {
    width: Math.max(0, scroller.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight)),
    height: Math.max(0, scroller.clientHeight - pixels(style.paddingTop) - pixels(style.paddingBottom)),
  };
}

function nodeMap(document: SitemapDocument): ReadonlyMap<string, SitemapNodeModel> {
  const result = new Map<string, SitemapNodeModel>();
  const visit = (node: SitemapNodeModel): void => {
    result.set(node.id, node);
    node.children.forEach(visit);
  };
  document.root.forEach(visit);
  return result;
}

export function clampCanvasZoom(zoom: number): number {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, Math.round(zoom * 100) / 100));
}

export function fitCanvasZoom(viewportWidth: number, viewportHeight: number, contentWidth: number, contentHeight: number): number {
  const widthScale = contentWidth > 0 ? viewportWidth / contentWidth : MAX_CANVAS_ZOOM;
  const heightScale = contentHeight > 0 ? viewportHeight / contentHeight : MAX_CANVAS_ZOOM;
  return clampCanvasZoom(Math.min(widthScale, heightScale));
}

export function canvasStageMargin(viewportSize: number, contentSize: number, zoom: number): number {
  if (zoom <= 0) return 0;
  // The stage is positioned outside its own scale transform, so this is a
  // visual pixel margin. Dividing by zoom would double it at 50%.
  return Math.max(0, (viewportSize - contentSize * zoom) / 2);
}

export function SitemapCanvas(props: SitemapCanvasProps): Child {
  const document = toSignal(props.document);
  const className = props.class;
  return (
    <div class={`sg-sitemapper-canvas${className ? ` ${className}` : ""}`}>
      <Show when={computed(() => document.value.root.length === 0)}>{() => (
        <EmptyState
          icon={SitemapperIcon}
          title="No pages yet"
          description="Create the Home page to start mapping this site."
          action={<Button variant="primary" on:click={() => props.onCreateRoot()}>Create Home page</Button>}
        />
      )}</Show>
      <Show when={computed(() => document.value.root.length > 0)}>{() => <CanvasSurface {...props} document={document} />}</Show>
    </div>
  );
}

function CanvasSurface({
  document,
  routes: routesInput,
  sources: sourcesInput,
  selectedId: selectedInput,
  zoom: zoomInput,
  onZoomChange,
  onSelect,
  onAddChild,
  onDuplicate,
  onDelete,
  layoutPreference: preferenceInput = "auto",
  onLayoutPreferenceChange,
}: SitemapCanvasProps & { document: ReadonlySignal<SitemapDocument> }): Child {
  const scope = getScope();
  const routes = toSignal(routesInput);
  const sources = toSignal(sourcesInput);
  const selectedId = toSignal(selectedInput);
  const zoom = toSignal(zoomInput);
  const layoutPreference = toSignal(preferenceInput);
  const scrollRef: Ref<HTMLDivElement> = { current: null };
  const nodeElements = new Map<string, HTMLDivElement>();
  let frame: number | null = null;
  let observer: ResizeObserver | null = null;
  let active = false;
  const measurements = signal<Measurements>({ viewportWidth: 0, viewportHeight: 0, heights: new Map() });
  const mediaLayoutMode = signal<CanvasLayoutMode>(modeFromMediaQuery(
    typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(DESKTOP_MEDIA_QUERY) : undefined,
  ));
  const layoutMode = computed<CanvasLayoutMode>(() => layoutPreference.value === "auto" ? mediaLayoutMode.value : layoutPreference.value);
  let pan: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;

  // The document-reference boundary is intentional: commands preserve the
  // reference for no-ops and replace it for real mutations.
  const logicalTree = computed(() => buildLogicalTree(document.value));
  const nodesById = computed(() => nodeMap(document.value));
  const rootId = computed(() => document.value.root[0]?.id ?? null);
  const layout = computed<CanvasLayout>(() => layoutSitemap(logicalTree.value, measurements.value.heights, measurements.value.viewportWidth, layoutMode.value));
  const placed = computed(() => layout.value.nodes.filter((rectangle) => nodesById.value.has(rectangle.id)));

  scope.onActivate(() => {
    if (typeof globalThis.matchMedia !== "function") return undefined;
    const query = globalThis.matchMedia(DESKTOP_MEDIA_QUERY);
    const updateMode = (): void => { mediaLayoutMode.value = modeFromMediaQuery(query); };
    updateMode();
    query.addEventListener("change", updateMode);
    return () => query.removeEventListener("change", updateMode);
  });

  const measure = (): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    // `offsetHeight` rather than `getBoundingClientRect()`: the stage carries a
    // zoom transform, and a transformed rect would feed a scaled height back
    // into the layout that produced it.
    const { width: viewportWidth, height: viewportHeight } = contentBox(scroller);
    const heights = new Map<string, number>();
    for (const logical of logicalTree.value.nodes) {
      const element = nodeElements.get(logical.node.id);
      if (element) heights.set(logical.node.id, Math.max(NODE_MIN_HEIGHT, element.offsetHeight));
    }
    const previous = measurements.value;
    const stableHeights = sameHeights(previous.heights, heights) ? previous.heights : heights;
    if (previous.viewportWidth === viewportWidth && previous.viewportHeight === viewportHeight && previous.heights === stableHeights) return;
    measurements.value = { viewportWidth, viewportHeight, heights: stableHeights };
  };

  const scheduleMeasure = (): void => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      measure();
    });
  };

  // Nodes activate before this surface does, so the first pass observes every
  // node at once; a node added later joins the observer and asks for one pass.
  const nodeElement = (id: string, element: HTMLDivElement | null): void => {
    const previous = nodeElements.get(id);
    if (previous && previous !== element) observer?.unobserve(previous);
    if (element) nodeElements.set(id, element);
    else nodeElements.delete(id);
    if (element) observer?.observe(element);
    if (active) scheduleMeasure();
  };

  scope.onActivate(() => {
    active = true;
    measure();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleMeasure);
      if (scrollRef.current) observer.observe(scrollRef.current);
      for (const element of nodeElements.values()) observer.observe(element);
    }
    return () => {
      active = false;
      observer?.disconnect();
      observer = null;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };
  });

  // A changed document re-measures the nodes it kept, as the layout pass did.
  let measuredTree = logicalTree.value;
  scope.effect(() => {
    const tree = logicalTree.value;
    if (tree === measuredTree) return;
    measuredTree = tree;
    if (active) measure();
  });

  const centerOnSelection = (): void => {
    const scroller = scrollRef.current;
    const selected = selectedId.value;
    const element = selected ? nodeElements.get(selected) : undefined;
    if (!scroller || !element) return;
    const current = layout.value;
    const scale = zoom.value;
    const { width, height } = contentBox(scroller);
    const left = canvasStageMargin(measurements.value.viewportWidth, current.width, scale);
    const top = canvasStageMargin(measurements.value.viewportHeight, current.height, scale);
    scroller.scrollLeft = Math.max(0, left + (element.offsetLeft + element.offsetWidth / 2) * scale - width / 2);
    scroller.scrollTop = Math.max(0, top + (element.offsetTop + element.offsetHeight / 2) * scale - height / 2);
  };

  /**
   * The selection this canvas has already brought into view.
   *
   * A layout recomputation is a measurement settling — fonts arriving, panes
   * sizing, the graph finishing its first render — and not a request to scroll.
   * Re-asserting the reveal on each one scrolled the selected node's ancestors
   * repeatedly (measured at up to nine times for a single selection), which
   * pulls the page back under whoever is working in it and moves every other
   * row on the route while it happens. `layout` stays a dependency so a
   * selection made before its node exists is still revealed by the first layout
   * that has it — but once, not on every later measurement.
   */
  let revealed: string | null = null;
  scope.effect(() => {
    const selected = selectedId.value;
    void layout.value;
    if (!selected) { revealed = null; return; }
    if (revealed === selected) return;
    const element = nodeElements.get(selected);
    if (!element) return;
    revealed = selected;
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });

  const fit = (): void => {
    const scroller = scrollRef.current;
    const current = layout.value;
    if (!scroller || current.width === 0) return;
    const { width, height } = contentBox(scroller);
    const nextZoom = fitCanvasZoom(width, height, current.width, current.height);
    onZoomChange(nextZoom);
    requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (!element) return;
      element.scrollLeft = 0;
      element.scrollTop = 0;
    });
  };

  const beginPan = (event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button,a,input,textarea,select,[role=group],[role=menu],[data-sg-pan-disabled=\"true\"]")) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    scroller.setPointerCapture?.(event.pointerId);
  };

  const movePan = (event: PointerEvent): void => {
    const scroller = scrollRef.current;
    if (!pan || !scroller || pan.pointerId !== event.pointerId) return;
    scroller.scrollLeft = pan.left - (event.clientX - pan.x);
    scroller.scrollTop = pan.top - (event.clientY - pan.y);
  };

  const endPan = (event: PointerEvent): void => {
    if (pan?.pointerId !== event.pointerId) return;
    scrollRef.current?.releasePointerCapture?.(event.pointerId);
    pan = null;
  };

  const viewportWidth = computed(() => Math.max(layout.value.width * zoom.value, measurements.value.viewportWidth));
  const viewportHeight = computed(() => Math.max(layout.value.height * zoom.value, measurements.value.viewportHeight));

  return (
    <>
      <div class="sg-sitemapper-canvas__controls">
        <div class="cms-seg cms-seg--sm" role="group" aria-label="Canvas view controls">
          <button type="button" class="cms-seg__option" on:click={fit}>Fit</button>
          <button type="button" class="cms-seg__option" disabled={computed(() => selectedId.value === null)} on:click={centerOnSelection}>Center on selection</button>
        </div>
        <SegmentedControl<CanvasLayoutPreference>
          label="Layout"
          size="sm"
          value={layoutPreference}
          onChange={(next) => onLayoutPreferenceChange?.(next)}
          options={[{ value: "auto", label: "Auto" }, { value: "cluster", label: "Cluster" }, { value: "outline", label: "Outline" }]}
        />
      </div>
      <div class="sg-sitemapper-canvas__legend">
        <span><span class="sg-sitemapper-dot sg-sitemapper-dot--ok" />Composition</span>
        <span><span class="sg-sitemapper-dot sg-sitemapper-dot--accent" />Mapping route family</span>
        <span><span class="sg-sitemapper-dot sg-sitemapper-dot--warn" />Unassigned</span>
      </div>
      <div
        ref={scrollRef}
        class="sg-sitemapper-canvas__scroll"
        data-sg-layout-preference={layoutPreference}
        on:pointerdown={beginPan}
        on:pointermove={movePan}
        on:pointerup={endPan}
        on:pointercancel={endPan}
      >
        <div
          class="sg-sitemapper-canvas__viewport"
          style={computed(() => ({
            width: `${viewportWidth.value}px`,
            height: `${viewportHeight.value}px`,
          }))}
        >
          <div
            class="sg-sitemapper-canvas__stage"
            data-sg-layout={computed(() => layout.value.mode)}
            style={computed(() => ({
              width: `${layout.value.width}px`,
              height: `${layout.value.height}px`,
              transform: `scale(${zoom.value})`,
              left: `${canvasStageMargin(viewportWidth.value, layout.value.width, zoom.value)}px`,
              top: `${canvasStageMargin(viewportHeight.value, layout.value.height, zoom.value)}px`,
            }))}
          >
            <SitemapConnectors layout={layout} />
            <For each={placed} by={(rectangle) => rectangle.id}>{(rectangle) => {
              const id = rectangle.value.id;
              // Kept across the one pass in which a removed page is still listed.
              let last = nodesById.value.get(id)!;
              return (
                <SitemapNode
                  id={id}
                  node={computed(() => { last = nodesById.value.get(id) ?? last; return last; })}
                  route={computed(() => routes.value.get(id) ?? "/")}
                  source={computed(() => sources.value.get(id))}
                  rectangle={rectangle}
                  selected={computed(() => selectedId.value === id)}
                  isRoot={computed(() => rootId.value === id)}
                  onElement={nodeElement}
                  onSelect={onSelect}
                  onAddChild={onAddChild}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                />
              );
            }}</For>
          </div>
        </div>
      </div>
    </>
  );
}

export default SitemapCanvas;
