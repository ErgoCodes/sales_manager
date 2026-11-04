// Neutral ESLint flat config for TypeScript packages that do not use Expo or
// React Native (packages/*, apps/api, apps/web). Usage in a consumer:
//   const { defineConfig } = require('eslint/config');
//   module.exports = defineConfig([...require('@monaco/eslint-config')]);
const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = [
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
