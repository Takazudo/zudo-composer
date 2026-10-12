import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

/** @param {string} directory */
export async function servePreview(directory) {
  const root = resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
      let file = resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(`${root}${sep}`))
        throw Error("Outside preview root");
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      response.setHeader(
        "content-type",
        types[/** @type {keyof typeof types} */ (extname(file))] ??
          "application/octet-stream",
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(undefined)),
  );
  const address = /** @type {import("node:net").AddressInfo} */ (
    server.address()
  );
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve(undefined))),
      ),
  };
}
