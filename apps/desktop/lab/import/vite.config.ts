import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The import lab: the whole desktop app (its router, tabs and screens) on
 * made-up data with no runtime, with what other tools left in althar's
 * folders found and brought in (README.md). Seams: what the board and the
 * two Settings pages take from the kit comes through ui.ts (the found group
 * in Up next, the Other tools sections); and three of the app's own modules
 * are the lab's, each wrapping the app's: the sections of both Settings
 * pages, with Other tools added, and a thread's blocks, which say where a
 * conversation brought in came from and how it continues.
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const seamed = new Set(
  ['features/board/BoardView.tsx', 'features/projectSettings/ProjectSettingsPage.tsx', 'features/settings/SettingsPage.tsx'].map((one) =>
    join(renderer, one),
  ),
)
const swaps = new Map(
  [
    ['features/projectSettings/sections.ts', 'projectSections.ts'],
    ['features/settings/sections.ts', 'settingsSections.ts'],
    ['shared/ThreadBlocks.tsx', 'ThreadBlocks.tsx'],
  ].map(([app, lab]) => [join(renderer, app as string), join(here, lab as string)]),
)
const replacements = new Set(swaps.values())

const seam = (): Plugin => ({
  name: 'import-lab:seam',
  enforce: 'pre',
  async resolveId(source, importer) {
    if (importer === undefined) return null
    const from = importer.split('?')[0] ?? ''
    if (source === '@althar/ui' && seamed.has(from)) return join(here, 'ui.ts')
    // The lab's own module reaches the app's as it is.
    if (replacements.has(from) || !source.startsWith('.')) return null
    const resolved = await this.resolve(source, importer, { skipSelf: true })
    const id = resolved?.id.split('?')[0]
    return id === undefined ? null : (swaps.get(id) ?? null)
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6178, strictPort: true },
})
