"use client";

// The Composer's record-scoped client controller. It keeps the synchronous
// reducer/preview/export ordering established by Takazudo/zudo-sg#247 while handing immutable
// record revisions to Takazudo/zudo-sg#300's async save queue:
//
//   controller-model.ts  — the document + session-state reducer
//   persistence/save-queue.ts — serialized, revision-aware record writes
//   navigation-guard.ts   — the native beforeunload dirty-record guard
//
// A supported CompositionRecord is loaded before this hook is mounted; the
// record-scoped path performs no provider read.
//
// State is kept in a ref (not just `useState`) so `dispatch` can always act
// on the latest value without depending on `state` (which would otherwise
// force a new `dispatch` identity — and a new navigation-guard/effect
// teardown — on every action).

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
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
  state: ComposerControllerState;
  /** The live record draft. Its id/createdAt stay fixed for this mounted controller. */
  record: CompositionRecord;
  manifest: ComponentCatalog;
  /** Non-null right after a rejected command (e.g. cardinality/accepts) until the next successful action. */
  lastError: string | null;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  add: (target: InsertionTarget, componentId: string) => void;
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
   * Returns the post-flush document read from the live state ref — fresh in
   * the SAME tick, which is what export needs (a re-render hasn't happened
   * yet when export generates JSX right after flushing).
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
  | { status: "inserted" }
  | { status: "rejected"; message: string };

export interface UseComposerControllerOptions {
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
  if (left.cardinality !== right.cardinality) return false;
  const leftAccepts = left.accepts ? [...left.accepts].sort() : null;
  const rightAccepts = right.accepts ? [...right.accepts].sort() : null;
  if (leftAccepts === null || rightAccepts === null) return leftAccepts === rightAccepts;
  return leftAccepts.length === rightAccepts.length && leftAccepts.every((value, index) => value === rightAccepts[index]);
}

