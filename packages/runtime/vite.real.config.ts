import { defineConfig } from 'vite-plus'

/*
 * What is run by hand against this computer itself, never in CI: how
 * quickly the runtime answers while the computer is busy
 * (tests/real/responsiveness.test.ts), which takes it for minutes.
 */
export default defineConfig({
  test: {
    include: ['tests/real/*.test.ts'],
    environment: 'node',
    testTimeout: 60 * 60_000,
    hookTimeout: 60_000,
    // One file, one worker: its timings are its own.
    maxWorkers: 1,
    silent: false,
    // Its waits give up near the test's own time, as every test's do.
    setupFiles: ['@althar/testing/setup'],
  },
})
