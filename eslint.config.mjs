import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/target/**',
      'backend-nexus-sample/**',
      'backend/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        React: 'readonly',
      },
    },
    // Restores what the legacy .eslintrc.cjs configured before the flat-config
    // migration dropped it. Without the plugin registered, every
    // `// eslint-disable-next-line react-hooks/exhaustive-deps` in the tree is
    // a hard error ("Definition for rule ... was not found") — and we silently
    // lost hook linting entirely.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
