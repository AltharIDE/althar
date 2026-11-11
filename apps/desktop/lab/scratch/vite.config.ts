import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The Scratch lab: the app's own project window (ProjectView, its board and its
 * conversation) drawn from the tests' fixtures with no runtime, with each
 * direction for where Scratch lives and what it is called drawn into it. Keys
 * A–E, or the bar along the bottom, swap the direction (lab/scratch/README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(import.meta.dirname, '../thread/vitest.ts') } },
  server: { port: 6147, strictPort: true },
})
