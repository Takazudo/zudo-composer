import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // `worktrees/` holds nested git checkouts of this same repo, on other branches.
  // Linting them reports another branch's in-progress errors as this tree's, and
  // re-lints every file once per worktree. The rest are gitignored tool output.
  {
    ignores: [
      'dist',
      '**/dist-editor',
      '**/dist-site',
      '**/.zudo-site-project',
      'packages/*/cms/{compositions,content,mappings,sitemaps,workspaces}/**',
      '**/dist',
      'coverage',
      'worktrees/**',
      'server/generated/**',
      'server/authoring.mjs',
      'server/authoring.d.mts',
      'server/site-build.mjs',
      'server/site-build.d.mts',
      'server/site-project.d.mts',
      'server/vite.d.mts',
      'server/config-public.d.mts',
      '.vite/**',
      '.artifacts/**',
      'test-results/**',
      'playwright-report/**',
      'doc/**',
      'styleguide/**',
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
  {
    // These are the only files that import the two virtual modules declared in
    // `src/features/composer/pack-config.d.ts`; each carries an explicit
    // triple-slash reference so every `tsc -b` program that reaches it also
    // sees the declaration (issue #667/#668). Scoped narrowly rather than a
    // blanket allowance for the rule.
    files: [
      'src/main.tsx',
      'src/hosted-demo/main.tsx',
      'src/features/composer/active-pack.ts',
      'src/features/composer/preview/preview-entry.ts',
      'src/features/delivery/preview-entry.ts',
    ],
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
  {
    // packages/ui is byte-ported from the pinned @zudo-sg/ui tree (#686 C0),
    // which lints under eslint-plugin-react (not installed here). Its
    // `prose-md.tsx` carries an `eslint-disable-next-line react/no-danger`
    // comment; without a rule of that name registered, ESLint errors on the
    // directive itself ("Definition for rule ... was not found") rather than
    // just leaving it unused. This no-op stand-in lets the byte-identical
    // file lint clean without editing its content.
    files: ['packages/ui/src/**/*.tsx'],
    plugins: {
      react: { rules: { 'no-danger': { create: () => ({}) } } },
    },
  },
);
