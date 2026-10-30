import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

/* The default suite: the fakes, and the adapters against recorded answers, so it runs in CI. Real accounts run with `bun run test:real`. */
export default defineConfig({
  test: {
    ...testing('medium'),
    include: ['tests/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/**/*.ts'],
      // src/testing is test tooling, not production code: the fakes are exercised by every test that uses them.
      exclude: ['src/index.ts', 'src/testing/**'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
