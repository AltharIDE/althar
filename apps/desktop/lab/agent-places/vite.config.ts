import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The agent places lab: where the home's workers and their agents live, and
 * Settings for the home and its workers, drawn on the app's own
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
