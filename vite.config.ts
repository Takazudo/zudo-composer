import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import composerFileProviderPlugin from './plugins/composer-file-provider-plugin.mjs';

export default defineConfig({
  publicDir: 'media-store/public',
  // The focused renderer imports WASM/glue through Vite asset queries, which
  // must stay in Vite's normal transform pipeline instead of dep optimization.
  optimizeDeps: { exclude: ['@zudo-sg/ui'] },
  plugins: [composerFileProviderPlugin(), tailwindcss(), preact()],
});
