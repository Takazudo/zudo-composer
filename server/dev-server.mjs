// @ts-check
// The dev server the `zudo-composer dev` command boots.
//
// Vite's `root` is the *host* project, because that is where the host's
// `node_modules`, `public/` and CMS data live. The package's own modules —
// `index.html`, `src/main.tsx`, every plugin's SSR entry — are outside that
// root and are addressed through `/@fs` (`appModuleId`). The config is
// therefore built here in JavaScript rather than read from a `vite.config.ts`:
// an installed package has no config file at the host root to be found.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";
import tailwindcss from "@tailwindcss/vite";
import preact from "@preact/preset-vite";
import composerFileProviderPlugin from "../plugins/composer-file-provider-plugin.mjs";
import domainFileProviderPlugin from "../plugins/domain-file-provider-plugin.mjs";
import contentDomainProvider from "../plugins/content-domain-provider.mjs";
import mappingDomainProvider from "../plugins/mapping-domain-provider.mjs";
import sitemapperDomainProvider from "../plugins/sitemapper-domain-provider.mjs";
import workspaceDomainProvider, { resolveWorkspaceRegistryRoot } from "../plugins/workspace-domain-provider.mjs";
import { siteProjectSourcePlugin } from "../plugins/site-project-source-plugin.mjs";
import composerAppHtmlPlugin, { APP_ENTRY_MODULE } from "../plugins/composer-app-html.mjs";
import componentPackPlugin from "../plugins/component-pack-plugin.mjs";
import hostStylesPlugin from "../plugins/host-styles-plugin.mjs";
import { APP_ROOT, resolveAppWarmupFiles, resolveFsAllow, resolvePublicDir, resolveSiteProjectLocalRoot, resolveWatchIgnored, resolveWorkspaceRoot } from "../plugins/roots.mjs";
import { createModuleEvaluator } from "./module-evaluator.mjs";
import { loadHostConfig } from "./host-context.mjs";

import { resolveImageEditorAliases } from "../plugins/image-editor-aliases.mjs";

export { loadHostConfig };

/**
 * Packages Vite's dependency optimizer must not scan beyond the configured
 * component pack, which `componentPackPlugin` adds itself. A pack and
 * `@takazudo/zfb-md-wasm` import their glue/wasm resources with Vite's `?url`
 * query, which the optimizer cannot resolve while scanning; the asset pipeline
 * handles them on demand once they stay in the normal module graph. The name is
 * harmless when the package is not installed.
 */
export const OPTIMIZE_DEPS_EXCLUDE = Object.freeze(["@takazudo/zfb-md-wasm"]);

/**
 * The bare specifiers `@preact/preset-vite` puts into `optimizeDeps.include`.
 *
 * Vite resolves an `optimizeDeps.include` entry from the Vite root — the HOST
 * project — but preact is zudo-composer's own dependency and, in a real
 * install, is not reachable from there. Every entry then fails to resolve and
 * the host sees five startup warnings. It is invisible in this repository's own
 * fixtures, where a workspace install hoists preact to a directory the host
 * root can see.
 */
const PREACT_OPTIMIZE_INCLUDE = Object.freeze([
  ["preact", "."],
  ["preact/jsx-runtime", "jsx-runtime"],
  // preact ships one runtime directory and its `exports` maps both the
  // production and the development specifier onto it.
  ["preact/jsx-dev-runtime", "jsx-runtime"],
  ["preact/debug", "debug"],
  ["preact/devtools", "devtools"],
]);

/**
 * Exact-match aliases pinning those specifiers to the copy installed beside
 * this package, so the optimizer resolves them from where they actually are.
 *
 * Each replacement is the subpackage DIRECTORY rather than a resolved file:
 * `require.resolve` would pick the CommonJS `main`, while a directory lets
 * Vite read that directory's own `package.json` and take the browser/ESM
 * entry, which is what an unaliased resolution would have produced.
 *
 * The patterns are anchored, so `preact/hooks` and friends keep resolving
 * relative to the importing file and no prefix rewrite invents a path.
 */
