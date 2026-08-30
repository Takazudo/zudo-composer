import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import composerFileProviderPlugin from './plugins/composer-file-provider-plugin.mjs';

export default defineConfig({
  publicDir: 'media-store/public',
  plugins: [composerFileProviderPlugin(), tailwindcss(), preact()],
});
