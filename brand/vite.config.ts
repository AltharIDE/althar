import { defineConfig } from 'vite-plus'
import { testing } from '@althar/testing/vitest'

export default defineConfig({
  test: {
    ...testing('medium'),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
