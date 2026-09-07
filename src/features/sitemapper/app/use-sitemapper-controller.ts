"use client";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useWorkspace } from "../../../app/workspace-context";
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
}

export interface SitemapperController {
  state: SitemapperControllerState;
  record: SitemapRecord;
  queue: SitemapSaveQueue;
  lastError: string | null;
  dispatch: (action: SitemapperAction) => string | null;
  updatePropsDebounced: (pageId: string, patch: SitemapPagePropsPatch) => void;
  flushPropUpdates: () => SitemapDocument;
  flushNavigationDrafts: () => string | null;
  updateNavigationDebounced: (menu: "primary" | "footer", itemId: string, patch: SitemapperNavigationPatch) => void;
  flushPersistence: () => Promise<void>;
  retrySave: () => void;
  /** Undo only the most recent local remove while no later mutation occurred. */
  canUndoRemove: boolean;
  undoRemove: () => string | null;
}

function statusFromQueue(state: SaveQueueState<SitemapRecord>): SitemapperSaveStatus {
  return state.status === "error"
    ? { kind: "error", reason: state.error.message }
    : { kind: state.status };
}

export function useSitemapperController(options: UseSitemapperControllerOptions): SitemapperController {
  const integration = useWorkspace()?.integration;
  const workspaceSession = useRef<ReturnType<NonNullable<typeof integration>["sessions"]["register"]> | null>(null);
  const idFactoryRef = useRef(options.idFactory ?? createUuidIdFactory());
  const nowRef = useRef(options.now ?? (() => new Date().toISOString()));
  const debounceMsRef = useRef(options.debounceMs ?? SITEMAPPER_PROP_DEBOUNCE_MS);
  if (options.record.id !== options.record.document.id) {
    throw new Error("The Sitemap record and document identities do not match.");
  }
  const recordRef = useRef<SitemapRecord>(cloneJson(options.record));
  const queueRef = useRef<SitemapSaveQueue | null>(null);
  if (queueRef.current === null) {
    if (options.saveQueue) {
      if (options.saveQueue.ref.recordId !== options.record.id) {
        throw new Error("The Sitemap record does not match its save queue identity.");
      }
      queueRef.current = options.saveQueue;
    } else {
      const write = options.write
        ?? (options.store ? (snapshot: SaveQueueSnapshot<SitemapRecord>) => options.store!.put(snapshot.record) : null);
      if (!write) throw new Error("useSitemapperController requires saveQueue, write, or store.");
      const ref: SaveQueueRef = { providerId: options.providerId ?? SITEMAP_PROVIDERS.filesystem.id, recordId: options.record.id };
      queueRef.current = createSaveQueue<SitemapRecord>({
        ref,
        initialRecord: options.record,
        write,
      });
    }
  }

  const stateRef = useRef<SitemapperControllerState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = createInitialSitemapperControllerState(
      recordRef.current.document,
      statusFromQueue(queueRef.current.state),
    );
  }
  const [state, setState] = useState(stateRef.current);
  const [lastError, setLastError] = useState<string | null>(null);
  const pendingRef = useRef<Map<string, SitemapPagePropsPatch>>(new Map());
  const pendingNavigationRef = useRef<Map<string, { menu: "primary" | "footer"; itemId: string; patch: SitemapperNavigationPatch }>>(new Map());
  const pendingNavigationErrorRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutationRevisionRef = useRef(0);
  const undoRemoveRef = useRef<{ document: SitemapDocument; selectedId: string | null; revision: number } | null>(null);

  const applyAction = useCallback((action: SitemapperAction): string | null => {
    const prior = stateRef.current!;
    const result = applySitemapperAction(prior, action, idFactoryRef.current);
    setLastError(result.error);
    if (result.error) return result.error;
    let next = result.state;
    if (result.documentChanged) {
      mutationRevisionRef.current += 1;
      undoRemoveRef.current = action.type === "remove"
        ? { document: cloneJson(prior.document), selectedId: prior.selectedId, revision: mutationRevisionRef.current }
        : null;
      recordRef.current = {
        ...recordRef.current,
        updatedAt: nowRef.current(),
        document: next.document,
      };
      try {
        queueRef.current!.edit(queueRef.current!.ref, recordRef.current);
        next = { ...next, saveStatus: statusFromQueue(queueRef.current!.state) };
      } catch (error) {
        next = {
          ...next,
          saveStatus: {
            kind: "error",
            reason: error instanceof Error ? error.message : "Sitemap persistence failed.",
          },
        };
      }
    }
    stateRef.current = next;
    setState(next);
    return null;
  }, []);

  const flushPropUpdates = useCallback((): SitemapDocument => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = new Map();
    for (const [pageId, patch] of pending) {
      applyAction({ type: "updateProps", pageId, patch });
    }
    let navigationError: string | null = null;
    for (const [key, pendingNavigation] of pendingNavigationRef.current) {
      const items = stateRef.current!.document.navigation[pendingNavigation.menu];
      const index = items.findIndex((item) => item.id === pendingNavigation.itemId);
      const current = index < 0 ? undefined : items[index];
      if (!current) {
        pendingNavigationRef.current.delete(key);
        navigationError = `Navigation item "${pendingNavigation.itemId}" no longer exists.`;
        continue;
      }
      const result = applySitemapperAction(stateRef.current!, {
        type: "editNavigation",
        menu: pendingNavigation.menu,
        command: { kind: "put", item: { ...current, ...pendingNavigation.patch }, index },
      }, idFactoryRef.current);
      if (!result.error && result.documentChanged) {
        const next = result.state;
        mutationRevisionRef.current += 1;
        undoRemoveRef.current = null;
        recordRef.current = { ...recordRef.current, updatedAt: nowRef.current(), document: next.document };
        try {
          queueRef.current!.edit(queueRef.current!.ref, recordRef.current);
          stateRef.current = { ...next, saveStatus: statusFromQueue(queueRef.current!.state) };
          setState(stateRef.current);
          pendingNavigationRef.current.delete(key);
        } catch (error) {
          navigationError = error instanceof Error ? error.message : "Sitemap persistence failed.";
        }
      } else if (result.error) {
        navigationError = result.error;
      } else {
        pendingNavigationRef.current.delete(key);
      }
    }
    pendingNavigationErrorRef.current = navigationError;
    if (navigationError) {
      setLastError(navigationError);
      const current = stateRef.current!;
      const next = { ...current, saveStatus: { kind: "error" as const, reason: navigationError } };
      stateRef.current = next;
      setState(next);
    }
    // Invalid/no-op pending patches do not call queue.edit. Restore the honest
    // queue status instead of leaving the toolbar permanently dirty.
    const current = stateRef.current!;
    const saveStatus = statusFromQueue(queueRef.current!.state);
    if (pendingNavigationRef.current.size === 0 && current.saveStatus.kind === "dirty" && saveStatus.kind !== "dirty") {
      const next = { ...current, saveStatus };
      stateRef.current = next;
      setState(next);
    }
    return stateRef.current!.document;
  }, [applyAction]);

  const flushNavigationDrafts = useCallback((): string | null => {
    flushPropUpdates();
    return pendingNavigationErrorRef.current;
  }, [flushPropUpdates]);

  const dispatch = useCallback((action: SitemapperAction): string | null => {
    const flushError = flushNavigationDrafts();
    if (flushError) return flushError;
    return applyAction(action);
  }, [applyAction, flushNavigationDrafts]);

  const updatePropsDebounced = useCallback((pageId: string, patch: SitemapPagePropsPatch): void => {
    pendingRef.current.set(pageId, { ...pendingRef.current.get(pageId), ...patch });
    workspaceSession.current?.changed();
    const current = stateRef.current!;
    if (current.saveStatus.kind !== "dirty") {
      const next = { ...current, saveStatus: { kind: "dirty" } as const };
      stateRef.current = next;
      setState(next);
    }
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushPropUpdates();
    }, debounceMsRef.current);
  }, [flushPropUpdates]);

  const updateNavigationDebounced = useCallback((menu: "primary" | "footer", itemId: string, patch: SitemapperNavigationPatch): void => {
    const key = `${menu}:${itemId}`;
    const current = pendingNavigationRef.current.get(key);
    pendingNavigationRef.current.set(key, {
      menu,
      itemId,
      patch: { ...current?.patch, ...patch },
    });
    pendingNavigationErrorRef.current = null;
    setLastError(null);
    workspaceSession.current?.changed();
    const currentState = stateRef.current!;
    if (currentState.saveStatus.kind !== "dirty") {
      const next = { ...currentState, saveStatus: { kind: "dirty" as const } };
      stateRef.current = next;
      setState(next);
    }
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushPropUpdates();
    }, debounceMsRef.current);
  }, [flushPropUpdates]);

  const flushPersistence = useCallback(async (): Promise<void> => {
    flushPropUpdates();
    if (pendingNavigationErrorRef.current || pendingNavigationRef.current.size > 0) {
      throw new Error(pendingNavigationErrorRef.current ?? "Navigation drafts could not be saved.");
    }
    await queueRef.current!.flush();
  }, [flushPropUpdates]);

  const retrySave = useCallback((): void => {
    flushPropUpdates();
    if (pendingNavigationErrorRef.current || pendingNavigationRef.current.size > 0) {
      const reason = pendingNavigationErrorRef.current ?? "Navigation drafts could not be saved.";
      setLastError(reason);
      return;
    }
    try {
      queueRef.current!.retry();
    } catch (error) {
      const current = stateRef.current!;
      const next = {
        ...current,
        saveStatus: {
          kind: "error" as const,
          reason: error instanceof Error ? error.message : "Sitemap persistence failed.",
        },
      };
      stateRef.current = next;
      setState(next);
    }
  }, [flushPropUpdates]);

  const undoRemove = useCallback((): string | null => {
    flushPropUpdates();
    if (pendingNavigationErrorRef.current || pendingNavigationRef.current.size > 0) return null;
    const undo = undoRemoveRef.current;
    if (!undo || undo.revision !== mutationRevisionRef.current) return null;
    const current = stateRef.current!;
    const document = cloneJson(undo.document);
    const nextState: SitemapperControllerState = {
      ...current,
      document,
      selectedId: undo.selectedId,
      saveStatus: { kind: "dirty" },
    };
    mutationRevisionRef.current += 1;
    undoRemoveRef.current = null;
    recordRef.current = { ...recordRef.current, updatedAt: nowRef.current(), document };
    try {
      queueRef.current!.edit(queueRef.current!.ref, recordRef.current);
      nextState.saveStatus = statusFromQueue(queueRef.current!.state);
    } catch (error) {
      nextState.saveStatus = { kind: "error", reason: error instanceof Error ? error.message : "Sitemap persistence failed." };
    }
    stateRef.current = nextState;
    setState(nextState);
    setLastError(null);
    return null;
  }, [flushPropUpdates]);

  const flushRef = useRef(flushPropUpdates);
  flushRef.current = flushPropUpdates;
  const persistenceRef = useRef(flushPersistence);
  persistenceRef.current = flushPersistence;
  useEffect(() => {
    if (!integration) return;
    const queue = queueRef.current!;
    const session = integration.sessions.register({ feature: "Sitemap", ...queue.ref, workspaceId: integration.workspace.id }, {
      flush: async () => { await persistenceRef.current(); }, retry: () => queue.retry(),
    });
    workspaceSession.current = session;
    let revision = queue.state.draftRevision;
    const unsubscribe = queue.subscribe((next) => { if (revision !== next.draftRevision) { revision = next.draftRevision; session.changed(); } });
    return () => { flushRef.current(); unsubscribe(); session.detach(); workspaceSession.current = null; };
  }, [integration]);
  useEffect(() => {
    const queue = queueRef.current!;
    const unsubscribe = queue.subscribe((queueState) => {
      const current = stateRef.current!;
      const saveStatus = pendingRef.current.size > 0 || pendingNavigationRef.current.size > 0 ? { kind: "dirty" as const } : statusFromQueue(queueState);
      if (
        current.saveStatus.kind === saveStatus.kind
        && (saveStatus.kind !== "error"
          || (current.saveStatus.kind === "error" && current.saveStatus.reason === saveStatus.reason))
      ) return;
      const next = { ...current, saveStatus };
      stateRef.current = next;
      setState(next);
    });
    return () => {
      flushRef.current();
      unsubscribe();
    };
  }, []);

  return {
    state,
    record: recordRef.current,
    queue: queueRef.current,
    lastError,
    dispatch,
    updatePropsDebounced,
    flushPropUpdates,
    flushNavigationDrafts,
    updateNavigationDebounced,
    flushPersistence,
    retrySave,
    canUndoRemove: undoRemoveRef.current !== null && undoRemoveRef.current.revision === mutationRevisionRef.current,
    undoRemove,
  };
}
