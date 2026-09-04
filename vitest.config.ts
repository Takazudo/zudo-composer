import { configDefaults, defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          include: ['server/**/*.test.ts'],
          environment: 'node',
          // These specs spawn real Node processes (CLI framing, cross-process CAS) and
          // a 5s in-process default reads as a regression under full-suite load (#179).
          testTimeout: 20_000,
          // `worktrees/` holds nested git checkouts of this same repo. Without this the
          // root run collects every sibling worktree's specs as if they were ours, which
          // inflates counts, reruns another branch's tests against this tree, and reports
          // deleted files as "0 test" once a worktree is removed mid-run.
          exclude: [...configDefaults.exclude, '**/worktrees/**'],
        },
      },
      {
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
          name: 'app',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          exclude: [...configDefaults.exclude, '**/worktrees/**', 'server/**'],
        },
      },
    ],
  },
});
