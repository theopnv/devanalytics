import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    ignores: ['node_modules/**', '.wrangler/**', '.backfill/**', 'action/dist/**', '**/generated/**', 'worker-configuration.d.ts', 'graft/**', '.claude/**', 'examples/**'],
  },
  {
    files: ['**/*.{ts,mts}'],
    extends: [js.configs.recommended, tseslint.configs.strict],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        projectService: true,
      },
    },
    plugins: { '@sonarjs': sonarjs },
    rules: {
      curly: ['error', 'all'],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@sonarjs/cognitive-complexity': ['error', 15],
      '@sonarjs/cyclomatic-complexity': ['error', { threshold: 10 }],
    },
  },
  {
    files: ['**/*.test.{ts,mts}'],
    rules: {
      '@sonarjs/cognitive-complexity': 'off',
      '@sonarjs/cyclomatic-complexity': 'off',
    },
  },
]);
