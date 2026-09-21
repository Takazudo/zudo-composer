// @ts-check
// Records which modules and emitted CSS files a build's start modules
// actually reach, using Rollup's own module graph rather than re-parsing
// bundled code. A Vite manifest carries no source module ids, and the static
// site's entry resolves through `virtual:site-static-project`, so neither can
// stand in for a real reachability walk.
//
// `scripts/check-preview-isolation.mjs` reads the emitted `entry-graph.json`
// after the real build and fails when editor CSS is reachable from a preview
// or site document — see #724.

import { relative, resolve, sep } from "node:path";
import { APP_ROOT } from "./roots.mjs";

export const ENTRY_GRAPH_FILE_NAME = "entry-graph.json";

// Package-relative start-module ids, shared by every config that registers
// this plugin and by `scripts/check-preview-isolation.mjs`, which keys its
// entry-specific rules off these same strings.
export const COMPOSER_PREVIEW_ENTRY_MODULE = "src/features/composer/preview/preview-entry.ts";
export const SITE_PREVIEW_ENTRY_MODULE = "src/features/delivery/visitor-entry.ts";
export const STATIC_SITE_ENTRY_MODULE = "server/site-build/client/main.tsx";

/**
 * An id outside this package (an installed dependency, a host project file, a
 * Rollup virtual module) carries no forbidden-source signal this gate checks
 * for, and recording its absolute filesystem path would leak the build
 * machine's directory layout into a file the hosted demo Workers end up
 * serving. Only ids inside this package are kept, made relative so the graph
 * is portable across machines.
 * @param {string} id
 * @returns {string | undefined}
 */
function packageRelativeId(id) {
  if (id.startsWith("\0")) return undefined;
  const absolute = resolve(id);
  if (absolute !== APP_ROOT && !absolute.startsWith(APP_ROOT + sep)) return undefined;
  return relative(APP_ROOT, absolute).split(sep).join("/");
}

/**
 * @param {{startModules: string[]}} options
 * @returns {import("vite").Plugin}
 */
export function entryGraphPlugin({ startModules }) {
  return {
    name: "zudo-composer-entry-graph",
    generateBundle(_options, bundle) {
      /** @type {Record<string, import("vite").Rollup.OutputChunk>} */
      const chunksByFileName = {};
      // A module can land in more than one chunk (a shared dependency), so a
      // module id's own chunk is a set, not a single answer.
      /** @type {Map<string, Set<string>>} */
      const chunkFileNamesByModuleId = new Map();
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        chunksByFileName[file.fileName] = file;
        for (const moduleId of file.moduleIds) {
          let fileNames = chunkFileNamesByModuleId.get(moduleId);
          if (!fileNames) chunkFileNamesByModuleId.set(moduleId, (fileNames = new Set()));
          fileNames.add(file.fileName);
        }
      }

      /** @type {Record<string, {moduleIds: string[], cssFileNames: string[]}>} */
      const entries = {};
      for (const startModule of startModules) {
        const startId = resolve(APP_ROOT, startModule);

        // The module graph: every module this start module reaches, statically
        // or dynamically, transitively. This is what the forbidden-source
        // check matches against.
        /** @type {Set<string>} */
        const reachedModules = new Set();
        /** @type {string[]} */
        const moduleStack = [startId];
        while (moduleStack.length > 0) {
          const id = /** @type {string} */ (moduleStack.pop());
          if (reachedModules.has(id)) continue;
          reachedModules.add(id);
          const info = this.getModuleInfo(id);
          if (!info) continue;
          for (const dependencyId of info.importedIds) moduleStack.push(dependencyId);
          for (const dependencyId of info.dynamicallyImportedIds) moduleStack.push(dependencyId);
        }

        // The chunk graph the browser actually loads for this entry: walking
        // module reachability and then asking "which chunk holds this module"
        // over-attributes CSS, because Rollup can place an unrelated entry's
        // exclusive modules in the same shared chunk as one of ours. A chunk's
        // OWN static/dynamic chunk imports (mirroring Vite's own
        // `__vite__mapDeps` preload computation) is the graph that is actually
        // reachable from this start module's document.
        /** @type {Set<string>} */
        const reachedChunkFileNames = new Set();
        /** @type {string[]} */
        const chunkStack = [...(chunkFileNamesByModuleId.get(startId) ?? [])];
        while (chunkStack.length > 0) {
          const fileName = /** @type {string} */ (chunkStack.pop());
          if (reachedChunkFileNames.has(fileName)) continue;
          reachedChunkFileNames.add(fileName);
          const chunk = chunksByFileName[fileName];
          if (!chunk) continue;
          for (const dependencyFileName of chunk.imports) chunkStack.push(dependencyFileName);
          for (const dependencyFileName of chunk.dynamicImports) chunkStack.push(dependencyFileName);
        }
        /** @type {Set<string>} */
        const cssFileNames = new Set();
        for (const fileName of reachedChunkFileNames) {
          const metadata = /** @type {{viteMetadata?: import("vite").ChunkMetadata}} */ (chunksByFileName[fileName]).viteMetadata;
          for (const cssFileName of metadata?.importedCss ?? []) cssFileNames.add(cssFileName);
        }

        entries[startModule] = {
          moduleIds: [...reachedModules].map(packageRelativeId).filter((id) => id !== undefined).sort(),
          cssFileNames: [...cssFileNames].sort(),
        };
      }

      this.emitFile({
        type: "asset",
        fileName: ENTRY_GRAPH_FILE_NAME,
        source: `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`,
      });
    },
  };
}

export default entryGraphPlugin;
