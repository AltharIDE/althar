import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

export default defineConfig({
  test: {
    ...testing,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
})
