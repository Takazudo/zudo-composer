import { configDefaults, defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    projects: [
      {
        // Node-lane specs may import a component pack, whose sidecars are
        // `.tsx`. Without this the default JSX runtime would be React's — the
        // same statement `server/module-evaluator.mjs` has to make for the
        // installed lane.
        oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
        test: {
          name: 'server',
          // Must stay as wide as the app project's `server/**` exclusion, or a server spec
          // in any other supported extension would be claimed by neither project and silently
          // never run.
          include: ['server/**/*.{test,spec}.?(c|m)[jt]s?(x)', 'packages/image-editor/src/__tests__/**/*.test.ts'],
          environment: 'node',
          // These specs spawn real Node processes (CLI framing, cross-process CAS) and
          // a 5s in-process default reads as a regression under full-suite load (#179).
          // One of them boots the packaged bin end to end, which pays for a cold Vite
          // start plus dependency optimization — that alone exceeded 20s on a CI runner
          // while passing locally, so the ceiling covers a real cold boot, not a hang.
          testTimeout: 60_000,
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
            'virtual:zudo-composer-pack': fileURLToPath(new URL('./src/test/composer-pack.ts', import.meta.url)),
            'virtual:zudo-composer-host-styles': fileURLToPath(new URL('./src/test/host-styles.css', import.meta.url)),
            'virtual:release-config': fileURLToPath(new URL('./src/test/release-config.ts', import.meta.url)),
            'virtual:composer-file-provider-config': fileURLToPath(
              new URL('./src/test/composer-file-provider-config.ts', import.meta.url),
            ),
            'virtual:composer-domain-providers': fileURLToPath(
              new URL('./src/test/composer-domain-providers.ts', import.meta.url),
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
          // Provider specs now drive real filesystem stores (fsync per commit) instead of
          // in-memory IndexedDB. The heaviest of them take ~75s of test time on their own,
          // and under full-suite parallel load they contend for the disk badly enough to
          // blow past 20s while passing in isolation. Same reason the server project raises
          // its own timeout; the cost here is real I/O, not a hung promise.
          testTimeout: 60_000,
          exclude: [...configDefaults.exclude, '**/worktrees/**', 'server/**', 'packages/image-editor/src/__tests__/**/*.test.ts', 'packages/demo-*/**'],
        },
      },
      {
        // The demo host packages are hosts, not the app: no jsdom, no
        // `src/test` setup and none of the app project's `virtual:*` aliases,
        // which a pack must never depend on. Their specs spawn installed
        // `zudo-composer` commands and import the packs' `.tsx` sidecars, hence
        // the server project's JSX runtime and timeout.
        oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
        test: {
          name: 'demos',
          include: ['packages/demo-*/**/*.test.?(c|m)[jt]s?(x)'],
          environment: 'node',
          testTimeout: 60_000,
          exclude: [...configDefaults.exclude, '**/worktrees/**'],
        },
      },
    ],
  },
});
