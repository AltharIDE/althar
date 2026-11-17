import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The issue part lab: the whole desktop app (its router and screens) on
 * made-up data with no runtime, opened on a task that came from a Linear
 * issue, with what the task's screen takes from the kit for that issue (its
 * card, the switch under it, and the header's parts) swapped for each
 * direction's by one import seam: TaskView.tsx's kit comes through ui.ts
 * (lab/issue-part/README.md).
 */

const here = import.meta.dirname
const seamed = new Set([join(here, '../../src/renderer/features/task/TaskView.tsx')])

/** The kit, as TaskView.tsx imports it, is the lab's. */
const seam = (): Plugin => ({
  name: 'issue-part-lab:seam',
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
  server: { port: 6179, strictPort: true },
})
