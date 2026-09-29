import { defineConfig } from '@playwright/test'

/* The built app, driven through Electron. Run `bun run build` first; `test:e2e` does. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  outputDir: 'test-results',
})
