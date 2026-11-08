import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * open on a task in one of phase 5's situations. Seams swap the kit for four
 * of the app's own files, so each direction draws its card on the real
 * board, its parts in the real task header, its lines in the real thread and
 * its tray on the real composer, without touching the app's code. Plain
 * JavaScript, so the kit's type check leaves it out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const seams = [
  // The board: the case's card, and where Scratch opens.
  { importer: 'features/board/BoardView.tsx', id: '@althar/ui', to: 'seams/boardUi.ts' },
  // A task's bar and composer: its chip, its parts, what sits over the composer.
  { importer: 'features/task/TaskView.tsx', id: '@althar/ui', to: 'seams/taskUi.ts' },
  // A task's Outputs: each of its changes, as the direction has them.
  { importer: 'features/task/TaskView.tsx', id: './Outputs', to: 'seams/Outputs.tsx' },
  // The plan card: it names the preset, the one place it shows.
  { importer: 'features/project/Card.tsx', id: '@althar/ui', to: 'seams/cardUi.ts' },
  // The coordinator's conversation: in C, Scratch sits over its composer.
  { importer: 'features/project/ProjectView.tsx', id: '@althar/ui', to: 'seams/projectUi.ts' },
  // A task's thread: Althar's lines carry the direction's blocks, a turn's line where its time went.
  { importer: 'features/task/TaskThread.tsx', id: '@althar/ui', to: 'seams/threadUi.ts' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'calm-parts-seams',
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
  server: { port: 5374, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
