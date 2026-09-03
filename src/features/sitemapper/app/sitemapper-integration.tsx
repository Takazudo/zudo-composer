"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useBreadcrumb, type EditorStatus } from "../../../app/chrome-context";
import { EditorBody, EditorChrome, RecordTitle } from "../../../components/editor-chrome";
import { DuplicateIcon, EditIcon, EllipsisIcon, MinusIcon, PlusIcon, TrashIcon } from "../../../components/icons";
import { useLibraryConfirm } from "../../../components/library-page";
import { ConfirmDialog, Menu, MenuItem, MenuSeparator, useMenu } from "../../../components/overlay";
import { Banner, Button, SegmentedControl } from "../../../components/ui";
import { cloneJson, createUuidIdFactory, type IdFactory } from "../../../shared";
import type { CompositionCatalog } from "../../../sitemapper/catalog";
import type { SitemapRecord, SitemapStore } from "../../../sitemapper/library";
import type { SitemapNode } from "../../../sitemapper/model";
import { indexDocument } from "../../../sitemapper/model";
import {
  expandSitemapRoutes,
  type MappingAssignmentCatalog,
  type SitemapNodeRouteInfo,
  type SitemapRouteExpansion,
} from "../../../sitemapper/routes";
import { SitemapNameDialog } from "../library/name-dialog";
import { CanvasPane, type SitemapView } from "../ui/canvas/canvas-pane";
import type { PageSourceLabel } from "../ui/canvas/page-source";
import { clampCanvasZoom } from "../ui/canvas/sitemap-canvas";
import { InspectorPanel } from "../ui/inspector/inspector-panel";
import { buildSitemapOutline } from "../ui/tree/outline-model";
import { PagesPane } from "../ui/tree/pages-pane";
import { countDescendants } from "../ui/tree/tree-helpers";
import type { SitemapperSaveStatus } from "./controller-model";
import { sitemapperHref, SITEMAPPER_ROUTE } from "./sitemapper-intent";
import { useSitemapperController } from "./use-sitemapper-controller";

const ZOOM_STEP = 0.1;

/** One stable empty map, so a Sitemap with no Mapping never rerenders on it. */
const NO_ROUTE_INFO: ReadonlyMap<string, SitemapNodeRouteInfo> = new Map();

export interface SitemapperIntegrationProps {
  record: SitemapRecord;
  store: Pick<SitemapStore, "put" | "delete">;
  catalog: Pick<CompositionCatalog, "listCompositions" | "resolveComposition">;
  mappingCatalog?: MappingAssignmentCatalog;
  /** The `?page=` half of the deep link, when the URL named one. */
  initialPageId?: string;
  /** Route transitions this editor owns: duplicating and deleting the record. */
  navigate?: (href: string) => void;
  /** Record ids for a duplicated Sitemap; page ids come from `idFactory`. */
  recordIdFactory?: IdFactory;
  idFactory?: IdFactory;
  now?: () => string;
}

type NameDialogState = { kind: "sitemap" } | { kind: "page"; pageId: string; title: string };

/** The queue's own vocabulary, translated into the chrome's four states. */
function statusOf(status: SitemapperSaveStatus, onRetry: () => void): EditorStatus {
  switch (status.kind) {
    case "saved": return { state: "saved" };
    case "saving": return { state: "saving" };
    case "error": return { state: "failed", detail: status.reason, onRetry };
    case "dirty": return { state: "unsaved" };
  }
}

