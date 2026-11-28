"use client";

// The production Composer app fills `ComposerWorkspace`'s slots with the real
// surfaces and drives them all from one controller via
// `createComposerIntegration` — no second renderer/source mapping, one document
// snapshot everywhere:
//
//   toolbar   → back / RecordTitle / view controls / history + Export + overflow
//   banner    → current provider/navigation recovery status
//   tree      → structure rail on the shared OutlineTree (read-only in Preview)
//   canvas    → preview iframe host (ComposerCanvasHost)
//   inspector → Properties / Slots / Reuse over the same selection
//
// The shared component chooser is mounted once here, at app level — opened by
// BOTH structure Adds and canvas insert-point `request-add`s, capturing its
// target on open so a later selection change cannot redirect an in-flight add.
// The export dialog reads the same document/manifest the canvas does.
//
// The context menu is likewise mounted once: `createComposerMenus` owns which
// menu is open and its derived items, the structure rows open it with the
// button that was pressed, and `ComposerCanvasHost` opens it with an
// iframe-relayed rect translated to host coordinates — one menu, one
// positioning and dismissal implementation, regardless of origin.
//
// Two pieces of selection live here rather than in the controller. The selected
// SLOT has no node id to hold — it is a `{parentId, slotId}` pair the structure
// rail and the Reuse tab share — and the record-level dialogs are chrome, not
// document state.

