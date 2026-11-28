"use client";

// The Composer's record-scoped client controller. It keeps the synchronous
// reducer/preview/export ordering established by Takazudo/zudo-sg#247 while handing immutable
// record revisions to Takazudo/zudo-sg#300's async save queue:
//
//   controller-model.ts  — the document + session-state reducer
//   persistence/save-queue.ts — serialized, revision-aware record writes
//   navigation-guard.ts   — the native beforeunload dirty-record guard
//
// A supported CompositionRecord is loaded before this controller is created;
// the record-scoped path performs no provider read.
//
// The controller is created once per mounted record. Its state is a signal,
// so every command reads and writes the latest value and keeps one stable
// identity for the controller's lifetime.

import { computed, signal, type ReadonlySignal, type Scope } from "@takazudo/zfb/zudo-react";
import type {
  ComponentCatalog,
  CompositionDocument,
  CompositionDerivedOutputOutcome,
  CompositionNode,
  CompositionRecord,
  CompositionRecordRef,
  CompositionSaveOutcome,
  GlobalTemplateOutletTarget,
  IdFactory,
  InsertionTarget,
  JsonObject,
  PublicationDependencyGuard,
  ResolvedGlobalTemplateOutletContract,
  RootPolicy,
  SaveQueue,
  SaveQueueState,
} from "../../../composer/browser";
import {
  cloneJson,
  createUuidIdFactory,
  findLocation,
  repairSelection,
} from "../../../composer/browser";
import {
  applyComposerAction,
  createInitialControllerState,
  DOCUMENT_MUTATION_HISTORY_POLICY,
  hasUnsavedChanges,
  isDocumentMutation,
  type ComposerAction,
  type ComposerCanvasViewport,
  type ComposerControllerState,
  type ComposerMode,
  type ComposerSaveStatus,
} from "./controller-model";
import {
  breakHistoryCoalescing,
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  clearHistory,
  createHistory,
  mergePropCoalescing,
  pushHistory,
  redoHistory,
  undoHistory,
  type CoalesceKey,
  type ComposerHistory,
  type PropCoalescing,
  type PropPath,
} from "./history-model";
import { installComposerNavigationGuard } from "./navigation-guard";

type CompositionSaveQueue = SaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>;
type CompositionSaveQueueState = SaveQueueState<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>;
interface PendingProps {
  patch: JsonObject;
  coalescePaths: PropCoalescing;
}

/**
 * The typed reducer/controller API surface. UI consumers depend on this type,
 * not on `controller-model.ts`'s action union —
 * the action union is an implementation detail; this is the seam.
 */
