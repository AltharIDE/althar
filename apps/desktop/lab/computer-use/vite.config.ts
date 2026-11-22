import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The computer use lab: the app's own computer use card, in a task's thread
 * with its lead at work, in each state a session goes through, with no
 * runtime or native helper behind it (lab/computer-use/README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(import.meta.dirname, 'vitest.ts'), '@althar/testing': join(import.meta.dirname, 'testing.ts') } },
  server: { port: 6135, strictPort: true },
})
