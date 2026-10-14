import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser.
 * One seam swaps the thread's ThreadBlocks import, in the coordinator's
 * screen and a task's, for a wrapper that draws every block as the app does
 * and re-places a message's link cards the way the page's direction says.
 * Plain JavaScript, so the desktop's type check (src, tests, e2e, scripts,
 * *.config.ts) leaves it out; the prototype's own tsconfig covers the rest.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const seams = [
  { importer: 'features/project/ProjectView.tsx', id: '../../shared/ThreadBlocks', to: 'seams/ThreadBlocks.tsx' },
  { importer: 'features/task/TaskView.tsx', id: '../../shared/ThreadBlocks', to: 'seams/ThreadBlocks.tsx' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'link-cards-seams',
  enforce: 'pre',
  resolveId(id, importer) {
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
  server: { port: 5377, strictPort: true, fs: { allow: [repo] } },
})
