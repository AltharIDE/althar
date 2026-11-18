import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The whole-team lab: the whole desktop app (its router, tabs and screens)
 * on made-up data with no runtime, for a team of four on one repository,
 * with five explorations of Althar as the whole team's IDE swapped in by a
 * few import seams (lab/whole-team/README.md). Everything else is the app's
 * own.
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const at = (path: string) => join(renderer, path)
const lab = (path: string) => join(here, 'seams', path)

/** Which import, from which of the app's files, is the lab's. */
const SEAMS: ReadonlyArray<{ readonly importer: string; readonly source: string; readonly to: string }> = [
  // The page beside a conversation: the running app, pointed at for comments.
  { importer: at('shared/ThreadHost.tsx'), source: '../features/browser/PageView', to: lab('PageView.tsx') },
  // The project's settings: People and rules, in D.
  { importer: at('features/projectSettings/ProjectSettingsPage.tsx'), source: './sections', to: lab('settingsSections.ts') },
  { importer: at('features/projectSettings/ProjectSettingsPage.tsx'), source: '../rules/RulesSection', to: lab('RulesSection.tsx') },
  // The project's row: the team, in E.
  { importer: at('features/project/ProjectView.tsx'), source: '@althar/ui', to: lab('projectUi.ts') },
  // A task's outputs: the evidence an approver reads, in C.
  { importer: at('features/task/TaskView.tsx'), source: './Outputs', to: lab('Outputs.tsx') },
  // A task's header and its conversation's foot: the hand-off and the guardrail.
  { importer: at('features/task/TaskView.tsx'), source: '@althar/ui', to: lab('taskUi.ts') },
  // A board card and a row up next: whose work it is.
  { importer: at('features/board/BoardView.tsx'), source: '@althar/ui', to: lab('cardUi.ts') },
]

const seam = (): Plugin => ({
  name: 'whole-team-lab:seam',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer === undefined) return null
    const from = importer.split('?')[0] ?? ''
    return SEAMS.find((one) => one.importer === from && one.source === source)?.to ?? null
  },
})

export default defineConfig({
  root: here,
  plugins: [seam(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6181, strictPort: true },
})
