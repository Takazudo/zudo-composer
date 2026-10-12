// @ts-check
// The Vite plugins a host adds to build `zudo-composer/content-editor` into
// its own private admin bundle: the tool's Tailwind (resolved from the tool
// root) for the editor chrome, and the Preact JSX transform. The editor graph
// has no virtual modules, component pack or host stylesheet, so nothing else
// is needed.

import preact from "@preact/preset-vite";
import { tailwindPlugin } from "./tailwind-plugin.mjs";

/** @returns {import("vite").PluginOption[]} */
export function contentEditorPlugins() {
  return [
    {
      name: "zudo-composer-content-editor",
      config() {
        // The entry ships as TypeScript source with CSS imports; the dev-time
        // dependency optimizer must transform it like application source.
        return { optimizeDeps: { exclude: ["zudo-composer/content-editor"] } };
      },
    },
    ...tailwindPlugin(),
    preact(),
  ];
}

export default contentEditorPlugins;
