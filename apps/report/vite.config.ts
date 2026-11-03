import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

/*
 * The Worker's tests run on Node, whose Request, FormData, File and fetch
 * are the web APIs workerd gives the Worker. Linear is a fake passed in as
 * `fetch`, and the rate limits are fakes passed in as bindings.
 */
export default defineConfig({
  test: {
    ...testing('small'),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/**/*.ts'],
      // src/testing is test tooling, not production code: the fake Linear is exercised by every test that files a report.
      exclude: ['src/testing/**'],
      reporter: ['text', 'html'],
      // Checked when a test fails too, so a run that only quarantined tests fail still gates on it (@althar/testing).
      reportOnFailure: true,
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
