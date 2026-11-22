import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The artifact boards lab: artifacts for design engineers. The whole desktop
 * app (its router, tabs and screens) on made-up data with no runtime, for
 * kiln, a pottery studio's bookings site, with four directions swapped in by
 * a few import seams (lab/artifact-boards/README.md): an artifact as a canvas
 * of boards, browsed, talked to and shared. Kiln, the product, runs on its own
 * page (kiln.html), which every board frames. Everything else is the app's own.
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const at = (path: string) => join(renderer, path)
const lab = (path: string) => join(here, 'seams', path)

/** Which import, from which of the app's files, is the lab's. */
const SEAMS: ReadonlyArray<{ readonly importer: string; readonly source: string; readonly to: string }> = [
  // A canvas beside a conversation: an artifact of boards (A, D), today's panel otherwise.
  { importer: at('shared/ThreadHost.tsx'), source: '../features/canvases/CanvasHost', to: lab('Host.tsx') },
  // The project's Artifacts view: a gallery and a room of its own (B), the wall (C), today's table otherwise.
  { importer: at('features/project/ProjectView.tsx'), source: '../canvases/ArtifactsView', to: lab('Room.tsx') },
  // A task's canvases as it opens: the artifact its lead drew, beside it from the start.
  { importer: at('features/task/TaskView.tsx'), source: '../canvases/arrivals', to: lab('arrivals.ts') },
  // The top rows: an artifact chat's names the artifact and who sees it, beside its conversation and in the project's Artifacts.
  { importer: at('features/task/TaskView.tsx'), source: '@althar/ui', to: lab('ui.tsx') },
  { importer: at('features/project/ProjectView.tsx'), source: '@althar/ui', to: lab('ui.tsx') },
  // The project's settings: where its artifacts go in git, under Code and issues (E7).
  { importer: at('features/projectSettings/ProjectSettingsPage.tsx'), source: './CodeSection', to: lab('CodeSection.tsx') },
]

const seam = (): Plugin => ({
  name: 'artifact-boards-lab:seam',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer === undefined) return null
    const from = importer.split('?')[0] ?? ''
    return SEAMS.find((one) => one.importer === from && one.source === source)?.to ?? null
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  resolve: {
    alias: {
      // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
      vitest: join(here, 'vitest.ts'),
      '@althar/testing': join(here, 'testing.ts'),
      // Glyphs the kit's icon set doesn't name yet, from the same Iconoir it draws with.
      'iconoir-react': join(here, '../../../../packages/ui/node_modules/iconoir-react'),
    },
  },
  server: { port: 6196, strictPort: true },
})
