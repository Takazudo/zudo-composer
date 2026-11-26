import type { DraftView } from "./types";

/** A mutation response is authoritative; older in-flight reads cannot replace it. */
export function createDraftRefreshController(accept: (view: DraftView) => void, fail: (cause: unknown) => void) {
  let sequence = 0, settledThrough = 0, disposed = false;
  const invalidate = () => { settledThrough = ++sequence; };
  return {
    invalidate,
    dispose() { disposed = true; invalidate(); },
    accept(view: DraftView) { if (disposed) return; invalidate(); accept(view); },
    async refresh(read: () => Promise<DraftView>): Promise<DraftView | null> {
      if (disposed) return null;
      const request = ++sequence;
      try {
        const view = await read();
        // A queued refresh cannot hide a draft that was already read successfully.
        if (disposed || request <= settledThrough) return null;
        settledThrough = request;
        accept(view);
        return view;
      } catch (cause) {
        if (!disposed && request === sequence) {
          settledThrough = request;
          fail(cause);
        }
        return null;
      }
    },
  };
}
