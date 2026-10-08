import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      /* What draws the assets is covered; what writes them to disk and drives a browser is exercised by running it. */
      include: ['src/**/*.ts'],
      exclude: ['src/files.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
