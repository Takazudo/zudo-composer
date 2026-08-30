"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { ArrowLeftIcon } from "../../../components/icons";
import type { IdFactory } from "../../../shared";
import type { CompositionCatalog } from "../../../sitemapper/catalog";
import type { SitemapRecord, SitemapStore } from "../../../sitemapper/library";
import type { SitemapNode } from "../../../sitemapper/model";
import { expandSitemapRoutes, type MappingAssignmentCatalog, type SitemapRouteExpansion } from "../../../sitemapper/routes";
import { SitemapperToolbar } from "../chrome/sitemapper-toolbar";
import { SitemapperWorkspace } from "../chrome/sitemapper-workspace";
import { SitemapCanvas } from "../ui/canvas/sitemap-canvas";
import { InspectorPanel } from "../ui/inspector/inspector-panel";
import { SitemapTree } from "../ui/tree/sitemap-tree";
import { useSitemapperController } from "./use-sitemapper-controller";
import { useSitemapperKeyboard } from "./use-sitemapper-keyboard";

export interface SitemapperIntegrationProps {
  record: SitemapRecord;
  store: Pick<SitemapStore, "put">;
  catalog: Pick<CompositionCatalog, "listCompositions" | "resolveComposition">;
  mappingCatalog?: MappingAssignmentCatalog;
  onBack: (record: SitemapRecord) => void | Promise<void>;
  idFactory?: IdFactory;
  now?: () => string;
}

function findNode(nodes: readonly SitemapNode[], id: string | null): SitemapNode | null {
  if (!id) return null;
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findNode(node.children, id);
    if (nested) return nested;
  }
  return null;
}

export function SitemapperIntegration({ record, store, catalog, mappingCatalog, onBack, idFactory, now }: SitemapperIntegrationProps): JSX.Element {
  const controller = useSitemapperController({ record, store, idFactory, now });
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const document = controller.state.document;
  const [routeExpansionState, setRouteExpansionState] = useState<{ document: typeof document; expansion: SitemapRouteExpansion } | null>(null);
  const selectedId = controller.state.selectedId;
  const dispatch = controller.dispatch;
  const selectedNode = useMemo(() => findNode(document.root, selectedId), [document, selectedId]);
  const routeExpansion = routeExpansionState?.document === document ? routeExpansionState.expansion : null;
  useEffect(() => {
    if (!mappingCatalog) { setRouteExpansionState(null); return; }
    let active = true;
    void expandSitemapRoutes({ document, catalog: mappingCatalog.routes }).then((expansion) => {
      if (!active) return;
      setRouteExpansionState({ document, expansion });
    });
    return () => { active = false; };
  }, [document, mappingCatalog]);

  const addChild = useCallback((parentId: string) => { dispatch({ type: "addChild", parentId, title: "Untitled page" }); }, [dispatch]);
  const addSibling = useCallback((pageId: string) => { dispatch({ type: "addSibling", pageId, title: "Untitled page" }); }, [dispatch]);
  const remove = useCallback((pageId: string) => { dispatch({ type: "remove", pageId }); }, [dispatch]);
  const duplicate = useCallback((pageId: string) => { dispatch({ type: "duplicate", pageId }); }, [dispatch]);
  const select = useCallback((pageId: string) => { dispatch({ type: "select", pageId }); }, [dispatch]);
  const escape = useCallback(() => { dispatch({ type: "select", pageId: null }); }, [dispatch]);
  useSitemapperKeyboard({ selectedId, onRemoveSelected: remove, onEscape: escape });

  const back = async (): Promise<void> => {
    setTransitionError(null);
    try {
      controller.flushPropUpdates();
      await controller.flushPersistence();
      const saved = controller.queue.state.draft;
      await controller.queue.close();
      await onBack(saved);
    } catch (reason) {
      setTransitionError(reason instanceof Error ? reason.message : "The Sitemap could not be saved.");
    }
  };

  return (
    <SitemapperWorkspace
      banner={transitionError || controller.lastError ? <p role="alert">{transitionError ?? controller.lastError}</p> : null}
      toolbar={<><button type="button" class="sg-sitemapper-toolbar-button" onClick={() => void back()}><ArrowLeftIcon size="sm" />All sitemaps</button><SitemapperToolbar documentName={document.name} saveStatus={controller.state.saveStatus} onRetrySave={controller.retrySave} /></>}
      tree={<SitemapTree document={document} routeInfo={routeExpansion?.nodes ?? new Map()} selectedId={selectedId} expandedIds={controller.state.expandedIds} onSelect={select} onToggleExpanded={(pageId) => dispatch({ type: "toggleExpanded", pageId })} onAddChild={addChild} onAddSibling={addSibling} onRename={(pageId, title) => dispatch({ type: "updateProps", pageId, patch: { title } })} onDuplicate={duplicate} onDelete={remove} onReorder={(pageId, direction) => dispatch({ type: "reorder", pageId, direction })} />}
      canvas={<SitemapCanvas document={document} routeInfo={routeExpansion?.nodes ?? new Map()} selectedId={selectedId} onSelect={select} onAddChild={addChild} onAddSibling={addSibling} onDuplicate={duplicate} onDelete={remove} onCreateRoot={() => undefined} />}
      inspector={<InspectorPanel selectedId={selectedId} node={selectedNode} catalog={catalog} mappingCatalog={mappingCatalog} routeInfo={selectedId ? routeExpansion?.nodes.get(selectedId) : undefined} onUpdatePropsDebounced={controller.updatePropsDebounced} onFlushPropUpdates={controller.flushPropUpdates} onUpdateComposition={(pageId, composition) => dispatch({ type: "updateProps", pageId, patch: { source: composition ? { kind: "composition", ref: composition } : { kind: "unassigned" } } })} onUpdateSource={(pageId, source) => dispatch({ type: "updateProps", pageId, patch: { source } })} />}
    />
  );
}

export default SitemapperIntegration;
