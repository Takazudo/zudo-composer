import type { Plugin } from "vite";

export declare const ENTRY_GRAPH_FILE_NAME = "entry-graph.json";

export declare const COMPOSER_PREVIEW_ENTRY_MODULE = "src/features/composer/preview/preview-entry.ts";
export declare const SITE_PREVIEW_ENTRY_MODULE = "src/features/delivery/visitor-entry.ts";
export declare const STATIC_SITE_ENTRY_MODULE = "server/site-build/client/main.tsx";

/** For each start module (a package-relative id): every module id it
 * transitively reaches, and the emitted CSS file names of the chunks those
 * modules landed in. Both are recorded relative to this package's root. */
export interface EntryGraph {
  schemaVersion: 1;
  entries: Record<string, { moduleIds: string[]; cssFileNames: string[] }>;
}

export declare function entryGraphPlugin(options: { startModules: string[] }): Plugin;
export default entryGraphPlugin;
