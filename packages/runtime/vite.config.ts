import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    // The fake agents only, so it runs in CI; the real ones run with `bun run test:agents`.
    include: ['tests/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
