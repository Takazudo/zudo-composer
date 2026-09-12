import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `worktrees/` holds nested git checkouts of this same repo, on other branches.
  // Linting them reports another branch's in-progress errors as this tree's, and
  // re-lints every file once per worktree. The rest are gitignored tool output.
  {
    ignores: [
      'dist',
      'dist-hosted-demo',
      '**/dist-site',
      '**/.zudo-site-project',
      '**/dist',
      'coverage',
      'worktrees/**',
      '.vite/**',
      '**/.zudo-site-project/**',
      '.artifacts/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['bin/**/*.mjs', 'scripts/**/*.mjs', 'plugins/**/*.mjs', 'server/**/*.mjs', 'packages/*/bin/**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
);
