import { signal, type ReadonlySignal, type Scope } from "@takazudo/zfb/zudo-react";

/** The subscribe/snapshot shape Composer controllers expose (save queue, sessions, theme). */
export interface ExternalStore<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  /** The snapshot setup must reproduce while hydrating server output (useSyncExternalStore's third argument). */
  getServerSnapshot?(): T;
}

/**
 * Replacement for `useSyncExternalStore`: a readonly signal owned by `scope`.
 *
 * Setup reads `getServerSnapshot` when present, because hydration fails closed
 * (`ZR_HYDRATION_MISMATCH`) on any text that differs from the server's. The
 * subscription starts on activation (browser only) and re-reads the snapshot
 * there, so a change between setup and activation is not lost; it ends with the
 * scope, and a notification after disposal never writes.
 */
export function storeSignal<T>(scope: Scope, store: ExternalStore<T>): ReadonlySignal<T> {
  const value = signal((store.getServerSnapshot ?? store.getSnapshot).call(store));
  scope.onActivate(() => {
    value.value = store.getSnapshot();
    return store.subscribe(() => {
      if (!scope.abortSignal.aborted) value.value = store.getSnapshot();
    });
  });
  return value;
}