export interface ComposerController {
  state: ReadonlySignal<ComposerControllerState>;
  /** The live record draft. Its id/createdAt stay fixed for this mounted controller. */
  readonly record: CompositionRecord;
  manifest: ComponentCatalog;
  /** Non-null right after a rejected command (e.g. cardinality/accepts) until the next successful action. */
  lastError: ReadonlySignal<string | null>;
  undo: () => void;
  redo: () => void;
  canUndo: ReadonlySignal<boolean>;
  canRedo: ReadonlySignal<boolean>;
  add: (target: InsertionTarget, componentId: string) => ComposerInsertionOutcome;
  rename: (name: string) => void;
  updateProps: (nodeId: string, patch: JsonObject, coalescePaths?: PropCoalescing, removeProps?: readonly string[]) => void;
  /**
   * Debounced sibling of `updateProps` for PER-KEYSTROKE sources (the
   * inspector's text/color/number streams, issue Takazudo/zudo-sg#291/#259). Patches are
   * coalesced per node and dispatched once per typing pause, so the whole
   * expensive commit path (reducer → immutable record snapshot + save queue
   * → preview-iframe re-render) runs once per pause instead of once per
   * keystroke — the same cheap-live-path / expensive-commit-point split the
   * shared rail resizers use. Deterministic flush guarantees (a pending patch
   * can never be lost or reordered):
   *   - any OTHER controller action (select, remove, setMode, …) flushes the
   *     pending patch FIRST, so the reducer always sees events in user order;
   *   - `flushPropUpdates` is wired to field blur, export/JSX generation, the
   *     navigation guard, and controller unmount.
   */
  updatePropsDebounced: (nodeId: string, patch: JsonObject, coalescePaths?: PropCoalescing) => void;
  /**
   * Synchronously dispatch any `updatePropsDebounced` patches still pending.
   * Returns the post-flush document read from the live state — fresh in the
   * SAME tick, which is what export needs (no DOM update has happened yet
   * when export generates JSX right after flushing).
   */
  flushPropUpdates: () => CompositionDocument;
  /** Commit pending props synchronously, then await persistence of the newest record revision. */
  flushPersistence: () => Promise<void>;
  /** Retry the newest retained draft after a persistence error. */
  retrySave: () => void;
  reorder: (nodeId: string, direction: "up" | "down") => void;
  remove: (nodeId: string) => void;
  /** Session clipboard = a deep-cloned snapshot of the node. Refused for opaque nodes. */
  copy: (nodeId: string) => void;
  /** Copy + remove (with Takazudo/zudo-sg#245's selection repair). Refused for opaque nodes. */
  cut: (nodeId: string) => void;
  /** Clone-with-new-ids + insert-subtree at `target`, then select + reveal it. Errors (e.g. an incompatible slot) surface via `lastError`, never a silent no-op. */
  paste: (target: InsertionTarget) => void;
  /** Atomically clone and insert every root from a saved Pattern, then select and reveal its first inserted root. */
  insertForest: (sourceRoots: readonly CompositionNode[], target: InsertionTarget) => ComposerForestInsertionOutcome;
  /** Clone-with-new-ids + insert immediately after the source, then select + reveal it. Refused for opaque nodes. */
  duplicate: (nodeId: string) => void;
  /**
   * Canvas drag & drop (issue Takazudo/zudo-sg#258): move (or, when `copy`, clone) `sourceNodeId`
   * to `target`, then select + reveal it. Atomically revalidated (slot/
   * cardinality/cycle/root/opaque-policy); an invalid drop surfaces via
   * `lastError`, never a silent partial change.
   */
  drop: (sourceNodeId: string, target: InsertionTarget, copy: boolean) => void;
  /** Publish the current non-empty local document as a Pattern. */
  publishPattern: () => void;
  /** Publish a real empty component slot as this Global template's stable outlet. */
  publishGlobalTemplate: (target: GlobalTemplateOutletTarget, label: string) => void;
  /** Create or update the Global outlet while retaining its id after creation. */
  setGlobalTemplateOutlet: (target: GlobalTemplateOutletTarget, label: string) => void;
  renameGlobalTemplateOutlet: (label: string) => void;
  reassignGlobalTemplateOutlet: (target: GlobalTemplateOutletTarget) => void;
  /** The owning app must pass its current dependent-count result. */
  clearPublication: (dependencyGuard: PublicationDependencyGuard) => void;
  /** Bind through a parent-app resolved source/outlet contract; never performs provider I/O. */
  bindConsumer: (contract: ResolvedGlobalTemplateOutletContract) => void;
  /** Remove only the binding and retain all canonical local root nodes. */
  removeBinding: () => void;
  /** Update ephemeral bound-root constraints after parent-app resolution. */
  setRootPolicy: (rootPolicy: RootPolicy) => void;
  select: (nodeId: string | null) => void;
  reveal: (nodeId: string) => void;
  toggleExpanded: (nodeId: string) => void;
  setExpanded: (nodeId: string, expanded: boolean) => void;
  setMode: (mode: ComposerMode) => void;
  setViewport: (viewport: ComposerCanvasViewport) => void;
}

/** The chooser needs a synchronous command outcome so it never closes after a rejected atomic mutation. */
export type ComposerForestInsertionOutcome =
  | { status: "inserted"; nodeId: string }
  | { status: "rejected"; message: string };

export type ComposerInsertionOutcome = ComposerForestInsertionOutcome;

