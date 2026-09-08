"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useBreadcrumb, type EditorStatus } from "../../../app/chrome-context";
import { useWorkspace } from "../../../app/workspace-context";
import { CONTENT_FILE_PROVIDER_DOMAIN } from "../../../content/storage/file-provider";
import { MAPPING_FILE_PROVIDER_DOMAIN } from "../../../mapping/storage/file-provider";
import type { WorkspaceRecord } from "../../../app/workspace-record";
import { notifyRouteSelection } from "../../../app/route-intents";
import { EditorBody, EditorChrome, RecordTitle } from "../../../components/editor-chrome";
import { DuplicateIcon, EditIcon, EllipsisIcon, MinusIcon, PlusIcon, TrashIcon } from "../../../components/icons";
import { useLibraryConfirm } from "../../../components/library-page";
import { ConfirmDialog, Menu, MenuItem, MenuSeparator, useMenu } from "../../../components/overlay";
import { Banner, Button, SegmentedControl } from "../../../components/ui";
import { cloneJson, createUuidIdFactory, type IdFactory } from "../../../shared";
import { subscribePersistenceChanges } from "../../../shared/persistence-generation";
import type { CompositionCatalog } from "../../../sitemapper/catalog";
import type { SitemapRecord, SitemapStore } from "../../../sitemapper/library";
import type { SitemapNode } from "../../../sitemapper/model";
import { indexDocument } from "../../../sitemapper/model";
import type { SitemapMenu, SitemapNavigationCommand } from "../../../sitemapper/commands/navigation";
import {
  expandSitemapRoutes,
  type MappingAssignmentCatalog,
  type SitemapNodeRouteInfo,
  type SitemapRouteExpansion,
} from "../../../sitemapper/routes";
import { SitemapNameDialog } from "../library/name-dialog";
import { CanvasPane, type SitemapView } from "../ui/canvas/canvas-pane";
import type { PageSourceLabel } from "../ui/canvas/page-source";
import { clampCanvasZoom, type CanvasLayoutPreference } from "../ui/canvas/sitemap-canvas";
import { InspectorPanel } from "../ui/inspector/inspector-panel";
import { buildSitemapOutline } from "../ui/tree/outline-model";
import { PagesPane } from "../ui/tree/pages-pane";
import { countDescendants } from "../ui/tree/tree-helpers";
import { NavigationPane } from "../ui/views/navigation-pane";
import { RoutePreviewPane } from "../ui/views/route-preview-pane";
import { withSitemapperWorkspaceLock } from "./sitemapper-workspace-lock";
import type { SitemapperSaveStatus } from "./controller-model";
import { sitemapperHref, SITEMAPPER_ROUTE } from "./sitemapper-intent";
import { useSitemapperController } from "./use-sitemapper-controller";

const ZOOM_STEP = 0.1;

/** One stable empty map, so a Sitemap with no Mapping never rerenders on it. */
const NO_ROUTE_INFO: ReadonlyMap<string, SitemapNodeRouteInfo> = new Map();

export interface SitemapperIntegrationProps {
  providerId: string;
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
  providerId,
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
  const controller = useSitemapperController({ record, providerId, store, idFactory, now });
  const workspace = useWorkspace();
  const workspaceIntegration = workspace?.integration;
  const document = controller.state.document;
  const selectedId = controller.state.selectedId;
  const dispatch = controller.dispatch;

  const [view, setView] = useState<SitemapView>("canvas");
  const [zoom, setZoom] = useState(1);
  const [layoutPreference, setLayoutPreference] = useState<CanvasLayoutPreference>("auto");
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [compositions, setCompositions] = useState<ReadonlyMap<string, { name: string; providerLabel: string }>>(new Map());
  const [routeExpansionState, setRouteExpansionState] = useState<{ document: typeof document; epoch: number; expansion: SitemapRouteExpansion } | null>(null);
  const [catalogEpoch, setCatalogEpoch] = useState(0);
  const [workspaceMetadata, setWorkspaceMetadata] = useState<WorkspaceRecord | null>(null);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const confirm = useLibraryConfirm();
  const overflowRef = useRef<HTMLButtonElement | null>(null);
  const overflow = useMenu(overflowRef, { align: "end" });
  const recordIdFactoryRef = useRef(recordIdFactory ?? createUuidIdFactory());
  const nowRef = useRef(now ?? (() => new Date().toISOString()));
  const navigateRef = useRef(navigate);
  const routeExpansionEpochRef = useRef(0);
  navigateRef.current = navigate;

  const index = useMemo(() => indexDocument(document), [document]);
  const outline = useMemo(() => buildSitemapOutline(document), [document]);
  const selectedNode: SitemapNode | null = selectedId ? index.byId.get(selectedId)?.node ?? null : null;
  const routeExpansion = routeExpansionState?.document === document && routeExpansionState.epoch === catalogEpoch ? routeExpansionState.expansion : null;
  const activeSitemap = workspaceMetadata?.metadata.activeSitemap.providerId === providerId
    && workspaceMetadata.metadata.activeSitemap.recordId === record.id;

