import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Prototype: what blocks a ready card, at a glance. One light page per
 * direction, served from here and never built. The app's own BoardView and
 * HomeView render as they are, fed fake data; `@althar/ui` resolves to
 * `kit.ts`, which is the kit with the board card, the Needs you lane and the
 * home's line wrapped, so a page's direction can change what a ready card
 * says. Throwaway: delete the folder when done.
 *
 *   ./node_modules/.bin/vp dev --config prototypes/ready-blockers/vite.config.ts   (from apps/desktop)
 *
 * The server doesn't always see files change: after an edit, start it again.
 */
const here = import.meta.dirname

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@althar\/ui$/, replacement: join(here, 'kit.ts') },
      // The desktop tests' fake client makes the home's runtime; its vi.fn is a plain function here.
      { find: /^vitest$/, replacement: join(here, 'vitest.ts') },
    ],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5371, strictPort: true, fs: { allow: [join(here, '../../../..')] } },
})
