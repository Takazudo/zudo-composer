/** Internal transport hint; never an authorization header or server write bypass. */
export const AUTHORING_READ_HEADER = "x-zudo-authoring-read";

/** Retry only explicitly read-only requests refused before admission. */
export async function retryAuthoringRead(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  attempt: (signal?: AbortSignal) => Promise<Response>,
  options: { timeoutMs?: number; delayMs?: number } = {},
): Promise<Response> {
  if (new Headers(init?.headers).get(AUTHORING_READ_HEADER) !== "1") return attempt(init?.signal ?? undefined);
  const controller = new AbortController();
  const signal = controller.signal;
  const original = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort(original?.reason);
  original?.addEventListener("abort", abort, { once: true });
  if (original?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new DOMException("Authoring read did not settle in time.", "TimeoutError")), options.timeoutMs ?? 120_000);
  try {
    for (;;) {
      signal.throwIfAborted();
      let busy = false;
      try {
        const response = await attempt(signal);
        signal.throwIfAborted();
        if (response.status === 409) {
          const value = await response.clone().json().catch(() => null);
          busy = value?.ok === false && value?.error?.code === "authoring-busy";
        }
        if (!busy) return response;
      } catch (cause) {
        if (!(cause && typeof cause === "object" && "code" in cause && cause.code === "authoring-busy")) throw cause;
      }
      await new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); signal.removeEventListener("abort", stop); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, options.delayMs ?? 250);
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) stop();
      });
    }
  } finally { clearTimeout(timeout); original?.removeEventListener("abort", abort); }
}
