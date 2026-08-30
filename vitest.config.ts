import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      'virtual:composer-file-provider-config': fileURLToPath(
        new URL('./src/test/composer-file-provider-config.ts', import.meta.url),
      ),
      'virtual:site-project-source': fileURLToPath(
        new URL('./src/test/site-project-source.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