  useBreadcrumb([{ label: "Sitemaps", href: SITEMAPPER_ROUTE }, { label: document.name }]);

  useEffect(() => {
    if (!workspaceIntegration) {
      setWorkspaceMetadata(null);
      return undefined;
    }
    let live = true;
    const readMetadata = (): void => {
      void workspaceIntegration.workspace.metadata().then((next) => {
        if (live) {
          setWorkspaceMetadata(next);
          setMetadataError(null);
        }
      }).catch((reason: unknown) => {
        if (live) setMetadataError(reason instanceof Error ? reason.message : "Workspace metadata is unavailable.");
      });
    };
    readMetadata();
    const unsubscribe = workspaceIntegration.subscribeChanges(readMetadata, ["workspace"]);
    return () => { live = false; unsubscribe(); };
  }, [workspaceIntegration]);

  useEffect(() => {
    if (!workspaceIntegration?.workspace.id) return undefined;
    // A filesystem provider's refresh hint names its domain, not a
    // workspace-scoped database: the workspace travels as a request header.
    return subscribePersistenceChanges((channel) => {
      if (channel === CONTENT_FILE_PROVIDER_DOMAIN || channel === MAPPING_FILE_PROVIDER_DOMAIN) {
        routeExpansionEpochRef.current += 1;
        setRouteExpansionState(null);
        setCatalogEpoch((current) => current + 1);
      }
    });
  }, [workspaceIntegration]);

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
    window.history.replaceState(null, "", sitemapperHref(providerId, record.id, selectedId ?? undefined));
    notifyRouteSelection();
  }, [record.id, selectedId]);

  useEffect(() => {
    if (!mappingCatalog) { setRouteExpansionState(null); return; }
    let active = true;
    const epoch = ++routeExpansionEpochRef.current;
    void expandSitemapRoutes({ document, catalog: mappingCatalog.routes, policy: "authoring-preview" }).then((expansion) => {
      if (!active || routeExpansionEpochRef.current !== epoch) return;
      setRouteExpansionState({ document, epoch: catalogEpoch, expansion });
    }).catch(() => {
      if (active && routeExpansionEpochRef.current === epoch) setRouteExpansionState(null);
    });
    return () => { active = false; };
  }, [document, mappingCatalog, catalogEpoch]);

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
        ...(info === undefined
          ? {}
          : { detail: `${info.derivedRouteCount} ${info.derivedRouteCount === 1 ? "route" : "routes"}` }),
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
      navigateRef.current?.(sitemapperHref(providerId, duplicateId));
    } catch (reason) {
      setRecordError(reason instanceof Error ? reason.message : "The Sitemap could not be duplicated.");
    }
  };

  const deleteRecord = async (): Promise<void> => {
    setRecordError(null);
    setDeleteBlocked(false);
    try {
      // Close the save queue first: a write still in flight would put the
      // record straight back after the delete.
      await controller.flushPersistence();
      await withSitemapperWorkspaceLock(workspaceIntegration?.workspace.id, async () => {
        if (workspaceIntegration) {
          const currentMetadata = await workspaceIntegration.workspace.metadata();
          if (currentMetadata.metadata.activeSitemap.providerId === providerId && currentMetadata.metadata.activeSitemap.recordId === record.id) {
            throw new Error("This is the active Sitemap. Select another Sitemap as active before deleting it.");
          }
        }
        await controller.queue.close();
        if (workspaceIntegration) {
          const currentMetadata = await workspaceIntegration.workspace.metadata();
          if (currentMetadata.metadata.activeSitemap.providerId === providerId && currentMetadata.metadata.activeSitemap.recordId === record.id) {
            throw new Error("This is the active Sitemap. Select another Sitemap as active before deleting it.");
          }
        }
        await store.delete(record.id);
      });
      navigateRef.current?.(SITEMAPPER_ROUTE);
    } catch (reason) {
      if (reason instanceof Error && reason.message === "This is the active Sitemap. Select another Sitemap as active before deleting it.") setDeleteBlocked(true);
      setRecordError(reason instanceof Error ? reason.message : "The Sitemap could not be deleted.");
    }
  };

  const setActiveSitemap = async (): Promise<void> => {
    if (!workspaceIntegration) {
      setMetadataError("Workspace metadata is unavailable in this editor.");
      return;
    }
    setMetadataBusy(true);
    setMetadataError(null);
    try {
      await withSitemapperWorkspaceLock(workspaceIntegration.workspace.id, async () => {
        const current = await workspaceIntegration.workspace.metadata();
        const next = await workspaceIntegration.workspace.updateMetadata(current.mutationToken, {
          activeSitemap: { providerId: providerId as WorkspaceRecord["metadata"]["activeSitemap"]["providerId"], recordId: record.id },
        });
        setWorkspaceMetadata(next);
      });
    } catch (reason) {
      setMetadataError(reason instanceof Error ? reason.message : "The active Sitemap could not be changed.");
    } finally {
      setMetadataBusy(false);
    }
  };

  const editNavigation = useCallback((menu: SitemapMenu, command: SitemapNavigationCommand): void => {
    // Kept as a small bridge so NavigationPane can never mutate the document
    // directly; the controller queue owns every persisted edit.
    controller.dispatch({ type: "editNavigation", menu, command });
  }, [controller.dispatch]);

  const changeView = useCallback((next: SitemapView): void => {
    if (!controller.flushNavigationDrafts()) setView(next);
  }, [controller.flushNavigationDrafts]);

  const saveStatus = controller.state.saveStatus;
  // The selected authored page owns the new child even when it is a Mapping
  // family. Missing parents and the single-root rule remain structural limits.
  const addTargetId = selectedId ?? document.root[0]?.id ?? null;
  const canAddPage = addTargetId === null ? document.root.length === 0 : index.byId.has(addTargetId);
  const notice = recordError || controller.lastError || metadataError
    ? <Banner tone="err" action={deleteBlocked ? <a class="cms-btn cms-btn--ghost cms-btn--xs" href={SITEMAPPER_ROUTE}>Choose another Sitemap</a> : undefined}>{recordError ?? controller.lastError ?? metadataError}</Banner>
    : controller.canUndoRemove
      ? <Banner tone="info">Page removed. <Button size="xs" variant="ghost" onClick={() => { controller.undoRemove(); }}>Undo remove</Button></Banner>
      : null;

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
            onChange={changeView}
            options={[{ value: "canvas", label: "Canvas" }, { value: "outline", label: "Outline" }, { value: "routes", label: "Routes" }, { value: "navigation", label: "Navigation" }]}
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
          {metadataError ? <span class="sg-sitemapper-metadata-error" role="alert">{metadataError}</span> : null}
          <Button
            size="sm"
            variant={activeSitemap ? "ghost" : "primary"}
            disabled={activeSitemap || metadataBusy || !workspaceIntegration}
            onClick={() => void setActiveSitemap()}
          >
            {activeSitemap ? "Active Sitemap" : metadataBusy ? "Setting active…" : "Set active"}
          </Button>
          <a class="cms-btn cms-btn--ghost cms-btn--sm" href="/site" target="_blank" rel="noreferrer">Visitor preview</a>
          <Button
            disabled={!canAddPage}
            title={canAddPage ? undefined : "Choose an existing parent page; a Sitemap can have only one root."}
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
            onRename={(pageId, title) => {
              if (title !== undefined) {
                dispatch({ type: "updateProps", pageId, patch: { title } });
                return;
              }
              const node = index.byId.get(pageId)?.node;
              if (node) setNameDialog({ kind: "page", pageId, title: node.title });
            }}
            onMove={(pageId, direction) => dispatch({ type: "reorder", pageId, direction })}
            onDuplicate={(pageId) => dispatch({ type: "duplicate", pageId })}
            onDelete={requestDelete}
          />
        }
        main={
          view === "outline" ? (
            <div class="sg-sitemapper-view-stack">
              <div class="sg-sitemapper-main__notice">{notice}</div>
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
              onRename={(pageId, title) => {
                if (title !== undefined) {
                  dispatch({ type: "updateProps", pageId, patch: { title } });
                  return;
                }
                const node = index.byId.get(pageId)?.node;
                if (node) setNameDialog({ kind: "page", pageId, title: node.title });
              }}
              onMove={(pageId, direction) => dispatch({ type: "reorder", pageId, direction })}
              onDuplicate={(pageId) => dispatch({ type: "duplicate", pageId })}
              onDelete={requestDelete}
              showCollapseButton={false}
              heading="Outline"
              class="sg-sitemapper-outline-pane"
            />
            </div>
          ) : view === "routes" ? (
            <RoutePreviewPane
              document={document}
              authoredRoutes={outline.routes}
              expansion={routeExpansion}
              selectedId={selectedId}
              onSelect={(pageId) => dispatch({ type: "select", pageId })}
              notice={notice}
            />
          ) : view === "navigation" ? (
            <NavigationPane
              document={document}
              expansion={routeExpansion}
              selectedId={selectedId}
              onSelect={(pageId) => dispatch({ type: "select", pageId })}
              onEdit={editNavigation}
              onDraft={controller.updateNavigationDebounced}
              onFlush={controller.flushNavigationDrafts}
              notice={notice}
            />
          ) : (
            <CanvasPane
              document={document}
              routes={outline.routes}
              sources={sources}
              routeInfo={routeExpansion?.nodes ?? NO_ROUTE_INFO}
              view="canvas"
              selectedId={selectedId}
              zoom={zoom}
              layoutPreference={layoutPreference}
              onLayoutPreferenceChange={setLayoutPreference}
              notice={notice}
              onZoomChange={setZoom}
              onSelect={(pageId) => dispatch({ type: "select", pageId })}
              onAddChild={addChild}
              onDuplicate={(pageId) => dispatch({ type: "duplicate", pageId })}
              onDelete={requestDelete}
              onCreateRoot={() => dispatch({ type: "addRoot", title: "Home" })}
            />
          )
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
