import { defineConfig } from 'vite-plus'

/*
 * The contract against the real agents: Claude Code, Codex and OpenCode, as
 * installed and signed in on this machine. It sends a few short prompts, so it
 * costs a little usage, and never runs in CI.
 */
export default defineConfig({
  test: {
    include: ['tests/agents/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
