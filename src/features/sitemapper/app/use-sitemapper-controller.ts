import { getScope, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { ProductionProviderIntegration } from "../../../app/provider-integration";
import { cloneJson, createUuidIdFactory, type IdFactory } from "../../../shared";
import {
  createSaveQueue,
  type SaveQueue,
  type SaveQueueRef,
  type SaveQueueSnapshot,
  type SaveQueueState,
} from "../../../shared/persistence";
import type { SitemapPagePropsPatch } from "../../../sitemapper/commands";
import type { SitemapNavigationItem } from "../../../sitemapper/model";
import { SITEMAP_PROVIDERS, type SitemapRecord, type SitemapStore } from "../../../sitemapper/library";
import type { SitemapDocument } from "../../../sitemapper/model";
import {
  applySitemapperAction,
  createInitialSitemapperControllerState,
  type SitemapperAction,
  type SitemapperControllerState,
  type SitemapperSaveStatus,
} from "./controller-model";

export const SITEMAPPER_PROP_DEBOUNCE_MS = 200;
export type SitemapSaveQueue = SaveQueue<SitemapRecord>;
export type SitemapperNavigationPatch = Partial<Pick<SitemapNavigationItem, "label" | "visible" | "destination">>;

export interface UseSitemapperControllerOptions {
  record: SitemapRecord;
  providerId?: string;
  /** Supply an existing record-bound queue when a parent owns transition lifetime. */
  saveQueue?: SitemapSaveQueue;
  /** Used to create the shared generic queue when `saveQueue` is omitted. */
  write?: (snapshot: SaveQueueSnapshot<SitemapRecord>) => Promise<void>;
  /** Convenience production seam; the queue still owns snapshotting and ordering. */
  store?: Pick<SitemapStore, "put">;
  idFactory?: IdFactory;
  now?: () => string;
  debounceMs?: number;
  /** The workspace whose save barrier flushes this editor; none when mounted standalone. */
  integration?: ProductionProviderIntegration | null;
}

export interface SitemapperControllerSignals {
  readonly state: ReadonlySignal<SitemapperControllerState>;
  readonly lastError: ReadonlySignal<string | null>;
  readonly canUndoRemove: ReadonlySignal<boolean>;
}

/**
 * `state`, `lastError` and `canUndoRemove` read the current values; bind live
 * markup to `signals`.
 */
export interface SitemapperController {
  readonly state: SitemapperControllerState;
  readonly signals: SitemapperControllerSignals;
  readonly record: SitemapRecord;
  queue: SitemapSaveQueue;
  readonly lastError: string | null;
  dispatch: (action: SitemapperAction) => string | null;
  updatePropsDebounced: (pageId: string, patch: SitemapPagePropsPatch) => void;
  flushPropUpdates: () => SitemapDocument;
  flushNavigationDrafts: () => string | null;
  updateNavigationDebounced: (menu: "primary" | "footer", itemId: string, patch: SitemapperNavigationPatch) => void;
  flushPersistence: () => Promise<void>;
  retrySave: () => void;
  /** Undo only the most recent local remove while no later mutation occurred. */
  readonly canUndoRemove: boolean;
  undoRemove: () => string | null;
}

function statusFromQueue(state: SaveQueueState<SitemapRecord>): SitemapperSaveStatus {
  return state.status === "error"
    ? { kind: "error", reason: state.error.message }
    : { kind: state.status };
}

/**
 * The Sitemap editor session. Call during component setup: the record, the
 * save queue and the workspace session live as long as the calling scope, and
 * leaving it flushes pending property drafts.
 */
export function createSitemapperController(options: UseSitemapperControllerOptions): SitemapperController {
  const scope = getScope();
  const integration = options.integration ?? null;
  let workspaceSession: ReturnType<ProductionProviderIntegration["sessions"]["register"]> | null = null;
  const idFactory = options.idFactory ?? createUuidIdFactory();
  const now = options.now ?? (() => new Date().toISOString());
  const debounceMs = options.debounceMs ?? SITEMAPPER_PROP_DEBOUNCE_MS;
  if (options.record.id !== options.record.document.id) {
    throw new Error("The Sitemap record and document identities do not match.");
  }
  let record: SitemapRecord = cloneJson(options.record);
  let queue: SitemapSaveQueue;
  if (options.saveQueue) {
    if (options.saveQueue.ref.recordId !== options.record.id) {
      throw new Error("The Sitemap record does not match its save queue identity.");
    }
    queue = options.saveQueue;
  } else {
    const write = options.write
      ?? (options.store ? (snapshot: SaveQueueSnapshot<SitemapRecord>) => options.store!.put(snapshot.record) : null);
    if (!write) throw new Error("createSitemapperController requires saveQueue, write, or store.");
    const ref: SaveQueueRef = { providerId: options.providerId ?? SITEMAP_PROVIDERS.filesystem.id, recordId: options.record.id };
    queue = createSaveQueue<SitemapRecord>({
      ref,
      initialRecord: options.record,
      write,
    });
  }

  const state = signal<SitemapperControllerState>(createInitialSitemapperControllerState(
    record.document,
    statusFromQueue(queue.state),
  ));
  const lastError = signal<string | null>(null);
  const canUndoRemove = signal(false);
  let pending = new Map<string, SitemapPagePropsPatch>();
  const pendingNavigation = new Map<string, { menu: "primary" | "footer"; itemId: string; patch: SitemapperNavigationPatch }>();
  let pendingNavigationError: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let mutationRevision = 0;
  let undoRemoveState: { document: SitemapDocument; selectedId: string | null; revision: number } | null = null;
  const syncUndo = () => { canUndoRemove.value = undoRemoveState !== null && undoRemoveState.revision === mutationRevision; };
  const setState = (next: SitemapperControllerState) => { state.value = next; };

  const applyAction = (action: SitemapperAction): string | null => {
    const prior = state.value;
    const result = applySitemapperAction(prior, action, idFactory);
    lastError.value = result.error;
    if (result.error) return result.error;
    let next = result.state;
    if (result.documentChanged) {
      mutationRevision += 1;
      undoRemoveState = action.type === "remove"
        ? { document: cloneJson(prior.document), selectedId: prior.selectedId, revision: mutationRevision }
        : null;
      record = {
        ...record,
        updatedAt: now(),
        document: next.document,
      };
      try {
        queue.edit(queue.ref, record);
        next = { ...next, saveStatus: statusFromQueue(queue.state) };
      } catch (error) {
        next = {
          ...next,
          saveStatus: {
            kind: "error",
            reason: error instanceof Error ? error.message : "Sitemap persistence failed.",
          },
        };
      }
      syncUndo();
    }
    setState(next);
    return null;
  };

  const flushPropUpdates = (): SitemapDocument => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const drained = pending;
    pending = new Map();
    for (const [pageId, patch] of drained) {
      applyAction({ type: "updateProps", pageId, patch });
    }
    let navigationError: string | null = null;
    for (const [key, draft] of pendingNavigation) {
      const items = state.value.document.navigation[draft.menu];
      const index = items.findIndex((item) => item.id === draft.itemId);
      const current = index < 0 ? undefined : items[index];
      if (!current) {
        pendingNavigation.delete(key);
        navigationError = `Navigation item "${draft.itemId}" no longer exists.`;
        continue;
      }
      const result = applySitemapperAction(state.value, {
        type: "editNavigation",
        menu: draft.menu,
        command: { kind: "put", item: { ...current, ...draft.patch }, index },
      }, idFactory);
      if (!result.error && result.documentChanged) {
        const next = result.state;
        mutationRevision += 1;
        undoRemoveState = null;
        syncUndo();
        record = { ...record, updatedAt: now(), document: next.document };
        try {
          queue.edit(queue.ref, record);
          setState({ ...next, saveStatus: statusFromQueue(queue.state) });
          pendingNavigation.delete(key);
        } catch (error) {
          navigationError = error instanceof Error ? error.message : "Sitemap persistence failed.";
        }
      } else if (result.error) {
        navigationError = result.error;
      } else {
        pendingNavigation.delete(key);
      }
    }
    pendingNavigationError = navigationError;
    if (navigationError) {
      lastError.value = navigationError;
      setState({ ...state.value, saveStatus: { kind: "error" as const, reason: navigationError } });
    }
    // Invalid/no-op pending patches do not call queue.edit. Restore the honest
    // queue status instead of leaving the toolbar permanently dirty.
    const current = state.value;
    const saveStatus = statusFromQueue(queue.state);
    if (pendingNavigation.size === 0 && current.saveStatus.kind === "dirty" && saveStatus.kind !== "dirty") {
      setState({ ...current, saveStatus });
    }
    return state.value.document;
  };

  const flushNavigationDrafts = (): string | null => {
    flushPropUpdates();
    return pendingNavigationError;
  };

  const dispatch = (action: SitemapperAction): string | null => {
    const flushError = flushNavigationDrafts();
    if (flushError) return flushError;
    return applyAction(action);
  };

  const markDirty = () => {
    const current = state.value;
    if (current.saveStatus.kind !== "dirty") setState({ ...current, saveStatus: { kind: "dirty" as const } });
  };
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flushPropUpdates();
    }, debounceMs);
  };

  const updatePropsDebounced = (pageId: string, patch: SitemapPagePropsPatch): void => {
    pending.set(pageId, { ...pending.get(pageId), ...patch });
    workspaceSession?.changed();
    markDirty();
    schedule();
  };

  const updateNavigationDebounced = (menu: "primary" | "footer", itemId: string, patch: SitemapperNavigationPatch): void => {
    const key = `${menu}:${itemId}`;
    const current = pendingNavigation.get(key);
    pendingNavigation.set(key, {
      menu,
      itemId,
      patch: { ...current?.patch, ...patch },
    });
    pendingNavigationError = null;
    lastError.value = null;
    workspaceSession?.changed();
    markDirty();
    schedule();
  };

  const flushPersistence = async (): Promise<void> => {
    flushPropUpdates();
    if (pendingNavigationError || pendingNavigation.size > 0) {
      throw new Error(pendingNavigationError ?? "Navigation drafts could not be saved.");
    }
    await queue.flush();
  };

  const retrySave = (): void => {
    flushPropUpdates();
    if (pendingNavigationError || pendingNavigation.size > 0) {
      lastError.value = pendingNavigationError ?? "Navigation drafts could not be saved.";
      return;
    }
    try {
      queue.retry();
    } catch (error) {
      setState({
        ...state.value,
        saveStatus: {
          kind: "error" as const,
          reason: error instanceof Error ? error.message : "Sitemap persistence failed.",
        },
      });
    }
  };

  const undoRemove = (): string | null => {
    flushPropUpdates();
    if (pendingNavigationError || pendingNavigation.size > 0) return null;
    const undo = undoRemoveState;
    if (!undo || undo.revision !== mutationRevision) return null;
    const current = state.value;
    const document = cloneJson(undo.document);
    const nextState: SitemapperControllerState = {
      ...current,
      document,
      selectedId: undo.selectedId,
      saveStatus: { kind: "dirty" },
    };
    mutationRevision += 1;
    undoRemoveState = null;
    syncUndo();
    record = { ...record, updatedAt: now(), document };
    try {
      queue.edit(queue.ref, record);
      nextState.saveStatus = statusFromQueue(queue.state);
    } catch (error) {
      nextState.saveStatus = { kind: "error", reason: error instanceof Error ? error.message : "Sitemap persistence failed." };
    }
    setState(nextState);
    lastError.value = null;
    return null;
  };

  if (integration) {
    const session = integration.sessions.register({ feature: "Sitemap", ...queue.ref, workspaceId: integration.workspace.id }, {
      flush: async () => { await flushPersistence(); }, retry: () => queue.retry(),
    });
    workspaceSession = session;
    let revision = queue.state.draftRevision;
    const unsubscribe = queue.subscribe((next) => { if (revision !== next.draftRevision) { revision = next.draftRevision; session.changed(); } });
    scope.onCleanup(() => { flushPropUpdates(); unsubscribe(); session.detach(); workspaceSession = null; });
  }
  const unsubscribeQueue = queue.subscribe((queueState) => {
    const current = state.value;
    const saveStatus = pending.size > 0 || pendingNavigation.size > 0 ? { kind: "dirty" as const } : statusFromQueue(queueState);
    if (
      current.saveStatus.kind === saveStatus.kind
      && (saveStatus.kind !== "error"
        || (current.saveStatus.kind === "error" && current.saveStatus.reason === saveStatus.reason))
    ) return;
    setState({ ...current, saveStatus });
  });
  scope.onCleanup(() => {
    flushPropUpdates();
    unsubscribeQueue();
  });

  return {
    get state() { return state.value; },
    signals: { state, lastError, canUndoRemove },
    get record() { return record; },
    queue,
    get lastError() { return lastError.value; },
    dispatch,
    updatePropsDebounced,
    flushPropUpdates,
    flushNavigationDrafts,
    updateNavigationDebounced,
    flushPersistence,
    retrySave,
    get canUndoRemove() { return canUndoRemove.value; },
    undoRemove,
  };
}
