"use client";

// The central Composer integration hook (issue #251). This is the single place
// every surface's callbacks are composed against #247's ONE controller/reducer.
// It is also the seam waves 6-9 (#254 chooser-preview, #255 clipboard, #256
// menus, #257 inline-edit, #258 DnD) extend: they can call this hook to obtain
// the live session/document/selection and the shared chooser + callback set
// without re-deriving any of it.
//
// Manifest reconciliation (the one non-obvious wiring detail):
//   - the tree (#250) and chooser (#250) want BOTH the RICHER
//     `ComponentDefinition[]` array (title/category/description) AND the
//     model-side `ComponentCatalog` (for slot/traversal/diagnostic helpers);
//   - the inspector (#249), the export generator (#245), and the controller
//     model (#245/#247) want only the model-side `ComponentCatalog` lookup.
//   `ComponentDefinition` is a structural superset of the model's
//   `ComponentManifestEntry`, so ONE richer array is the source of truth and the
//   `ComponentCatalog` is DERIVED from it (`createComponentCatalog`) exactly ONCE,
//   here — never a second, drift-prone (or redundantly re-validated) manifest.
//   The controller is handed that same derived `manifest`, and `composer-
//   integration.tsx` passes that identical `controller.manifest` down to the
//   tree/chooser too (alongside the raw `manifestEntries` array), so
//   `createComponentCatalog` never runs more than once per `manifestEntries` change
//   (issue #290) and `controller.manifest` is identical to what the
//   inspector/export/tree/chooser all receive.

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  ComposerReuseResolutionOptions,
  CompositionRecord,
  GlobalTemplateResolutionOutcome,
  InsertionTarget,
} from "../../../composer";
import { compositionRecordRefKey, createComponentCatalog } from "../../../composer";
import type { ComponentPackManifest } from "@zudo-composer/component-contract";
import type { ComponentDefinition } from "../active-pack";
import type { ComposerCanvasViewport } from "../chrome/controller-model";
import {
  useComposerController,
  type ComposerController,
  type UseComposerControllerOptions,
} from "../chrome/use-composer-controller";
import type { PreviewSession, PreviewTheme } from "../preview";
import {
  useComposerExport,
  type UseComposerExportResult,
} from "../ui/export/use-composer-export";
import { useHostTheme } from "./use-host-theme";
import { getPersistedViewport, setPersistedViewport } from "./viewport";

export interface UseComposerIntegrationOptions {
  /** Explicit serializable component pack shared with the controller and preview. */
  manifest: ComponentPackManifest;
  /** Forwarded to `useComposerController` (sample/idFactory overrides for tests). */
  controllerOptions: Omit<UseComposerControllerOptions, "manifest">;
  /**
   * Optional parent-owned, read-only Global-template resolver. The iframe
   * never receives this provider-facing capability or its loaded source data.
   */
  reuseResolution?: ComposerReuseResolutionOptions;
}

export interface ComposerChooserState {
  open: boolean;
  target: InsertionTarget | null;
}

export interface ComposerIntegrationApi {
  controller: ComposerController;
  /** The richer array — feed the tree + chooser. */
  manifestEntries: readonly ComponentDefinition[];
  /** The live preview snapshot's session half (mode + theme + selection). */
  session: PreviewSession;
  theme: PreviewTheme;
  viewport: ComposerCanvasViewport;
  /** Set + persist the canvas viewport. */
  setViewport: (viewport: ComposerCanvasViewport) => void;
  chooser: ComposerChooserState;
  openChooser: (target: InsertionTarget) => void;
  closeChooser: () => void;
  exportState: UseComposerExportResult;
  /** Latest parent-app resolver outcome for this provider-qualified record. */
  reuseResolution: GlobalTemplateResolutionOutcome | null;
  /** Friendly display name for a component id, from the richer catalog. */
  titleFor: (componentId: string) => string | undefined;

  // ── Composed callbacks (all resolve to the one controller) ────────────────
  /** Canvas selection: a real node reveals (selects + expands ancestors); `null` clears. */
  handleCanvasSelect: (nodeId: string | null) => void;
  /** Canvas insert point → open the shared parent chooser for that exact target. */
  handleCanvasRequestAdd: (target: InsertionTarget) => void;
  /** Chooser confirm → add the component at the captured target. */
  handleChooserAdd: (target: InsertionTarget, componentId: string) => void;
  /** Chooser expand-ancestors → reveal the freshly added node in the tree. */
  handleExpandAncestors: (nodeIds: string[]) => void;
  /** Keyboard remove → remove the given (selected) node. */
  handleRemoveSelected: (nodeId: string) => void;
  /** Keyboard Escape → close any open menu/dialog. */
  handleEscape: () => void;

