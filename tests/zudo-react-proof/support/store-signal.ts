export { storeSignal, type ExternalStore } from "../../../src/runtime/store-signal";

/** Test fixture: a counter store with a fixed server snapshot and an observable listener set. */
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
