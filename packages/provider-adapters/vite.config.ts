import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

/* The default suite: the fake agent only, so it runs in CI. The real agents run with `bun run test:agents`. */
export default defineConfig({
  test: {
    ...testing('medium'),
    include: ['tests/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/**/*.ts'],
      // src/testing is test tooling, not production code: the fake agent is exercised by every test that uses it.
      exclude: ['src/index.ts', 'src/testing/**'],
      reporter: ['text', 'html'],
      // Checked when a test fails too, so a run that only quarantined tests fail still gates on it (@althar/testing).
      reportOnFailure: true,
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
