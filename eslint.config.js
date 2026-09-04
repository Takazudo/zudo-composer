import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `worktrees/` holds nested git checkouts of this same repo, on other branches.
  // Linting them reports another branch's in-progress errors as this tree's, and
  // re-lints every file once per worktree.
  //
  // The rest are gitignored tool output. `.wrangler/tmp/` is the one that bites:
  // `wrangler dev` (smoke:local, the SiteProject production lane) and even
  // `deploy --dry-run` leave generated workers there, so a second `pnpm check`
  // in the same tree failed on lint errors in Wrangler's own scratch files.
  // CI never saw it because CI never runs twice in one checkout.
  {
    ignores: [
      'dist',
      '**/dist',
      'coverage',
      'worktrees/**',
      '.wrangler/**',
      '.vite/**',
      '.artifacts/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['scripts/**/*.mjs', 'plugins/**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
);