export function SitemapperIntegration({
  record,
  store,
  catalog,
  mappingCatalog,
  initialPageId,
  navigate,
  recordIdFactory,
  idFactory,
  now,
}: SitemapperIntegrationProps): JSX.Element {
  const controller = useSitemapperController({ record, store, idFactory, now });
  const document = controller.state.document;
  const selectedId = controller.state.selectedId;
  const dispatch = controller.dispatch;

  const [view, setView] = useState<SitemapView>("canvas");
  const [zoom, setZoom] = useState(1);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [compositions, setCompositions] = useState<ReadonlyMap<string, { name: string; providerLabel: string }>>(new Map());
  const [routeExpansionState, setRouteExpansionState] = useState<{ document: typeof document; expansion: SitemapRouteExpansion } | null>(null);
  const confirm = useLibraryConfirm();
  const overflowRef = useRef<HTMLButtonElement | null>(null);
  const overflow = useMenu(overflowRef, { align: "end" });
  const recordIdFactoryRef = useRef(recordIdFactory ?? createUuidIdFactory());
  const nowRef = useRef(now ?? (() => new Date().toISOString()));
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const index = useMemo(() => indexDocument(document), [document]);
  const outline = useMemo(() => buildSitemapOutline(document), [document]);
  const selectedNode: SitemapNode | null = selectedId ? index.byId.get(selectedId)?.node ?? null : null;
  const routeExpansion = routeExpansionState?.document === document ? routeExpansionState.expansion : null;

  useBreadcrumb([{ label: "Sitemaps", href: SITEMAPPER_ROUTE }, { label: document.name }]);

  // The deep link's `?page=` selects once, and only when it names a real page.
  const appliedIntentRef = useRef(false);
  useEffect(() => {
    if (appliedIntentRef.current) return;
    appliedIntentRef.current = true;
    if (initialPageId && index.byId.has(initialPageId)) dispatch({ type: "select", pageId: initialPageId });
  }, [dispatch, index, initialPageId]);

  // The address bar follows the selection, so a copied URL opens the page the
  // author is looking at. `replaceState` keeps it out of the history stack —
  // selecting a page is not a navigation.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") return;
    window.history.replaceState(null, "", sitemapperHref(record.id, selectedId ?? undefined));
  }, [record.id, selectedId]);

  useEffect(() => {
    if (!mappingCatalog) { setRouteExpansionState(null); return; }
    let active = true;
    void expandSitemapRoutes({ document, catalog: mappingCatalog.routes }).then((expansion) => {
      if (!active) return;
      setRouteExpansionState({ document, expansion });
    });
    return () => { active = false; };
  }, [document, mappingCatalog]);

  // Composition names are read once per catalog: every canvas node, Tree row
  // and inspector card says the same thing about a page's source.
  useEffect(() => {
    let active = true;
    void catalog.listCompositions()
      .then((outcome) => {
        if (!active) return;
        setCompositions(new Map(outcome.entries.map((entry) => [
          `${entry.ref.providerId}:${entry.ref.recordId}`,
          { name: entry.name, providerLabel: entry.providerLabel },
        ])));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [catalog]);

  const sources = useMemo(() => {
    const labels = new Map<string, PageSourceLabel>();
    for (const location of index.byId.values()) {
      const { source } = location.node;
      if (source.kind === "composition") {
        // An unlisted reference is a broken one; the raw record id is the
        // honest label until the inspector says why it could not be resolved.
        const entry = compositions.get(`${source.ref.providerId}:${source.ref.recordId}`);
        labels.set(location.node.id, {
          kind: "composition",
          name: entry?.name ?? source.ref.recordId,
          ...(entry === undefined ? {} : { detail: entry.providerLabel }),
        });
        continue;
      }
      if (source.kind !== "mapping") continue;
      const info = routeExpansion?.nodes.get(location.node.id);
      labels.set(location.node.id, {
        kind: "mapping",
        name: info?.mapping?.name ?? source.ref.recordId,
        detail: info ? `${info.derivedRouteCount} ${info.derivedRouteCount === 1 ? "route" : "routes"}` : undefined,
      });
    }
    return labels;
  }, [compositions, index, routeExpansion]);

  const addChild = useCallback((parentId: string) => {
    dispatch({ type: "setExpanded", pageId: parentId, expanded: true });
    dispatch({ type: "addChild", parentId, title: "Untitled page" });
  }, [dispatch]);

  const requestDelete = useCallback((pageId: string) => {
    const node = index.byId.get(pageId)?.node;
    if (!node) return;
    const descendants = countDescendants(node);
    confirm.request({
      title: `Delete ${node.title}?`,
      message: descendants > 0
        ? `Its ${descendants} sub-${descendants === 1 ? "page" : "pages"} are deleted with it. This cannot be undone.`
        : "This cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
      onConfirm: () => dispatch({ type: "remove", pageId }),
    });
  }, [confirm, dispatch, index]);

  const duplicateRecord = async (): Promise<void> => {
    setRecordError(null);
    try {
      controller.flushPropUpdates();
      await controller.flushPersistence();
      const source = controller.queue.state.draft;
      const duplicateId = recordIdFactoryRef.current(source.document.name);
      const timestamp = nowRef.current();
      await store.put({
        id: duplicateId,
        createdAt: timestamp,
        updatedAt: timestamp,
        document: { ...cloneJson(source.document), id: duplicateId, name: `${source.document.name} copy` },
      });
      navigateRef.current?.(sitemapperHref(duplicateId));
    } catch (reason) {
      setRecordError(reason instanceof Error ? reason.message : "The Sitemap could not be duplicated.");
    }
  };

  const deleteRecord = async (): Promise<void> => {
    setRecordError(null);
    try {
      // Close the save queue first: a write still in flight would put the
      // record straight back after the delete.
      controller.flushPropUpdates();
      await controller.queue.close();
      await store.delete(record.id);
      navigateRef.current?.(SITEMAPPER_ROUTE);
    } catch (reason) {
      setRecordError(reason instanceof Error ? reason.message : "The Sitemap could not be deleted.");
    }
  };

  const saveStatus = controller.state.saveStatus;
  // A Mapping route family owns its own routes and takes no authored children,
  // so the toolbar's Add page adds beside it rather than going dead.
  const addTargetId = selectedNode !== null && selectedNode.source.kind === "mapping"
    ? index.byId.get(selectedNode.id)?.parentId ?? null
    : selectedId ?? document.root[0]?.id ?? null;
  // The one case with nowhere to go: the single root page is itself a Mapping.
  const canAddPage = addTargetId !== null || document.root.length === 0;

  return (
    <EditorChrome
      editorKey="sitemapper"
      class="sg-sitemapper-editor"
      back={{ href: SITEMAPPER_ROUTE, label: "Back to Sitemaps" }}
      title={<RecordTitle value={document.name} label="Sitemap name" onCommit={(name) => dispatch({ type: "rename", name })} />}
      status={statusOf(saveStatus, controller.retrySave)}
      dirty={saveStatus.kind !== "saved"}
      paneLabels={{ nav: "Pages", main: "Canvas", insp: "Inspect" }}
      center={
        <>
          <SegmentedControl<SitemapView>
            label="View"
            size="sm"
            value={view}
            onChange={setView}
            options={[{ value: "tree", label: "Tree" }, { value: "canvas", label: "Canvas" }]}
          />
          <div class="sg-sitemapper-zoom" role="group" aria-label="Zoom">
            <Button size="xs" variant="ghost" iconOnly aria-label="Zoom out" disabled={view !== "canvas"} onClick={() => setZoom((current) => clampCanvasZoom(current - ZOOM_STEP))}>
              <MinusIcon size="xs" />
            </Button>
            <span class="sg-sitemapper-zoom__level">{Math.round(zoom * 100)}%</span>
            <Button size="xs" variant="ghost" iconOnly aria-label="Zoom in" disabled={view !== "canvas"} onClick={() => setZoom((current) => clampCanvasZoom(current + ZOOM_STEP))}>
              <PlusIcon size="xs" />
            </Button>
          </div>
        </>
      }
      right={
        <>
          <Button
            disabled={!canAddPage}
            title={canAddPage ? undefined : "The root page is a Mapping route family, which takes no authored children."}
            onClick={() => {
              if (addTargetId === null) dispatch({ type: "addRoot", title: "Home" });
              else addChild(addTargetId);
            }}
          >
            <PlusIcon size="sm" />
            Add page
          </Button>
          {/* A raw button rather than `Button`: the menu measures its trigger
           * through a ref, and Preact strips `ref` from a function component. */}
          <button
            type="button"
            ref={overflowRef}
            class="cms-btn cms-btn--ghost cms-btn--icon"
            aria-label="More sitemap actions"
            {...overflow.triggerProps}
          >
            <EllipsisIcon size="sm" />
          </button>
          <Menu controller={overflow} label="Sitemap actions">
            <MenuItem icon={DuplicateIcon} onSelect={() => void duplicateRecord()}>Duplicate sitemap</MenuItem>
            <MenuItem icon={EditIcon} onSelect={() => setNameDialog({ kind: "sitemap" })}>Rename…</MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={TrashIcon}
              tone="danger"
              onSelect={() => confirm.request({
                title: `Delete ${document.name}?`,
                message: "The pages and their source assignments are deleted with it. This cannot be undone.",
                confirmLabel: "Delete",
                tone: "danger",
                onConfirm: () => void deleteRecord(),
              })}
            >
              Delete…
            </MenuItem>
          </Menu>
        </>
      }
    >
      <EditorBody
        navLabel="Pages"
        inspectorLabel="Inspector"
        nav={
          <PagesPane
            document={document}
            outline={outline}
            selectedId={selectedId}
            expandedIds={controller.state.expandedIds}
            onSelect={(pageId) => dispatch({ type: "select", pageId })}
            onExpandedChange={(pageIds) => dispatch({ type: "setExpandedIds", pageIds })}
            onAdd={(request) => {
              if (request.parentId === null) dispatch({ type: "addRoot", title: request.title });
              else dispatch({ type: "addChild", parentId: request.parentId, title: request.title, atIndex: request.index });
            }}
            onAddChild={addChild}
            onRename={(pageId) => {
              const node = index.byId.get(pageId)?.node;
              if (node) setNameDialog({ kind: "page", pageId, title: node.title });
            }}
            onMove={(pageId, direction) => dispatch({ type: "reorder", pageId, direction })}
            onDuplicate={(pageId) => dispatch({ type: "duplicate", pageId })}
            onDelete={requestDelete}
          />
        }
        main={
          <CanvasPane
            document={document}
            routes={outline.routes}
            sources={sources}
            routeInfo={routeExpansion?.nodes ?? NO_ROUTE_INFO}
            view={view}
            selectedId={selectedId}
            zoom={zoom}
            notice={recordError || controller.lastError ? (
              <Banner tone="err">{recordError ?? controller.lastError}</Banner>
            ) : null}
            onZoomChange={setZoom}
            onSelect={(pageId) => dispatch({ type: "select", pageId })}
            onAddChild={addChild}
            onDuplicate={(pageId) => dispatch({ type: "duplicate", pageId })}
            onDelete={requestDelete}
            onCreateRoot={() => dispatch({ type: "addRoot", title: "Home" })}
          />
        }
        inspector={
          <InspectorPanel
            document={document}
            node={selectedNode}
            routes={outline.routes}
            catalog={catalog}
            mappingCatalog={mappingCatalog}
            routeInfo={selectedId ? routeExpansion?.nodes.get(selectedId) : undefined}
            onUpdatePropsDebounced={controller.updatePropsDebounced}
            onFlushPropUpdates={controller.flushPropUpdates}
            onUpdateSource={(pageId, source) => dispatch({ type: "updateProps", pageId, patch: { source } })}
            onReparent={(pageId, parentId) => dispatch({
              type: "move",
              pageId,
              targetParentId: parentId,
              targetIndex: index.byId.get(parentId)?.node.children.length ?? 0,
            })}
            onDelete={requestDelete}
            onConfirm={(request) => confirm.request({ ...request, tone: "danger" })}
          />
        }
      />
      <SitemapNameDialog
        open={nameDialog !== null}
        title={nameDialog?.kind === "page" ? "Rename page" : "Rename sitemap"}
        description={nameDialog?.kind === "page"
          ? `Choose a new name for ${nameDialog.title}.`
          : `Choose a new name for ${document.name}.`}
        label={nameDialog?.kind === "page" ? "Page title" : "Sitemap name"}
        submitLabel="Save name"
        initialValue={nameDialog?.kind === "page" ? nameDialog.title : document.name}
        onSubmit={(value) => {
          if (nameDialog?.kind === "page") dispatch({ type: "updateProps", pageId: nameDialog.pageId, patch: { title: value } });
          else dispatch({ type: "rename", name: value });
          setNameDialog(null);
        }}
        onClose={() => setNameDialog(null)}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </EditorChrome>
  );
}

export default SitemapperIntegration;
