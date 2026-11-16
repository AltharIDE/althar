import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The conversation bar lab: the whole desktop app (its router, tabs and
 * screens) on made-up data with no runtime, with the bar over the
 * coordinator's conversation swapped for the lab's by one import seam: what
 * the project's screen and its asides take from the kit comes through
 * ui.ts, which gives each direction's bar and project row
 * (lab/conversation-bar/README.md).
 */

const here = import.meta.dirname
const project = join(here, '../../src/renderer/features/project')
const seamed = new Set([join(project, 'Asides.tsx'), join(project, 'ProjectView.tsx')])

/** The kit, as Asides.tsx and ProjectView.tsx import it, is the lab's. */
const seam = (): Plugin => ({
  name: 'conversation-bar-lab:seam',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === '@althar/ui' && importer !== undefined && seamed.has(importer.split('?')[0] ?? '')) return join(here, 'ui.ts')
    return null
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6177, strictPort: true },
})
