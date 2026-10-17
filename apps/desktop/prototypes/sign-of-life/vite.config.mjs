import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * showing what it shows between sending a message and the first word back,
 * today's way and five others. Nothing in the app or the kit changes on
 * disk. Seams swap one import of a real screen for the prototype's, for this
 * server alone:
 *
 * - the coordinator's thread (ProjectView's ThreadBlocks) and a task's
 *   (TaskView's TaskThread) draw as they do, then the direction's sign of
 *   life where the reply will start;
 * - what every thread takes from the kit (ThreadBlocks' You), so B can say
 *   under your message where it stands.
 *
 * Plain JavaScript, so no type check takes it in.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const seams = [
  { importer: 'features/project/ProjectView.tsx', id: '../../shared/ThreadBlocks', to: 'seams/CoordinatorBlocks.tsx' },
  { importer: 'features/task/TaskView.tsx', id: './TaskThread', to: 'seams/TaskThread.tsx' },
  { importer: 'shared/ThreadBlocks.tsx', id: '@althar/ui', to: 'seams/blocksUi.tsx' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'sign-of-life-seams',
  enforce: 'pre',
  resolveId(id, importer) {
    const from = importer?.split('?')[0] ?? ''
    const seam = seams.find((one) => one.id === id && from.endsWith(one.importer))
    return seam === undefined ? null : resolve(here, seam.to)
  },
}

/**
 * Each patch: the file, and the text it finds and what it puts in its place. A patch that finds nothing stops the page.
 * Today the last turn counts as the running one, even with the person's message after it, so in the gap the previous
 * reply shows as at work again; every direction counts only a turn after the person's last message (fix.ts).
 */
const patches = [
  {
    file: 'apps/desktop/src/renderer/shared/thread.ts',
    edits: [
      ["import { took } from './time'", "import { took } from './time'\nimport { liveTurn as __liveTurn } from '@proto/fix'"],
      [
        "const live = turnRunning ? merged.findLastIndex((block) => block.kind === 'turn') : -1",
        'const live = turnRunning ? __liveTurn(merged) : -1',
      ],
    ],
  },
  {
    file: 'apps/desktop/src/renderer/shared/rounds.ts',
    edits: [
      ["import { took } from './time'", "import { took } from './time'\nimport { liveTurn as __liveTurn } from '@proto/fix'"],
      ["const lastTurn = blocks.findLastIndex((block) => block.kind === 'turn')", 'const lastTurn = __liveTurn(blocks)'],
    ],
  },
]

/** @type {import('vite-plus').Plugin} */
const patch = {
  name: 'sign-of-life-patches',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0]
    const one = patches.find((each) => file === resolve(repo, each.file))
    if (one === undefined) return null
    let out = code
    for (const [find, put] of one.edits) {
      if (!out.includes(find)) throw new Error(`sign-of-life: ${one.file} no longer has ${JSON.stringify(find.slice(0, 60))}`)
      out = out.replace(find, put)
    }
    return { code: out, map: null }
  },
}

export default defineConfig({
  root: here,
  plugins: [swap, patch, react()],
  resolve: {
    alias: [
      { find: /^vitest$/, replacement: resolve(here, 'vi.ts') },
      { find: /^@proto\/(.*)$/, replacement: `${here}/$1` },
    ],
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // Inside the agent's sandbox Vite doesn't hear edits; polling it does.
  server: { port: 5397, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
