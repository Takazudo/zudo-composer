// @ts-check

// A deliberately small static server for the hosted-demo browser lane.
// It serves only the already-built artifact; authoring APIs and Vite middleware
// are intentionally absent from this path.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

const MIME_BY_EXTENSION = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".wasm", "application/wasm"],
]);

/** @param {string} path */
function mimeType(path) {
  return MIME_BY_EXTENSION.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}

/** @param {string} root @param {string} pathname @returns {string | null} */
function isSafePath(root, pathname) {
  const path = resolve(root, `.${pathname}`);
  const withinRoot = path === root || path.startsWith(`${root}${sep}`);
  return withinRoot ? path : null;
}

/** @param {import("node:http").IncomingMessage} request */
function acceptsHtml(request) {
  return String(request.headers.accept ?? "").split(",").some((value) => value.trim().split(";", 1)[0] === "text/html");
}

/** @param {string} pathname @param {import("node:http").IncomingMessage} request */
function isSpaNavigation(pathname, request) {
  // Unknown immutable uploads must stay 404 even if a browser sends a broad
  // Accept header. Asset URLs with a suffix are also never HTML fallbacks.
  return acceptsHtml(request) && !pathname.startsWith("/uploaded-media/") && !extname(pathname);
}

/**
 * Start a static hosted-demo server and resolve after the listen callback.
 * @param {{ directory: string, host?: string, port?: number }} options
 * @returns {Promise<{ server: import("node:http").Server, url: string, close: () => Promise<void> }>}
 */
export async function startHostedDemoStaticServer({ directory, host = "127.0.0.1", port = 4175 }) {
  const root = resolve(directory);
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error(`Hosted demo artifact is not a directory: ${root}`);
  const server = createServer(
    /** @param {import("node:http").IncomingMessage} request @param {import("node:http").ServerResponse} response */
    async (request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url ?? "/", `http://${host}`).pathname);
      } catch {
        response.writeHead(400);
        response.end("Bad URL");
        return;
      }
      let filePath = isSafePath(root, pathname);
      if (filePath) {
        try {
          const info = await stat(filePath);
          if (!info.isFile()) filePath = null;
        } catch {
          filePath = null;
        }
      }
      if (!filePath && isSpaNavigation(pathname, request)) filePath = join(root, "index.html");
      if (!filePath) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      // The path has already been resolved beneath root. Keep this check close to
      // the response in case this function is changed to support another fallback.
      const servedRelative = relative(root, filePath);
      if (servedRelative.startsWith(`..${sep}`) || servedRelative === "..") {
        response.writeHead(404);
        response.end();
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": mimeType(filePath),
        "Content-Length": body.byteLength,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (request.method === "HEAD") response.end();
      else response.end(body);
    },
  );
  /** @type {Promise<void>} */
  const listening = new Promise((resolveListen, reject) => {
    /** @param {Error} error */
    const onError = (error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolveListen(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") {
    /** @type {Promise<void>} */
    const closed = new Promise((resolveClose) => server.close(() => resolveClose()));
    await closed;
    throw new Error("Hosted demo static server did not expose a TCP address.");
  }
  /** @type {Promise<void> | undefined} */
  let closePromise;
  return {
    server,
    url: `http://${host}:${address.port}`,
    close: () => {
      if (closePromise) return closePromise;
      closePromise = new Promise((resolveClose, reject) => {
        /** @param {Error | undefined} error */
        server.close((error) => error ? reject(error) : resolveClose());
      });
      return closePromise;
    },
  };
}