export function resolvePreactAliases(appRoot = APP_ROOT) {
  let packageRoot;
  try {
    packageRoot = dirname(createRequire(resolve(appRoot, "package.json")).resolve("preact/package.json"));
  } catch {
    // No preact beside the package: nothing to pin, and the normal resolver
    // will report the real problem when a module actually asks for it.
    return [];
  }
  return PREACT_OPTIMIZE_INCLUDE.flatMap(([specifier, subdirectory]) => {
    const replacement = resolve(packageRoot, subdirectory);
    if (!existsSync(replacement)) return [];
    return [{ find: new RegExp(`^${specifier.replace("/", "\\/")}$`), replacement }];
  });
}

/**
 * The complete inline Vite config for a host-rooted dev server.
 * @param {{workspaceRoot?: string, env?: Record<string, string | undefined>}} [options]
 */
export async function resolveComposerDevConfig(options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const composerConfig = await loadHostConfig(workspaceRoot, options.env);
  const { paths, settings } = composerConfig;
  const { default: releaseApiPlugin } = /** @type {{default: (options: unknown) => any}} */ (
    await createModuleEvaluator(APP_ROOT)(resolve(APP_ROOT, "plugins/release-api-plugin.ts"))
  );
  // Resolving the pack is the first thing that can fail, and it fails loudly:
  // a host whose pack cannot be resolved has no pack, and never the bundled one.
  const componentPack = componentPackPlugin({ workspaceRoot, pack: settings.pack });
  return {
    composerConfig,
    inlineConfig: {
      configFile: /** @type {const} */ (false),
      root: workspaceRoot,
      // Committed assets only; the assets store's own content-addressed bytes
      // come from the file-provider middleware, not from here.
      publicDir: resolvePublicDir(workspaceRoot, paths.publicAssets),
      // Vite's html middlewares would look for `<root>/index.html`, which a
      // host project does not have — the package owns the shell. The app-html
      // plugin serves it instead.
      appType: /** @type {const} */ ("custom"),
      optimizeDeps: {
        exclude: [componentPack.identity.packageName, ...OPTIMIZE_DEPS_EXCLUDE],
        // Scanning starts from html under `root`, and there is none. Point the
        // scanner at the package's entry so the first request does not stall
        // on a full-reload discovery round.
        entries: [resolve(APP_ROOT, APP_ENTRY_MODULE)],
      },
      resolve: { alias: [...resolvePreactAliases(), ...resolveImageEditorAliases()] },
      server: {
        fs: { allow: [...resolveFsAllow(workspaceRoot), componentPack.identity.packageRoot] },
        watch: { ignored: resolveWatchIgnored([paths.data, paths.compositions, paths.content, paths.mappings, paths.sitemaps, paths.assets, paths.publicAssets, resolveSiteProjectLocalRoot(workspaceRoot)]) },
        warmup: { clientFiles: resolveAppWarmupFiles() },
      },
      // Every CMS root comes from the resolved config, passed explicitly, so
      // the plugins' own `ZUDO_COMPOSITIONS_ROOT` / `ZUDO_ASSETS_STORE_ROOT`
      // fallbacks do not apply in this lane. The SiteProject release root is
      // not a config setting and keeps its own `ZUDO_SITE_PROJECT_ROOT`.
      plugins: [
        componentPack,
        hostStylesPlugin({ stylesPath: paths.styles, styles: settings.styles, configPath: composerConfig.configPath }),
        releaseApiPlugin({ assetsStoreRoot: paths.assets, workspaceRoot, packIdentity: componentPack.identity }),
        siteProjectSourcePlugin({ workspaceRoot, packIdentity: componentPack.identity }),
        composerFileProviderPlugin({ workspaceRoot, compositionsRoot: paths.compositions, assetsStoreRoot: paths.assets }),
        domainFileProviderPlugin({
          workspaceRoot,
          descriptors: [
            workspaceDomainProvider({
              registryRoot: resolveWorkspaceRegistryRoot(paths.data),
              domainRoots: {
                compositions: paths.compositions,
                content: paths.content,
                mappings: paths.mappings,
                sitemaps: paths.sitemaps,
              },
            }),
            contentDomainProvider({ contentRoot: paths.content }),
            mappingDomainProvider({ mappingsRoot: paths.mappings }),
            sitemapperDomainProvider({ sitemapsRoot: paths.sitemaps }),
          ],
        }),
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
