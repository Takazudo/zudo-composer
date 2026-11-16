import type { DraftView } from "./types";

/** A mutation response is authoritative; older in-flight reads cannot replace it. */
export function createDraftRefreshController(accept: (view: DraftView) => void, fail: (cause: unknown) => void) {
  let sequence = 0, disposed = false;
  return {
    invalidate() { sequence++; },
    dispose() { disposed = true; sequence++; },
    accept(view: DraftView) { if (disposed) return; sequence++; accept(view); },
    async refresh(read: () => Promise<DraftView>): Promise<DraftView | null> {
      if (disposed) return null;
      const request = ++sequence;
      try {
        const view = await read();
        if (disposed || request !== sequence) return null;
        accept(view);
        return view;
      } catch (cause) {
        if (!disposed && request === sequence) fail(cause);
        return null;
      }
    },
  };
}
