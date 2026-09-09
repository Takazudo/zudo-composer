import type { WorkerLike } from "./client";
import { createWorkerState, handleMessageSteps } from "./worker-core";
import type { Response } from "./worker-core";
/** Same state machine as the worker, yielding between sixteen-row chunks. */
export function createFallbackWorker(): WorkerLike {
  const state = createWorkerState(),
    listeners = new Set<(event: MessageEvent<Response>) => void>();
  let stopped = false;
  return {
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    terminate() {
      stopped = true;
      listeners.clear();
      state.source = undefined;
      state.cache = undefined;
    },
    postMessage(request) {
      const steps = handleMessageSteps(state, request);
      const advance = () => {
        if (stopped) {
          steps.return([]);
          return;
        }
        const step = steps.next();
        if (!step.done) setTimeout(advance, 0);
        else
          for (const { message } of step.value)
            for (const listener of listeners)
              listener({ data: message } as MessageEvent<Response>);
      };
      setTimeout(advance, 0);
    },
  };
}
