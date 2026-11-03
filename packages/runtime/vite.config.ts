import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

export default defineConfig({
  test: {
    ...testing('medium'),
    // The fake agents only, so it runs in CI; the real ones run with `bun run test:agents`.
    include: ['tests/*.test.ts'],
    environment: 'node',
    // What the runtime logs as agents start and turns run is read only for a test that failed.
    silent: 'passed-only',
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text', 'html'],
      // Checked when a test fails too, so a run that only quarantined tests fail still gates on it (@althar/testing).
      reportOnFailure: true,
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
