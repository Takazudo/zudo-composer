"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The production Composer app fills `ComposerWorkspace`'s slots with the real
// surfaces and drives them all from one controller via
// `useComposerIntegration` — no second renderer/source mapping, one document
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
// The context menu is likewise mounted once: `useComposerMenus` owns which menu
// is open and its derived items, the structure rows open it with the button
// that was pressed, and `ComposerCanvasHost` opens it with an iframe-relayed
// rect translated to host coordinates — one menu, one positioning and
// dismissal implementation, regardless of origin.
//
// Two pieces of selection live here rather than in the controller. The selected
// SLOT has no node id to hold — it is a `{parentId, slotId}` pair the structure
// rail and the Reuse tab share — and the record-level dialogs are chrome, not
// document state.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import {
  generateBrowserJsxExport,
  linkedEditorPresentation,
  materializeGlobalTemplateView,
  type ComposerReuseResolutionOptions,
  type LinkedEditorLifecycleActions,
  type ReuseCatalogOutcome,
  type ReuseSelectionOutcome,
  type CompositionPublication,
  type CompositionRecordRef,
} from "../../../composer/browser";
import { useBreadcrumb, type EditorStatus } from "../../../app/chrome-context";
import { RecordTitle } from "../../../components/editor-chrome";
import { ConfirmDialog, Menu, MenuItem, MenuSeparator } from "../../../components/overlay";
import { Banner, Button, Chip } from "../../../components/ui";
import { RefreshIcon } from "../../../components/icons";
import type { ComposerComponentProvider } from "../active-pack";
import { ComposerWorkspace } from "../chrome/composer-workspace";
import type { ComposerSaveStatus } from "../chrome/controller-model";
import type { UseComposerControllerOptions } from "../chrome/use-composer-controller";
import { ComposerStructurePane, type SelectedSlot } from "../ui/tree/structure-pane";
import { ComposerChooser } from "../ui/chooser/composer-chooser";
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
import { useComposerIntegration } from "./use-composer-integration";
import { useComposerKeyboard } from "./use-composer-keyboard";
import { useComposerMenus } from "./use-composer-menus";
import type {
  ReuseAuthoringActionResult,
  ReuseDependencyCheck,
} from "../ui/shared/reuse-authoring-contract";

export interface ComposerIntegrationProps {
  /** One validated provider view shared by controller, canvas, and chooser. */
  componentProvider: ComposerComponentProvider;
  /** Forwarded to the record-scoped controller. */
  controllerOptions: Omit<UseComposerControllerOptions, "manifest">;
  /** Parent-owned, provider-scoped resolver used for linked preview/Copy behavior. */
  reuseResolution?: ComposerReuseResolutionOptions;
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

  // ── Canvas bridge test seams (production defaults) ────────────────────────
  createBridge?: typeof createComposerPreviewBridge;
  previewLocation?: ComposerPreviewLocation;
  hostWindow?: MessageTarget;
  /** Production route coordinator seam for landing debounced props before transitions. */
  registerFlushPendingProps?: (flush: (() => void) | null) => void;
  onDuplicateComposition?: () => void;
  duplicatingComposition?: boolean;
  /** Record-level delete; the owner navigates away once the record is gone. */
  onDeleteComposition?: () => void;
  navigationError?: string | null;
  onRetryNavigation?: () => void;
  navigationRetrying?: boolean;
  recoveryNotice?: string | null;
  onRetryRecovery?: () => void;
  recoveryRetrying?: boolean;
  /** Parent-owned provider relationship query used before changing a published source. */
  getPublicationDependencies?: (sourceRecordId: string) => Promise<ReuseDependencyCheck>;
}

