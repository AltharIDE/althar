import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The role lenses lab: the whole desktop app (its router, tabs and screens)
 * on made-up data with no runtime, where the project's screen takes two
 * things from the lab by one import seam: the project's row (with the lens
 * switcher) through ui.ts, and the board's pane through Lens.tsx, which draws
 * each direction's home for the lens on (lab/role-lenses/README.md).
 */

const here = import.meta.dirname
const projectView = join(here, '../../src/renderer/features/project/ProjectView.tsx')

const seam = (): Plugin => ({
  name: 'role-lenses-lab:seam',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer === undefined || importer.split('?')[0] !== projectView) return null
    if (source === '@althar/ui') return join(here, 'ui.ts')
    if (source === '../board/BoardView') return join(here, 'Lens.tsx')
    return null
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6181, strictPort: true },
})
