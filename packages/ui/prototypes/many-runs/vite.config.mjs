import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser.
 * The seams swap one import of a real screen for these pages alone, so each
 * direction puts its many runnables where the one Run button was, without
 * touching the app's own code. Plain JavaScript, so the kit's type check
 * leaves it (and vite-plus's test typings) out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const seams = [
  // The project's front page: its Run button is the direction's.
  { importer: 'features/project/ProjectView.tsx', id: '@althar/ui', to: 'seams/projectUi.ts' },
  // A task's bar: its menu's Run item is the direction's, beside the menu.
  { importer: 'features/task/TaskView.tsx', id: '@althar/ui', to: 'seams/taskUi.ts' },
  // The project's settings: in D, what it runs is one of their modules.
  { importer: 'features/project/ProjectSettings.tsx', id: '@althar/ui', to: 'seams/settingsUi.ts' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'many-runs-seams',
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
  server: { port: 5356, strictPort: true, fs: { allow: [repo] } },
})
