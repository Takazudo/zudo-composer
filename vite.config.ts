import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import composerFileProviderPlugin from './plugins/composer-file-provider-plugin.mjs';
import siteProjectSourcePlugin from './plugins/site-project-source-plugin.mjs';
import bundledProject from './src/site-project/sample/sample-site-project.json';
import type { SiteProject } from './src/site-project/model/types';

export default defineConfig({
  plugins: [
    siteProjectSourcePlugin({ bundledProject: bundledProject as unknown as SiteProject }),
    composerFileProviderPlugin(),
    tailwindcss(),
    preact(),
  ],
});