import { computed, For, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import {
  generateBrowserJsxExport,
  linkedEditorPresentation,
  materializeGlobalTemplateView,
  type ComposerReuseResolutionOptions,
  type LinkedEditorLifecycleActions,
  type LinkedEditorPresentation,
  type ReuseCatalogOutcome,
  type ReuseSelectionOutcome,
  type CompositionPublication,
  type CompositionRecordRef,
} from "../../../composer/browser";
import { bindBreadcrumb, type ChromeStore, type EditorStatus } from "../../../app/chrome-context";
import type { VersionedAssetStore } from "../../../assets/library";
import { RecordTitle } from "../../../components/editor-chrome";
import { ConfirmDialog, Menu, MenuItem, MenuSeparator } from "../../../components/overlay";
import { Banner, Button, Chip } from "../../../components/ui";
import { RefreshIcon } from "../../../components/icons";
import { read, type MaybeSignal } from "../../../components/reactive";
import { Rebuild } from "../../../components/rebuild";
import { Keyed } from "../../../runtime";
import type { ComposerComponentProvider } from "../active-pack";
import { ComposerWorkspace, createComposerEditorChrome } from "../chrome/composer-workspace";
import type { ComposerSaveStatus } from "../chrome/controller-model";
import type { ComposerControllerOptions } from "../chrome/use-composer-controller";
import { memo, memoOn } from "../reactive/memo";
import { ComposerStructurePane, type SelectedSlot } from "../ui/tree/structure-pane";
import { ComposerChooser } from "../ui/chooser/composer-chooser";
import { QuickInsertPopover } from "../ui/quick-insert/quick-insert-popover";
import { InspectorPanel } from "../ui/inspector/inspector-panel";
import { ComposerExportDialog } from "../ui/export/export-dialog";
import { ComposerRenameDialog } from "../ui/shared/rename-dialog";
import { ComposerToolbarActions } from "../ui/toolbar/toolbar-actions";
import { ComposerViewControls } from "../ui/toolbar/view-controls";
import {
  createComposerPreviewBridge,
  localPreviewSnapshot,
  type ComposerPreviewLocation,
  type ComposerPreviewSnapshot,
  type MessageTarget,
} from "../preview";
import { ComposerCanvasHost } from "./composer-canvas-host";
import { formatComposerRoute } from "../routing";
import { createComposerIntegration } from "./use-composer-integration";
import { bindComposerKeyboard } from "./use-composer-keyboard";
import { createComposerMenus } from "./use-composer-menus";
import type {
  ReuseAuthoringActionResult,
  ReuseDependencyCheck,
} from "../ui/shared/reuse-authoring-contract";

export interface ComposerIntegrationProps {
  /** One validated provider view shared by controller, canvas, and chooser. */
  componentProvider: ComposerComponentProvider;
  /** Forwarded to the record-scoped controller. */
  controllerOptions: Omit<ComposerControllerOptions, "manifest">;
  /** Parent-owned, provider-scoped resolver used for linked preview/Copy behavior. */
  reuseResolution?: MaybeSignal<ComposerReuseResolutionOptions | undefined>;
  /**
   * Read the active provider's saved-Pattern catalog for this mounted record.
   * The owner binds its current provider and record identity into this callback,
   * keeping provider I/O out of the Composer surface.
   */
  listPatternCatalog?: () => Promise<ReuseCatalogOutcome>;
  /** Load one catalog Pattern through that same active-provider boundary. */
  loadPattern?: (ref: CompositionRecordRef) => Promise<ReuseSelectionOutcome>;
  /** Provider-owned linked-template actions; this surface never receives the provider itself. */
  linkedActions?: Pick<
    LinkedEditorLifecycleActions,
    "onOpenSource" | "onDetach" | "onRemoveBrokenBinding"
  >;
  /** The app chrome store the breadcrumb and save state are published into. */
  appChrome?: ChromeStore | null;
  /** The workspace's versioned Asset store, for resolving managed Asset references. */
  assetStore?: VersionedAssetStore;

  // ── Canvas bridge test seams (production defaults) ────────────────────────
  createBridge?: typeof createComposerPreviewBridge;
  previewLocation?: ComposerPreviewLocation;
  hostWindow?: MessageTarget;
  /** Production route coordinator seam for landing debounced props before transitions. */
  registerFlushPendingProps?: (flush: (() => void) | null) => void;
  onDuplicateComposition?: () => void;
  duplicatingComposition?: MaybeSignal<boolean>;
  /** Record-level delete; the owner navigates away once the record is gone. */
  onDeleteComposition?: () => void;
  navigationError?: MaybeSignal<string | null | undefined>;
  onRetryNavigation?: MaybeSignal<(() => void) | undefined>;
  navigationRetrying?: MaybeSignal<boolean>;
  recoveryNotice?: MaybeSignal<string | null | undefined>;
  onRetryRecovery?: () => void;
  recoveryRetrying?: MaybeSignal<boolean>;
  /** Parent-owned provider relationship query used before changing a published source. */
  getPublicationDependencies?: (sourceRecordId: string) => Promise<ReuseDependencyCheck>;
}

/** The library index this editor came from, and returns to. */
const LIBRARY_HREF = formatComposerRoute({ kind: "index" });

const LOCAL_PRESENTATION: LinkedEditorPresentation = { state: "local" };

/** The queue's own vocabulary, translated into the chrome's four states. */
function statusOf(status: ComposerSaveStatus, onRetry: () => void): EditorStatus {
  switch (status.kind) {
    case "saved": return { state: "saved" };
    case "saving": return { state: "saving" };
    case "dirty": return { state: "unsaved" };
    case "error": return { state: "failed", detail: status.reason, onRetry };
  }
}

/** The Pattern / Global template chip that sits beside the record's name. */
function publicationChip(publication: CompositionPublication | undefined): Child {
  if (publication === undefined) return null;
  if (publication.kind === "pattern") return <Chip tone="accent">Pattern</Chip>;
  const label = publication.outlet.label;
  return <Chip tone="accent">{label ? `Global template · ${label}` : "Global template"}</Chip>;
}

export function ComposerIntegration(props: ComposerIntegrationProps): Child {
  const scope = getScope();
  const linkedRetryEpoch = signal(0);
  const effectiveReuseResolution = memoOn(
    () => [read(props.reuseResolution), linkedRetryEpoch.value] as const,
    (reuseResolution, epoch) => reuseResolution
      ? {
        ...reuseResolution,
        // Retrying a broken link is a fresh provider read even when its parent
        // record/ref is unchanged. Keep the parent's refresh token intact.
        refreshKey: [reuseResolution.refreshKey, epoch],
      }
      : undefined,
  );
  const api = createComposerIntegration(scope, {
    componentProvider: props.componentProvider,
    controllerOptions: props.controllerOptions,
    reuseResolution: effectiveReuseResolution,
  });
  const { controller, manifestEntries, chooser, exportState, titleFor, handleUndo, handleRedo, canUndo, canRedo } = api;
  const { state } = controller;
  const manifest = controller.manifest;
  const { chrome, rails } = createComposerEditorChrome();

  const document = computed(() => state.value.document);
  const documentName = computed(() => state.value.document.name);
  const mode = computed(() => state.value.mode);
  const selectedId = computed(() => state.value.selectedId);
  const rootPolicy = computed(() => state.value.rootPolicy);
  const readOnly = computed(() => state.value.mode === "preview");

  const selectedSlot = signal<SelectedSlot | null>(null);
  const renaming = signal(false);
  const deleting = signal(false);

  bindBreadcrumb(
    scope,
    props.appChrome ?? null,
    memo(() => [{ label: "Compositions", href: LIBRARY_HREF }, { label: documentName.value }], (left, right) => left[1]!.label === right[1]!.label),
  );

  // A slot selection only means something while its owner is still selected and
  // still has that slot; a delete or an undo can take either away.
  const activeSlot = computed(() => {
    const slot = selectedSlot.value;
    return slot && slot.parentId === selectedId.value ? slot : null;
  });

  const linkedView = memoOn(
    () => [api.reuseResolution.value, document.value] as const,
    (resolution, current) => resolution
      ? materializeGlobalTemplateView({ ...controller.record, document: current }, resolution)
      : null,
  );
  const linkedPresentation = memoOn(
    () => [linkedView.value] as const,
    (view) => (view ? linkedEditorPresentation(view) : LOCAL_PRESENTATION),
  );
  const previewSnapshot = memoOn(
    () => [linkedView.value, document.value] as const,
    (view, current): ComposerPreviewSnapshot => {
      if (view?.status !== "resolved") return localPreviewSnapshot(current, controller.record.id);
      return {
        document: view.localDocument,
        localRecordId: view.localRuntime.recordId,
        linked: {
          sourceRecordId: view.sourceRuntime.sourceRecordId,
          sourceDocument: view.sourceDocument,
          outlet: view.outlet,
        },
      };
    },
  );
  const linkedActions = memoOn(
    () => [linkedView.value] as const,
    (view): LinkedEditorLifecycleActions | undefined => {
      if (!view || view.status === "local") return undefined;
      const onOpenSource = props.linkedActions?.onOpenSource;
      if (view.status === "blocked") {
        return {
          onOpenSource,
          onRetry: () => { linkedRetryEpoch.value += 1; },
          onRemoveBrokenBinding: props.linkedActions?.onRemoveBrokenBinding,
        };
      }
      return { onOpenSource, onDetach: props.linkedActions?.onDetach };
    },
  );

  const patternCatalog = signal<ReuseCatalogOutcome | undefined>(undefined);
  const patternCatalogLoading = signal(false);
  let patternCatalogRequest = 0;
  const browserCopyOutcome = memoOn(
    () => [exportState.exportDocument.value, api.reuseResolution.value] as const,
    (exportDocument, resolution) => exportDocument
      ? generateBrowserJsxExport({ record: { ...controller.record, document: exportDocument }, manifest, resolution })
      : null,
  );
  const menus = createComposerMenus(scope, api);

  // A catalog is intentionally re-read for every chooser session. A source
  // can be unpublished/deleted or changed to another reusable role while the
  // editor remains mounted; selection still performs a second, full-record
  // read before the atomic controller command runs.
  let seenChooserOpen: boolean | null = null;
  scope.effect(() => {
    const open = chooser.value.open;
    if (seenChooserOpen === open) return;
    seenChooserOpen = open;
    const request = ++patternCatalogRequest;
    const listPatternCatalog = props.listPatternCatalog;
    if (!open || !listPatternCatalog) {
      patternCatalog.value = undefined;
      patternCatalogLoading.value = false;
      return;
    }
    patternCatalog.value = undefined;
    patternCatalogLoading.value = true;
    void listPatternCatalog().then(
      (outcome) => {
        if (request !== patternCatalogRequest || scope.abortSignal.aborted) return;
        patternCatalog.value = outcome;
        patternCatalogLoading.value = false;
      },
      (reason) => {
        if (request !== patternCatalogRequest || scope.abortSignal.aborted) return;
        patternCatalog.value = {
          status: "load-error",
          message: reason instanceof Error ? reason.message : "Patterns could not be loaded.",
        };
        patternCatalogLoading.value = false;
      },
    );
  });
  scope.onCleanup(() => {
    patternCatalogRequest += 1;
  });

  const checkPublicationDependencies = async (): Promise<ReuseDependencyCheck> => {
    if (!props.getPublicationDependencies) {
      return {
        status: "unavailable",
        message: "The current Composition provider cannot verify template consumers yet.",
      };
    }
    try {
      return await props.getPublicationDependencies(controller.record.id);
    } catch (reason) {
      return {
        status: "load-error",
        message: reason instanceof Error ? reason.message : "Template consumer relationships could not be loaded.",
      };
    }
  };

  const clearPublication = async (): Promise<ReuseAuthoringActionResult> => {
    if (state.value.document.publication?.kind === "pattern") {
      controller.clearPublication({ dependentCount: 0 });
      return { status: "applied" };
    }
    const check = await checkPublicationDependencies();
    if (check.status !== "ready") return { status: "unavailable", message: check.message };
    if (check.dependentCount > 0) {
      return {
        status: "blocked",
        message: `Cannot unpublish this Global template while ${check.dependentCount} consumer${check.dependentCount === 1 ? " is" : "s are"} still bound to it.`,
      };
    }
    controller.clearPublication({ dependentCount: check.dependentCount });
    return { status: "applied" };
  };

  const setGlobalTemplateOutlet = async (
    target: { parentId: string; slotId: string },
    label: string,
  ): Promise<ReuseAuthoringActionResult> => {
    const current = state.value.document.publication;
    const reassigning = current?.kind === "global-template"
      && (current.outlet.target.parentId !== target.parentId || current.outlet.target.slotId !== target.slotId);
    if (reassigning) {
      const check = await checkPublicationDependencies();
      if (check.status !== "ready") return { status: "unavailable", message: check.message };
      controller.setGlobalTemplateOutlet(target, label);
      return check.dependentCount > 0
        ? {
          status: "applied",
          message: `${check.dependentCount} existing consumer${check.dependentCount === 1 ? " keeps" : "s keep"} the stable outlet ID and will follow this reassignment.`,
        }
        : { status: "applied" };
    }
    controller.setGlobalTemplateOutlet(target, label);
    return { status: "applied" };
  };

  scope.onActivate(() => {
    props.registerFlushPendingProps?.(controller.flushPropUpdates);
  });
  scope.onCleanup(() => props.registerFlushPendingProps?.(null));

  bindComposerKeyboard(scope, {
    mode,
    selectedId,
    onRemoveSelected: api.handleRemoveSelected,
    onEscape: api.handleEscape,
    onUndo: handleUndo,
    onRedo: handleRedo,
    canUndo,
    canRedo,
    menuOpen: menus.controller.open,
  });

  const status = computed(() => statusOf(state.value.saveStatus, controller.retrySave));
  const dirty = computed(() => state.value.saveStatus.kind !== "saved");
  const publication = computed(() => state.value.document.publication);
  const dangerItems = computed(() => menus.items.value.filter((item) => item.danger === true));
  const plainItems = computed(() => menus.items.value.filter((item) => item.danger !== true));

  const hasNavigationError = computed(() => Boolean(read(props.navigationError)));
  const hasRecoveryNotice = computed(() => Boolean(read(props.recoveryNotice)));
  const navigationRetrying = computed(() => Boolean(read(props.navigationRetrying)));
  const recoveryRetrying = computed(() => Boolean(read(props.recoveryRetrying)));
  const retryNavigation = computed(() => read(props.onRetryNavigation));
  const banner = memoOn(
    () => [hasNavigationError.value, hasRecoveryNotice.value, Boolean(retryNavigation.value)] as const,
    (navigation, recovery, canRetryNavigation): Child => {
      if (!navigation && !recovery) return null;
      return (
        <>
          {navigation ? (
            <Banner
              tone="err"
              action={canRetryNavigation ? (
                <Button size="sm" disabled={navigationRetrying} on:click={() => retryNavigation.value?.()}>
                  <RefreshIcon size="sm" />
                  {computed(() => (navigationRetrying.value ? "Retrying navigation…" : "Retry navigation"))}
                </Button>
              ) : null}
            >
              {computed(() => read(props.navigationError) ?? "")}
            </Banner>
          ) : null}
          {recovery ? (
            <Banner
              tone="warn"
              action={props.onRetryRecovery ? (
                <Button size="sm" disabled={recoveryRetrying} on:click={() => props.onRetryRecovery?.()}>
                  <RefreshIcon size="sm" />
                  {computed(() => (recoveryRetrying.value ? "Retrying recovery…" : "Retry recovery"))}
                </Button>
              ) : null}
            >
              {computed(() => read(props.recoveryNotice) ?? "")}
            </Banner>
          ) : null}
        </>
      );
    },
  );

  return (
    <ComposerWorkspace
      back={{ href: LIBRARY_HREF, label: "Back to Compositions" }}
      chrome={chrome}
      rails={rails}
      appChrome={props.appChrome ?? null}
      title={
        <>
          <RecordTitle
            value={documentName}
            label="Composition name"
            disabled={readOnly}
            onCommit={(name) => controller.rename(name)}
          />
          <Rebuild value={publication}>{(current) => publicationChip(current)}</Rebuild>
        </>
      }
      status={status}
      dirty={dirty}
      center={
        <ComposerViewControls
          mode={mode}
          viewport={api.viewport}
          onSetMode={controller.setMode}
          onSetViewport={api.setViewport}
        />
      }
      right={({ toggleRail }) => (
        <ComposerToolbarActions
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onExport={exportState.openExport}
          derivedOutput={computed(() => state.value.derivedOutput)}
          clipboard={computed(() => state.value.clipboard)}
          titleFor={titleFor}
          onDuplicateComposition={props.onDuplicateComposition}
          duplicatingComposition={props.duplicatingComposition}
          onRenameComposition={() => { renaming.value = true; }}
          onDeleteComposition={props.onDeleteComposition ? () => { deleting.value = true; } : undefined}
          onToggleStructure={() => toggleRail("nav")}
          onToggleInspector={() => toggleRail("insp")}
        />
      )}
      banner={banner}
      tree={
        <ComposerStructurePane
          document={document}
          manifest={manifest}
          entries={manifestEntries}
          rootPolicy={rootPolicy}
          selectedId={selectedId}
          revealEpoch={api.revealEpoch}
          selectedSlot={activeSlot}
          onSelectNode={api.revealNode}
          onSelectSlot={(slot) => { selectedSlot.value = slot; }}
          onSelectDocument={() => controller.select(null)}
          onOpenChooser={api.openChooser}
          onOpenNodeMenu={menus.handleTreeOpenNodeMenu}
          onOpenInsertMenu={menus.handleTreeOpenInsertMenu}
          readOnly={readOnly}
          linkedPresentation={linkedPresentation}
          linkedActions={linkedActions}
          chrome={chrome}
          rails={rails}
        />
      }
      canvas={
        <ComposerCanvasHost
          componentProvider={props.componentProvider}
          document={document}
          session={api.session}
          viewport={api.viewport}
          onSelect={api.handleCanvasSelect}
          onRequestAdd={api.handleCanvasRequestAdd}
          onRequestQuickInsert={menus.requestQuickInsert}
          onRequestNodeMenu={menus.openNodeMenu}
          onRequestInsertMenu={menus.openInsertMenu}
          onCommitInlineEdit={api.handleCommitInlineEdit}
          onDropNode={api.handleDropNode}
          onRequestUndo={handleUndo}
          onRequestRedo={handleRedo}
          createBridge={props.createBridge}
          location={props.previewLocation}
          hostWindow={props.hostWindow}
          snapshot={previewSnapshot}
          onOpenSource={(sourceRecordId) => linkedActions.value?.onOpenSource?.(sourceRecordId)}
          assetStore={props.assetStore}
        />
      }
      inspector={
        <InspectorPanel
          document={document}
          manifest={manifest}
          entries={manifestEntries}
          selectedId={selectedId}
          selectedSlot={activeSlot}
          rootPolicy={rootPolicy}
          mode={mode}
          rails={rails}
          onUpdateProps={controller.updateProps}
          onUpdatePropsDebounced={controller.updatePropsDebounced}
          onFlushPendingProps={controller.flushPropUpdates}
          onRemove={controller.remove}
          onCopy={api.handleCopy}
          onDuplicate={api.handleDuplicate}
          onJumpToSlot={(slot) => { selectedSlot.value = slot; }}
          onPublishPattern={controller.publishPattern}
          onClearPublication={clearPublication}
          onSetGlobalTemplateOutlet={setGlobalTemplateOutlet}
          lastError={controller.lastError}
          titleFor={titleFor}
          linkedPresentation={linkedPresentation}
          linkedActions={linkedActions}
        />
      }
    >
      {/* The canvas menu has no host-side trigger to measure, so it is anchored
          to this zero-size element, parked at the iframe-relayed rect. */}
      <span ref={menus.anchorRef} class="sg-composer-menu-anchor" aria-hidden="true" />
      {/* The key carries the label too: a menu's accessible name is fixed per mount. */}
      <Keyed value={computed(() => `${menus.menuKey.value}\u0000${menus.label.value}`)} by={(key) => key}>
        {() => (
          <Menu controller={menus.controller} label={menus.label.value}>
            <Rebuild value={menus.quickInsert}>{(quickInsert) => (quickInsert ? <QuickInsertPopover {...quickInsert} /> : null)}</Rebuild>
            <For each={plainItems} by={(item) => item.id}>
              {(item) => (
                <MenuItem
                  disabled={computed(() => item.value.disabled === true)}
                  closeOnSelect={false}
                  onSelect={() => item.value.onSelect()}
                >
                  {computed(() => item.value.label)}
                </MenuItem>
              )}
            </For>
            <Show when={computed(() => dangerItems.value.length > 0)}>
              {() => <MenuSeparator />}
            </Show>
            <For each={dangerItems} by={(item) => item.id}>
              {(item) => (
                <MenuItem
                  tone="danger"
                  disabled={computed(() => item.value.disabled === true)}
                  closeOnSelect={false}
                  onSelect={() => item.value.onSelect()}
                >
                  {computed(() => item.value.label)}
                </MenuItem>
              )}
            </For>
          </Menu>
        )}
      </Keyed>

      <ComposerChooser
        componentProvider={props.componentProvider}
        open={computed(() => chooser.value.open)}
        target={computed(() => chooser.value.target)}
        initialTab={computed(() => chooser.value.initialTab ?? "components")}
        document={document}
        manifest={manifest}
        entries={manifestEntries}
        onAdd={api.handleChooserAdd}
        onExpandAncestors={api.handleExpandAncestors}
        onClose={api.closeChooser}
        // The tree's insert session owns the live target; a canvas add keeps the one captured on open.
        resolveTarget={() => {
          const current = chooser.value;
          return current.session ? current.session.resolveTarget() : current.target;
        }}
        onComplete={api.completeChooser}
        patternCatalog={patternCatalog}
        patternCatalogLoading={patternCatalogLoading}
        loadPattern={props.loadPattern}
        rootPolicy={rootPolicy}
        onInsertPattern={(target, sourceRoots) => controller.insertForest(sourceRoots, target)}
        assetStore={props.assetStore}
      />

      <ComposerExportDialog
        open={exportState.open}
        onClose={exportState.closeExport}
        documentName={documentName}
        result={exportState.result}
        copyOutcome={browserCopyOutcome}
      />

      <ComposerRenameDialog
        open={renaming}
        value={documentName}
        onSubmit={(name) => {
          controller.rename(name);
          renaming.value = false;
        }}
        onClose={() => { renaming.value = false; }}
      />

      <ConfirmDialog
        open={deleting}
        title={computed(() => `Delete ${documentName.value}?`)}
        message="The composition and its components are deleted. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          deleting.value = false;
          props.onDeleteComposition?.();
        }}
        onClose={() => { deleting.value = false; }}
      />
    </ComposerWorkspace>
  );
}

ComposerIntegration.displayName = "ComposerIntegration";
