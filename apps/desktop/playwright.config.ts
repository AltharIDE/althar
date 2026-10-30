import { budget } from '@althar/testing/budget'
import { defineConfig } from '@playwright/test'

/*
 * The built app, driven through Electron. Run `bun run build` first; `test:e2e` does. In CI a spec that fails runs
 * once more, and one that passes only then is reported as flaky (@althar/testing), as the unit tests are.
 *
 * Each test drives the whole app, so it takes the large budget, scaled for the machine as the unit tests' is, and no
 * spec sets a time of its own. What a test waits for, an assertion here or an action (e2e/support.ts, as the app is
 * launched), takes a third of that, the medium budget: one that never comes fails with two thirds of its test's time
 * still left, saying what it waited for, rather than the test running out and saying only that it did.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: budget.large,
  expect: { timeout: budget.medium },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['@althar/testing/playwright']] : 'list',
  use: { trace: 'retain-on-failure' },
  outputDir: 'test-results',
})
