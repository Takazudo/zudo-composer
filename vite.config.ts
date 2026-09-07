import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import composerFileProviderPlugin from './plugins/composer-file-provider-plugin.mjs';
import siteProjectSourcePlugin from './plugins/site-project-source-plugin.mjs';
import releaseApiPlugin from './plugins/release-api-plugin';
import domainFileProviderPlugin from './plugins/domain-file-provider-plugin.mjs';
import contentDomainProvider from './plugins/content-domain-provider.mjs';
import mappingDomainProvider from './plugins/mapping-domain-provider.mjs';
import sitemapperDomainProvider from './plugins/sitemapper-domain-provider.mjs';
import workspaceDomainProvider, { resolveWorkspaceRegistryRoot } from './plugins/workspace-domain-provider.mjs';
import componentPackPlugin from './plugins/component-pack-plugin.mjs';
import hostStylesPlugin from './plugins/host-styles-plugin.mjs';
import { APP_ROOT, readRootEnvironment, resolveAppWarmupFiles, resolveFsAllow, resolvePublicDir, resolveSiteProjectLocalRoot, resolveWatchIgnored } from './plugins/roots.mjs';
import { CONFIG_FILE_NAME, composer } from './server/config/index.ts';
import hostConfig from './zudo-composer.config.ts';

// The repo root is its own host: this is the same resolution an installed
// zudo-composer performs against a host project, with the config imported
// directly rather than evaluated, because Vite already compiles this file.
const composerConfig = composer({ ...hostConfig, workspaceRoot: APP_ROOT, configPath: resolve(APP_ROOT, CONFIG_FILE_NAME) });
const componentPack = componentPackPlugin({ workspaceRoot: composerConfig.workspaceRoot, pack: composerConfig.settings.pack });

// The four authoring domain roots a workspace scopes, plus the registry that
// names workspaces. Every root is resolved here and passed to its plugin
// explicitly — no plugin reads the config file itself.
//
// A `dataDir` setting must be host-relative, so a lane that needs to author
// into a temporary tree cannot express that as configuration. `ZUDO_DATA_ROOT`
// is the absolute equivalent, and it re-bases every domain beneath it exactly
// as `dataDir` re-bases the relative ones. Without it a browser lane leaves
// content, mappings, sitemaps and the workspace registry in THIS repository,
// where the next run inherits a registry pointing at a deleted tree.
//
// The two single-domain overrides still win over it, which is the precedence
// the isolated dev lane and the SiteProject lane already rely on.
const dataRoot = readRootEnvironment(process.env.ZUDO_DATA_ROOT, 'Data root');
const domainRoot = (domain: 'compositions' | 'content' | 'mappings' | 'sitemaps' | 'media') =>
  dataRoot ? resolve(dataRoot, domain) : composerConfig.paths[domain];
const compositionsRoot = readRootEnvironment(process.env.ZUDO_COMPOSITIONS_ROOT, 'Compositions root')
  ?? domainRoot('compositions');
const domainRoots = {
  compositions: compositionsRoot,
  content: domainRoot('content'),
  mappings: domainRoot('mappings'),
  sitemaps: domainRoot('sitemaps'),
};
const workspaceRegistryRoot = resolveWorkspaceRegistryRoot(dataRoot ?? composerConfig.paths.data);

// The content-addressed Media store, and the committed bytes the host's own
// static pipeline serves. Both come from the resolved config; the browser lanes
// keep their absolute-root override so they can write into a temporary tree.
const mediaStoreRoot = readRootEnvironment(process.env.ZUDO_MEDIA_STORE_ROOT, 'Media store root')
  ?? domainRoot('media');

export default defineConfig({
  publicDir: resolvePublicDir(composerConfig.workspaceRoot, composerConfig.paths.publicMedia),
  // The configured pack and zfb-md-wasm import their glue/wasm files with
  // Vite's `?url` query. Keep both dependency packages in Vite's normal module
  // graph: Rolldown's dependency optimizer cannot resolve those resource
  // imports while scanning the package, whereas the asset pipeline handles
  // them on demand. The pack's name is derived, never spelled out — that is
  // what makes the themeset swap one config edit.
  optimizeDeps: { exclude: [componentPack.identity.packageName, '@takazudo/zfb-md-wasm'] },
  // `componentPackPlugin` declares an fs-allow entry for the pack, and any
  // declared entry replaces Vite's root-derived default. Naming both roots here
  // is what keeps this repo's own sources readable while the pack stays so.
  server: {
    fs: { allow: resolveFsAllow(APP_ROOT) },
    watch: {
      ignored: resolveWatchIgnored([
        composerConfig.paths.data,
        ...Object.values(domainRoots),
        mediaStoreRoot,
        composerConfig.paths.publicMedia,
        workspaceRegistryRoot,
        resolveSiteProjectLocalRoot(composerConfig.workspaceRoot),
      ]),
    },
    warmup: { clientFiles: resolveAppWarmupFiles() },
  },
  plugins: [
    componentPack,
    hostStylesPlugin({
      stylesPath: composerConfig.paths.styles,
      styles: composerConfig.settings.styles,
      configPath: composerConfig.configPath,
    }),
    releaseApiPlugin({ mediaStoreRoot }),
    // The release reader re-derives the current toolchain to compare it with
    // the activated release's, so it needs the same pack the service stamped
    // with. `dev-server.mjs` passes both; without them here the reader throws
    // and every route reports that no SiteProject is activated.
    siteProjectSourcePlugin({ workspaceRoot: composerConfig.workspaceRoot, packIdentity: componentPack.identity }),
    composerFileProviderPlugin({
      mediaStoreRoot,
      compositionsRoot,
      workspaceRoot: composerConfig.workspaceRoot,
    }),
    domainFileProviderPlugin({
      workspaceRoot: composerConfig.workspaceRoot,
      descriptors: [
        workspaceDomainProvider({ registryRoot: workspaceRegistryRoot, domainRoots }),
        contentDomainProvider({ contentRoot: domainRoots.content }),
        mappingDomainProvider({ mappingsRoot: domainRoots.mappings }),
        sitemapperDomainProvider({ sitemapsRoot: domainRoots.sitemaps }),
      ],
    }),
    tailwindcss(),
    preact(),
  ],
});
