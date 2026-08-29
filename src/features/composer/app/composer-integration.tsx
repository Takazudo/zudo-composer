"use client";

/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The production Composer app (issue #251). Fills #247's `ComposerWorkspace`
// slots with the real surfaces and drives them all from ONE controller via
// `useComposerIntegration` — no second renderer/source mapping, one document
// snapshot everywhere:
//
//   toolbar   → #249 pieces (composed in ComposerToolbarBar) + viewport control
//   banner    → current provider/navigation recovery status
//   tree      → #250 structure rail (read-only in Preview)
//   canvas    → the #248 preview iframe host (ComposerCanvasHost)
//   inspector → #249 schema-driven inspector
//
// The shared component chooser (#250) is mounted ONCE here, at app level —
// opened by BOTH tree slot Adds and canvas insert-point `request-add`s, capturing
// its target on open so a later selection change cannot redirect an in-flight
// add. The export dialog (#249) reads the SAME document/manifest the canvas does.
//
// The context menu (#256) is likewise mounted ONCE here: `useComposerMenus`
// owns which menu is open and its derived items, `ComposerTree` opens it via
// its `onOpenNodeMenu`/`onOpenInsertMenu` callbacks, and `ComposerCanvasHost`
// opens it via the SAME two callbacks after translating the iframe-relayed
// rect to host coordinates — one menu, one positioning/dismissal
// implementation, regardless of origin.
//
// This file is deliberately thin: state lives in the controller, callback
// composition lives in `useComposerIntegration`, layout lives in
// `ComposerWorkspace`. It is the surface waves 6-9 extend.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import {
  generateBrowserJsxExport,
  linkedEditorPresentation,
  materializeGlobalTemplateView,
  type ComposerReuseResolutionOptions,
  type LinkedEditorLifecycleActions,
  type ReuseCatalogOutcome,
  type ReuseSelectionOutcome,
  type CompositionRecordRef,
} from "../../../composer/browser";
import type { ComposerComponentProvider } from "../active-pack";
import { ComposerWorkspace } from "../chrome/composer-workspace";
import type { UseComposerControllerOptions } from "../chrome/use-composer-controller";
import { ComposerTree } from "../ui/tree/composer-tree";
import { ComposerChooser } from "../ui/chooser/composer-chooser";
import { ComposerMenu } from "../ui/menu/composer-menu";
import { SubtreeRemovalConfirm } from "../ui/tree/tree-row-actions";
import { InspectorPanel } from "../ui/inspector/inspector-panel";
import { ComposerExportDialog } from "../ui/export/export-dialog";
import {
  createComposerPreviewBridge,
  localPreviewSnapshot,
  type ComposerPreviewLocation,
  type ComposerPreviewSnapshot,
  type MessageTarget,
} from "../preview";
import { ComposerCanvasHost } from "./composer-canvas-host";
import { ComposerToolbarBar } from "./composer-toolbar-bar";
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
  onNavigateToLibrary?: () => void;
  onDuplicateComposition?: () => void;
  duplicatingComposition?: boolean;
  navigationError?: string | null;
  onRetryNavigation?: () => void;
  navigationRetrying?: boolean;
  recoveryNotice?: string | null;
  onRetryRecovery?: () => void;
  recoveryRetrying?: boolean;
  /** Parent-owned provider relationship query used before changing a published source. */
  getPublicationDependencies?: (sourceRecordId: string) => Promise<ReuseDependencyCheck>;
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
  const { controller, manifestEntries, session, viewport, setViewport, chooser, exportState, titleFor } = api;
  const { state } = controller;
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
    menuOpen: menus.open,
  });

  return (
    <>
      <ComposerWorkspace
        treeWidthPx={state.leftWidth}
        inspectorWidthPx={state.rightWidth}
        banner={
          <>
            {props.navigationError && (
              <div class="sg-composer-library-alert sg-composer-library-alert-error" role="alert">
                <p>{props.navigationError}</p>
                {props.onRetryNavigation && (
                  <button
                    type="button"
                    class="sg-composer-library-button"
                    disabled={props.navigationRetrying}
                    onClick={props.onRetryNavigation}
                  >
                    {props.navigationRetrying ? "Retrying navigation…" : "Retry navigation"}
                  </button>
                )}
              </div>
            )}
            {props.recoveryNotice && (
              <div class="sg-composer-library-alert" aria-label="Composition recovery notice">
                <p>{props.recoveryNotice}</p>
                {props.onRetryRecovery && (
                  <button
                    type="button"
                    class="sg-composer-library-button"
                    disabled={props.recoveryRetrying}
                    onClick={props.onRetryRecovery}
                  >
                    {props.recoveryRetrying ? "Retrying recovery…" : "Retry recovery"}
                  </button>
                )}
              </div>
            )}
          </>
        }
        toolbar={
          <ComposerToolbarBar
            documentName={state.document.name}
            publication={state.document.publication}
            saveStatus={state.saveStatus}
            derivedOutput={state.derivedOutput}
            mode={state.mode}
            viewport={viewport}
            onSetMode={controller.setMode}
            onSetViewport={setViewport}
            onRetrySave={controller.retrySave}
            onExport={exportState.openExport}
            clipboard={state.clipboard}
            titleFor={titleFor}
            onNavigateToLibrary={props.onNavigateToLibrary}
            onDuplicateComposition={props.onDuplicateComposition}
            duplicatingComposition={props.duplicatingComposition}
          />
        }
        tree={
          <ComposerTree
            document={state.document}
            manifest={controller.manifest}
            entries={manifestEntries}
            selectedId={state.selectedId}
            expandedIds={state.expandedIds}
            onSelect={controller.select}
            onReveal={controller.reveal}
            onToggleExpanded={controller.toggleExpanded}
            onOpenChooser={api.openChooser}
            onReorder={controller.reorder}
            onRemove={controller.remove}
            onOpenNodeMenu={menus.handleTreeOpenNodeMenu}
            onOpenInsertMenu={menus.handleTreeOpenInsertMenu}
            readOnly={readOnly}
            onSetGlobalTemplateOutlet={setGlobalTemplateOutlet}
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
            mode={state.mode}
            onUpdateProps={controller.updateProps}
            onUpdatePropsDebounced={controller.updatePropsDebounced}
            onFlushPendingProps={controller.flushPropUpdates}
            onReorder={controller.reorder}
            onRemove={controller.remove}
            onPublishPattern={controller.publishPattern}
            onClearPublication={clearPublication}
            lastError={controller.lastError}
            titleFor={titleFor}
            linkedPresentation={linkedPresentation}
            linkedActions={linkedActions}
          />
        }
      />

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

      <ComposerMenu
        open={menus.open}
        label={menus.label}
        anchor={menus.anchor}
        onClose={menus.onClose}
        items={menus.items ?? undefined}
      >
        {menus.confirm && (
          <SubtreeRemovalConfirm
            nodeTitle={menus.confirm.nodeTitle}
            descendantCount={menus.confirm.descendantCount}
            onCancel={menus.onCancelConfirm}
            onConfirm={menus.onConfirmDelete}
          />
        )}
      </ComposerMenu>

      <ComposerExportDialog
        open={exportState.open}
        onClose={exportState.closeExport}
        documentName={state.document.name}
        result={exportState.result}
        copyOutcome={browserCopyOutcome}
      />
    </>
  );
}

ComposerIntegration.displayName = "ComposerIntegration";
