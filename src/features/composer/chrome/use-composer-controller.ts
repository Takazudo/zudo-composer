"use client";

// The Composer's record-scoped client controller. It keeps the synchronous
// reducer/preview/export ordering established by #247 while handing immutable
// record revisions to #300's async save queue:
//
//   controller-model.ts  — the document + session-state reducer
//   persistence/save-queue.ts — serialized, revision-aware record writes
//   navigation-guard.ts   — the SPA-router "unsaved edits" guard
//   resizer-contract.ts   — the vanilla-JS resizer script's width bridge
//
// A supported CompositionRecord is loaded before this hook is mounted; the
// record-scoped path performs no provider read. The optional sample-only path
// remains temporarily for the pre-library production mount and is replaced by
// the provider/route composition in #305.
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
} from "../../../composer";
import {
  cloneJson,
  createUuidIdFactory,
} from "../../../composer";
import {
  applyComposerAction,
  createInitialControllerState,
  hasUnsavedChanges,
  type ComposerAction,
  type ComposerCanvasViewport,
  type ComposerControllerState,
  type ComposerLoadNotice,
  type ComposerMode,
  type ComposerSaveStatus,
} from "./controller-model";
import { installComposerNavigationGuard } from "./navigation-guard";
import {
  LS_INSPECTOR_WIDTH,
  LS_TREE_WIDTH,
  MIN_RAIL_W,
  WIDTH_CHANGE_EVENT,
  getPersistedWidth,
  setPersistedWidth,
  type ComposerWidthChangeDetail,
} from "./resizer-contract";

type CompositionSaveQueue = SaveQueue<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>;
type CompositionSaveQueueState = SaveQueueState<CompositionRecord, CompositionRecordRef, CompositionSaveOutcome>;

/**
 * The typed reducer/controller API surface. Downstream waves (#248-#251)
 * should depend on THIS type, not on `controller-model.ts`'s action union —
 * the action union is an implementation detail; this is the seam.
 */
export interface ComposerController {
  state: ComposerControllerState;
  /** The live record draft. Its id/createdAt stay fixed for this mounted controller. */
  record: CompositionRecord;
  manifest: ComponentCatalog;
  /** Non-null right after a rejected command (e.g. cardinality/accepts) until the next successful action. */
  lastError: string | null;
  add: (target: InsertionTarget, componentId: string) => void;
  rename: (name: string) => void;
  updateProps: (nodeId: string, patch: JsonObject) => void;
  /**
   * Debounced sibling of `updateProps` for PER-KEYSTROKE sources (the
   * inspector's text/color/number streams, issue #291/#259). Patches are
   * coalesced per node and dispatched once per typing pause, so the whole
   * expensive commit path (reducer → immutable record snapshot + save queue
   * → preview-iframe re-render) runs once per pause instead of once per
   * keystroke — the same cheap-live-path / expensive-commit-point split the
   * rail resizer documents (resizer-scripts-source.ts). Deterministic flush
   * guarantees (a pending patch can never be lost or reordered):
   *   - any OTHER controller action (select, remove, setMode, …) flushes the
   *     pending patch FIRST, so the reducer always sees events in user order;
   *   - `flushPropUpdates` is wired to field blur, export/JSX generation, the
   *     navigation guard, and controller unmount.
   */
  updatePropsDebounced: (nodeId: string, patch: JsonObject) => void;
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
  /** Copy + remove (with #245's selection repair). Refused for opaque nodes. */
  cut: (nodeId: string) => void;
  /** Clone-with-new-ids + insert-subtree at `target`, then select + reveal it. Errors (e.g. an incompatible slot) surface via `lastError`, never a silent no-op. */
  paste: (target: InsertionTarget) => void;
  /** Atomically clone and insert every root from a saved Pattern, then select and reveal its first inserted root. */
  insertForest: (sourceRoots: readonly CompositionNode[], target: InsertionTarget) => ComposerForestInsertionOutcome;
  /** Clone-with-new-ids + insert immediately after the source, then select + reveal it. Refused for opaque nodes. */
  duplicate: (nodeId: string) => void;
  /**
   * Canvas drag & drop (issue #258): move (or, when `copy`, clone) `sourceNodeId`
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
  setLeftWidth: (width: number) => void;
  setRightWidth: (width: number) => void;
  /** Legacy localStorage reload. Record-scoped controllers leave loading to the route coordinator. */
  reload: () => void;
  /** Restore the sample body while preserving a record-scoped controller's identity. */
  reset: () => void;
  dismissLoadNotice: () => void;
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
}