  // ── Clipboard/duplicate seam (issue #255; wave 7's #256 menus call these) ──
  /** Copy: session clipboard = a snapshot of the node. Refused (via `controller.lastError`) for opaque nodes. */
  handleCopy: (nodeId: string) => void;
  /** Cut: copy + remove, with #245's selection repair. Refused for opaque nodes. */
  handleCut: (nodeId: string) => void;
  /** Paste: clone-with-new-ids + insert-subtree at `target`, then select + reveal it. An incompatible target surfaces via `controller.lastError`, never a silent no-op. */
  handlePaste: (target: InsertionTarget) => void;
  /** Duplicate: clone-with-new-ids + insert immediately after the source, then select + reveal it. Refused for opaque nodes. */
  handleDuplicate: (nodeId: string) => void;

  // ── Inline canvas editing (issue #257) ────────────────────────────────────
  /**
   * A canvas inline edit that PASSED the host's revision check → route the value
   * through the controller's EXISTING `updateProps` (no second mutation path).
   * The inspector, tree, and canvas all read the same document, so they update
   * live. Field-domain validation stays `updateProps`'s job.
   */
  handleCommitInlineEdit: (nodeId: string, fieldKey: string, value: string) => void;

  // ── Canvas drag & drop (issue #258) ───────────────────────────────────────
  /**
   * A canvas drag & drop that PASSED the host's revision check → route the
   * move (or Alt-copy) through the controller's `drop` action, which atomically
   * revalidates and applies it, then selects + reveals the moved/new node.
   */
  handleDropNode: (sourceNodeId: string, target: InsertionTarget, copy: boolean) => void;
}

