import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // 'dist' is the web build output. 'android/app/build' and
  // 'android/app/src/main/assets' are Capacitor's copied/synced web build
  // plus its own native-bridge.js — vendored, minified build artifacts,
  // not source. None of these were ever meant to be linted; without this
  // they account for the vast majority of `npm run lint`'s reported
  // problems (~1050 of ~1090 as of 2026-08-22), none of them real.
  globalIgnores(['dist', 'android/app/build', 'android/app/src/main/assets']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // React Compiler-readiness rules — not relevant since senseUS
      // isn't using React Compiler. Revisit and re-enable deliberately
      // if that ever changes; keeping rules-of-hooks and exhaustive-deps
      // active above, since those are genuinely valuable regardless.
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/set-state-in-render': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/unsupported-syntax': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/config': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/component-hook-factories': 'off',
      'react-hooks/gating': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/incompatible-library': 'off',
    },
  },
])