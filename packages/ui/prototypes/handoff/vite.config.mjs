import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * with two tasks of this repository's. The seams swap a few imports of the
 * real task screen for these pages alone, so each direction draws the
 * thread (and, for B, the face it opens on) its own way, without touching
 * the app's own code. Plain JavaScript, so the kit's type check leaves it
 * (and vite-plus's test typings) out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const TASK = 'features/task/TaskView.tsx'
const seams = [
  // The thread: each direction's, or the app's own for Today.
  { importer: TASK, id: './TaskThread', to: 'seams/TaskThread.tsx' },
  // What the rules keep for the person: A and C draw it with the handoff, so the thread's end doesn't again.
  { importer: TASK, id: './PermissionCall', to: 'seams/PermissionCall.tsx' },
  // The face a task opens on: B's is where it stands.
  { importer: TASK, id: './chosenFaces', to: 'seams/chosenFaces.ts' },
  // The header's faces: in B, Outputs is Where it stands, first.
  { importer: TASK, id: '@althar/ui', to: 'seams/taskUi.ts' },
  // Outputs, and its left column, which is where it stands in B.
  { importer: TASK, id: './Outputs', to: 'seams/Outputs.tsx' },
  { importer: TASK, id: './NoOutputsView', to: 'seams/NoOutputsView.tsx' },
  { importer: 'features/task/Outputs.tsx', id: '@althar/ui', to: 'seams/outputsUi.ts' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'handoff-seams',
  enforce: 'pre',
  resolveId(id, importer) {
    // deps.ts names the desktop's packages by path, for the types; they load as a desktop file loads them, so there is one copy.
    const desktops = /apps\/desktop\/node_modules\/(@tanstack\/react-(?:query|router))$/.exec(id)?.[1]
    if (desktops !== undefined) return this.resolve(desktops, resolve(repo, 'apps/desktop/src/renderer/main.tsx'), { skipSelf: true })
    const seam = seams.find((one) => one.id === id && importer?.split('?')[0]?.endsWith(one.importer))
    return seam === undefined ? null : resolve(here, seam.to)
  },
}

export default defineConfig({
  root: here,
  plugins: [swap, react()],
  resolve: {
    alias: [{ find: /^vitest$/, replacement: resolve(here, 'vi.ts') }],
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // Polling, so a server started inside the sandbox still sees edits.
  server: { port: 5361, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
