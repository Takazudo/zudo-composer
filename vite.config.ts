import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import composerFileProviderPlugin from './plugins/composer-file-provider-plugin.mjs';
import siteProjectSourcePlugin from './plugins/site-project-source-plugin.mjs';
import releaseApiPlugin from './plugins/release-api-plugin';
import bundledRelease from './artifacts/site-release/bundled-release.json';
import { resolveLocalReleaseToolchain } from './server/site-project-local/toolchain-config.mjs';

const bundledSource = bundledRelease as never;

export default defineConfig(async () => ({
  publicDir: 'media-store/public',
  // zfb-md-wasm's browser entry imports its glue/wasm files with Vite's
  // `?url` query. Keep both dependency packages in Vite's normal module graph:
  // Rolldown's dependency optimizer cannot resolve those resource imports while
  // scanning the package, whereas the asset pipeline handles them on demand.
  optimizeDeps: { exclude: ['@zudo-sg/ui', '@takazudo/zfb-md-wasm'] },
  plugins: [
    releaseApiPlugin(),
    siteProjectSourcePlugin({
      bundledSource,
      currentToolchain: await resolveLocalReleaseToolchain(),
    }),
    composerFileProviderPlugin(),
    tailwindcss(),
    preact(),
  ],
}));