export interface ComposerControllerOptions {
  manifest: ComponentCatalog;
  /** Already-loaded supported record. */
  record: CompositionRecord;
  /** Record-scoped queue created for the same provider-qualified record. */
  saveQueue: CompositionSaveQueue;
  /** Optional initial resolver result for a record mounted as a bound consumer. */
  rootPolicy?: RootPolicy;
  idFactory?: IdFactory;
  now?: () => string;
  /** Monotonic milliseconds used only for history coalescing. */
  historyNow?: () => number;
}

/** 200ms — just above a fast typist's ~100-180ms inter-key gap (so steady typing coalesces into one trailing commit) yet keeps the trailing persist+preview inside the ~300ms "feels instant" budget; the UX trade is documented in Takazudo/zudo-sg#259. */
export const INSPECTOR_COMMIT_DEBOUNCE_MS = 200;

function saveStatusFromQueue(state: CompositionSaveQueueState): ComposerSaveStatus {
  switch (state.status) {
    case "saved":
      return { kind: "saved" };
    case "dirty":
      return { kind: "dirty" };
    case "saving":
      return { kind: "saving" };
    case "error":
      return { kind: "error", reason: state.error.message };
  }
}

/** A generated-output warning belongs only to the revision known as saved. */
function derivedOutputFromQueue(state: CompositionSaveQueueState): CompositionDerivedOutputOutcome | null {
  return state.status === "saved" ? state.outcome?.derived ?? null : null;
}

function sameRootPolicy(left: RootPolicy, right: RootPolicy): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "resolved" || right.kind !== "resolved") return true;
  if (left.cardinality !== right.cardinality || left.min !== right.min || left.max !== right.max) return false;
  if (JSON.stringify(left.origin ?? null) !== JSON.stringify(right.origin ?? null)) return false;
  const leftAccepts = left.accepts ? [...left.accepts].sort() : null;
  const rightAccepts = right.accepts ? [...right.accepts].sort() : null;
  if (leftAccepts === null || rightAccepts === null) return leftAccepts === rightAccepts;
  return leftAccepts.length === rightAccepts.length && leftAccepts.every((value, index) => value === rightAccepts[index]);
}

