import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/* Scrappy: unpushed commits as the thing to do first. A light page per direction, served from here; never built. */
const here = import.meta.dirname

export default defineConfig({
  root: here,
  // The screenshots shoot.mjs takes, which the comparison page shows.
  publicDir: join(here, '../../test-results/unpushed-first'),
  plugins: [react()],
  resolve: {
    // The app's own test fixtures make the fake runtime; their vi.fn is a plain function here.
    alias: { vitest: join(here, 'vitest.ts') },
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5344, strictPort: true, fs: { allow: [join(here, '../../../..')] } },
})
