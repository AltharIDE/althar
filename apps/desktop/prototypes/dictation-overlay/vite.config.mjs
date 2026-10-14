import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Throwaway: dictation that follows you across screens, on the real desktop
 * app in a browser, on the tests' fake client. The seams swap one import of
 * a real screen for this page alone: the screens' dictation reads a fake
 * stream kept by thread (as "Keep composer text and dictation when
 * navigating away" keeps it), the composer says when it is on screen, and
 * the tabs bar can carry a tab's dictation. Plain JavaScript, so no type
 * check takes it in. Never built.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')
const renderer = resolve(repo, 'apps/desktop/src/renderer')

const seams = [
  // The screens' dictation: kept by thread, outliving the screen, fed by the fake stream.
  { importer: 'features/project/ProjectView.tsx', id: '../../shared/dictation/useDictation', to: 'seams/useDictationCoordinator.ts' },
  { importer: 'features/task/TaskView.tsx', id: '../../shared/dictation/useDictation', to: 'seams/useDictationTask.ts' },
  // The composer, which says when it is on screen, and what idea E writes over it.
  { importer: 'features/project/ProjectView.tsx', id: '@althar/ui', to: 'seams/viewUi.tsx' },
  { importer: 'features/task/TaskView.tsx', id: '@althar/ui', to: 'seams/viewUi.tsx' },
  // The tabs bar, where idea D puts the dictation.
  { importer: 'features/tabs/TabsFrame.tsx', id: '@althar/ui', to: 'seams/tabsUi.tsx' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'dictation-seams',
  enforce: 'pre',
  resolveId(id, importer) {
    const from = importer?.split('?')[0] ?? ''
    // Only the app's own files are swapped; a seam reaches the real module it stands in for.
    if (!from.startsWith(renderer)) return null
    const seam = seams.find((one) => one.id === id && from.endsWith(one.importer))
    return seam === undefined ? null : resolve(here, seam.to)
  },
}

export default defineConfig({
  root: here,
  plugins: [swap, react()],
  resolve: {
    // The app's own test fixtures make the fake runtime; their vi.fn is a plain function here.
    alias: [{ find: /^vitest$/, replacement: resolve(here, 'vi.ts') }],
    dedupe: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
  },
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  server: { port: 5397, strictPort: true, fs: { allow: [repo] } },
})
