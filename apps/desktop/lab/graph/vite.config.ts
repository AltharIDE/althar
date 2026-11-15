import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

import { BOARD_PATCHES } from './board/patches'
import { CHAT_PATCHES } from './chat/patches'
import type { Patch } from './patching'
import { TASK_PATCHES } from './task/patches'

/*
 * The graph lab: the whole desktop app (its router, tabs and screens) on a
 * made-up runtime where a big request is planned with the coordinator and
 * then runs as the graph of tasks it became, drawn into the app's own
 * screens by a few seams, each a single import or line, so every option
 * runs over the real thing (lab/graph/README.md).
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const projectView = join(renderer, 'features/project/ProjectView.tsx')

/** Imports swapped for the lab's, each in the one file that imports it. */
const swaps: ReadonlyArray<{ readonly importer: string; readonly source: string; readonly to: string }> = [
  // The coordinator's thread draws a card through the lab's, which draws the plan as the chat option on show does.
  { importer: projectView, source: './Card', to: join(here, 'seams/Card.tsx') },
  // The board, as the board option on show draws it, or the plan in its place while it's talked over beside (chat D).
  { importer: projectView, source: '../board/BoardView', to: join(here, 'seams/BoardView.tsx') },
]

/** Lines patched in the app's own files, each part's where it needs a word or a place (each part's patches.ts). */
const patches: ReadonlyArray<Patch> = [...CHAT_PATCHES, ...BOARD_PATCHES, ...TASK_PATCHES]

const seams = (): Plugin => ({
  name: 'graph-lab:seams',
  enforce: 'pre',
  resolveId(source, importer) {
    const from = importer?.split('?')[0]
    const swap = swaps.find((one) => one.importer === from && one.source === source)
    return swap === undefined ? null : swap.to
  },
  transform(code, id) {
    const file = id.split('?')[0]
    const mine = patches.filter((one) => one.file === file)
    if (mine.length === 0) return null
    let out = code
    for (const one of mine) {
      if (one.from === '') {
        out = one.to + out
        continue
      }
      if (!out.includes(one.from)) throw new Error(`graph-lab: ${file} no longer has ${one.from}`)
      out = out.replace(one.from, one.to)
    }
    return { code: out, map: null }
  },
})

export default defineConfig({
  root: here,
  plugins: [seams(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  // Another port where a helper runs its own copy beside this one: LAB_PORT=6172.
  server: { port: Number(process.env.LAB_PORT ?? 6171), strictPort: true },
})
