import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import composerFileProviderPlugin from './plugins/composer-file-provider-plugin.mjs';

export default defineConfig({
  plugins: [composerFileProviderPlugin(), preact()],
});