export function useComposerController(options: UseComposerControllerOptions): ComposerController {
  const manifest = options.manifest;
  const idFactory = useMemo(() => options.idFactory ?? createUuidIdFactory(), [options.idFactory]);
  const now = options.now ?? (() => new Date().toISOString());
  const historyNow = options.historyNow ?? (() => performance.now());

  const queueRef = useRef<CompositionSaveQueue>(options.saveQueue);
  const nowRef = useRef(now);
  const historyNowRef = useRef(historyNow);
  const recordRef = useRef<CompositionRecord | null>(null);
  const stateRef = useRef<ComposerControllerState | null>(null);
  const historyRef = useRef<ComposerHistory>(createHistory());
  if (stateRef.current === null) {
    const record = cloneJson(options.record);
    if (record.id !== record.document.id || options.saveQueue.ref.recordId !== record.id) {
      throw new Error("The loaded Composition record does not match its save queue identity.");
    }
    recordRef.current = record;
    const document = record.document;
    stateRef.current = createInitialControllerState({
      document,
      manifest,
      rootPolicy: options.rootPolicy,
      saveStatus: saveStatusFromQueue(options.saveQueue.state),
      derivedOutput: derivedOutputFromQueue(options.saveQueue.state),
    });
  }

  const [state, setState] = useState<ComposerControllerState>(stateRef.current);
  const [lastError, setLastError] = useState<string | null>(null);
  const pendingPropsRef = useRef<Map<string, PendingProps>>(new Map());
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBaseSaveStatusRef = useRef<ComposerSaveStatus | null>(null);

  const persistDocumentState = useCallback((stateWithDocument: ComposerControllerState): ComposerControllerState => {
    recordRef.current = {
      ...recordRef.current!,
      updatedAt: nowRef.current(),
      document: stateWithDocument.document,
    };

    const queue = queueRef.current;
    try {
      queue.edit(queue.ref, recordRef.current);
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
  }, []);

  const applyAction = useCallback(
    (action: ComposerAction): string | null => {
      const current = stateRef.current!;
      const result = applyComposerAction(current, action, { manifest, idFactory });
      setLastError(result.error);
      if (result.error) {
        historyRef.current = breakHistoryCoalescing(historyRef.current);
        const restoredStatus = queueRef.current
          ? saveStatusFromQueue(queueRef.current.state)
          : pendingBaseSaveStatusRef.current;
        if (restoredStatus && current.saveStatus.kind === "dirty") {
          const next = { ...current, saveStatus: restoredStatus };
          stateRef.current = next;
          setState(next);
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
          historyRef.current = clearHistory();
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
          historyRef.current = pushHistory(
            historyRef.current,
            { document: current.document, selectedId: current.selectedId },
            { coalesceKey, atMs: historyNowRef.current() },
          );
        }
        next = persistDocumentState(next);
      } else if (action.type === "updateProps" && pendingBaseSaveStatusRef.current) {
        next = {
          ...next,
          saveStatus: saveStatusFromQueue(queueRef.current.state),
        };
        historyRef.current = breakHistoryCoalescing(historyRef.current);
      } else {
        if (action.type === "setRootPolicy" && !sameRootPolicy(current.rootPolicy, next.rootPolicy)) {
          historyRef.current = clearHistory();
        } else {
          historyRef.current = breakHistoryCoalescing(historyRef.current);
        }
      }
      stateRef.current = next;
      setState(next);
      return null;
    },
    [manifest, idFactory, persistDocumentState],
  );

  // ── Debounced updateProps channel (issue Takazudo/zudo-sg#291) ─────────────────────────────
  // Per-keystroke inspector commits are coalesced here: the pending patch map
  // holds the latest merged patch per node, and only the trailing edge of a
  // typing burst dispatches (→ record snapshot + save queue + preview render).
  const flushPropUpdates = useCallback((): CompositionDocument => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (pendingPropsRef.current.size > 0) {
      const pending = pendingPropsRef.current;
      pendingPropsRef.current = new Map();
      for (const [nodeId, item] of pending) {
        applyAction({ type: "updateProps", nodeId, patch: item.patch, coalescePaths: item.coalescePaths });
      }
      pendingBaseSaveStatusRef.current = null;
    }
    return stateRef.current!.document;
  }, [applyAction]);

  // Every non-debounced action flushes pending keystroke patches FIRST, so the
  // reducer always sees user events in real order — a pending text edit lands
  // BEFORE the remove/reorder/mode-switch/reset that followed it, and a patch
  // can never target a node an interleaved action already removed.
  const dispatch = useCallback(
    (action: ComposerAction) => {
      flushPropUpdates();
      return applyAction(action);
    },
    [flushPropUpdates, applyAction],
  );

  const updatePropsDebounced = useCallback(
    (nodeId: string, patch: JsonObject, coalescePaths?: PropCoalescing) => {
      const pending = pendingPropsRef.current;
      if (pending.size === 0) pendingBaseSaveStatusRef.current = stateRef.current!.saveStatus;
      const previous = pending.get(nodeId);
      const nextPaths = coalescePaths ?? Object.keys(patch).map((prop) => [prop] as PropPath);
      pending.set(nodeId, {
        patch: { ...previous?.patch, ...patch },
        coalescePaths: mergePropCoalescing(
          previous === undefined ? [] : previous.coalescePaths,
          nextPaths,
        ),
      });
      const current = stateRef.current!;
      if (current.saveStatus.kind !== "dirty") {
        const next = { ...current, saveStatus: { kind: "dirty" } as const, derivedOutput: null };
        stateRef.current = next;
        setState(next);
      }
      if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        flushPropUpdates();
      }, INSPECTOR_COMMIT_DEBOUNCE_MS);
    },
    [flushPropUpdates],
  );

  const flushPersistence = useCallback(async (): Promise<void> => {
    flushPropUpdates();
    const queue = queueRef.current;
    if (queue) await queue.flush();
  }, [flushPropUpdates]);

  const restoreHistoryEntry = useCallback((entry: { document: CompositionDocument; selectedId: string | null }) => {
    const current = stateRef.current!;
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
    stateRef.current = next;
    setLastError(null);
    setState(next);
  }, [manifest, persistDocumentState]);

  const undo = useCallback((): void => {
    if (stateRef.current!.mode === "preview") return;
    flushPropUpdates();
    const current = stateRef.current!;
    const transition = undoHistory(historyRef.current, {
      document: current.document,
      selectedId: current.selectedId,
    });
    if (!transition) return;
    historyRef.current = transition.history;
    restoreHistoryEntry(transition.restore);
  }, [flushPropUpdates, restoreHistoryEntry]);

  const redo = useCallback((): void => {
    if (stateRef.current!.mode === "preview") return;
    flushPropUpdates();
    const current = stateRef.current!;
    const transition = redoHistory(historyRef.current, {
      document: current.document,
      selectedId: current.selectedId,
    });
    if (!transition) return;
    historyRef.current = transition.history;
    restoreHistoryEntry(transition.restore);
  }, [flushPropUpdates, restoreHistoryEntry]);

  const flushPropUpdatesRef = useRef(flushPropUpdates);
  flushPropUpdatesRef.current = flushPropUpdates;

  const retrySave = useCallback((): void => {
    flushPropUpdates();
    const queue = queueRef.current;
    if (!queue) return;
    try {
      queue.retry();
    } catch (error) {
      const current = stateRef.current!;
      const next = {
        ...current,
        saveStatus: {
          kind: "error" as const,
          reason: error instanceof Error ? error.message : "Composition persistence failed.",
        },
      };
      stateRef.current = next;
      setState(next);
    }
  }, [flushPropUpdates]);

  // Queue state is provider-neutral. Pending debounce input remains visibly
  // dirty even if an older revision finishes while the 200ms timer is open.
  // On unmount, land pending props, detach immediately, and explicitly consume
  // close() so teardown can neither claim a late success nor leak a rejection.
  useEffect(() => {
    const queue = queueRef.current;
    if (!queue) return () => void flushPropUpdatesRef.current();
    const unsubscribe = queue.subscribe((queueState) => {
      const current = stateRef.current!;
      const saveStatus: ComposerSaveStatus =
        pendingPropsRef.current.size > 0 ? { kind: "dirty" } : saveStatusFromQueue(queueState);
      const derivedOutput = pendingPropsRef.current.size > 0 ? null : derivedOutputFromQueue(queueState);
      if (
        current.saveStatus.kind === saveStatus.kind &&
        (saveStatus.kind !== "error" ||
          (current.saveStatus.kind === "error" && current.saveStatus.reason === saveStatus.reason))
        && current.derivedOutput === derivedOutput
      ) {
        return;
      }
      const next = { ...current, saveStatus, derivedOutput };
      stateRef.current = next;
      setState(next);
    });
    return () => {
      flushPropUpdatesRef.current();
      unsubscribe();
      void queue.close().catch(() => undefined);
    };
  }, []);

  // SPA-router + native beforeunload guard while the document is not "saved".
  // The guard flushes first: a debounce-pending keystroke is LANDED before
  // deciding, then async dirty/in-flight work synchronously blocks navigation.
  useEffect(
    () =>
      installComposerNavigationGuard(() => {
        flushPropUpdates();
        const queue = queueRef.current;
        return (
          pendingPropsRef.current.size > 0 ||
          hasUnsavedChanges(stateRef.current!) ||
          (queue ? queue.state.dirty || queue.state.saving : false)
        );
      }),
    [flushPropUpdates],
  );

  return useMemo<ComposerController>(
    () => ({
      state,
      record: recordRef.current!,
      manifest,
      lastError,
      undo,
      redo,
      canUndo: state.mode !== "preview" && historyCanUndo(historyRef.current),
      canRedo: state.mode !== "preview" && historyCanRedo(historyRef.current),
      add: (target, componentId) => dispatch({ type: "add", target, componentId }),
      rename: (name) => dispatch({ type: "rename", name }),
      updateProps: (nodeId, patch, coalescePaths, removeProps) => dispatch({ type: "updateProps", nodeId, patch, coalescePaths, removeProps }),
      updatePropsDebounced,
      flushPropUpdates,
      flushPersistence,
      retrySave,
      reorder: (nodeId, direction) => dispatch({ type: "reorder", nodeId, direction }),
      remove: (nodeId) => dispatch({ type: "remove", nodeId }),
      copy: (nodeId) => dispatch({ type: "copy", nodeId }),
      cut: (nodeId) => dispatch({ type: "cut", nodeId }),
      paste: (target) => dispatch({ type: "paste", target }),
      insertForest: (sourceRoots, target) => {
        const error = dispatch({ type: "insertForest", sourceRoots, target });
        return error ? { status: "rejected", message: error } : { status: "inserted" };
      },
      duplicate: (nodeId) => dispatch({ type: "duplicate", nodeId }),
      drop: (sourceNodeId, target, copy) => dispatch({ type: "drop", sourceNodeId, target, copy }),
      publishPattern: () => dispatch({ type: "publishPattern" }),
      publishGlobalTemplate: (target, label) => dispatch({ type: "publishGlobalTemplate", target, label }),
      setGlobalTemplateOutlet: (target, label) => dispatch({ type: "setGlobalTemplateOutlet", target, label }),
      renameGlobalTemplateOutlet: (label) => dispatch({ type: "renameGlobalTemplateOutlet", label }),
      reassignGlobalTemplateOutlet: (target) => dispatch({ type: "reassignGlobalTemplateOutlet", target }),
      clearPublication: (dependencyGuard) => dispatch({ type: "clearPublication", dependencyGuard }),
      bindConsumer: (contract) => dispatch({ type: "bindConsumer", contract }),
      removeBinding: () => dispatch({ type: "removeBinding" }),
      setRootPolicy: (rootPolicy) => dispatch({ type: "setRootPolicy", rootPolicy }),
      select: (nodeId) => dispatch({ type: "select", nodeId }),
      reveal: (nodeId) => dispatch({ type: "reveal", nodeId }),
      toggleExpanded: (nodeId) => dispatch({ type: "toggleExpanded", nodeId }),
      setExpanded: (nodeId, expanded) => dispatch({ type: "setExpanded", nodeId, expanded }),
      setMode: (mode) => dispatch({ type: "setMode", mode }),
      setViewport: (viewport) => dispatch({ type: "setViewport", viewport }),
    }),
    [
      state,
      manifest,
      lastError,
      dispatch,
      updatePropsDebounced,
      flushPropUpdates,
      flushPersistence,
      retrySave,
      undo,
      redo,
    ],
  );
}
