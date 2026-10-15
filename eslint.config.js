import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['backend/**/*.js', 'tests/**/*.mjs', 'vite.config.js', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      parserOptions: { sourceType: 'module' },
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      // Les écrans chargent des données et des métadonnées depuis des APIs externes.
      // Le plugin signale à tort ces mises à jour asynchrones comme synchrones.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
