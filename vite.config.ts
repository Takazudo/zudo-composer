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
