import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

export default defineConfig({
  test: {
    ...testing('medium'),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
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
