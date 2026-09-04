import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `worktrees/` holds nested git checkouts of this same repo, on other branches.
  // Linting them reports another branch's in-progress errors as this tree's, and
  // re-lints every file once per worktree.
  { ignores: ['dist', '**/dist', 'coverage', 'worktrees/**'] },
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
