"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";
import type { IdFactory } from "../../../shared";
import type { CompositionCatalog } from "../../../sitemapper/catalog";
import type { SitemapRecord, SitemapStore } from "../../../sitemapper/library";
import type { SitemapNode } from "../../../sitemapper/model";
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

export function SitemapperIntegration({ record, store, catalog, onBack, idFactory, now }: SitemapperIntegrationProps): JSX.Element {
  const controller = useSitemapperController({ record, store, idFactory, now });
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const document = controller.state.document;
  const selectedId = controller.state.selectedId;
  const dispatch = controller.dispatch;
  const selectedNode = useMemo(() => findNode(document.root, selectedId), [document, selectedId]);

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
      toolbar={<><button type="button" class="sg-sitemapper-toolbar-button" onClick={() => void back()}>All sitemaps</button><SitemapperToolbar documentName={document.name} saveStatus={controller.state.saveStatus} onRetrySave={controller.retrySave} /></>}
      tree={<SitemapTree document={document} selectedId={selectedId} expandedIds={controller.state.expandedIds} onSelect={select} onToggleExpanded={(pageId) => dispatch({ type: "toggleExpanded", pageId })} onAddChild={addChild} onAddSibling={addSibling} onRename={(pageId, title) => dispatch({ type: "updateProps", pageId, patch: { title } })} onDuplicate={duplicate} onDelete={remove} onReorder={(pageId, direction) => dispatch({ type: "reorder", pageId, direction })} />}
      canvas={<SitemapCanvas document={document} selectedId={selectedId} onSelect={select} onAddChild={addChild} onAddSibling={addSibling} onDuplicate={duplicate} onDelete={remove} onCreateRoot={() => undefined} />}
      inspector={<InspectorPanel selectedId={selectedId} node={selectedNode} catalog={catalog} onUpdatePropsDebounced={controller.updatePropsDebounced} onFlushPropUpdates={controller.flushPropUpdates} onUpdateComposition={(pageId, composition) => dispatch({ type: "updateProps", pageId, patch: { composition } })} />}
    />
  );
}

export default SitemapperIntegration;
