import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * as althar stands on 6 November. The seams swap a few imports of the real
 * screens for this page alone, so each direction draws them its own way
 * without touching the app's code. Plain JavaScript, so the kit's type
 * check leaves it out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const PROJECT = 'features/project/ProjectView.tsx'
const BOARD = 'features/board/BoardView.tsx'
const TASK = 'features/task/TaskView.tsx'
const seams = [
  // The project's header (New task) and its composer (B starts a task from it).
  { importer: PROJECT, id: '@althar/ui', to: 'seams/projectUi.tsx' },
  // What the conversation holds: in B, what was started from the composer.
  { importer: 'features/project/ProjectScreen.tsx', id: './useProject', to: 'seams/useProject.ts' },
  // The board's lanes and cards: C's card at the top of Running, a lead-started task's lineage.
  { importer: BOARD, id: '@althar/ui', to: 'seams/boardUi.tsx' },
  // The task's thread: each direction's pieces where its data marks them.
  { importer: TASK, id: './TaskThread', to: 'seams/TaskThread.tsx' },
  // What still asks, in a task: each direction's card.
  { importer: TASK, id: './PermissionCall', to: 'seams/PermissionCall.tsx' },
  // The project's Rules: A's list of what asks, B's shorter charter.
  { importer: 'features/rules/RulesSection.tsx', id: '@althar/ui/screens', to: 'seams/rulesScreens.tsx' },
  { importer: 'features/rules/RulesSection.tsx', id: '@althar/ui', to: 'seams/rulesUi.tsx' },
  // Althar's Settings: the Skills section as MCP servers and skills.
  { importer: 'features/settings/SettingsPage.tsx', id: '@althar/ui', to: 'seams/settingsUi.tsx' },
  // A thread's tool rows: an MCP call says its server.
  { importer: 'shared/ThreadBlocks.tsx', id: '@althar/ui', to: 'seams/threadUi.tsx' },
  // The task's header: in the sketches, its parts.
  { importer: TASK, id: '@althar/ui', to: 'seams/taskUi.tsx' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'capable-seams',
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
  server: { port: 5367, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
