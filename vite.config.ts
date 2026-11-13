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
    jsPlugins: ['./lint/althar.js'],
    options: { typeAware: true, typeCheck: true },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'react/rules-of-hooks': 'error',
      'react/exhaustive-deps': 'error',
    },
    overrides: [
      /* The runtime and the packages it uses read the time and wait only through Effect's Clock (lint/clock.js). */
      {
        files: ['packages/{runtime,domain,contracts,persistence-sqlite,provider-adapters,connectors}/src/**'],
        rules: { 'althar/one-clock': 'error' },
      },
      /* But the fake agent, which runs outside any effect, as a process of its own too, and times what a test asks of it. */
      {
        files: ['packages/provider-adapters/src/testing/**'],
        rules: { 'althar/one-clock': 'off' },
      },
      /* The runtime and the agent adapters remove files and folders only through cleanUp and removeFully (lint/removal.js). */
      {
        files: ['packages/{runtime,provider-adapters}/src/**'],
        rules: { 'althar/one-removal': 'error' },
      },
      /* But where those two are made, and the fake agent, whose scratch files are a test's. */
      {
        files: ['packages/provider-adapters/src/removal.ts', 'packages/provider-adapters/src/testing/**'],
        rules: { 'althar/one-removal': 'off' },
      },
      /* The runtime, what it runs, and the app's main process start no process and copy no folder synchronously (lint/thread.js). */
      {
        files: [
          'packages/{runtime,domain,contracts,persistence-sqlite,provider-adapters,connectors,skills}/src/**',
          'apps/desktop/src/{main,preload,runtime,speech,logs}/**',
        ],
        rules: { 'althar/off-the-thread': 'error' },
      },
      /* But the fake agent and the fake services, which run beside a test, never in the app. */
      {
        files: ['packages/{provider-adapters,connectors}/src/testing/**'],
        rules: { 'althar/off-the-thread': 'off' },
      },
      /* A press in the window or the kit shows its result at once, never after a call answers (lint/press.js). */
      {
        files: ['apps/desktop/src/renderer/**/*.tsx', 'packages/ui/src/**/*.tsx'],
        rules: { 'althar/press-at-once': 'error' },
      },
    ],
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
