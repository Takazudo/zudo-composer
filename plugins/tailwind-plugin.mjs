// @ts-check
// Tailwind belongs to the tool, while stylesheets and @source bases belong to
// the host. A host outside this repository cannot resolve the tool's packages
// through its own node_modules.

import { createRequire } from "node:module";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { APP_ROOT } from "./roots.mjs";

/** @returns {import("vite").Plugin[]} */
export function tailwindPlugin() {
  const requireFromTool = createRequire(resolve(APP_ROOT, "package.json"));
  return [
    {
      name: "zudo-composer-tailwind-resolver",
      enforce: "pre",
      config() {
        return {
          resolve: {
            alias: [{
              // This is an identity match: only the resolver changes. Tailwind
              // 4.3's Vite plugin has no public customCssResolver option; its
              // internal CSS resolver consults Vite aliases, but bypasses
              // ordinary plugins' resolveId hooks.
              find: /^tailwindcss\//,
              replacement: "$&",
              customResolver(specifier) {
                let path;
                try {
                  // These CSS subpaths are public package exports, with and
                  // without .css. Honor exports instead of inventing paths.
                  path = requireFromTool.resolve(specifier);
                } catch (cause) {
                  throw new Error(
                    `zudo-composer Tailwind: "${specifier}" could not be resolved from tool root ${APP_ROOT}: ${cause instanceof Error ? cause.message : String(cause)}`,
                    { cause },
                  );
                }
                // Keep JavaScript exports (e.g. tailwindcss/colors) under
                // ordinary importer-based resolution. This hook owns CSS.
                return path.endsWith(".css") ? path : null;
              },
            }],
          },
        };
      },
    },
    ...tailwindcss(),
  ];
}

export default tailwindPlugin;
