import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser.
 * The seams swap one import of a real screen for these pages alone, so each
 * direction moves the two settings without touching the app's own code.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../../..')

const seams: ReadonlyArray<{ importer: string; id: string; to: string }> = [
  // Where a project's settings open from: the bar, the one panel, a view of their own, or a button of their own.
  { importer: 'features/project/ProjectSettings.tsx', id: '@althar/ui', to: 'seams/projectUi.ts' },
  // The app's settings: a scope switch on top (B), or an app menu in front of them (D).
  { importer: 'features/settings/SettingsPanel.tsx', id: '@althar/ui', to: 'seams/settingsUi.ts' },
  // The project's views, with Settings as one of them (C).
  { importer: 'features/project/ProjectView.tsx', id: './ProjectBar', to: 'seams/ProjectBar.tsx' },
]

const swap: Plugin = {
  name: 'settings-at-hand-seams',
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
  server: { port: 5340, strictPort: true, fs: { allow: [repo] } },
})
