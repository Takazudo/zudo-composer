// @ts-check
// Evaluating tool-owned TypeScript and host-owned config/pack modules through
// Vite, rooted at the owner of the entry being evaluated.
//
// Neither can be `import()`ed: they are TypeScript, and Node refuses to strip
// types for anything under `node_modules` — which is exactly where an installed
// zudo-composer lives. This is the evaluator `loadComposerConfig({ load })`
// exists to receive. It is `runnerImport` rather than a dev server's
// `ssrLoadModule` because at config time no server exists yet, and a throwaway
// one would be a second Vite boot.
//
// It lives apart from `dev-server.mjs` so the `api` command can use it without
// pulling the whole dev-server plugin graph into its process.

import { pathToFileURL } from "node:url";
import { runnerImport } from "vite";
import { resolveComposerModules } from "../plugins/module-resolution.mjs";

/**
 * @param {string} root Host root for config/pack modules; APP_ROOT for tool modules.
 * @returns {(modulePath: string) => Promise<Record<string, unknown>>}
 */
export function createModuleEvaluator(root) {
  return async (modulePath) => {
    const { module } = await runnerImport(pathToFileURL(modulePath).href, {
      configFile: false,
      root,
      resolve: resolveComposerModules(),
      // The Preact preset does not run here, so state the JSX runtime for
      // both tool and host `.tsx` modules; the default would import React.
      oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    });
    return /** @type {Record<string, unknown>} */ (module);
  };
}
