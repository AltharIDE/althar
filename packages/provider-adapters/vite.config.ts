import { defineConfig } from 'vite-plus'

/* The default suite: the fake agent only, so it runs in CI. The real agents run with `bun run test:agents`. */
export default defineConfig({
  test: {
    include: ['tests/*.test.ts'],
    environment: 'node',
    coverage: {
      include: ['src/**/*.ts'],
      // src/testing is test tooling, not production code: the fake agent is exercised by every test that uses it.
      exclude: ['src/index.ts', 'src/testing/**'],
      reporter: ['text', 'html'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
})
