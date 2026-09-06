// @ts-check
// Evaluating the package's own TypeScript modules, and the host's config,
// through Vite.
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

/**
 * @param {string} root
 * @returns {(modulePath: string) => Promise<Record<string, unknown>>}
 */
export function createModuleEvaluator(root) {
  return async (modulePath) => {
    const { module } = await runnerImport(pathToFileURL(modulePath).href, {
      configFile: false,
      root,
      // No plugin pipeline runs here, so the JSX runtime the package's `.tsx`
      // files expect has to be stated: the default would emit React imports.
      oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
    });
    return /** @type {Record<string, unknown>} */ (module);
  };
}