/** The library index this editor came from, and returns to. */
const LIBRARY_HREF = formatComposerRoute({ kind: "index" });

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
function publicationChip(publication: CompositionPublication | undefined): ComponentChildren {
  if (publication === undefined) return null;
  if (publication.kind === "pattern") return <Chip tone="accent">Pattern</Chip>;
  const label = publication.outlet.label;
  return <Chip tone="accent">{label ? `Global template · ${label}` : "Global template"}</Chip>;
}

export function ComposerIntegration(props: ComposerIntegrationProps): JSX.Element {
  const [linkedRetryEpoch, setLinkedRetryEpoch] = useState(0);
  const effectiveReuseResolution = useMemo(() => {
    if (!props.reuseResolution) return undefined;
    return {
      ...props.reuseResolution,
      // Retrying a broken link is a fresh provider read even when its parent
      // record/ref is unchanged. Keep the parent's refresh token intact.
      refreshKey: [props.reuseResolution.refreshKey, linkedRetryEpoch],
    };
  }, [linkedRetryEpoch, props.reuseResolution]);
  const api = useComposerIntegration({
    componentProvider: props.componentProvider,
    controllerOptions: props.controllerOptions,
    reuseResolution: effectiveReuseResolution,
  });
  const {
    controller,
    manifestEntries,
    session,
    viewport,
    setViewport,
    chooser,
    exportState,
    titleFor,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
  } = api;
  const { state } = controller;

  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useBreadcrumb([{ label: "Compositions", href: LIBRARY_HREF }, { label: state.document.name }]);

  // A slot selection only means something while its owner is still selected and
  // still has that slot; a delete or an undo can take either away.
  const activeSlot =
    selectedSlot && selectedSlot.parentId === state.selectedId ? selectedSlot : null;

  const linkedView = useMemo(() => {
    if (!api.reuseResolution) return null;
    return materializeGlobalTemplateView(
      { ...controller.record, document: state.document },
      api.reuseResolution,
    );
  }, [api.reuseResolution, controller.record, state.document]);
  const linkedPresentation = useMemo(
    () => (linkedView ? linkedEditorPresentation(linkedView) : undefined),
    [linkedView],
  );
  const previewSnapshot = useMemo<ComposerPreviewSnapshot>(() => {
    if (linkedView?.status !== "resolved") {
      return localPreviewSnapshot(state.document, controller.record.id);
    }
    return {
      document: linkedView.localDocument,
      localRecordId: linkedView.localRuntime.recordId,
      linked: {
        sourceRecordId: linkedView.sourceRuntime.sourceRecordId,
        sourceDocument: linkedView.sourceDocument,
        outlet: linkedView.outlet,
      },
    };
  }, [controller.record.id, linkedView, state.document]);
  const linkedActions = useMemo<LinkedEditorLifecycleActions | undefined>(() => {
    if (!linkedView || linkedView.status === "local") return undefined;
    const onOpenSource = props.linkedActions?.onOpenSource;
    if (linkedView.status === "blocked") {
      return {
        onOpenSource,
        onRetry: () => setLinkedRetryEpoch((epoch) => epoch + 1),
        onRemoveBrokenBinding: props.linkedActions?.onRemoveBrokenBinding,
      };
    }
    return {
      onOpenSource,
      onDetach: props.linkedActions?.onDetach,
    };
  }, [linkedView, props.linkedActions]);
  const [patternCatalog, setPatternCatalog] = useState<ReuseCatalogOutcome | undefined>(undefined);
  const [patternCatalogLoading, setPatternCatalogLoading] = useState(false);
  const patternCatalogRequest = useRef(0);
  const browserCopyOutcome = useMemo(() => {
    const exportDocument = exportState.exportDocument;
    if (!exportDocument) return null;
    return generateBrowserJsxExport({
      record: { ...controller.record, document: exportDocument },
      manifest: controller.manifest,
      resolution: api.reuseResolution,
    });
  }, [api.reuseResolution, controller.manifest, controller.record, exportState.exportDocument]);
  const readOnly = state.mode === "preview";
  const menus = useComposerMenus(api);

  // A catalog is intentionally re-read for every chooser session. A source
  // can be unpublished/deleted or changed to another reusable role while the
  // editor remains mounted; selection still performs a second, full-record
  // read before the atomic controller command runs.
  useEffect(() => {
    const request = ++patternCatalogRequest.current;
    if (!chooser.open || !props.listPatternCatalog) {
      setPatternCatalog(undefined);
      setPatternCatalogLoading(false);
      return;
    }

    setPatternCatalog(undefined);
    setPatternCatalogLoading(true);
    void props.listPatternCatalog().then(
      (outcome) => {
        if (request !== patternCatalogRequest.current) return;
        setPatternCatalog(outcome);
        setPatternCatalogLoading(false);
      },
      (reason) => {
        if (request !== patternCatalogRequest.current) return;
        setPatternCatalog({
          status: "load-error",
          message: reason instanceof Error ? reason.message : "Patterns could not be loaded.",
        });
        setPatternCatalogLoading(false);
      },
    );

    return () => {
      patternCatalogRequest.current += 1;
    };
  }, [chooser.open, props.listPatternCatalog]);

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
    if (state.document.publication?.kind === "pattern") {
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
    const current = state.document.publication;
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

  useEffect(() => {
    props.registerFlushPendingProps?.(controller.flushPropUpdates);
    return () => props.registerFlushPendingProps?.(null);
  }, [controller.flushPropUpdates, props.registerFlushPendingProps]);

  useComposerKeyboard({
    mode: state.mode,
    selectedId: state.selectedId,
    onRemoveSelected: api.handleRemoveSelected,
    onEscape: api.handleEscape,
    onUndo: handleUndo,
    onRedo: handleRedo,
    canUndo,
    canRedo,
    menuOpen: menus.controller.open,
  });

  const publication = state.document.publication;
  const dangerItems = menus.items.filter((item) => item.danger === true);
  const plainItems = menus.items.filter((item) => item.danger !== true);

  return (
    <ComposerWorkspace
      back={{ href: LIBRARY_HREF, label: "Back to Compositions" }}
      title={
        <>
          <RecordTitle
            value={state.document.name}
            label="Composition name"
            disabled={readOnly}
            onCommit={(name) => controller.rename(name)}
          />
          {publicationChip(publication)}
        </>
      }
      status={statusOf(state.saveStatus, controller.retrySave)}
      dirty={state.saveStatus.kind !== "saved"}
      center={
        <ComposerViewControls
          mode={state.mode}
          viewport={viewport}
          onSetMode={controller.setMode}
          onSetViewport={setViewport}
        />
      }
      right={({ toggleRail }) => (
        <ComposerToolbarActions
          onUndo={handleUndo}
          onRedo={handleRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          onExport={exportState.openExport}
          derivedOutput={state.derivedOutput}
          clipboard={state.clipboard}
          titleFor={titleFor}
          onDuplicateComposition={props.onDuplicateComposition}
          duplicatingComposition={props.duplicatingComposition}
          onRenameComposition={() => setRenaming(true)}
          onDeleteComposition={props.onDeleteComposition ? () => setDeleting(true) : undefined}
          onToggleStructure={() => toggleRail("nav")}
          onToggleInspector={() => toggleRail("insp")}
        />
      )}
      banner={
        <>
          {props.navigationError && (
            <Banner
              tone="err"
              action={
                props.onRetryNavigation && (
                  <Button size="sm" disabled={props.navigationRetrying} onClick={props.onRetryNavigation}>
                    <RefreshIcon size="sm" />
                    {props.navigationRetrying ? "Retrying navigation…" : "Retry navigation"}
                  </Button>
                )
              }
            >
              {props.navigationError}
            </Banner>
          )}
          {props.recoveryNotice && (
            <Banner
              tone="warn"
              action={
                props.onRetryRecovery && (
                  <Button size="sm" disabled={props.recoveryRetrying} onClick={props.onRetryRecovery}>
                    <RefreshIcon size="sm" />
                    {props.recoveryRetrying ? "Retrying recovery…" : "Retry recovery"}
                  </Button>
                )
              }
            >
              {props.recoveryNotice}
            </Banner>
          )}
        </>
      }
      tree={
        <ComposerStructurePane
          document={state.document}
          manifest={controller.manifest}
          entries={manifestEntries}
          selectedId={state.selectedId}
          revealEpoch={api.revealEpoch}
          selectedSlot={activeSlot}
          onSelectNode={api.revealNode}
          onSelectSlot={setSelectedSlot}
          onSelectDocument={() => controller.select(null)}
          onOpenChooser={api.openChooser}
          onOpenNodeMenu={menus.handleTreeOpenNodeMenu}
          onOpenInsertMenu={menus.handleTreeOpenInsertMenu}
          readOnly={readOnly}
          linkedPresentation={linkedPresentation}
          linkedActions={linkedActions}
        />
      }
      canvas={
        <ComposerCanvasHost
          componentProvider={props.componentProvider}
          document={state.document}
          session={session}
          viewport={viewport}
          onSelect={api.handleCanvasSelect}
          onRequestAdd={api.handleCanvasRequestAdd}
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
          onOpenSource={linkedActions?.onOpenSource}
        />
      }
      inspector={
        <InspectorPanel
          document={state.document}
          manifest={controller.manifest}
          selectedId={state.selectedId}
          selectedSlot={activeSlot}
          mode={state.mode}
          onUpdateProps={controller.updateProps}
          onUpdatePropsDebounced={controller.updatePropsDebounced}
          onFlushPendingProps={controller.flushPropUpdates}
          onRemove={controller.remove}
          onCopy={api.handleCopy}
          onDuplicate={api.handleDuplicate}
          onJumpToSlot={setSelectedSlot}
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
      <Menu controller={menus.controller} label={menus.label}>
        {plainItems.map((item) => (
          <MenuItem key={item.id} disabled={item.disabled} closeOnSelect={false} onSelect={item.onSelect}>
            {item.label}
          </MenuItem>
        ))}
        {dangerItems.length > 0 && <MenuSeparator />}
        {dangerItems.map((item) => (
          <MenuItem key={item.id} tone="danger" disabled={item.disabled} closeOnSelect={false} onSelect={item.onSelect}>
            {item.label}
          </MenuItem>
        ))}
      </Menu>

      <ComposerChooser
        componentProvider={props.componentProvider}
        open={chooser.open}
        target={chooser.target}
        document={state.document}
        manifest={controller.manifest}
        entries={manifestEntries}
        onAdd={api.handleChooserAdd}
        onExpandAncestors={api.handleExpandAncestors}
        onClose={api.closeChooser}
        patternCatalog={patternCatalog}
        patternCatalogLoading={patternCatalogLoading}
        loadPattern={props.loadPattern}
        rootPolicy={state.rootPolicy}
        onInsertPattern={(target, sourceRoots) => controller.insertForest(sourceRoots, target)}
      />

      <ComposerExportDialog
        open={exportState.open}
        onClose={exportState.closeExport}
        documentName={state.document.name}
        result={exportState.result}
        copyOutcome={browserCopyOutcome}
      />

      <ComposerRenameDialog
        open={renaming}
        value={state.document.name}
        onSubmit={(name) => {
          controller.rename(name);
          setRenaming(false);
        }}
        onClose={() => setRenaming(false)}
      />

      <ConfirmDialog
        open={deleting}
        title={`Delete ${state.document.name}?`}
        message="The composition and its components are deleted. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          setDeleting(false);
          props.onDeleteComposition?.();
        }}
        onClose={() => setDeleting(false)}
      />
    </ComposerWorkspace>
  );
}

ComposerIntegration.displayName = "ComposerIntegration";