/** 200ms — just above a fast typist's ~100-180ms inter-key gap (so steady typing coalesces into one trailing commit) yet keeps the trailing persist+preview inside the ~300ms "feels instant" budget; the UX trade is documented in #259. */
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

export function useComposerController(options: UseComposerControllerOptions): ComposerController {
  const manifest = options.manifest;
  const idFactory = useMemo(() => options.idFactory ?? createUuidIdFactory(), [options.idFactory]);
  const now = options.now ?? (() => new Date().toISOString());

  const queueRef = useRef<CompositionSaveQueue>(options.saveQueue);
  const nowRef = useRef(now);
  const recordRef = useRef<CompositionRecord | null>(null);
  const stateRef = useRef<ComposerControllerState | null>(null);
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
      loadNotice: null,
      saveStatus: saveStatusFromQueue(options.saveQueue.state),
      derivedOutput: derivedOutputFromQueue(options.saveQueue.state),
      leftWidth: getPersistedWidth(LS_TREE_WIDTH, MIN_RAIL_W),
      rightWidth: getPersistedWidth(LS_INSPECTOR_WIDTH, MIN_RAIL_W),
    });
  }

  const [state, setState] = useState<ComposerControllerState>(stateRef.current);
  const [lastError, setLastError] = useState<string | null>(null);
  const pendingPropsRef = useRef<Map<string, JsonObject>>(new Map());
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBaseSaveStatusRef = useRef<ComposerSaveStatus | null>(null);

  const applyAction = useCallback(
    (action: ComposerAction): string | null => {
      const current = stateRef.current!;
      const result = applyComposerAction(current, action, { manifest, idFactory });
      setLastError(result.error);
      if (result.error) {
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
        recordRef.current = {
          ...recordRef.current!,
          updatedAt: nowRef.current(),
          document: next.document,
        };

        const queue = queueRef.current;
        try {
          queue.edit(queue.ref, recordRef.current);
          next = { ...next, saveStatus: saveStatusFromQueue(queue.state), derivedOutput: null };
        } catch (error) {
          next = {
            ...next,
            saveStatus: { kind: "error", reason: error instanceof Error ? error.message : "Composition persistence failed." },
            derivedOutput: null,
          };
        }
      } else if (action.type === "updateProps" && pendingBaseSaveStatusRef.current) {
        next = {
          ...next,
          saveStatus: saveStatusFromQueue(queueRef.current.state),
        };
      }
      stateRef.current = next;
      setState(next);
      return null;
    },
    [manifest, idFactory],
  );

  // ── Debounced updateProps channel (issue #291) ─────────────────────────────
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
      for (const [nodeId, patch] of pending) applyAction({ type: "updateProps", nodeId, patch });
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
    (nodeId: string, patch: JsonObject) => {
      const pending = pendingPropsRef.current;
      if (pending.size === 0) pendingBaseSaveStatusRef.current = stateRef.current!.saveStatus;
      pending.set(nodeId, { ...pending.get(nodeId), ...patch });
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

  // Mirror the vanilla resizer script's committed widths into typed state
  // (the drag/keyboard mechanics themselves run outside Preact for
  // per-pixel performance — see resizer-scripts-source.ts).
  useEffect(() => {
    function onWidthChange(event: Event): void {
      const detail = (event as CustomEvent<ComposerWidthChangeDetail>).detail;
      if (!detail) return;
      dispatch(
        detail.rail === "tree"
          ? { type: "setLeftWidth", width: detail.width }
          : { type: "setRightWidth", width: detail.width },
      );
    }
    document.addEventListener(WIDTH_CHANGE_EVENT, onWidthChange);
    return () => document.removeEventListener(WIDTH_CHANGE_EVENT, onWidthChange);
  }, [dispatch]);

  return useMemo<ComposerController>(
    () => ({
      state,
      record: recordRef.current!,
      manifest,
      lastError,
      add: (target, componentId) => dispatch({ type: "add", target, componentId }),
      rename: (name) => dispatch({ type: "rename", name }),
      updateProps: (nodeId, patch) => dispatch({ type: "updateProps", nodeId, patch }),
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
      setLeftWidth: (width) => {
        setPersistedWidth(LS_TREE_WIDTH, width);
        dispatch({ type: "setLeftWidth", width });
      },
      setRightWidth: (width) => {
        setPersistedWidth(LS_INSPECTOR_WIDTH, width);
        dispatch({ type: "setRightWidth", width });
      },
      reload: () => {
        flushPropUpdates();
      },
      reset: () => {
        const document = cloneJson(options.record.document);
        dispatch({ type: "resetToSample", document });
      },
      dismissLoadNotice: () => dispatch({ type: "dismissLoadNotice" }),
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
      options.record.document,
    ],
  );
}