export function useComposerIntegration(
  options: UseComposerIntegrationOptions,
): ComposerIntegrationApi {
  const manifestEntries = options.manifest.components;
  const manifest = useMemo(() => createComponentCatalog(options.manifest), [options.manifest]);
  const controller = useComposerController({ manifest, ...options.controllerOptions });
  const { state } = controller;
  const [reuseResolution, setReuseResolution] = useState<GlobalTemplateResolutionOutcome | null>(null);
  const reuseRequestGeneration = useRef(0);
  const setRootPolicyRef = useRef(controller.setRootPolicy);
  setRootPolicyRef.current = controller.setRootPolicy;

  const reuseConfig = options.reuseResolution;
  const reuseRefKey = reuseConfig ? compositionRecordRefKey(reuseConfig.ref) : null;
  const boundSourceKey = state.document.binding
    ? `${state.document.binding.sourceRecordId}:${state.document.binding.outletId}`
    : null;
  const consumerRecord = useMemo<CompositionRecord>(
    () => ({ ...controller.record, document: state.document }),
    [controller.record, state.document],
  );

  // A provider navigation, a consumer refresh, or a relevant source-save
  // token invalidates the preceding read. Stores currently do not expose
  // cancellation, so the essential guarantee is that a late result cannot
  // update this controller's policy after the active document has changed.
  useEffect(() => {
    const generation = ++reuseRequestGeneration.current;
    if (!reuseConfig) {
      setReuseResolution(null);
      setRootPolicyRef.current({ kind: "unrestricted" });
      return;
    }
    setReuseResolution(null);
    void reuseConfig.resolver.resolve(consumerRecord).then(
      (outcome) => {
        if (generation !== reuseRequestGeneration.current) return;
        setReuseResolution(outcome);
        setRootPolicyRef.current(
          outcome.status === "resolved" || outcome.status === "incompatible-local-root"
            ? outcome.rootPolicy
            : outcome.status === "unbound"
              ? { kind: "unrestricted" }
              : { kind: "unresolved" },
        );
      },
      () => {
        if (generation !== reuseRequestGeneration.current) return;
        // A custom resolver may reject. Keep the persisted binding/local roots
        // intact and safely block bound-root writes rather than surfacing a
        // stale or unrestricted policy.
        setRootPolicyRef.current({ kind: "unresolved" });
      },
    );
    return () => {
      if (generation === reuseRequestGeneration.current) reuseRequestGeneration.current += 1;
    };
  }, [boundSourceKey, consumerRecord, reuseConfig?.refreshKey, reuseConfig?.resolver, reuseRefKey]);

  const theme = useHostTheme();

  // Restore the persisted viewport once, after mount (the controller always
  // initializes to "fluid"; dispatching during render is not allowed).
  useEffect(() => {
    const persisted = getPersistedViewport();
    if (persisted && persisted !== state.viewport) controller.setViewport(persisted);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const setViewport = useCallback(
    (viewport: ComposerCanvasViewport) => {
      setPersistedViewport(viewport);
      controller.setViewport(viewport);
    },
    [controller],
  );

  const session = useMemo<PreviewSession>(
    () => ({ mode: state.mode, theme, selectedId: state.selectedId }),
    [state.mode, theme, state.selectedId],
  );

  const [chooser, setChooser] = useState<ComposerChooserState>({ open: false, target: null });
  const openChooser = useCallback((target: InsertionTarget) => {
    setChooser({ open: true, target });
  }, []);
  const closeChooser = useCallback(() => setChooser({ open: false, target: null }), []);

  // The export hook takes a document RESOLVER, and it's the controller's
  // `flushPropUpdates` (issue #291): a debounce-pending inspector edit lands —
  // and the post-flush document is read back in the same tick — before any
  // JSX generation, so an export can never miss the tail of a typing burst.
  const exportState = useComposerExport(controller.flushPropUpdates, manifest);

  const titleFor = useMemo(() => {
    const byId = new Map(manifestEntries.map((e) => [e.id, e.title]));
    return (componentId: string) => byId.get(componentId);
  }, [manifestEntries]);

  const handleCanvasSelect = useCallback(
    (nodeId: string | null) => {
      if (nodeId === null) controller.select(null);
      else controller.reveal(nodeId);
    },
    [controller],
  );

  const handleCanvasRequestAdd = useCallback(
    (target: InsertionTarget) => openChooser(target),
    [openChooser],
  );

  const handleChooserAdd = useCallback(
    (target: InsertionTarget, componentId: string) => controller.add(target, componentId),
    [controller],
  );

  const handleExpandAncestors = useCallback(
    (nodeIds: string[]) => nodeIds.forEach((id) => controller.setExpanded(id, true)),
    [controller],
  );

  const handleRemoveSelected = useCallback(
    (nodeId: string) => controller.remove(nodeId),
    [controller],
  );

  const handleCopy = useCallback((nodeId: string) => controller.copy(nodeId), [controller]);
  const handleCut = useCallback((nodeId: string) => controller.cut(nodeId), [controller]);
  const handlePaste = useCallback((target: InsertionTarget) => controller.paste(target), [controller]);
  const handleDuplicate = useCallback((nodeId: string) => controller.duplicate(nodeId), [controller]);

  const handleCommitInlineEdit = useCallback(
    (nodeId: string, fieldKey: string, value: string) =>
      controller.updateProps(nodeId, { [fieldKey]: value }),
    [controller],
  );

  const handleDropNode = useCallback(
    (sourceNodeId: string, target: InsertionTarget, copy: boolean) =>
      controller.drop(sourceNodeId, target, copy),
    [controller],
  );

  // Keep an escape handler whose identity only changes when what it must close
  // changes, so the keyboard hook does not re-bind on every controller update.
  // Depend on `closeExport` itself (not the whole `exportState` object) so a
  // stray re-render doesn't destabilize this callback even if `exportState`'s
  // own memoization were ever loosened (issue #286).
  const { closeExport } = exportState;
  const openStateRef = useRef({ chooserOpen: chooser.open, exportOpen: exportState.open });
  openStateRef.current = { chooserOpen: chooser.open, exportOpen: exportState.open };
  const handleEscape = useCallback(() => {
    if (openStateRef.current.chooserOpen) closeChooser();
    if (openStateRef.current.exportOpen) closeExport();
  }, [closeChooser, closeExport]);

  return {
    controller,
    manifestEntries,
    session,
    theme,
    viewport: state.viewport,
    setViewport,
    chooser,
    openChooser,
    closeChooser,
    exportState,
    reuseResolution,
    titleFor,
    handleCanvasSelect,
    handleCanvasRequestAdd,
    handleChooserAdd,
    handleExpandAncestors,
    handleRemoveSelected,
    handleEscape,
    handleCopy,
    handleCut,
    handlePaste,
    handleDuplicate,
    handleCommitInlineEdit,
    handleDropNode,
  };
}
