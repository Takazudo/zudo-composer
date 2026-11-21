const PENDING_ATTRIBUTE = "data-cms-nav-pending";

export interface PageLoading {
  /** Marks one pending navigation-shaped operation. The returned release is idempotent. */
  begin(source?: Element | null): () => void;
  isLoading(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createPageLoading(): PageLoading {
  let active = 0;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    begin(source) {
      active++;
      source?.setAttribute(PENDING_ATTRIBUTE, "");
      notify();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
        source?.removeAttribute(PENDING_ATTRIBUTE);
        notify();
      };
    },
    isLoading: () => active > 0,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
