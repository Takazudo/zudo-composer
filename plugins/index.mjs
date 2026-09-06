// @ts-check
// The `zudo-composer/vite` entry: the Vite-side pieces a host needs when it
// builds its own config instead of running `zudo-composer dev`. The dev server
// (`zudo-composer`) assembles exactly these.

export { default as composerAppHtmlPlugin, APP_ENTRY_MODULE } from "./composer-app-html.mjs";
export { default as composerFileProviderPlugin } from "./composer-file-provider-plugin.mjs";
export { siteProjectSourcePlugin } from "./site-project-source-plugin.mjs";
export { APP_ROOT, appModuleId, resolveWorkspaceRoot } from "./roots.mjs";
