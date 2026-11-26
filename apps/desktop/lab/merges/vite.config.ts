import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * The merges lab: the coordinator's thread after "see everything thru to
 * main", as it reads today and in three tidier directions, at four moments
 * of the merges, with no runtime behind it (lab/merges/README.md).
 */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  // Of the tests' own package they need only its times: the rest reads the machine's files and settings, which a page hasn't.
  resolve: {
    alias: {
      vitest: join(import.meta.dirname, 'vitest.ts'),
      '@althar/testing': join(import.meta.dirname, '../../../../packages/testing/src/time.ts'),
    },
  },
  server: { port: 6141, strictPort: true },
})
