import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The device lab: a simulator or an emulator beside a task's conversation,
 * in four directions, on the app's own thread and kit with no runtime behind
 * them (lab/device/README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies, which on a page are the functions they wrap, and
  // count time with @althar/testing, the rest of which reads files and Node's process.
  resolve: {
    alias: { vitest: join(import.meta.dirname, 'vitest.ts'), '@althar/testing': join(import.meta.dirname, 'testing.ts') },
  },
  server: { port: 6141, strictPort: true },
})
