// @ts-check
// The dev server the `zudo-composer dev` command boots.
//
// Vite's `root` is the *host* project, because that is where the host's
// `node_modules`, `public/` and CMS data live. The package's own modules —
// `index.html`, `src/main.tsx`, every plugin's SSR entry — are outside that
// root and are addressed through `/@fs` (`appModuleId`). The config is
// therefore built here in JavaScript rather than read from a `vite.config.ts`:
// an installed package has no config file at the host root to be found.

import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import preact from "@preact/preset-vite";
import composerFileProviderPlugin from "../plugins/composer-file-provider-plugin.mjs";
import { siteProjectSourcePlugin } from "../plugins/site-project-source-plugin.mjs";
import composerAppHtmlPlugin, { APP_ENTRY_MODULE } from "../plugins/composer-app-html.mjs";
import { APP_ROOT, resolveWorkspaceRoot } from "../plugins/roots.mjs";
import { createModuleEvaluator } from "./module-evaluator.mjs";

/**
 * Packages Vite's dependency optimizer must not scan. `@zudo-sg/ui` and
 * `@takazudo/zfb-md-wasm` import their glue/wasm resources with Vite's `?url`
 * query, which the optimizer cannot resolve while scanning; the asset pipeline
 * handles them on demand once they stay in the normal module graph.
 */
export const OPTIMIZE_DEPS_EXCLUDE = Object.freeze(["@zudo-sg/ui", "@takazudo/zfb-md-wasm"]);

/**
 * Resolve the host's `zudo-composer.config.ts`.
 * @param {string} workspaceRoot
 * @param {Record<string, string | undefined>} [env]
 */
export async function loadHostConfig(workspaceRoot, env) {
  const evaluateApp = createModuleEvaluator(APP_ROOT);
  const { loadComposerConfig } = /** @type {{loadComposerConfig: (options: unknown) => Promise<any>}} */ (
    await evaluateApp(resolve(APP_ROOT, "server/config/index.ts"))
  );
  return loadComposerConfig({ workspaceRoot, env, load: createModuleEvaluator(workspaceRoot) });
}

/** @param {string} path */
function realpathOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Directories Vite is allowed to read files from.
 *
 * Vite derives its default allow-list from the *host* root, so a package
 * installed outside it — every real install — would be denied. Both roots are
 * listed with their realpaths as well: under pnpm the package is reached
 * through a symlink into `node_modules/.pnpm`, and fs-allow comparisons happen
 * on whichever of the two forms the request produced.
 * @param {string} workspaceRoot
 */
export function resolveFsAllow(workspaceRoot) {
  const candidates = [workspaceRoot, realpathOrSelf(workspaceRoot), APP_ROOT, realpathOrSelf(APP_ROOT)];
  return [...new Set(candidates)];
}

/**
 * Vite's static directory for a host.
 *
 * Committed media is served at `/<last segment of publicMediaDir>/`, so the
 * static root is that directory's parent. A single-segment `publicMediaDir`
 * would make the parent the host project root and expose the whole tree, so it
 * is refused rather than silently served.
 * @param {string} workspaceRoot
 * @param {string} publicMedia
 */
export function resolvePublicDir(workspaceRoot, publicMedia) {
  const publicDir = dirname(publicMedia);
  if (publicDir === resolve(workspaceRoot)) {
    throw new Error(
      `zudo-composer config: \`publicMediaDir\` must sit inside a static directory, not directly at the host project root — received "${publicMedia}". Use a nested path such as "public/uploaded-media".`,
    );
  }
  return publicDir;
}

/**
 * The complete inline Vite config for a host-rooted dev server.
 * @param {{workspaceRoot?: string, env?: Record<string, string | undefined>}} [options]
 */
export async function resolveComposerDevConfig(options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const composerConfig = await loadHostConfig(workspaceRoot, options.env);
  const { paths } = composerConfig;
  const { default: releaseApiPlugin } = /** @type {{default: (options: unknown) => any}} */ (
    await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "plugins/release-api-plugin.ts"))
  );
  return {
    composerConfig,
    inlineConfig: {
      configFile: /** @type {const} */ (false),
      root: workspaceRoot,
      // Committed media only; the media store's own content-addressed bytes
      // come from the file-provider middleware, not from here.
      publicDir: resolvePublicDir(workspaceRoot, paths.publicMedia),
      // Vite's html middlewares would look for `<root>/index.html`, which a
      // host project does not have — the package owns the shell. The app-html
      // plugin serves it instead.
      appType: /** @type {const} */ ("custom"),
      optimizeDeps: {
        exclude: [...OPTIMIZE_DEPS_EXCLUDE],
        // Scanning starts from html under `root`, and there is none. Point the
        // scanner at the package's entry so the first request does not stall
        // on a full-reload discovery round.
        entries: [resolve(APP_ROOT, APP_ENTRY_MODULE)],
      },
      server: { fs: { allow: resolveFsAllow(workspaceRoot) } },
      // Every CMS root comes from the resolved config, passed explicitly, so
      // the plugins' own `ZUDO_COMPOSITIONS_ROOT` / `ZUDO_MEDIA_STORE_ROOT`
      // fallbacks do not apply in this lane. The SiteProject release root is
      // not a config setting and keeps its own `ZUDO_SITE_PROJECT_ROOT`.
      plugins: [
        releaseApiPlugin({ mediaStoreRoot: paths.media }),
        siteProjectSourcePlugin({ workspaceRoot }),
        composerFileProviderPlugin({ workspaceRoot, compositionsRoot: paths.compositions, mediaStoreRoot: paths.media }),
        composerAppHtmlPlugin(),
        tailwindcss(),
        preact(),
      ],
    },
  };
}

/**
 * Boot the dev server and start listening.
 * @param {{workspaceRoot?: string, env?: Record<string, string | undefined>, port?: number, host?: string | boolean, strictPort?: boolean}} [options]
 */
export async function startComposerDevServer(options = {}) {
  const { composerConfig, inlineConfig } = await resolveComposerDevConfig(options);
  const server = await createServer({
    ...inlineConfig,
    server: {
      ...inlineConfig.server,
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.strictPort === undefined ? {} : { strictPort: options.strictPort }),
    },
  });
  await server.listen();
  return { server, composerConfig };
}
