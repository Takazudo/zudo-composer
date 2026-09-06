"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { SitemapperIcon } from "../../../../components/icons";
import { Button, EmptyState, SegmentedControl } from "../../../../components/ui";
import type { SitemapDocument, SitemapNode as SitemapNodeModel } from "../../../../sitemapper/model";
import SitemapConnectors from "./connectors";
import {
  buildLogicalTree,
  DESKTOP_MEDIA_QUERY,
  layoutSitemap,
  NODE_MIN_HEIGHT,
  type CanvasLayoutMode,
  type NodeHeights,
} from "./layout";
import type { PageSourceLabels } from "./page-source";
import SitemapNode from "./sitemap-node";

export const MIN_CANVAS_ZOOM = 0.4;
export const MAX_CANVAS_ZOOM = 1.5;

export type CanvasLayoutPreference = "auto" | CanvasLayoutMode;

export interface SitemapCanvasProps {
  document: SitemapDocument;
  /** Authored route per page id. */
  routes: ReadonlyMap<string, string>;
  sources: PageSourceLabels;
  selectedId: string | null;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onSelect: (id: string) => void;
  onAddChild: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateRoot: () => void;
  /** Auto follows the responsive seam; the other choices remain author-controlled. */
  layoutPreference?: CanvasLayoutPreference;
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

function sameMeasurements(previous: Measurements, width: number, height: number, heights: ReadonlyMap<string, number>): boolean {
  if (previous.viewportWidth !== width || previous.viewportHeight !== height || previous.heights.size !== heights.size) return false;
  for (const [id, height] of heights) {
    if (previous.heights.get(id) !== height) return false;
  }
  return true;
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

export function SitemapCanvas({
  document,
  routes,
  sources,
  selectedId,
  zoom,
  onZoomChange,
  onSelect,
  onAddChild,
  onDuplicate,
  onDelete,
  onCreateRoot,
  layoutPreference = "auto",
  onLayoutPreferenceChange,
  class: className,
}: SitemapCanvasProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const frameRef = useRef<number | null>(null);
  const [measurements, setMeasurements] = useState<Measurements>({ viewportWidth: 0, viewportHeight: 0, heights: new Map() });
  const [mediaLayoutMode, setMediaLayoutMode] = useState<CanvasLayoutMode>(() => modeFromMediaQuery(
    typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(DESKTOP_MEDIA_QUERY) : undefined,
  ));
  const layoutMode: CanvasLayoutMode = layoutPreference === "auto" ? mediaLayoutMode : layoutPreference;
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);

  // The document-reference boundary is intentional: commands preserve the
  // reference for no-ops and replace it for real mutations.
  const logicalTree = useMemo(() => buildLogicalTree(document), [document]);
  const nodesById = useMemo(() => nodeMap(document), [document]);
  const rootId = document.root[0]?.id ?? null;
  const layout = useMemo(() => document.root.length === 0
    ? null
    : layoutSitemap(logicalTree, measurements.heights, measurements.viewportWidth, layoutMode),
  [document, layoutMode, logicalTree, measurements]);

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return undefined;
    const query = globalThis.matchMedia(DESKTOP_MEDIA_QUERY);
    const updateMode = (): void => setMediaLayoutMode(modeFromMediaQuery(query));
    updateMode();
    query.addEventListener("change", updateMode);
    return () => query.removeEventListener("change", updateMode);
  }, []);

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    // `offsetHeight` rather than `getBoundingClientRect()`: the stage carries a
    // zoom transform, and a transformed rect would feed a scaled height back
    // into the layout that produced it.
    const viewportWidth = scroller.clientWidth;
    const viewportHeight = scroller.clientHeight;
    const heights = new Map<string, number>();
    for (const logical of logicalTree.nodes) {
      const element = nodeRefs.current.get(logical.node.id);
      if (element) heights.set(logical.node.id, Math.max(NODE_MIN_HEIGHT, element.offsetHeight));
    }
    setMeasurements((previous) => sameMeasurements(previous, viewportWidth, viewportHeight, heights)
      ? previous
      : { viewportWidth, viewportHeight, heights });
  }, [logicalTree]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    if (document.root.length === 0) return undefined;
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(scheduleMeasure);
    if (scrollRef.current) observer.observe(scrollRef.current);
    for (const element of nodeRefs.current.values()) observer.observe(element);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [document, logicalTree, measure, scheduleMeasure]);

  const centerOnSelection = useCallback(() => {
    const scroller = scrollRef.current;
    const element = selectedId ? nodeRefs.current.get(selectedId) : undefined;
    if (!scroller || !element) return;
    scroller.scrollLeft = Math.max(0, (element.offsetLeft + element.offsetWidth / 2) * zoom - scroller.clientWidth / 2);
    scroller.scrollTop = Math.max(0, (element.offsetTop + element.offsetHeight / 2) * zoom - scroller.clientHeight / 2);
  }, [selectedId, zoom]);

  useEffect(() => {
    if (!selectedId) return;
    nodeRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId, layout]);

  const fit = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || !layout || layout.width === 0) return;
    const nextZoom = fitCanvasZoom(scroller.clientWidth, scroller.clientHeight, layout.width, layout.height);
    onZoomChange(nextZoom);
    requestAnimationFrame(() => {
      const current = scrollRef.current;
      if (!current) return;
      current.scrollLeft = 0;
      current.scrollTop = 0;
    });
  }, [layout, onZoomChange]);

  const beginPan = useCallback((event: PointerEvent): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button,a,input,textarea,select,[role=group],[role=menu],[data-sg-pan-disabled=\"true\"]")) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    scroller.setPointerCapture?.(event.pointerId);
  }, []);

  const movePan = useCallback((event: PointerEvent): void => {
    const pan = panRef.current;
    const scroller = scrollRef.current;
    if (!pan || !scroller || pan.pointerId !== event.pointerId) return;
    scroller.scrollLeft = pan.left - (event.clientX - pan.x);
    scroller.scrollTop = pan.top - (event.clientY - pan.y);
  }, []);

  const endPan = useCallback((event: PointerEvent): void => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    scrollRef.current?.releasePointerCapture?.(event.pointerId);
    panRef.current = null;
  }, []);

  if (document.root.length === 0) {
    return (
      <div class={`sg-sitemapper-canvas${className ? ` ${className}` : ""}`}>
        <EmptyState
          icon={SitemapperIcon}
          title="No pages yet"
          description="Create the Home page to start mapping this site."
          action={<Button variant="primary" onClick={onCreateRoot}>Create Home page</Button>}
        />
      </div>
    );
  }

  return (
    <div class={`sg-sitemapper-canvas${className ? ` ${className}` : ""}`}>
      <div class="sg-sitemapper-canvas__controls">
        <div class="cms-seg cms-seg--sm" role="group" aria-label="Canvas view controls">
          <button type="button" class="cms-seg__option" onClick={fit}>Fit</button>
          <button type="button" class="cms-seg__option" disabled={selectedId === null} onClick={centerOnSelection}>Center on selection</button>
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
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        {layout ? (
          <div
            class="sg-sitemapper-canvas__viewport"
            style={{
              width: `${Math.max(layout.width * zoom, measurements.viewportWidth)}px`,
              height: `${Math.max(layout.height * zoom, measurements.viewportHeight)}px`,
            }}
          >
            <div
              class="sg-sitemapper-canvas__stage"
              data-sg-layout={layout.mode}
              style={{
                width: `${layout.width}px`,
                height: `${layout.height}px`,
                transform: `scale(${zoom})`,
                left: `${canvasStageMargin(Math.max(layout.width * zoom, measurements.viewportWidth), layout.width, zoom)}px`,
                top: `${canvasStageMargin(Math.max(layout.height * zoom, measurements.viewportHeight), layout.height, zoom)}px`,
              }}
            >
              <SitemapConnectors layout={layout} />
              {layout.nodes.map((rectangle) => {
                const node = nodesById.get(rectangle.id);
                if (!node) return null;
                return (
                  <SitemapNode
                    key={node.id}
                    node={node}
                    route={routes.get(node.id) ?? "/"}
                    source={sources.get(node.id)}
                    rectangle={rectangle}
                    selected={selectedId === node.id}
                    isRoot={node.id === rootId}
                    nodeRef={(element) => {
                      if (element) nodeRefs.current.set(node.id, element);
                      else nodeRefs.current.delete(node.id);
                    }}
                    onSelect={onSelect}
                    onAddChild={onAddChild}
                    onDuplicate={onDuplicate}
                    onDelete={onDelete}
                  />
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default SitemapCanvas;
