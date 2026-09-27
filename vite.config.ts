import { defineConfig } from 'vite-plus'

/*
 * Workspace-wide lint, format and staged-file checks. Vite+ applies the root
 * `lint` and `fmt` blocks to every package, from wherever `vp check` runs;
 * each package keeps its own vite.config.ts for Vite, Vitest and CSS modules.
 */
export default defineConfig({
  lint: {
    ignorePatterns: [
      '**/dist/**',
      '**/.ssr/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/storybook-static/**',
    ],
    plugins: ['typescript', 'unicorn', 'oxc', 'react', 'jsx-a11y', 'import'],
    options: { typeAware: true, typeCheck: true },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'react/rules-of-hooks': 'error',
      'react/exhaustive-deps': 'error',
    },
  },
  fmt: {
    ignorePatterns: ['**/dist/**', '**/.ssr/**', '**/coverage/**', '**/*.html', 'apps/**/*.css', '**/*.md', 'bun.lock'],
    semi: false,
    singleQuote: true,
    printWidth: 140,
  },
  /* Run by the pre-commit hook (.vite-hooks/pre-commit): format and lint what is staged, fixing what can be fixed. */
  staged: {
    '*.{js,mjs,cjs,ts,mts,tsx,json}': 'vp check --fix',
  },
})
