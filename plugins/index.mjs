// @ts-check
// The `zudo-composer/vite` entry: the Vite-side pieces a host needs when it
// builds its own config instead of running `zudo-composer dev`. The dev server
// (`zudo-composer`) assembles exactly these.

export { default as composerAppHtmlPlugin, APP_ENTRY_MODULE } from "./composer-app-html.mjs";
export { default as composerFileProviderPlugin } from "./composer-file-provider-plugin.mjs";
export { siteProjectSourcePlugin } from "./site-project-source-plugin.mjs";
export { default as componentPackPlugin, COMPONENT_PACK_ID } from "./component-pack-plugin.mjs";
export { default as hostStylesPlugin, HOST_STYLES_ID } from "./host-styles-plugin.mjs";
export { assertPackSourcesResolvable, resolveComponentPack } from "./component-pack.mjs";
export { APP_ROOT, appModuleId, fsModuleId, resolveWorkspaceRoot } from "./roots.mjs";
export { loadHostContext } from "../server/host-context.mjs";

/** @typedef {import("./component-pack.mjs").ResolvedComponentPack} ResolvedComponentPack The resolved pack identity returned as HostContext.packIdentity. */
/** @typedef {import("../server/host-context.mjs").HostContext} HostContext */
