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
    const nodeEnv = process.env.NODE_ENV;
    // Vite's runnerImport resolves its own config with command "serve" before
    // loading the target module, and that resolveConfig call assigns
    // process.env.NODE_ENV globally (defaulting to "development") whenever it
    // was unset — before the config file even loads. Force a definite value
    // first so that assignment never fires, then restore exactly what the
    // caller had, including unset. An evaluated module that deliberately
    // chose a different value (e.g. a host config setting NODE_ENV itself)
    // is left as that module set it, for the caller to see.
    if (!nodeEnv) process.env.NODE_ENV = "production";
    try {
      const { module } = await runnerImport(pathToFileURL(modulePath).href, {
        configFile: false,
        root,
        resolve: resolveComposerModules(),
        // The Preact preset does not run here, so state the JSX runtime for
        // both tool and host `.tsx` modules; the default would import React.
        oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
      });
      return /** @type {Record<string, unknown>} */ (module);
    } finally {
      if (!nodeEnv && process.env.NODE_ENV === "production") {
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
      }
    }
  };
}
