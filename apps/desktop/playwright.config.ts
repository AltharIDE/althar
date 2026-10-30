import { defineConfig } from '@playwright/test'

/*
 * The built app, driven through Electron. Run `bun run build` first; `test:e2e` does. In CI a spec that fails runs
 * once more, and one that passes only then is reported as flaky (@althar/testing), as the unit tests are.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['@althar/testing/playwright']] : 'list',
  use: { trace: 'retain-on-failure' },
  outputDir: 'test-results',
})
