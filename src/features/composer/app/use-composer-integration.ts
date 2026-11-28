"use client";

// The central Composer integration controller. This is the single place every
// surface's callbacks compose against one controller/reducer and obtain the
// live session, document, selection, clipboard, menus, and shared chooser.
//
// Provider reconciliation (the one non-obvious wiring detail):
//   - the tree (Takazudo/zudo-sg#250) and chooser (Takazudo/zudo-sg#250) want BOTH the RICHER
//     `ComponentDefinition[]` array (title/category/description) AND the
//     model-side `ComponentCatalog` (for slot/traversal/diagnostic helpers);
//   - the inspector (Takazudo/zudo-sg#249), the export generator (Takazudo/zudo-sg#245), and the controller
//     model (Takazudo/zudo-sg#245/#247) want only the model-side `ComponentCatalog` lookup.
//   The validated provider view owns both projections. The controller receives
//   that exact catalog object, and `composer-
//   integration.tsx` passes that identical `controller.manifest` down to the
//   tree/chooser too (alongside the raw `manifestEntries` array), so
//   `controller.manifest` is identical to what the
//   inspector/export/tree/chooser all receive.

import { computed, signal, type ReadonlySignal, type Scope } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../../../components/reactive";
import { memo } from "../reactive/memo";
import type {
  ComposerReuseResolutionOptions,
  CompositionRecord,
  GlobalTemplateResolutionOutcome,
  InsertionTarget,
} from "../../../composer/browser";
import { compositionRecordRefKey } from "../../../composer/browser";
import type { ComponentDefinition, ComposerComponentProvider } from "../active-pack";
import type { ComposerCanvasViewport } from "../chrome/controller-model";
import {
  createComposerController,
  type ComposerController,
  type ComposerControllerOptions,
} from "../chrome/use-composer-controller";
import type { PreviewSession, PreviewTheme } from "../preview";
import type { ChooserTab } from "../ui/chooser/composer-chooser";
import {
  createComposerExport,
  type ComposerExportController,
} from "../ui/export/use-composer-export";
import { hostThemeSignal } from "./use-host-theme";
import { getPersistedViewport, setPersistedViewport } from "./viewport";

export interface ComposerIntegrationOptions {
  /** Exact validated provider shared with the controller and preview. */
  componentProvider: ComposerComponentProvider;
  /** Forwarded to `createComposerController` (including deterministic test seams). */
  controllerOptions: Omit<ComposerControllerOptions, "manifest">;
  /**
   * Optional parent-owned, read-only Global-template resolver. The iframe
   * never receives this provider-facing capability or its loaded source data.
   */
  reuseResolution?: MaybeSignal<ComposerReuseResolutionOptions | undefined>;
}

export interface ComposerChooserState {
  open: boolean;
  target: InsertionTarget | null;
  session?: ComposerInsertSession;
  initialTab?: ChooserTab;
}

/** Composer projection of the shared tree's pending-insert transaction. */
export interface ComposerInsertSession {
  resolveTarget: () => InsertionTarget | null;
  complete: (insertedId?: string) => void;
  cancel: () => void;
}

export interface ComposerIntegrationApi {
  controller: ComposerController;
  /** The richer array — feed the tree + chooser. */
  manifestEntries: readonly ComponentDefinition[];
  /** The live preview snapshot's session half (mode + theme + selection). */
  /** Stable per distinct session, so the canvas can compare it by identity. */
  session: ReadonlySignal<PreviewSession>;
  theme: ReadonlySignal<PreviewTheme>;
  viewport: ReadonlySignal<ComposerCanvasViewport>;
  /** Set + persist the canvas viewport. */
  setViewport: (viewport: ComposerCanvasViewport) => void;
  chooser: ReadonlySignal<ComposerChooserState>;
  openChooser: (target: InsertionTarget, session?: ComposerInsertSession, initialTab?: ChooserTab) => void;
  closeChooser: () => void;
  completeChooser: (insertedId?: string) => void;
  exportState: ComposerExportController;
  /** Latest parent-app resolver outcome for this provider-qualified record. */
  reuseResolution: ReadonlySignal<GlobalTemplateResolutionOutcome | null>;
  /** Friendly display name for a component id, from the richer catalog. */
  titleFor: (componentId: string) => string | undefined;
  /**
   * Bumped by every reveal, including one that re-selects what is already
   * selected. The structure rail listens to it rather than to `selectedId`,
   * because "show me this node" is a request even when the selection does not
   * move — an author who collapsed the branch since selecting it still needs
   * the row back.
   */
  revealEpoch: ReadonlySignal<number>;
  /** Select and reveal one node; the structure rail reopens its ancestors. */
  revealNode: (nodeId: string) => void;

