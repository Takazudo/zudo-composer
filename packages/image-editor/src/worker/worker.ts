import { createWorkerState, handleMessage } from "./worker-core";
import type { Request } from "./worker-core";
const state = createWorkerState();
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<Request>) => void;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
};
scope.onmessage = (event) => {
  for (const emission of handleMessage(state, event.data))
    scope.postMessage(emission.message, emission.transfer);
};
