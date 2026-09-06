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
import { APP_ROOT, appModuleId } from "./roots.mjs";

/** The shell the package serves for every authoring route. */
export const APP_HTML_PATH = resolve(APP_ROOT, "index.html");
export const APP_ENTRY_MODULE = "src/main.tsx";
/** The exact attribute value in `index.html` that this plugin rewrites. */
export const APP_ENTRY_HTML_SRC = `"/${APP_ENTRY_MODULE}"`;

/**
 * Rewrite the shell's entry script to a package-absolute `/@fs` id.
 * @param {string} html
 */
export function rewriteAppEntry(html) {
  if (!html.includes(APP_ENTRY_HTML_SRC)) {
    throw new Error(`zudo-composer: ${APP_HTML_PATH} no longer references ${APP_ENTRY_HTML_SRC}; the dev shell entry rewrite has nothing to replace.`);
  }
  return html.replace(APP_ENTRY_HTML_SRC, JSON.stringify(appModuleId(APP_ENTRY_MODULE)));
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