  // ── Composed callbacks (all resolve to the one controller) ────────────────
  /** Canvas selection: a real node reveals (selects + expands ancestors); `null` clears. */
  handleCanvasSelect: (nodeId: string | null) => void;
  /** Canvas insert point → open the shared parent chooser for that exact target. */
  handleCanvasRequestAdd: (target: InsertionTarget, initialTab?: ChooserTab) => void;
  /** Chooser confirm → add the component at the captured target. */
  handleChooserAdd: (target: InsertionTarget, componentId: string) => { status: "inserted"; nodeId: string } | { status: "rejected"; message: string };
  /** Chooser expand-ancestors → reveal the freshly added node in the tree. */
  handleExpandAncestors: (nodeIds: string[]) => void;
  /** Keyboard remove → remove the given (selected) node. */
  handleRemoveSelected: (nodeId: string) => void;
  /** Keyboard Escape → close any open menu/dialog. */
  handleEscape: () => void;

  // ── History actions (undo/redo) ───────────────────────────────────────────
  /** Undo the latest document mutation through the mounted controller. */
  handleUndo: () => void;
  /** Redo the next document mutation through the mounted controller. */
  handleRedo: () => void;
  /** Whether the mounted controller currently has an undo entry. */
  canUndo: ReadonlySignal<boolean>;
  /** Whether the mounted controller currently has a redo entry. */
  canRedo: ReadonlySignal<boolean>;

  // ── Clipboard/duplicate seam used by the host menus ───────────────────────
  /** Copy: session clipboard = a snapshot of the node. Refused (via `controller.lastError`) for opaque nodes. */
  handleCopy: (nodeId: string) => void;
  /** Cut: copy + remove, with Takazudo/zudo-sg#245's selection repair. Refused for opaque nodes. */
  handleCut: (nodeId: string) => void;
  /** Paste: clone-with-new-ids + insert-subtree at `target`, then select + reveal it. An incompatible target surfaces via `controller.lastError`, never a silent no-op. */
  handlePaste: (target: InsertionTarget) => void;
  /** Duplicate: clone-with-new-ids + insert immediately after the source, then select + reveal it. Refused for opaque nodes. */
  handleDuplicate: (nodeId: string) => void;

  // ── Inline canvas editing (issue Takazudo/zudo-sg#257) ────────────────────────────────────
  /**
   * A canvas inline edit that PASSED the host's revision check → route the value
   * through the controller's EXISTING `updateProps` (no second mutation path).
   * The inspector, tree, and canvas all read the same document, so they update
   * live. Field-domain validation stays `updateProps`'s job.
   */
  handleCommitInlineEdit: (nodeId: string, fieldKey: string, value: string) => void;

  // ── Canvas drag & drop (issue Takazudo/zudo-sg#258) ───────────────────────────────────────
  /**
   * A canvas drag & drop that PASSED the host's revision check → route the
   * move (or Alt-copy) through the controller's `drop` action, which atomically
   * revalidates and applies it, then selects + reveals the moved/new node.
   */
  handleDropNode: (sourceNodeId: string, target: InsertionTarget, copy: boolean) => void;
}

