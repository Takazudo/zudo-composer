// @ts-check
// Serves the package's own `index.html` from a host-rooted dev server.
//
// Two things break once Vite's root is the host project rather than the
// package: Vite's html middlewares look for `<root>/index.html`, which a host
// does not have, and the shell's `/src/main.tsx` script would resolve against
// the host root. Both are package-owned files, so both are addressed through
// `/@fs` (`appModuleId`) instead.
//
// This plugin is for the installed-package lane only. The repo's own
// `vite.config.ts` roots Vite at the package, where the shell resolves as
// written and Vite's own html handling applies.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { APP_ENTRY, APP_ROOT, appModuleId } from "./roots.mjs";

/** The shell the package serves for every authoring route. */
export const APP_HTML_PATH = resolve(APP_ROOT, "index.html");
// The warmup list and this shell must name the same entry, so it has one home.
export const APP_ENTRY_MODULE = APP_ENTRY;
/** The exact attribute value in `index.html` that this plugin rewrites. */
export const APP_ENTRY_HTML_SRC = `"/${APP_ENTRY_MODULE}"`;

/**
 * Rewrite the shell's entry script to a package-absolute `/@fs` id.
 * @param {string} html
 * @param {string} [entryModule]
 */
export function rewriteAppEntry(html, entryModule = APP_ENTRY_MODULE) {
  const source = `src=${APP_ENTRY_HTML_SRC}`;
  if (html.split(source).length !== 2) {
    throw new Error(`zudo-composer: ${APP_HTML_PATH} no longer references ${source} exactly once; the shell entry rewrite requires one application entry.`);
  }
  return html.replace(source, `src=${JSON.stringify(appModuleId(entryModule))}`);
}

/** @param {string | undefined} accept */
function acceptsHtml(accept) {
  return accept !== undefined && accept.includes("text/html");
}

/** @returns {import("vite").Plugin} */
export default function composerAppHtmlPlugin() {
  return {
    name: "zudo-composer-app-html",
    configureServer(server) {
      // Registered after Vite's own middlewares so transform, public-dir and
      // the file-provider endpoints all keep precedence over the shell.
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== "GET" && req.method !== "HEAD") return next();
          if (!acceptsHtml(req.headers.accept)) return next();
          let html;
          try {
            html = await server.transformIndexHtml(req.url ?? "/", rewriteAppEntry(await readFile(APP_HTML_PATH, "utf8")), req.originalUrl);
          } catch (error) {
            return next(error);
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html");
          res.setHeader("Cache-Control", "no-store");
          res.end(req.method === "HEAD" ? undefined : html);
        });
      };
    },
  };
}
