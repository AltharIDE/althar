import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The agent places lab: where agents at once and the places in use live, by
 * This Mac, beside the Settings slider and in Up next, drawn on the app's own
 * board and the kit's own bar and settings, with no runtime (README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  // What they take from the tests' own package reads files; the page has its one helper.
  resolve: {
    alias: [
      { find: /^vitest$/, replacement: join(import.meta.dirname, 'vitest.ts') },
      { find: /^@althar\/testing$/, replacement: join(import.meta.dirname, 'testing.ts') },
    ],
  },
  server: { port: 6161, strictPort: true },
})
