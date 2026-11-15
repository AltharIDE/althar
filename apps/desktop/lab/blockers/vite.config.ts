import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

import { BOARD_PATCHES } from './board/patches'
import type { Patch } from './patching'
import { PROJECT_PATCHES } from './project/patches'
import { TASK_PATCHES } from './task/patches'

/*
 * The blockers lab: the whole desktop app (its router, tabs and screens) on a
 * made-up runtime where tasks wait for other tasks, drawn into the app's own
 * screens by a few lines patched in at build time, so every direction runs
 * over the real thing (lab/blockers/README.md). Nothing in src changes.
 */

const here = import.meta.dirname

/** Lines patched in the app's own files, each part's where it needs a word or a place (each part's patches.ts). */
const patches: ReadonlyArray<Patch> = [...BOARD_PATCHES, ...TASK_PATCHES, ...PROJECT_PATCHES]

const seams = (): Plugin => ({
  name: 'blockers-lab:seams',
  enforce: 'pre',
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
      if (!out.includes(one.from)) throw new Error(`blockers-lab: ${file} no longer has ${one.from}`)
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
  server: { port: Number(process.env.LAB_PORT ?? 6174), strictPort: true },
})
