"use client";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { cloneJson, createUuidIdFactory, type IdFactory } from "../../../shared";
import {
  createSaveQueue,
  type SaveQueue,
  type SaveQueueRef,
  type SaveQueueSnapshot,
  type SaveQueueState,
} from "../../../shared/persistence";
import type { SitemapPagePropsPatch } from "../../../sitemapper/commands";
import type { SitemapRecord, SitemapStore } from "../../../sitemapper/library";
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
  flushPersistence: () => Promise<void>;
  retrySave: () => void;
}

function statusFromQueue(state: SaveQueueState<SitemapRecord>): SitemapperSaveStatus {
  return state.status === "error"
    ? { kind: "error", reason: state.error.message }
    : { kind: state.status };
}

export function useSitemapperController(options: UseSitemapperControllerOptions): SitemapperController {
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
      const ref: SaveQueueRef = { providerId: options.providerId ?? "indexeddb", recordId: options.record.id };
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyAction = useCallback((action: SitemapperAction): string | null => {
    const result = applySitemapperAction(stateRef.current!, action, idFactoryRef.current);
    setLastError(result.error);
    if (result.error) return result.error;
    let next = result.state;
    if (result.documentChanged) {
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
    // Invalid/no-op pending patches do not call queue.edit. Restore the honest
    // queue status instead of leaving the toolbar permanently dirty.
    const current = stateRef.current!;
    const saveStatus = statusFromQueue(queueRef.current!.state);
    if (current.saveStatus.kind === "dirty" && saveStatus.kind !== "dirty") {
      const next = { ...current, saveStatus };
      stateRef.current = next;
      setState(next);
    }
    return stateRef.current!.document;
  }, [applyAction]);

  const dispatch = useCallback((action: SitemapperAction): string | null => {
    flushPropUpdates();
    return applyAction(action);
  }, [applyAction, flushPropUpdates]);

  const updatePropsDebounced = useCallback((pageId: string, patch: SitemapPagePropsPatch): void => {
    pendingRef.current.set(pageId, { ...pendingRef.current.get(pageId), ...patch });
    const current = stateRef.current!;
    if (current.saveStatus.kind !== "dirty") {
      const next = { ...current, saveStatus: { kind: "dirty" } as const };
      stateRef.current = next;
      setState(next);
    }
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flushPropUpdates, debounceMsRef.current);
  }, [flushPropUpdates]);

  const flushPersistence = useCallback(async (): Promise<void> => {
    flushPropUpdates();
    await queueRef.current!.flush();
  }, [flushPropUpdates]);

  const retrySave = useCallback((): void => {
    flushPropUpdates();
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

  const flushRef = useRef(flushPropUpdates);
  flushRef.current = flushPropUpdates;
  useEffect(() => {
    const queue = queueRef.current!;
    const unsubscribe = queue.subscribe((queueState) => {
      const current = stateRef.current!;
      const saveStatus = pendingRef.current.size > 0 ? { kind: "dirty" as const } : statusFromQueue(queueState);
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
    flushPersistence,
    retrySave,
  };
}