export function createComposerController(scope: Scope, options: ComposerControllerOptions): ComposerController {
  const manifest = options.manifest;
  const idFactory = options.idFactory ?? createUuidIdFactory();
  const now = options.now ?? (() => new Date().toISOString());
  const historyNow = options.historyNow ?? (() => performance.now());
  const queue = options.saveQueue;

  let history: ComposerHistory = createHistory();
  // Undo/redo availability follows the history, which is a plain value; this
  // revision makes every history change observable.
  const historyRevision = signal(0);
  const setHistory = (next: ComposerHistory): void => {
    history = next;
    historyRevision.value += 1;
  };
  /**
   * The last root policy this controller actually KNEW, which is not the same
   * as the last one it was told. `unresolved` means the resolver has not
   * answered yet — at mount, or because a provider read failed — and the answer
   * it eventually gives is usually the contract already recorded. Comparing
   * against the last known policy is what keeps a round trip through
   * `unresolved` from counting as two material changes.
   */
  let lastKnownRootPolicy: RootPolicy | null = null;
  const initialRecord = cloneJson(options.record);
  if (initialRecord.id !== initialRecord.document.id || queue.ref.recordId !== initialRecord.id) {
    throw new Error("The loaded Composition record does not match its save queue identity.");
  }
  let record: CompositionRecord = initialRecord;
  const initialState = createInitialControllerState({
    document: initialRecord.document,
    manifest,
    selectedId: consumeReturnSelection(initialRecord.id),
    rootPolicy: options.rootPolicy,
    saveStatus: saveStatusFromQueue(queue.state),
    derivedOutput: derivedOutputFromQueue(queue.state),
  });
  if (initialState.rootPolicy.kind !== "unresolved") lastKnownRootPolicy = initialState.rootPolicy;

  const state = signal<ComposerControllerState>(initialState);
  const lastError = signal<string | null>(null);
  let pendingProps = new Map<string, PendingProps>();
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingBaseSaveStatus: ComposerSaveStatus | null = null;

  const persistDocumentState = (stateWithDocument: ComposerControllerState): ComposerControllerState => {
    record = {
      ...record,
      updatedAt: now(),
      document: stateWithDocument.document,
    };

    try {
      queue.edit(queue.ref, record);
      return {
        ...stateWithDocument,
        saveStatus: saveStatusFromQueue(queue.state),
        derivedOutput: null,
      };
    } catch (error) {
      return {
        ...stateWithDocument,
        saveStatus: {
          kind: "error",
          reason: error instanceof Error ? error.message : "Composition persistence failed.",
        },
        derivedOutput: null,
      };
    }
  };

  const applyAction = (action: ComposerAction): string | null => {
    const current = state.value;
    const result = applyComposerAction(current, action, { manifest, idFactory });
    lastError.value = result.error;
    if (result.error) {
      setHistory(breakHistoryCoalescing(history));
      const restoredStatus = saveStatusFromQueue(queue.state);
      if (current.saveStatus.kind === "dirty") {
        state.value = { ...current, saveStatus: restoredStatus };
      }
      return result.error;
    }

    let next = result.state;
    if (result.documentChanged) {
      if (!isDocumentMutation(action)) {
        throw new Error(`Document-changing Composer action "${action.type}" is not classified as a mutation.`);
      }
      const policy = DOCUMENT_MUTATION_HISTORY_POLICY[action.type];
      if (policy === "barrier") {
        setHistory(clearHistory());
      } else {
        const coalesceKey: CoalesceKey | null = action.type === "updateProps"
          ? action.coalescePaths === null || (action.removeProps?.length ?? 0) > 0
            ? null
            : {
                kind: "updateProps",
                nodeId: action.nodeId,
                propPaths: action.coalescePaths ?? Object.keys(action.patch).map((prop) => [prop]),
              }
          : null;
        setHistory(pushHistory(
          history,
          { document: current.document, selectedId: current.selectedId },
          { coalesceKey, atMs: historyNow() },
        ));
      }
      next = persistDocumentState(next);
    } else if (action.type === "updateProps" && pendingBaseSaveStatus) {
      next = {
        ...next,
        saveStatus: saveStatusFromQueue(queue.state),
      };
      setHistory(breakHistoryCoalescing(history));
    } else {
      if (action.type === "setRootPolicy") {
        // Losing sight of the contract is not a change to it. A resolver read
        // that fails transiently reports `unresolved` and then reports the
        // same contract again a moment later; clearing on each leg destroyed
        // the author's undo stack for a round trip they never asked for.
        const known = next.rootPolicy.kind === "unresolved" ? null : next.rootPolicy;
        const previouslyKnown = lastKnownRootPolicy;
        setHistory(known !== null && previouslyKnown !== null && !sameRootPolicy(previouslyKnown, known)
          ? clearHistory()
          : breakHistoryCoalescing(history));
        if (known !== null) lastKnownRootPolicy = known;
      } else {
        setHistory(breakHistoryCoalescing(history));
      }
    }
    state.value = next;
    return null;
  };

  // ── Debounced updateProps channel (issue Takazudo/zudo-sg#291) ─────────────────────────────
  // Per-keystroke inspector commits are coalesced here: the pending patch map
  // holds the latest merged patch per node, and only the trailing edge of a
  // typing burst dispatches (→ record snapshot + save queue + preview render).
  const flushPropUpdates = (): CompositionDocument => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    if (pendingProps.size > 0) {
      const pending = pendingProps;
      pendingProps = new Map();
      for (const [nodeId, item] of pending) {
        applyAction({ type: "updateProps", nodeId, patch: item.patch, coalescePaths: item.coalescePaths });
      }
      pendingBaseSaveStatus = null;
    }
    return state.value.document;
  };

  // Every non-debounced action flushes pending keystroke patches FIRST, so the
  // reducer always sees user events in real order — a pending text edit lands
  // BEFORE the remove/reorder/mode-switch/reset that followed it, and a patch
  // can never target a node an interleaved action already removed.
  const dispatch = (action: ComposerAction): string | null => {
    flushPropUpdates();
    return applyAction(action);
  };

  const updatePropsDebounced = (nodeId: string, patch: JsonObject, coalescePaths?: PropCoalescing): void => {
    if (pendingProps.size === 0) pendingBaseSaveStatus = state.value.saveStatus;
    const previous = pendingProps.get(nodeId);
    const nextPaths = coalescePaths ?? Object.keys(patch).map((prop) => [prop] as PropPath);
    pendingProps.set(nodeId, {
      patch: { ...previous?.patch, ...patch },
      coalescePaths: mergePropCoalescing(
        previous === undefined ? [] : previous.coalescePaths,
        nextPaths,
      ),
    });
    const current = state.value;
    if (current.saveStatus.kind !== "dirty") {
      state.value = { ...current, saveStatus: { kind: "dirty" } as const, derivedOutput: null };
    }
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      flushPropUpdates();
    }, INSPECTOR_COMMIT_DEBOUNCE_MS);
  };

  const flushPersistence = async (): Promise<void> => {
    flushPropUpdates();
    await queue.flush();
  };

  const restoreHistoryEntry = (entry: { document: CompositionDocument; selectedId: string | null }): void => {
    const current = state.value;
    const selectedId = repairSelection(entry.document, manifest, entry.selectedId);
    const expandedIds = new Set(current.expandedIds);
    if (selectedId !== null) {
      let location = findLocation(entry.document, manifest, selectedId);
      while (location && location.parentId !== null) {
        expandedIds.add(location.parentId);
        location = findLocation(entry.document, manifest, location.parentId);
      }
    }
    const next = persistDocumentState({
      ...current,
      document: entry.document,
      selectedId,
      expandedIds,
    });
    lastError.value = null;
    state.value = next;
  };

  const undo = (): void => {
    if (state.value.mode === "preview") return;
    flushPropUpdates();
    const current = state.value;
    const transition = undoHistory(history, {
      document: current.document,
      selectedId: current.selectedId,
    });
    if (!transition) return;
    setHistory(transition.history);
    restoreHistoryEntry(transition.restore);
  };

  const redo = (): void => {
    if (state.value.mode === "preview") return;
    flushPropUpdates();
    const current = state.value;
    const transition = redoHistory(history, {
      document: current.document,
      selectedId: current.selectedId,
    });
    if (!transition) return;
    setHistory(transition.history);
    restoreHistoryEntry(transition.restore);
  };

  const retrySave = (): void => {
    flushPropUpdates();
    try {
      queue.retry();
    } catch (error) {
      const current = state.value;
      state.value = {
        ...current,
        saveStatus: {
          kind: "error" as const,
          reason: error instanceof Error ? error.message : "Composition persistence failed.",
        },
      };
    }
  };

  // Queue state is provider-neutral. Pending debounce input remains visibly
  // dirty even if an older revision finishes while the 200ms timer is open.
  // On unmount, land pending props, detach immediately, and explicitly consume
  // close() so teardown can neither claim a late success nor leak a rejection.
  scope.onActivate(() => {
    const unsubscribe = queue.subscribe((queueState) => {
      const current = state.value;
      const saveStatus: ComposerSaveStatus =
        pendingProps.size > 0 ? { kind: "dirty" } : saveStatusFromQueue(queueState);
      const derivedOutput = pendingProps.size > 0 ? null : derivedOutputFromQueue(queueState);
      if (
        current.saveStatus.kind === saveStatus.kind &&
        (saveStatus.kind !== "error" ||
          (current.saveStatus.kind === "error" && current.saveStatus.reason === saveStatus.reason))
        && current.derivedOutput === derivedOutput
      ) {
        return;
      }
      state.value = { ...current, saveStatus, derivedOutput };
    });
    return () => {
      flushPropUpdates();
      unsubscribe();
      void queue.close().catch(() => undefined);
    };
  });

  // SPA-router + native beforeunload guard while the document is not "saved".
  // The guard flushes first: a debounce-pending keystroke is LANDED before
  // deciding, then async dirty/in-flight work synchronously blocks navigation.
  scope.onActivate(() =>
    installComposerNavigationGuard(() => {
      flushPropUpdates();
      return (
        pendingProps.size > 0 ||
        hasUnsavedChanges(state.value) ||
        queue.state.dirty || queue.state.saving
      );
    }),
  );

  const historyAvailable = (check: (current: ComposerHistory) => boolean) =>
    computed(() => {
      void historyRevision.value;
      return state.value.mode !== "preview" && check(history);
    });

  return {
    state,
    get record() {
      return record;
    },
    manifest,
    lastError,
    undo,
    redo,
    canUndo: historyAvailable(historyCanUndo),
    canRedo: historyAvailable(historyCanRedo),
    add: (target, componentId) => {
      const error = dispatch({ type: "add", target, componentId });
      const nodeId = state.value.selectedId;
      return error || !nodeId
        ? { status: "rejected", message: error ?? "The inserted component could not be selected." }
        : { status: "inserted", nodeId };
    },
    rename: (name) => void dispatch({ type: "rename", name }),
    updateProps: (nodeId, patch, coalescePaths, removeProps) => void dispatch({ type: "updateProps", nodeId, patch, coalescePaths, removeProps }),
    updatePropsDebounced,
    flushPropUpdates,
    flushPersistence,
    retrySave,
    reorder: (nodeId, direction) => void dispatch({ type: "reorder", nodeId, direction }),
    remove: (nodeId) => void dispatch({ type: "remove", nodeId }),
    copy: (nodeId) => void dispatch({ type: "copy", nodeId }),
    cut: (nodeId) => void dispatch({ type: "cut", nodeId }),
    paste: (target) => void dispatch({ type: "paste", target }),
    insertForest: (sourceRoots, target) => {
      const error = dispatch({ type: "insertForest", sourceRoots, target });
      const nodeId = state.value.selectedId;
      return error || !nodeId
        ? { status: "rejected", message: error ?? "The inserted Pattern could not be selected." }
        : { status: "inserted", nodeId };
    },
    duplicate: (nodeId) => void dispatch({ type: "duplicate", nodeId }),
    drop: (sourceNodeId, target, copy) => void dispatch({ type: "drop", sourceNodeId, target, copy }),
    publishPattern: () => void dispatch({ type: "publishPattern" }),
    publishGlobalTemplate: (target, label) => void dispatch({ type: "publishGlobalTemplate", target, label }),
    setGlobalTemplateOutlet: (target, label) => void dispatch({ type: "setGlobalTemplateOutlet", target, label }),
    renameGlobalTemplateOutlet: (label) => void dispatch({ type: "renameGlobalTemplateOutlet", label }),
    reassignGlobalTemplateOutlet: (target) => void dispatch({ type: "reassignGlobalTemplateOutlet", target }),
    clearPublication: (dependencyGuard) => void dispatch({ type: "clearPublication", dependencyGuard }),
    bindConsumer: (contract) => void dispatch({ type: "bindConsumer", contract }),
    removeBinding: () => void dispatch({ type: "removeBinding" }),
    setRootPolicy: (rootPolicy) => void dispatch({ type: "setRootPolicy", rootPolicy }),
    select: (nodeId) => void dispatch({ type: "select", nodeId }),
    reveal: (nodeId) => void dispatch({ type: "reveal", nodeId }),
    toggleExpanded: (nodeId) => void dispatch({ type: "toggleExpanded", nodeId }),
    setExpanded: (nodeId, expanded) => void dispatch({ type: "setExpanded", nodeId, expanded }),
    setMode: (mode) => void dispatch({ type: "setMode", mode }),
    setViewport: (viewport) => void dispatch({ type: "setViewport", viewport }),
  };
}

/** One-shot handoff written by the AI Assistant's "← Composer" link; ignored for any other record. */
function consumeReturnSelection(recordId: string): string | null {
  try {
    const raw = globalThis.sessionStorage?.getItem("zudo-composer-return-selection");
    if (!raw) return null;
    globalThis.sessionStorage.removeItem("zudo-composer-return-selection");
    const value = JSON.parse(raw) as { recordId?: unknown; nodeId?: unknown };
    return value.recordId === recordId && typeof value.nodeId === "string" ? value.nodeId : null;
  } catch { return null; }
}
