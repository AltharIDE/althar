import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser, with
 * althar's own repository, tracker and notes. The seams swap one import of a
 * real screen for these pages alone, so each direction puts the project's
 * settings where it would, without touching the app's own code. Plain
 * JavaScript, so the kit's type check leaves it out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const seams = [
  // The project's settings, from its front page: the direction's.
  { importer: 'features/project/ProjectView.tsx', id: './ProjectSettings', to: 'seams/ProjectSettings.tsx' },
  // The project's front page: in A to D, with no Settings button, and its Settings over the window when the bar says so.
  { importer: 'features/project/ProjectView.tsx', id: '@althar/ui', to: 'seams/projectUi.ts' },
  // The project's views in the bar: in A to D, Home, Conversation, Board, then Settings.
  { importer: 'features/project/ProjectBar.tsx', id: '@althar/ui', to: 'seams/barUi.ts' },
  // The gear at the bar's end: the app's, kept for the project's rows that open the app's connections.
  { importer: 'features/tabs/TabsFrame.tsx', id: '../settings/QuickSettings', to: 'seams/QuickSettings.tsx' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'project-settings-seams',
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
  server: { port: 5362, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
