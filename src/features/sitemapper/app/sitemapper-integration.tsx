"use client";

import { computed, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { bindBreadcrumb, type EditorStatus } from "../../../app/chrome-context";
import type { AppServices } from "../../../app/services";
import { CONTENT_FILE_PROVIDER_DOMAIN } from "../../../content/storage/file-provider";
import { MAPPING_FILE_PROVIDER_DOMAIN } from "../../../mapping/storage/file-provider";
import type { WorkspaceRecord } from "../../../app/workspace-record";
import { notifyRouteSelection } from "../../../app/route-intents";
import { createEditorChrome, createEditorRails, EditorBody, EditorChrome, RecordTitle } from "../../../components/editor-chrome";
import { DuplicateIcon, EditIcon, EllipsisIcon, MinusIcon, PlusIcon, TrashIcon } from "../../../components/icons";
import { createLibraryConfirm } from "../../../components/library-page";
import { ConfirmDialog, createMenu, Menu, MenuItem, MenuSeparator } from "../../../components/overlay";
import { liveSlot, Rebuild } from "../../../components/rebuild";
import { derive } from "../../mapping/signals";
import { Banner, Button, SegmentedControl } from "../../../components/ui";
import { cloneJson, createUuidIdFactory, type IdFactory } from "../../../shared";
import { subscribePersistenceChanges } from "../../../shared/persistence-generation";
import type { CompositionCatalog } from "../../../sitemapper/catalog";
import type { SitemapRecord, SitemapStore } from "../../../sitemapper/library";
import type { SitemapDocument as SitemapDocumentValue, SitemapNode } from "../../../sitemapper/model";
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
import { createSitemapperController } from "./use-sitemapper-controller";

const ZOOM_STEP = 0.1;

/** One stable empty map, so a Sitemap with no Mapping never updates on it. */
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
  /** The shell's route services; absent when the editor is mounted standalone. */
  services?: AppServices;
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
  services,
}: SitemapperIntegrationProps): Child {
  const scope = getScope();
  const workspaceIntegration = services?.workspace.integration;
  const controller = createSitemapperController({ record, providerId, store, idFactory, now, integration: workspaceIntegration });
  const controllerState = controller.signals.state;
  const document = computed(() => controllerState.value.document);
  const selectedId = computed(() => controllerState.value.selectedId);
  const expandedIds = computed(() => controllerState.value.expandedIds);
  const saveStatus = computed(() => controllerState.value.saveStatus);
  const dispatch = controller.dispatch;

  const view = signal<SitemapView>("canvas");
  const zoom = signal(1);
  const layoutPreference = signal<CanvasLayoutPreference>("auto");
  const nameDialog = signal<NameDialogState | null>(null);
  const recordError = signal<string | null>(null);
  const compositions = signal<ReadonlyMap<string, { name: string; providerLabel: string }>>(new Map());
  const routeExpansionState = signal<{ document: SitemapDocumentValue; epoch: number; expansion: SitemapRouteExpansion } | null>(null);
  const catalogEpoch = signal(0);
  const workspaceMetadata = signal<WorkspaceRecord | null>(null);
  const metadataBusy = signal(false);
  const metadataError = signal<string | null>(null);
  const deleteBlocked = signal(false);
  const confirm = createLibraryConfirm();
  const overflowRef: { current: HTMLButtonElement | null } = { current: null };
  const overflow = createMenu(overflowRef, { align: "end" });
  const chrome = createEditorChrome({ editorKey: "sitemapper" });
  const rails = createEditorRails({ chrome, navLabel: "Pages", inspectorLabel: "Inspector" });
  const createRecordId = recordIdFactory ?? createUuidIdFactory();
  const timestamp = now ?? (() => new Date().toISOString());
  let routeExpansionEpoch = 0;
  const alive = (): boolean => !scope.abortSignal.aborted;

  // `computed` has no equality cutoff; `derive` keeps each derived object
  // stable until the document itself changes, so selection or save-status
  // changes do not rebuild the tree, canvas or tables.
  const index = derive(() => [document.value] as const, indexDocument);
  const outline = derive(() => [document.value] as const, buildSitemapOutline);
  const routes = computed(() => outline.value.routes);
  const selectedNode = computed<SitemapNode | null>(() => {
    const id = selectedId.value;
    return id ? index.value.byId.get(id)?.node ?? null : null;
  });
  const routeExpansion = computed(() => {
    const current = routeExpansionState.value;
    return current?.document === document.value && current.epoch === catalogEpoch.value ? current.expansion : null;
  });
  const routeInfo = computed(() => routeExpansion.value?.nodes ?? NO_ROUTE_INFO);
  const activeSitemap = computed(() => workspaceMetadata.value?.metadata.activeSitemap.providerId === providerId
    && workspaceMetadata.value.metadata.activeSitemap.recordId === record.id);

  bindBreadcrumb(scope, services?.chrome ?? null, computed(() => [{ label: "Sitemaps", href: SITEMAPPER_ROUTE }, { label: document.value.name }]));

  scope.onActivate(() => {
    if (!workspaceIntegration) {
      workspaceMetadata.value = null;
      return undefined;
    }
    const readMetadata = (): void => {
      void workspaceIntegration.workspace.metadata().then((next) => {
        if (!alive()) return;
        workspaceMetadata.value = next;
        metadataError.value = null;
      }).catch((reason: unknown) => {
        if (alive()) metadataError.value = reason instanceof Error ? reason.message : "Workspace metadata is unavailable.";
      });
    };
    readMetadata();
    return workspaceIntegration.subscribeChanges(readMetadata, ["workspace"]);
  });

  scope.onActivate(() => {
    if (!workspaceIntegration?.workspace.id) return undefined;
    // A filesystem provider's refresh hint names its domain, not a
    // workspace-scoped database: the workspace travels as a request header.
    return subscribePersistenceChanges((channel) => {
      if (channel === CONTENT_FILE_PROVIDER_DOMAIN || channel === MAPPING_FILE_PROVIDER_DOMAIN) {
        routeExpansionEpoch += 1;
        routeExpansionState.value = null;
        catalogEpoch.value += 1;
      }
    });
  });

  // The deep link's `?page=` selects once, and only when it names a real page.
  if (initialPageId && index.value.byId.has(initialPageId)) dispatch({ type: "select", pageId: initialPageId });

  // The address bar follows the selection, so a copied URL opens the page the
  // author is looking at. `replaceState` keeps it out of the history stack —
  // selecting a page is not a navigation.
  // `computed` has no equality cutoff: every state change re-runs this, so it compares the last id it wrote.
  let writtenId: string | null | undefined;
  scope.effect(() => {
    const id = selectedId.value;
    if (id === writtenId) return;
    writtenId = id;
    if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") return;
    window.history.replaceState(null, "", sitemapperHref(providerId, record.id, id ?? undefined));
    notifyRouteSelection();
  });

  // Expansion is keyed by document identity and catalog epoch; other state
  // changes re-run the effect (no `computed` equality cutoff) and are skipped.
  let expandedFor: { document: SitemapDocumentValue; epoch: number } | null = null;
  scope.effect(() => {
    const current = document.value;
    const epochValue = catalogEpoch.value;
    if (expandedFor?.document === current && expandedFor.epoch === epochValue) return;
    expandedFor = { document: current, epoch: epochValue };
    if (!mappingCatalog) { routeExpansionState.value = null; return; }
    const epoch = ++routeExpansionEpoch;
    void expandSitemapRoutes({ document: current, catalog: mappingCatalog.routes, policy: "authoring-preview" }).then((expansion) => {
      if (!alive() || routeExpansionEpoch !== epoch) return;
      routeExpansionState.value = { document: current, epoch: epochValue, expansion };
    }).catch(() => {
      if (alive() && routeExpansionEpoch === epoch) routeExpansionState.value = null;
    });
  });

  // Composition names are read once per catalog: every canvas node, Tree row
  // and inspector card says the same thing about a page's source.
  scope.onActivate(() => {
    void catalog.listCompositions()
      .then((outcome) => {
        if (!alive()) return;
        compositions.value = new Map(outcome.entries.map((entry) => [
          `${entry.ref.providerId}:${entry.ref.recordId}`,
          { name: entry.name, providerLabel: entry.providerLabel },
        ]));
      })
      .catch(() => undefined);
  });

  const sources = derive(() => [compositions.value, routeExpansion.value, index.value] as const, (names, expansion, currentIndex) => {
    const labels = new Map<string, PageSourceLabel>();
    for (const location of currentIndex.byId.values()) {
      const { source } = location.node;
      if (source.kind === "composition") {
        // An unlisted reference is a broken one; the raw record id is the
        // honest label until the inspector says why it could not be resolved.
        const entry = names.get(`${source.ref.providerId}:${source.ref.recordId}`);
        labels.set(location.node.id, {
          kind: "composition",
          name: entry?.name ?? source.ref.recordId,
          ...(entry === undefined ? {} : { detail: entry.providerLabel }),
        });
        continue;
      }
      if (source.kind !== "mapping") continue;
      const info = expansion?.nodes.get(location.node.id);
      labels.set(location.node.id, {
        kind: "mapping",
        name: info?.mapping?.name ?? source.ref.recordId,
        ...(info === undefined
          ? {}
          : { detail: `${info.derivedRouteCount} ${info.derivedRouteCount === 1 ? "route" : "routes"}` }),
      });
    }
    return labels;
  });

  const select = (pageId: string): void => { dispatch({ type: "select", pageId }); };

  const addChild = (parentId: string): void => {
    dispatch({ type: "setExpanded", pageId: parentId, expanded: true });
    dispatch({ type: "addChild", parentId, title: "Untitled page" });
  };

  const requestDelete = (pageId: string): void => {
    const node = index.value.byId.get(pageId)?.node;
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
  };

  const duplicateRecord = async (): Promise<void> => {
    recordError.value = null;
    try {
      controller.flushPropUpdates();
      await controller.flushPersistence();
      const source = controller.queue.state.draft;
      const duplicateId = createRecordId(source.document.name);
      const createdAt = timestamp();
      await store.put({
        id: duplicateId,
        createdAt,
        updatedAt: createdAt,
        document: { ...cloneJson(source.document), id: duplicateId, name: `${source.document.name} copy` },
      });
      if (!alive()) return;
      navigate?.(sitemapperHref(providerId, duplicateId));
    } catch (reason) {
      if (alive()) recordError.value = reason instanceof Error ? reason.message : "The Sitemap could not be duplicated.";
    }
  };

  const deleteRecord = async (): Promise<void> => {
    recordError.value = null;
    deleteBlocked.value = false;
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
      if (!alive()) return;
      navigate?.(SITEMAPPER_ROUTE);
    } catch (reason) {
      if (!alive()) return;
      if (reason instanceof Error && reason.message === "This is the active Sitemap. Select another Sitemap as active before deleting it.") deleteBlocked.value = true;
      recordError.value = reason instanceof Error ? reason.message : "The Sitemap could not be deleted.";
    }
  };

  const setActiveSitemap = async (): Promise<void> => {
    if (!workspaceIntegration) {
      metadataError.value = "Workspace metadata is unavailable in this editor.";
      return;
    }
    metadataBusy.value = true;
    metadataError.value = null;
    try {
      await withSitemapperWorkspaceLock(workspaceIntegration.workspace.id, async () => {
        const current = await workspaceIntegration.workspace.metadata();
        const next = await workspaceIntegration.workspace.updateMetadata(current.mutationToken, {
          activeSitemap: { providerId: providerId as WorkspaceRecord["metadata"]["activeSitemap"]["providerId"], recordId: record.id },
        });
        if (alive()) workspaceMetadata.value = next;
      });
    } catch (reason) {
      if (alive()) metadataError.value = reason instanceof Error ? reason.message : "The active Sitemap could not be changed.";
    } finally {
      if (alive()) metadataBusy.value = false;
    }
  };

  const editNavigation = (menu: SitemapMenu, command: SitemapNavigationCommand): void => {
    // Kept as a small bridge so NavigationPane can never mutate the document
    // directly; the controller queue owns every persisted edit.
    controller.dispatch({ type: "editNavigation", menu, command });
  };

  const changeView = (next: SitemapView): void => {
    if (!controller.flushNavigationDrafts()) view.value = next;
  };

  const renamePage = (pageId: string, title?: string): void => {
    if (title !== undefined) {
      dispatch({ type: "updateProps", pageId, patch: { title } });
      return;
    }
    const node = index.value.byId.get(pageId)?.node;
    if (node) nameDialog.value = { kind: "page", pageId, title: node.title };
  };
  const addPage = (request: { parentId: string | null; title: string; index?: number }): void => {
    if (request.parentId === null) dispatch({ type: "addRoot", title: request.title });
    else dispatch({ type: "addChild", parentId: request.parentId, title: request.title, atIndex: request.index });
  };

  // The selected authored page owns the new child even when it is a Mapping
  // family. Missing parents and the single-root rule remain structural limits.
  const addTargetId = computed(() => selectedId.value ?? document.value.root[0]?.id ?? null);
  const canAddPage = computed(() => {
    const target = addTargetId.value;
    return target === null ? document.value.root.length === 0 : index.value.byId.has(target);
  });
  const lastError = controller.signals.lastError;
  const notice = computed<Child>(() => (recordError.value || lastError.value || metadataError.value
    ? <Banner tone="err" action={deleteBlocked.value ? <a class="cms-btn cms-btn--ghost cms-btn--xs" href={SITEMAPPER_ROUTE}>Choose another Sitemap</a> : undefined}>{recordError.value ?? lastError.value ?? metadataError.value}</Banner>
    : controller.signals.canUndoRemove.value
      ? <Banner tone="info">Page removed. <Button size="xs" variant="ghost" on:click={() => { controller.undoRemove(); }}>Undo remove</Button></Banner>
      : null));

  const pagesPaneProps = {
    document,
    outline,
    selectedId,
    expandedIds,
    chrome,
    rails,
    onSelect: select,
    onExpandedChange: (pageIds: readonly string[]) => { dispatch({ type: "setExpandedIds", pageIds }); },
    onAdd: addPage,
    onAddChild: addChild,
    onRename: renamePage,
    onMove: (pageId: string, direction: "up" | "down") => { dispatch({ type: "reorder", pageId, direction }); },
    onDuplicate: (pageId: string) => { dispatch({ type: "duplicate", pageId }); },
    onDelete: requestDelete,
  };

  return (
    <EditorChrome
      chrome={chrome}
      appChrome={services?.chrome ?? null}
      class="sg-sitemapper-editor"
      back={{ href: SITEMAPPER_ROUTE, label: "Back to Sitemaps" }}
      title={<RecordTitle value={computed(() => document.value.name)} label="Sitemap name" onCommit={(name) => dispatch({ type: "rename", name })} />}
      status={computed(() => statusOf(saveStatus.value, controller.retrySave))}
      dirty={computed(() => saveStatus.value.kind !== "saved")}
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
            <Button size="xs" variant="ghost" iconOnly aria-label="Zoom out" disabled={computed(() => view.value !== "canvas")} on:click={() => { zoom.value = clampCanvasZoom(zoom.value - ZOOM_STEP); }}>
              <MinusIcon size="xs" />
            </Button>
            <span class="sg-sitemapper-zoom__level">{computed(() => `${Math.round(zoom.value * 100)}%`)}</span>
            <Button size="xs" variant="ghost" iconOnly aria-label="Zoom in" disabled={computed(() => view.value !== "canvas")} on:click={() => { zoom.value = clampCanvasZoom(zoom.value + ZOOM_STEP); }}>
              <PlusIcon size="xs" />
            </Button>
          </div>
        </>
      }
      right={
        <>
          <Show when={computed(() => !!metadataError.value)}>{() => <span class="sg-sitemapper-metadata-error" role="alert">{computed(() => metadataError.value ?? "")}</span>}</Show>
          {/* `Button` fixes its variant at setup, so the button is rebuilt when the record becomes active. */}
          <Rebuild value={activeSitemap}>{(active) => (
            <Button
              size="sm"
              variant={active ? "ghost" : "primary"}
              disabled={computed(() => active || metadataBusy.value || !workspaceIntegration)}
              on:click={() => void setActiveSitemap()}
            >
              {computed(() => (active ? "Active Sitemap" : metadataBusy.value ? "Setting active…" : "Set active"))}
            </Button>
          )}</Rebuild>
          <a class="cms-btn cms-btn--ghost cms-btn--sm" href="/site" target="_blank" rel="noreferrer">Visitor preview</a>
          <Button
            disabled={computed(() => !canAddPage.value)}
            title={computed(() => (canAddPage.value ? null : "Choose an existing parent page; a Sitemap can have only one root."))}
            on:click={() => {
              const target = addTargetId.value;
              if (target === null) dispatch({ type: "addRoot", title: "Home" });
              else addChild(target);
            }}
          >
            <PlusIcon size="sm" />
            Add page
          </Button>
          <Button elementRef={overflowRef} variant="ghost" iconOnly aria-label="More sitemap actions" {...overflow.triggerProps}>
            <EllipsisIcon size="sm" />
          </Button>
          <Menu controller={overflow} label="Sitemap actions">
            <MenuItem icon={DuplicateIcon} onSelect={() => void duplicateRecord()}>Duplicate sitemap</MenuItem>
            <MenuItem icon={EditIcon} onSelect={() => { nameDialog.value = { kind: "sitemap" }; }}>Rename…</MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={TrashIcon}
              tone="danger"
              onSelect={() => confirm.request({
                title: `Delete ${document.value.name}?`,
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
        chrome={chrome}
        rails={rails}
        nav={<PagesPane {...pagesPaneProps} />}
        main={
          <>
            <Show when={computed(() => view.value === "outline")}>{() => (
              <div class="sg-sitemapper-view-stack">
                <div class="sg-sitemapper-main__notice">{liveSlot(notice)}</div>
                <PagesPane
                  {...pagesPaneProps}
                  showCollapseButton={false}
                  heading="Outline"
                  class="sg-sitemapper-outline-pane"
                />
              </div>
            )}</Show>
            <Show when={computed(() => view.value === "routes")}>{() => (
              <RoutePreviewPane
                document={document}
                authoredRoutes={routes}
                expansion={routeExpansion}
                selectedId={selectedId}
                onSelect={select}
                notice={notice}
              />
            )}</Show>
            <Show when={computed(() => view.value === "navigation")}>{() => (
              <NavigationPane
                document={document}
                expansion={routeExpansion}
                selectedId={selectedId}
                onSelect={select}
                onEdit={editNavigation}
                onDraft={controller.updateNavigationDebounced}
                onFlush={controller.flushNavigationDrafts}
                notice={notice}
              />
            )}</Show>
            <Show when={computed(() => view.value === "canvas")}>{() => (
              <CanvasPane
                document={document}
                routes={routes}
                sources={sources}
                routeInfo={routeInfo}
                view="canvas"
                selectedId={selectedId}
                zoom={zoom}
                layoutPreference={layoutPreference}
                onLayoutPreferenceChange={(preference) => { layoutPreference.value = preference; }}
                notice={notice}
                onZoomChange={(next) => { zoom.value = next; }}
                onSelect={select}
                onAddChild={addChild}
                onDuplicate={(pageId) => { dispatch({ type: "duplicate", pageId }); }}
                onDelete={requestDelete}
                onCreateRoot={() => { dispatch({ type: "addRoot", title: "Home" }); }}
              />
            )}</Show>
          </>
        }
        inspector={
          <InspectorPanel
            sitemap={derive(() => [activeSitemap.value] as const, (active) => ({ providerId, recordId: record.id, active }))}
            document={document}
            node={selectedNode}
            routes={routes}
            catalog={catalog}
            mappingCatalog={mappingCatalog}
            routeInfo={computed(() => { const id = selectedId.value; return id ? routeExpansion.value?.nodes.get(id) : undefined; })}
            rails={rails}
            onUpdatePropsDebounced={controller.updatePropsDebounced}
            onFlushPropUpdates={controller.flushPropUpdates}
            onUpdateSource={(pageId, source) => { dispatch({ type: "updateProps", pageId, patch: { source } }); }}
            onReparent={(pageId, parentId) => { dispatch({
              type: "move",
              pageId,
              targetParentId: parentId,
              targetIndex: index.value.byId.get(parentId)?.node.children.length ?? 0,
            }); }}
            onDelete={requestDelete}
            onConfirm={(request) => confirm.request({ ...request, tone: "danger" })}
          />
        }
      />
      <SitemapNameDialog
        open={computed(() => nameDialog.value !== null)}
        title={computed(() => (nameDialog.value?.kind === "page" ? "Rename page" : "Rename sitemap"))}
        description={computed(() => { const current = nameDialog.value; return current?.kind === "page" ? `Choose a new name for ${current.title}.` : `Choose a new name for ${document.value.name}.`; })}
        label={computed(() => (nameDialog.value?.kind === "page" ? "Page title" : "Sitemap name"))}
        submitLabel="Save name"
        initialValue={computed(() => { const current = nameDialog.value; return current?.kind === "page" ? current.title : document.value.name; })}
        onSubmit={(value) => {
          const current = nameDialog.value;
          if (current?.kind === "page") dispatch({ type: "updateProps", pageId: current.pageId, patch: { title: value } });
          else dispatch({ type: "rename", name: value });
          nameDialog.value = null;
        }}
        onClose={() => { nameDialog.value = null; }}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </EditorChrome>
  );
}

export default SitemapperIntegration;
