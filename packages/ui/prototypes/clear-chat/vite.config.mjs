import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * opened on althar's coordinator beside its board. The seams swap a few
 * imports of the real project screen for this page alone, so each direction
 * clears the conversation its own way without touching the app's code.
 * Plain JavaScript, so the kit's type check leaves it out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const VIEW = 'features/project/ProjectView.tsx'
const seams = [
  // What the thread holds: the conversation as the direction has cleared it, and the coordinator answering on the page.
  { importer: 'features/project/ProjectScreen.tsx', id: './useProject', to: 'seams/useProject.ts' },
  // The kit as the project's screen sees it: its header's ⋯ has the direction's clear, its composer the direction's undo.
  { importer: VIEW, id: '@althar/ui', to: 'seams/projectUi.tsx' },
  // The thread's blocks, split where the conversation was cleared, the direction's divider between.
  { importer: VIEW, id: '../../shared/thread', to: 'seams/thread.ts' },
  { importer: VIEW, id: '../../shared/ThreadBlocks', to: 'seams/ThreadBlocks.tsx' },
  // The project's notes, in its settings: in B, forgetting the conversation is at their foot.
  { importer: 'features/projectSettings/ProjectSettingsPage.tsx', id: './NotesSection', to: 'seams/NotesSection.tsx' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'clear-chat-seams',
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
  server: { port: 5363, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
