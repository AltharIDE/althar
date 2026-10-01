import { defineConfig } from 'vite-plus'

/*
 * The coordinator loop against the real agents, as installed and signed in on
 * this machine. It costs a few turns of usage on each agent the coordinator
 * picks, and never runs in CI.
 */
export default defineConfig({
  test: {
    include: ['tests/agents/*.test.ts'],
    environment: 'node',
    testTimeout: 20 * 60_000,
    hookTimeout: 60_000,
  },
})
