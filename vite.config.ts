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
        files: ['packages/{runtime,domain,contracts,persistence-sqlite,provider-adapters,connectors,transport-node}/src/**'],
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
          'packages/{runtime,domain,contracts,persistence-sqlite,provider-adapters,connectors,skills,transport-node}/src/**',
          'apps/desktop/src/{main,preload,runtime,speech,logs}/**',
        ],
        rules: { 'althar/off-the-thread': 'error' },
      },
      /* But the fake agent and the fake services, which run beside a test, never in the app. */
      {
        files: ['packages/{provider-adapters,connectors}/src/testing/**'],
        rules: { 'althar/off-the-thread': 'off' },
      },
      /*
       * The runtime's modules import one way (packages/runtime/ARCHITECTURE.md, "Where a file goes"): never in a cycle of
       * values, never up its layers (lint/layers.js, packages/runtime/layers.js), each name from the file that makes it
       * (lint/exports.js), and a type as a type, so an import that only names one loads nothing.
       */
      {
        files: ['packages/runtime/src/**'],
        rules: {
          'import/no-cycle': ['error', { ignoreTypes: true }],
          'althar/layers': 'error',
          'althar/exported-where-made': 'error',
          'typescript/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
          'typescript/no-import-type-side-effects': 'error',
        },
      },
      /*
       * A call is made in its area, and each package's Api.ts only puts the areas together (lint/areas.js; AGENTS.md,
       * "Where a change goes").
       */
      {
        files: ['packages/contracts/src/Api.ts', 'packages/runtime/src/Api.ts'],
        rules: { 'althar/calls-in-areas': 'error' },
      },
      /* A press in the window or the kit shows its result at once, never after a call answers (lint/press.js). */
      {
        files: ['apps/desktop/src/renderer/**/*.tsx', 'packages/ui/src/**/*.tsx'],
        rules: { 'althar/press-at-once': 'error' },
      },
      /* A test takes its size's time, never one of its own (lint/budget.js). */
      {
        files: ['packages/*/tests/**/*.{ts,tsx}', 'apps/*/tests/**/*.{ts,tsx}', 'brand/tests/**/*.{ts,tsx}'],
        rules: { 'althar/test-time': 'error' },
      },
      /* But the tests of real agents and real accounts, run by hand with configs of their own, a benchmark run by hand, and @althar/testing's own, which test the budget. */
      {
        files: ['**/tests/agents/**', '**/tests/real/**', '**/openBenchMerged.test.ts', 'packages/testing/**'],
        rules: { 'althar/test-time': 'off' },
      },
      /* An end-to-end spec takes the budget's times, never sleeps, and presses each system's own keys (lint/budget.js, lint/keys.js). */
      {
        files: ['apps/desktop/e2e/**/*.ts', 'apps/desktop/playwright.config.ts'],
        rules: { 'althar/spec-time': 'error', 'althar/system-keys': 'error' },
      },
      /* But the specs that drive real agents or a machine of the person's own, run by hand, which take as long as those do. */
      {
        files: ['apps/desktop/e2e/{real,real-tools,workerLab}.spec.ts'],
        rules: { 'althar/spec-time': 'off', 'althar/system-keys': 'off' },
      },
      /* No test or fixture rests on a date still to come (lint/dates.js). */
      {
        files: ['packages/*/tests/**/*.{ts,tsx}', 'apps/*/tests/**/*.{ts,tsx}', 'apps/*/e2e/**/*.ts', 'brand/tests/**/*.{ts,tsx}'],
        rules: { 'althar/no-future-dates': 'error' },
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
