import { configDefaults, defineConfig } from 'vitest/config';
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
    // `worktrees/` holds nested git checkouts of this same repo. Without this the
    // root run collects every sibling worktree's specs as if they were ours, which
    // inflates counts, reruns another branch's tests against this tree, and reports
    // deleted files as "0 test" once a worktree is removed mid-run.
    exclude: [...configDefaults.exclude, '**/worktrees/**'],
  },
});
