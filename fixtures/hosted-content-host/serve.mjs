// @ts-check
/* global console, process, Buffer, Request, URL */
// Serves the built editor and the Worker service on one origin for the
// browser proof: `/api/*` goes to the Worker module, everything else to dist.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const port = Number(process.env.PORT ?? 4175);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url ?? "/", `http://127.0.0.1:${port}`);
  try {
    if (url.pathname.startsWith("/api/") || /^\/(?:composer|mapping|sitemapper|assets)(?:\/|$)/.test(url.pathname)) {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const response = await worker.fetch(new Request(url, { method: incoming.method, headers: /** @type {Record<string, string>} */ (incoming.headers), ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const relative = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(dist, relative);
    if (!file.startsWith(dist)) throw Object.assign(new Error("outside"), { code: "ENOENT" });
    const bytes = await readFile(file).catch(() => readFile(join(dist, "index.html")));
    outgoing.writeHead(200, { "content-type": types[/** @type {keyof typeof types} */ (extname(file))] ?? "text/html; charset=utf-8" });
    outgoing.end(bytes);
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "text/plain" });
    outgoing.end(error instanceof Error ? error.message : String(error));
  }
});
server.listen(port, "127.0.0.1", () => console.log(`hosted-content-host listening on http://127.0.0.1:${port}`));
