import { defineConfig } from 'vite-plus'

/*
 * The contracts against real accounts, with tokens from the environment
 * (see README). They open and close a pull request and comment on an issue in
 * the scratch repository and tracker they are given, so they never run in CI.
 */
export default defineConfig({
  test: {
    include: ['tests/real/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    fileParallelism: false,
  },
})
