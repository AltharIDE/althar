import { testing } from '@althar/testing/vitest'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    ...testing('small'),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
