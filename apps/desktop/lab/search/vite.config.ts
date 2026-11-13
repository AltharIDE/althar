import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The search lab: the whole desktop app (its router, tabs and screens) on
 * made-up data with no runtime, with what ⌘K opens swapped for the lab's own
 * search by one import seam, so each direction runs over the real screens
 * and opens them (lab/search/README.md).
 */

const here = import.meta.dirname
const tabsFrame = join(here, '../../src/renderer/features/tabs/TabsFrame.tsx')

/** TabsFrame's finder is the lab's: one import, in one file. */
const seam = (): Plugin => ({
  name: 'search-lab:seam',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer?.split('?')[0] === tabsFrame && source === '../finder/FinderView') return join(here, 'Search.tsx')
    return null
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts') } },
  server: { port: 6161, strictPort: true },
})
