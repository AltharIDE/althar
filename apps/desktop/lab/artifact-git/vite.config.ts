import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The artifact-in-git lab: two people's Althars editing one artifact saved
 * in git (README.md). The whole desktop app (its router, tabs and screens)
 * on made-up data with no runtime, open on Kiln's Booking page in its own
 * room. A few import seams give the room's head, the canvas panel and the
 * canvas's place the kit's own components wrapped (kit.ts, wrapped.tsx),
 * the room a CanvasHost told which version to show, and the canvas its Save
 * to repo as each direction has it (seams/). Everything else is the app's.
 */

const here = import.meta.dirname
const canvases = join(here, '../../src/renderer/features/canvases')

/** Which import, from which of the app's files, is the lab's. */
const SEAMS: ReadonlyArray<{ readonly importer: string; readonly source: string; readonly to: string }> = [
  { importer: join(canvases, 'ArtifactRoom.tsx'), source: '@althar/ui', to: join(here, 'kit.ts') },
  { importer: join(canvases, 'ArtifactRoom.tsx'), source: './CanvasHost', to: join(here, 'seams/CanvasHost.tsx') },
  { importer: join(canvases, 'CanvasHost.tsx'), source: '@althar/ui', to: join(here, 'kit.ts') },
  { importer: join(canvases, 'CanvasHost.tsx'), source: './SaveCanvas', to: join(here, 'seams/SaveCanvas.tsx') },
]

const seam = (): Plugin => ({
  name: 'artifact-git-lab:seam',
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
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6207, strictPort: true },
})
