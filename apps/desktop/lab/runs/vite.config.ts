import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The runs and terminal lab: the whole desktop app (its router, tabs and
 * screens) on made-up data with no runtime, with a few import seams so each
 * direction can put a run and a terminal where it would live
 * (lab/runs/README.md):
 *
 * - what the project's screen, Run's list and the window's tabs take from the
 *   kit comes through ui.ts: Run's list gains "Open a terminal", the
 *   conversation's face gains its runs under it (B2), the tabs gain the
 *   terminal's own (D);
 * - the project's screen takes the run's card in its thread from RunOf.tsx,
 *   which opens a run's output where the direction keeps it.
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const projectView = join(renderer, 'features/project/ProjectView.tsx')
const kitFor = new Set([projectView, join(renderer, 'features/runs/Runs.tsx'), join(renderer, 'features/tabs/TabsFrame.tsx')])

const seam = (): Plugin => ({
  name: 'runs-lab:seam',
  enforce: 'pre',
  resolveId(source, importer) {
    const from = importer?.split('?')[0] ?? ''
    if (source === '@althar/ui' && kitFor.has(from)) return join(here, 'ui.ts')
    if (from === projectView && source === '../../shared/RunOf') return join(here, 'RunOf.tsx')
    return null
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6183, strictPort: true },
})
