import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * with two seams: the home's import of SettingsPanel, swapped for each
 * direction's settings; and the kit as the window's tabs import it, whose
 * ProjectTabs gets a Settings tab in the third round. Plain JavaScript, so
 * the kit's type check leaves it (and vite-plus's test typings) out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../../..')

const seams = [
  { importer: 'features/home/HomeView.tsx', id: '../settings/SettingsPanel', to: 'seams/SettingsPanel.tsx' },
  { importer: 'features/tabs/TabsFrame.tsx', id: '@althar/ui', to: 'seams/tabsUi.ts' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'settings-room-seams',
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
  server: { port: 5350, strictPort: true, fs: { allow: [repo] } },
})
