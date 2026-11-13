import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'
import DurationSequencer from '@althar/testing/sequencer'

import coverageGate from './coverage-gate.json'

export default defineConfig({
  test: {
    ...testing('medium'),
    sequence: { sequencer: DurationSequencer },
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
      // The target is 90% for both. Branch instrumentation varies slightly on an unchanged tree: allow 0.25 points.
      thresholds: coverageGate,
    },
  },
})
