import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'data/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // The embed script is a classic script that runs on third-party sites.
    files: ['public/widget.js'],
    languageOptions: { ecmaVersion: 2019, sourceType: 'script', globals: globals.browser },
  },
  {
    files: ['public/admin/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Browser-driver callbacks run inside the page.
    files: ['acceptance/drivers/browser-visitor-driver.js', 'acceptance/drivers/agency-dashboard-driver.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
