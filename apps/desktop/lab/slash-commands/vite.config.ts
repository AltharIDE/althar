import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The slash commands lab: the whole desktop app (its router, tabs and
 * screens) on made-up data with no runtime, with the composer given commands
 * by import seams: what a few of the app's files take from the kit, and
 * the DraftComposer its screens take, come through the lab's own modules
 * (lab/slash-commands/README.md).
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const at = (path: string) => join(renderer, path)

/** The kit, as each of these files imports it, is the lab's. */
const KIT = new Map([
  [at('shared/DraftComposer.tsx'), join(here, 'kit.ts')],
  [at('features/task/TaskView.tsx'), join(here, 'screens.tsx')],
  [at('shared/ThreadBlocks.tsx'), join(here, 'thread.tsx')],
  [at('features/project/Asides.tsx'), join(here, 'asides.tsx')],
])
/** The screens with a composer take the lab's DraftComposer, which says which composer it is. */
const SCREENS = new Set([
  at('features/task/TaskView.tsx'),
  at('features/project/ProjectView.tsx'),
  at('features/canvases/ArtifactRoom.tsx'),
])

const seam = (): Plugin => ({
  name: 'slash-commands-lab:seam',
  enforce: 'pre',
  resolveId(source, importer) {
    const from = importer?.split('?')[0] ?? ''
    if (source === '@althar/ui' && KIT.has(from)) return KIT.get(from)
    if (SCREENS.has(from) && source.endsWith('/shared/DraftComposer')) return join(here, 'draft.tsx')
    return null
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6188, strictPort: true },
})
