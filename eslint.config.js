import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', '**/dist', 'coverage', '_temp-resource/**'] },
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
