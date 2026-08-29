"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
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
import SitemapNode from "./sitemap-node";

export interface SitemapCanvasProps {
  document: SitemapDocument;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (id: string) => void;
  onAddSibling: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateRoot: () => void;
  class?: string;
}

interface Measurements {
  readonly viewportWidth: number;
  readonly heights: NodeHeights;
}

function modeFromMediaQuery(query: Pick<MediaQueryList, "matches"> | undefined): CanvasLayoutMode {
  return query?.matches ? "cluster" : "outline";
}

function sameMeasurements(previous: Measurements, width: number, heights: ReadonlyMap<string, number>): boolean {
  if (previous.viewportWidth !== width || previous.heights.size !== heights.size) return false;
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

export function SitemapCanvas({
  document,
  selectedId,
  onSelect,
  onAddChild,
  onAddSibling,
  onDuplicate,
  onDelete,
  onCreateRoot,
  class: className,
}: SitemapCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const frameRef = useRef<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Measurements>({ viewportWidth: 0, heights: new Map() });
  const [layoutMode, setLayoutMode] = useState<CanvasLayoutMode>(() => modeFromMediaQuery(
    typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(DESKTOP_MEDIA_QUERY) : undefined,
  ));

  // The document-reference boundary is intentional: commands preserve the
  // reference for no-ops and replace it for real mutations.
  const logicalTree = useMemo(() => buildLogicalTree(document), [document]);
  const nodesById = useMemo(() => nodeMap(document), [document]);
  const layout = useMemo(() => document.root.length === 0
    ? null
    : layoutSitemap(logicalTree, measurements.heights, measurements.viewportWidth, layoutMode),
  [document, layoutMode, logicalTree, measurements]);

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return undefined;
    const query = globalThis.matchMedia(DESKTOP_MEDIA_QUERY);
    const updateMode = (): void => setLayoutMode(modeFromMediaQuery(query));
    updateMode();
    query.addEventListener("change", updateMode);
    return () => query.removeEventListener("change", updateMode);
  }, []);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Complete every DOM read before the single state write. React applies the
    // resulting node-position writes in the following render.
    const viewportWidth = canvas.clientWidth;
    const heights = new Map<string, number>();
    for (const logical of logicalTree.nodes) {
      const element = nodeRefs.current.get(logical.node.id);
      if (element) heights.set(logical.node.id, Math.max(NODE_MIN_HEIGHT, element.getBoundingClientRect().height));
    }
    setMeasurements((previous) => sameMeasurements(previous, viewportWidth, heights)
      ? previous
      : { viewportWidth, heights });
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
    if (canvasRef.current) observer.observe(canvasRef.current);
    for (const element of nodeRefs.current.values()) observer.observe(element);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [document, logicalTree, measure, scheduleMeasure]);

  useEffect(() => {
    if (!selectedId) return;
    nodeRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedId, layout]);

  const selected = selectedId ? nodesById.get(selectedId) : undefined;
  const selectedIsRoot = selectedId === document.root[0]?.id;
  const rootHelpPrefix = selected ? `${selected.id}-tray` : "selected-tray";

  if (document.root.length === 0) {
    return (
      <section ref={canvasRef} class={`sg-sitemapper-canvas${className ? ` ${className}` : ""}`} aria-label="Sitemap canvas">
        <div class="sg-sitemapper-canvas__empty">
          <h2>No sitemap yet</h2>
          <p>Create a Home page to start mapping this site.</p>
          <button type="button" onClick={onCreateRoot}>Create Home page</button>
        </div>
      </section>
    );
  }

  // Non-empty documents always produce measured or provisional geometry.
  if (!layout) return <section class="sg-sitemapper-canvas" aria-label="Sitemap canvas" />;

  return (
    <section ref={canvasRef} class={`sg-sitemapper-canvas${className ? ` ${className}` : ""}`} aria-label="Sitemap canvas">
      <div
        class="sg-sitemapper-canvas__stage"
        data-sg-layout={layout.mode}
        style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
      >
        <SitemapConnectors layout={layout} />
        {layout.nodes.map((rectangle) => {
          const node = nodesById.get(rectangle.id);
          if (!node) return null;
          return (
            <SitemapNode
              key={node.id}
              node={node}
              rectangle={rectangle}
              selected={selectedId === node.id}
              menuOpen={openMenuId === node.id}
              nodeRef={(element) => {
                if (element) nodeRefs.current.set(node.id, element);
                else nodeRefs.current.delete(node.id);
              }}
              onSelect={onSelect}
              onToggleMenu={(id) => setOpenMenuId((current) => current === id ? null : id)}
              onAddChild={onAddChild}
              onAddSibling={onAddSibling}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          );
        })}
      </div>
      {selected && (
        <div class="sg-sitemapper-canvas__action-tray" aria-label={`Actions for ${selected.title}`}>
          <button type="button" onClick={() => onAddChild(selected.id)}>Add child</button>
          <button type="button" disabled={selectedIsRoot} aria-describedby={selectedIsRoot ? `${rootHelpPrefix}-sibling-help` : undefined} onClick={() => onAddSibling(selected.id)}>Add sibling</button>
          <button type="button" onClick={() => onDuplicate(selected.id)}>Duplicate</button>
          <button type="button" class="sg-sitemapper-danger" disabled={selectedIsRoot} aria-describedby={selectedIsRoot ? `${rootHelpPrefix}-delete-help` : undefined} onClick={() => onDelete(selected.id)}>Delete</button>
          {selectedIsRoot && <span id={`${rootHelpPrefix}-sibling-help`} class="sg-sitemapper-sr-only">The root page cannot have a sibling.</span>}
          {selectedIsRoot && <span id={`${rootHelpPrefix}-delete-help`} class="sg-sitemapper-sr-only">The root page cannot be deleted.</span>}
        </div>
      )}
    </section>
  );
}

export default SitemapCanvas;
