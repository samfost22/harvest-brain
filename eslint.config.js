import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/', 'node_modules/', 'data/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  { files: ['server/**', 'tests/**', '*.config.js'], languageOptions: { globals: globals.node } },
  { files: ['src/**', 'tests/ui.test.js'], languageOptions: { globals: globals.browser } },
  { files: ['shared/**'], languageOptions: { globals: globals['shared-node-browser'] } },
  { files: ['src/**/*.jsx'], ...reactHooks.configs.flat.recommended },
];
