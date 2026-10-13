import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: what blocks a ready card, at a glance. A light page per direction,
 * served from here; never built. The app's own board and home render as they
 * are; only the kit's ready card and home line are swapped, through `kit.ts`,
 * for the direction's.
 */
const here = import.meta.dirname

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: [
      // The kit as the app imports it, with the ready card and line of the page's direction.
      { find: /^@althar\/ui$/, replacement: join(here, 'kit.ts') },
      // The app's own test fixtures make the fake runtime; their vi.fn is a plain function here.
      { find: /^vitest$/, replacement: join(here, 'vitest.ts') },
    ],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5352, strictPort: true, fs: { allow: [join(here, '../../../..')] } },
})
