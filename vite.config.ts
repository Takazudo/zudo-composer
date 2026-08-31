import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import composerFileProviderPlugin from './plugins/composer-file-provider-plugin.mjs';
import siteProjectSourcePlugin from './plugins/site-project-source-plugin.mjs';

type BundledSiteProject = Parameters<typeof siteProjectSourcePlugin>[0]['bundledProject'];
const productionSiteProjectSource = readFileSync(
  new URL('./src/site-project/sample/sample-site-project.json', import.meta.url),
  'utf8',
);
const productionSiteProject = JSON.parse(productionSiteProjectSource) as unknown as BundledSiteProject;
const productionSiteProjectRevision = createHash('sha256')
  .update(productionSiteProjectSource, 'utf8')
  .digest('hex');

export default defineConfig({
  publicDir: 'media-store/public',
  // zfb-md-wasm's browser entry imports its glue/wasm files with Vite's
  // `?url` query. Keep both dependency packages in Vite's normal module graph:
  // Rolldown's dependency optimizer cannot resolve those resource imports while
  // scanning the package, whereas the asset pipeline handles them on demand.
  optimizeDeps: { exclude: ['@zudo-sg/ui', '@takazudo/zfb-md-wasm'] },
  plugins: [
    siteProjectSourcePlugin({
      bundledProject: productionSiteProject,
      bundledRevision: productionSiteProjectRevision,
    }),
    composerFileProviderPlugin(),
    tailwindcss(),
    preact(),
  ],
});
