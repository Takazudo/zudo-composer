import { signal, type ReadonlySignal, type Scope } from "@takazudo/zfb/zudo-react";

/** The shape Composer controllers already expose (save queue, sessions, theme). */
export interface ExternalStore<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  /** Like useSyncExternalStore's third argument: the snapshot hydration setup must reproduce. */
  getServerSnapshot?(): T;
}

/**
 * Replacement for useSyncExternalStore: a readonly signal owned by `scope`.
 * Subscribes on activation (browser only) and re-reads the snapshot there, so a
 * change between setup and activation is not lost; unsubscribes on disposal.
 * Hydration fails closed (ZR_HYDRATION_MISMATCH) if setup text differs from the
 * server's, so setup reads getServerSnapshot when the store provides one.
 */
export function storeSignal<T>(scope: Scope, store: ExternalStore<T>): ReadonlySignal<T> {
  const value = signal((store.getServerSnapshot ?? store.getSnapshot)());
  scope.onActivate(() => {
    value.value = store.getSnapshot();
    return store.subscribe(() => {
      if (!scope.abortSignal.aborted) value.value = store.getSnapshot();
    });
  });
  return value;
}

export function createCounterStore(initial = 0) {
  const server = { count: initial };
  let snapshot = server;
  const listeners = new Set<() => void>();
  return {
    listeners,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => server,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    increment() {
      snapshot = { count: snapshot.count + 1 };
      for (const listener of [...listeners]) listener();
    },
  };
}
