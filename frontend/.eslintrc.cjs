/* ESLint (flat config not used to keep it simple + stable with eslint 8). */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.app.json', './tsconfig.node.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  settings: { react: { version: '18' } },
  ignorePatterns: [
    'dist',
    'node_modules',
    'src/api/generated/**',
    '.eslintrc.cjs',
    'vite.config.ts',
    'vitest.config.ts',
    'playwright.asset-runtime.config.ts',
    'playwright.visual-pr-c.config.ts',
    'playwright.production-image.config.ts',
    'playwright.effect-preview.config.ts',
    'playwright.event-derived.config.ts',
    'tests/browser/asset-runtime/vite.config.ts',
    'tests/browser/production-image/vite.config.ts',
    'tests/browser/effect-preview/vite.config.ts',
    'tests/browser/event-derived-effect/vite.config.ts',
  ],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
  },
  overrides: [
    {
      // Tests exercise the untyped edges (JSON.parse bodies, mock casts, node
      // globals). Product code stays under the full type-checked ruleset.
      files: ['tests/**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/no-base-to-string': 'off',
      },
    },
  ],
};
