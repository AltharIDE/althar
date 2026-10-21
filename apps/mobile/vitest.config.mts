import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@althar/contracts': path.resolve(import.meta.dirname, '../../packages/contracts/src/index.ts'),
    },
    /* The contract's source and the app must share one Effect, the app's. */
    dedupe: ['effect'],
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
