import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: tasks waiting for a free agent. A light page per direction,
 * served from here; never built. The app's own board, dock, home, task
 * screen and card render as they are; what a direction changes comes in
 * through `kit.ts` (the kit's row, card, lane and dock, for the direction's)
 * and `agents.ts` (the app's words for waiting work).
 */
const here = import.meta.dirname

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: [
      // The kit as the app imports it, with the direction's row, card, lane and dock.
      { find: /^@althar\/ui$/, replacement: join(here, 'kit.ts') },
      // The app's words for waiting work, as every screen imports them, in the direction's voice.
      { find: /^(\.\.\/)+shared\/agents$/, replacement: join(here, 'agents.ts') },
      // The app's own test fixtures make the fake runtime; their vi.fn is a plain function here.
      { find: /^vitest$/, replacement: join(here, 'vitest.ts') },
    ],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5356, strictPort: true, fs: { allow: [join(here, '../../../..')] } },
})
