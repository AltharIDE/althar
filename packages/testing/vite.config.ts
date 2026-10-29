import { defineConfig } from 'vite-plus'

import { testing } from './src/vitest'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    ...testing,
  },
})
