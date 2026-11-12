import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The home lab: a project's real home (ProjectView, its header, conversation,
 * composer and board) on fake data with no runtime, laid out four ways, for
 * choosing how the board and the conversation close and come back
 * (lab/home/README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(import.meta.dirname, 'vitest.ts') } },
  server: { port: 6141, strictPort: true },
})