export function createComposerIntegration(
  scope: Scope,
  options: ComposerIntegrationOptions,
): ComposerIntegrationApi {
  const manifestEntries = options.componentProvider.manifest.components;
  const manifest = options.componentProvider.catalog;
  const controller = createComposerController(scope, { manifest, ...options.controllerOptions });
  const { state } = controller;
  const reuseResolution = signal<GlobalTemplateResolutionOutcome | null>(null);
  let reuseRequestGeneration = 0;

  // A provider navigation, a consumer refresh, or a relevant source-save
  // token invalidates the preceding read. Stores currently do not expose
  // cancellation, so the essential guarantee is that a late result cannot
  // update this controller's policy after the active document has changed.
  let seenReuseKey: readonly unknown[] | null = null;
  const runReuseResolution = () => {
    const reuseConfig = read(options.reuseResolution);
    const document = state.value.document;
    const key = [
      reuseConfig ? compositionRecordRefKey(reuseConfig.ref) : null,
      document.binding ? `${document.binding.sourceRecordId}:${document.binding.outletId}` : null,
      document,
      reuseConfig?.refreshKey,
      reuseConfig?.resolver,
    ];
    if (seenReuseKey !== null && key.every((value, index) => Object.is(value, seenReuseKey![index]))) return;
    seenReuseKey = key;
    const generation = ++reuseRequestGeneration;
    if (!reuseConfig) {
      reuseResolution.value = null;
      controller.setRootPolicy({ kind: "unrestricted" });
      return;
    }
    reuseResolution.value = null;
    const consumerRecord: CompositionRecord = { ...controller.record, document };
    void reuseConfig.resolver.resolve(consumerRecord).then(
      (outcome) => {
        if (generation !== reuseRequestGeneration || scope.abortSignal.aborted) return;
        reuseResolution.value = outcome;
        controller.setRootPolicy(
          outcome.status === "resolved" || outcome.status === "incompatible-local-root"
            ? outcome.rootPolicy
            : outcome.status === "unbound"
              ? { kind: "unrestricted" }
              : { kind: "unresolved" },
        );
      },
      () => {
        if (generation !== reuseRequestGeneration || scope.abortSignal.aborted) return;
        // A custom resolver may reject. Keep the persisted binding/local roots
        // intact and safely block bound-root writes rather than surfacing a
        // stale or unrestricted policy.
        controller.setRootPolicy({ kind: "unresolved" });
      },
    );
  };
  // A setup-time effect's first run is deferred, so the mount resolution runs
  // eagerly here; the effect then handles later changes via the key guard.
  runReuseResolution();
  scope.effect(runReuseResolution);
  scope.onCleanup(() => {
    reuseRequestGeneration += 1;
  });

  const theme = hostThemeSignal(scope);

  // Restore the persisted viewport once, after mount (the controller always
  // initializes to "fluid").
  scope.onActivate(() => {
    const persisted = getPersistedViewport();
    if (persisted && persisted !== state.value.viewport) controller.setViewport(persisted);
  });

  const setViewport = (viewport: ComposerCanvasViewport) => {
    setPersistedViewport(viewport);
    controller.setViewport(viewport);
  };

  const session = memo<PreviewSession>(() => ({
    mode: state.value.mode,
    theme: theme.value,
    selectedId: state.value.selectedId,
  }));
  const viewport = computed(() => state.value.viewport);

  const chooser = signal<ComposerChooserState>({ open: false, target: null });
  const openChooser = (target: InsertionTarget, insertSession?: ComposerInsertSession, initialTab?: ChooserTab) => {
    chooser.value.session?.cancel();
    chooser.value = { open: true, target, ...(insertSession ? { session: insertSession } : {}), ...(initialTab ? { initialTab } : {}) };
  };
  const closeChooser = () => {
    chooser.value.session?.cancel();
    chooser.value = { open: false, target: null };
  };
  const completeChooser = (insertedId?: string) => {
    chooser.value.session?.complete(insertedId);
    chooser.value = { open: false, target: null };
  };
  scope.onCleanup(() => chooser.value.session?.cancel());

  // The export controller takes a document RESOLVER, and it's the controller's
  // `flushPropUpdates` (issue Takazudo/zudo-sg#291): a debounce-pending inspector edit lands —
  // and the post-flush document is read back in the same tick — before any
  // JSX generation, so an export can never miss the tail of a typing burst.
  const exportState = createComposerExport(controller.flushPropUpdates, manifest);

  const titles = new Map(manifestEntries.map((e) => [e.id, e.title]));
  const titleFor = (componentId: string) => titles.get(componentId);

  const revealEpoch = signal(0);
  const revealNode = (nodeId: string) => {
    controller.reveal(nodeId);
    revealEpoch.value += 1;
  };

  const handleCanvasSelect = (nodeId: string | null) => {
    if (nodeId === null) controller.select(null);
    else revealNode(nodeId);
  };

  const handleEscape = () => {
    if (chooser.value.open) closeChooser();
    if (exportState.open.value) exportState.closeExport();
  };

  return {
    controller,
    manifestEntries,
    session,
    theme,
    viewport,
    setViewport,
    chooser,
    openChooser,
    closeChooser,
    completeChooser,
    exportState,
    reuseResolution,
    titleFor,
    revealEpoch,
    revealNode,
    handleCanvasSelect,
    handleCanvasRequestAdd: (target, initialTab) => openChooser(target, undefined, initialTab),
    handleChooserAdd: (target, componentId) => controller.add(target, componentId),
    handleExpandAncestors: (nodeIds) => nodeIds.forEach((id) => controller.setExpanded(id, true)),
    handleRemoveSelected: (nodeId) => controller.remove(nodeId),
    handleEscape,
    handleUndo: () => controller.undo(),
    handleRedo: () => controller.redo(),
    canUndo: controller.canUndo,
    canRedo: controller.canRedo,
    handleCopy: (nodeId) => controller.copy(nodeId),
    handleCut: (nodeId) => controller.cut(nodeId),
    handlePaste: (target) => controller.paste(target),
    handleDuplicate: (nodeId) => controller.duplicate(nodeId),
    handleCommitInlineEdit: (nodeId, fieldKey, value) => controller.updateProps(nodeId, { [fieldKey]: value }),
    handleDropNode: (sourceNodeId, target, copy) => controller.drop(sourceNodeId, target, copy),
  };
}
