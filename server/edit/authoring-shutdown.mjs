// @ts-check

/**
 * Await async middleware work even after its HTTP client has disconnected.
 * Vite closes sockets, but that alone does not await file-store promises. Wrap
 * both the existing stack and later registrations, including other providers
 * which read Composer snapshots while compiling working previews.
 * @param {import("vite").ViteDevServer} server
 * @param {{release(): Promise<void>}} lease
 */
export function installAuthoringShutdown(server, lease) {
  /** @type {Set<Promise<unknown>>} */
  const active = new Set();
  /** @type {Map<import("node:http").IncomingMessage, number>} */
  const requests = new Map();
  /** @type {WeakSet<Function>} */
  const wrapped = new WeakSet();
  let closing = false;
  /** @type {Promise<void> | undefined} */
  let shutdown;
  /** @param {Function} handler */
  function wrap(handler) {
    if (wrapped.has(handler)) return handler;
    /** @param {unknown} receiver @param {unknown[]} args @param {number} responseIndex */
    function invoke(receiver, args, responseIndex) {
      if (closing) {
        const response = /** @type {import("node:http").ServerResponse} */ (args[responseIndex]);
        response.statusCode = 503;
        response.end("Authoring server is shutting down.");
        return;
      }
      const result = Reflect.apply(handler, receiver, args);
      if (result && typeof result.then === "function") {
        const pending = Promise.resolve(result);
        active.add(pending);
        const request = /** @type {import("node:http").IncomingMessage} */ (args[responseIndex - 1]);
        requests.set(request, (requests.get(request) ?? 0) + 1);
        const settled = () => {
          active.delete(pending);
          const remaining = (requests.get(request) ?? 1) - 1;
          if (remaining) requests.set(request, remaining);
          else requests.delete(request);
        };
        void pending.then(settled, settled);
      }
      return result;
    }
    // Connect distinguishes error middleware by its declared four arguments.
    const result = handler.length === 4
      ? /** @this {unknown} */ function (/** @type {unknown} */ error, /** @type {unknown} */ req, /** @type {unknown} */ res, /** @type {unknown} */ next) { return invoke(this, [error, req, res, next], 2); }
      : /** @this {unknown} */ function (/** @type {unknown} */ req, /** @type {unknown} */ res, /** @type {unknown} */ next) { return invoke(this, [req, res, next], 1); };
    wrapped.add(result);
    return result;
  }
  const middleware = server.middlewares;
  const stack = /** @type {{handle: Function}[]} */ (middleware.stack ?? []);
  for (const layer of stack) layer.handle = wrap(layer.handle);
  const use = middleware.use;
  middleware.use = /** @type {typeof middleware.use} */ (function (/** @type {unknown[]} */ ...args) {
    return Reflect.apply(use, this, args.map(argument => typeof argument === "function" ? wrap(argument) : argument));
  });
  const close = server.close.bind(server);
  const closeWebSocket = server.ws.close.bind(server.ws);
  /** @type {Promise<void> | undefined} */
  let webSocketClose;
  server.ws.close = () => webSocketClose ??= Promise.resolve(closeWebSocket());
  server.close = () => {
    shutdown ??= (async () => {
      closing = true;
      // Disconnect operator challenges before waiting for their handlers. A
      // reconciliation challenge deliberately waits for this disconnect;
      // disposing the module evaluator first would interrupt its locked work.
      await server.ws.close();
      // Destroy active request streams on HTTP/1 and HTTP/2 alike. This wakes
      // incomplete body readers without disposing the SSR evaluator.
      for (const request of requests.keys()) if (typeof request.destroy === "function") request.destroy();
      // Keep the module evaluator available until handlers have completed their
      // storage work and native lock release. No new request may enter a store.
      while (active.size) await Promise.allSettled([...active]);
      await close();
      await lease.release();
    })();
    return shutdown;
  };
}
