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
import componentPackPlugin from './plugins/component-pack-plugin.mjs';
import hostStylesPlugin from './plugins/host-styles-plugin.mjs';
import { APP_ROOT } from './plugins/roots.mjs';
import { CONFIG_FILE_NAME, composer } from './server/config/index.ts';
import hostConfig from './zudo-composer.config.ts';

const mediaStoreRoot = process.env.ZUDO_MEDIA_STORE_ROOT;

// The repo root is its own host: this is the same resolution an installed
// zudo-composer performs against a host project, with the config imported
// directly rather than evaluated, because Vite already compiles this file.
const composerConfig = composer({ ...hostConfig, workspaceRoot: APP_ROOT, configPath: resolve(APP_ROOT, CONFIG_FILE_NAME) });
const componentPack = componentPackPlugin({ workspaceRoot: composerConfig.workspaceRoot, pack: composerConfig.settings.pack });

export default defineConfig({
  publicDir: 'media-store/public',
  // The configured pack and zfb-md-wasm import their glue/wasm files with
  // Vite's `?url` query. Keep both dependency packages in Vite's normal module
  // graph: Rolldown's dependency optimizer cannot resolve those resource
  // imports while scanning the package, whereas the asset pipeline handles
  // them on demand. The pack's name is derived, never spelled out — that is
  // what makes the themeset swap one config edit.
  optimizeDeps: { exclude: [componentPack.identity.packageName, '@takazudo/zfb-md-wasm'] },
  plugins: [
    componentPack,
    hostStylesPlugin({
      stylesPath: composerConfig.paths.styles,
      styles: composerConfig.settings.styles,
      configPath: composerConfig.configPath,
    }),
    releaseApiPlugin({ mediaStoreRoot }),
    siteProjectSourcePlugin(),
    composerFileProviderPlugin({ mediaStoreRoot }),
    domainFileProviderPlugin({ descriptors: [contentDomainProvider(), mappingDomainProvider(), sitemapperDomainProvider()] }),
    tailwindcss(),
    preact(),
  ],
});
