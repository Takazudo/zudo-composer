// @ts-check

// A deliberately small static server for the hosted-demo browser lane.
// It serves only the already-built artifact; authoring APIs and Vite middleware
// are intentionally absent from this path.
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { ASSET_CHECKSUM_URL_PATTERN, ASSET_IMMUTABLE_CACHE_CONTROL, ASSET_NOSNIFF, assetContentDisposition, assetMimeTypeForExtension } from "../../src/assets/model/asset-kinds.mjs";

const MIME_BY_EXTENSION = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/vnd.microsoft.icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml"],
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

/** @param {string} root @param {string} pathname @returns {Promise<string | null>} */
async function findFile(root, pathname) {
  const path = isSafePath(root, pathname);
  if (!path) return null;
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

/** @param {import("node:http").ServerResponse} response @param {string} pathname @param {string} search */
function redirectHtml(response, pathname, search) {
  // Encode decoded filenames again, preserving the query and a same-origin
  // absolute path even if the request contained an encoded leading slash.
  const location = pathname.replace(/^\/+/, "/").split("/").map(encodeURIComponent).join("/") + search;
  response.writeHead(308, { Location: location });
  response.end();
}

/** @param {import("node:http").IncomingMessage} request */
function acceptsHtml(request) {
  return String(request.headers.accept ?? "").split(",").some((value) => value.trim().split(";", 1)[0] === "text/html");
}

/** @param {string} pathname */
function isNavigationPath(pathname) {
  // Unknown immutable uploads must stay 404 even if a browser sends a broad
  // Accept header. Asset URLs with a suffix are also never HTML fallbacks.
  return !pathname.startsWith("/uploaded-assets/") && !extname(pathname);
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
  // An artifact with only a root index keeps the existing SPA request behavior.
  // Additional HTML files (including 404.html) opt into multi-page routing.
  const multiPage = (await readdir(root, { recursive: true, withFileTypes: true }))
    .some((entry) => entry.isFile() && extname(entry.name) === ".html" && (entry.name !== "index.html" || entry.parentPath !== root));
  const notFoundFile = await findFile(root, "/404.html");
  const server = createServer(
    /** @param {import("node:http").IncomingMessage} request @param {import("node:http").ServerResponse} response */
    async (request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }
      let pathname;
      let requestUrl;
      try {
        requestUrl = new URL(request.url ?? "/", `http://${host}`);
        pathname = decodeURIComponent(requestUrl.pathname);
      } catch {
        response.writeHead(400);
        response.end("Bad URL");
        return;
      }
      if (pathname === "/_headers" || !isSafePath(root, pathname)) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }
      let filePath = await findFile(root, pathname);
      if (multiPage && !pathname.startsWith("/uploaded-assets/")) {
        if (filePath && extname(pathname) === ".html") {
          const canonicalPath = pathname.endsWith("/index.html") ? pathname.slice(0, -"index.html".length) : pathname.slice(0, -".html".length);
          redirectHtml(response, canonicalPath, requestUrl.search);
          return;
        }
        if (!filePath && pathname.endsWith("/")) {
          filePath = await findFile(root, `${pathname}index.html`);
          if (!filePath && await findFile(root, `${pathname.slice(0, -1)}.html`)) {
            redirectHtml(response, pathname.slice(0, -1), requestUrl.search);
            return;
          }
        } else if (!filePath && !extname(pathname)) {
          filePath = await findFile(root, `${pathname}.html`);
          if (!filePath && await findFile(root, `${pathname}/index.html`)) {
            redirectHtml(response, `${pathname}/`, requestUrl.search);
            return;
          }
        }
      }
      let status = 200;
      if (!filePath && isNavigationPath(pathname)) {
        if (notFoundFile) {
          filePath = notFoundFile;
          status = 404;
        } else if (acceptsHtml(request)) {
          filePath = join(root, "index.html");
        }
      }
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
      const asset = ASSET_CHECKSUM_URL_PATTERN.test(pathname);
      const assetMimeType = asset ? assetMimeTypeForExtension(pathname.slice(pathname.lastIndexOf(".") + 1)) : undefined;
      const checksum = asset ? pathname.slice("/uploaded-assets/sha256-".length, pathname.lastIndexOf(".")) : undefined;
      /** @type {Record<string, string | number>} */
      const headers = {
        "Content-Type": assetMimeType ?? mimeType(filePath),
        "Content-Length": body.byteLength,
        "Cache-Control": asset ? ASSET_IMMUTABLE_CACHE_CONTROL : "no-store",
        "X-Content-Type-Options": ASSET_NOSNIFF,
      };
      if (asset && assetMimeType !== undefined && checksum !== undefined) {
        const disposition = assetContentDisposition(assetMimeType, checksum);
        if (disposition !== undefined) headers["Content-Disposition"] = disposition;
      }
      response.writeHead(status, {
        ...headers,
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
