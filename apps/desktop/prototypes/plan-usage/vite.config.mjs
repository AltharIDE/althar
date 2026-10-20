import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

/*
 * Scrappy: the real desktop app, on the tests' fake client, in a browser,
 * showing plan usage and steering four ways: ninemate's as built, and A to C.
 * Nothing in the app or the kit changes on disk. Seams swap one import of a
 * real screen for the prototype's, for this server alone:
 *
 * - the window's bar (TabsFrame): its Usage button, and what ⌘U opens;
 * - the Talk room's usage notices (ProjectView);
 * - the board's cards (BoardView) and the Talk room's task cards (Card);
 * - every model picker (ModelChoice);
 * - the home's screen (HomeView) and an agent's accounts (AgentAccounts).
 *
 * Each seam draws the real part, and in a direction that changes it, the
 * direction's part around it. Plain JavaScript, so no type check takes it in.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../../../..')

const seams = [
  { importer: 'features/tabs/TabsFrame.tsx', id: '@althar/ui', to: 'seams/tabsUi.tsx' },
  { importer: 'features/tabs/TabsFrame.tsx', id: '../usage/UsageView', to: 'seams/UsageView.tsx' },
  { importer: 'features/project/ProjectView.tsx', id: '../usage/UsageNotices', to: 'seams/UsageNotices.tsx' },
  { importer: 'features/board/BoardView.tsx', id: '@althar/ui', to: 'seams/boardUi.tsx' },
  { importer: 'features/project/Card.tsx', id: '@althar/ui', to: 'seams/cardUi.tsx' },
  { importer: 'shared/ModelChoice.tsx', id: '@althar/ui', to: 'seams/modelUi.tsx' },
  { importer: 'features/home/HomeView.tsx', id: '@althar/ui/screens', to: 'seams/homeScreens.tsx' },
  { importer: 'features/accounts/AgentAccounts.tsx', id: '@althar/ui', to: 'seams/accountsUi.tsx' },
]

/** @type {import('vite-plus').Plugin} */
const swap = {
  name: 'plan-usage-seams',
  enforce: 'pre',
  resolveId(id, importer) {
    const from = importer?.split('?')[0] ?? ''
    const seam = seams.find((one) => one.id === id && from.endsWith(one.importer))
    return seam === undefined ? null : resolve(here, seam.to)
  },
}

/**
 * Each patch: the file, a line put first, and the text it finds and what it
 * puts in its place. Another agent may be changing these files as this runs:
 * a patch that finds nothing says so in the server's log and leaves the file
 * as it is, rather than stopping the page.
 */
const patches = [
  {
    file: 'apps/desktop/src/renderer/shared/agents.ts',
    first: "import { waits as __waits } from '@proto/fix'",
    edits: [
      [
        'export const waitsWords = (agent: string, at: string, step?: string | null) =>\n  `',
        'export const waitsWords = (agent: string, at: string, step?: string | null) =>\n  __waits(agent, at, step) ?? `',
      ],
    ],
  },
]

/** @type {import('vite-plus').Plugin} */
const patch = {
  name: 'plan-usage-patches',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0]
    const one = patches.find((each) => file === resolve(repo, each.file))
    if (one === undefined) return null
    let out = code
    for (const [find, put] of one.edits) {
      if (!out.includes(find)) {
        console.warn(`plan-usage: ${one.file} no longer has ${JSON.stringify(find.slice(0, 60))}; left as it is`)
        return null
      }
      out = out.replace(find, put)
    }
    return { code: `${one.first}\n${out}`, map: null }
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
  server: { port: 5441, strictPort: true, fs: { allow: [repo] }, watch: { usePolling: true, interval: 1000 } },
})
