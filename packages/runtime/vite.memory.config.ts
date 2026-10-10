import { defineConfig } from 'vite-plus'
export default defineConfig({ test: { include: ['tests/model/*.test.ts'], environment: 'node', testTimeout: 120000 } })
