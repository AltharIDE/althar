import { join } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite-plus'

/*
 * The graph lab: the whole desktop app (its router, tabs and screens) on a
 * made-up runtime where one request plays out as the tasks it became, with
 * the graph of them drawn into the app's own screens by a few seams, each
 * a single import or line, so every direction runs over the real thing
 * (lab/graph/README.md).
 */

const here = import.meta.dirname
const renderer = join(here, '../../src/renderer')
const projectView = join(renderer, 'features/project/ProjectView.tsx')
const boardView = join(renderer, 'features/board/BoardView.tsx')
const taskView = join(renderer, 'features/task/TaskView.tsx')

/** Imports swapped for the lab's, each in the one file that imports it. */
const swaps: ReadonlyArray<{ readonly importer: string; readonly source: string; readonly to: string }> = [
  // The coordinator's thread draws a task's card through the lab's, which draws the request's graph in A.
  { importer: projectView, source: './Card', to: join(here, 'seams/Card.tsx') },
  // The board, with a request's band over it in B, and laid out as a graph in D.
  { importer: projectView, source: '../board/BoardView', to: join(here, 'seams/BoardView.tsx') },
]

/** Lines patched in the app's own files, each where the graph needs a word or a place; `from` empty puts `to` at the top. */
const patches: ReadonlyArray<{ readonly file: string; readonly from: string; readonly to: string }> = [
  // Up next says what a task waits for, as the runtime will once tasks depend on each other (DEV-228).
  { file: boardView, from: '', to: `import { labReasonOf, labWaitOf } from '${join(here, 'seams/board.ts')}'\n` },
  {
    file: boardView,
    from: 'wait={waits || pausedRow || startsAt !== null ? Wait.Workers : Wait.You}\n        reason={reason}',
    to: 'wait={labWaitOf(work) ?? (waits || pausedRow || startsAt !== null ? Wait.Workers : Wait.You)}\n        reason={labReasonOf(work) ?? reason}',
  },
  // C: a task of the request has a Request view beside Conversation and Outputs.
  {
    file: taskView,
    from: '',
    to: `import { labFacesOf, labHasRequest, labHeaderOf, LabRequestFace } from '${join(here, 'seams/task.tsx')}'\n`,
  },
  // A task the runtime holds for others says so in its header, as its row in Up next does.
  {
    file: taskView,
    from: "if (phase === 'drafting' || phase === 'planned' || phase === 'held') return { status, state: text.planning }",
    to: "if (phase === 'drafting' || phase === 'planned' || phase === 'held') return labHeaderOf(snapshot.task.slug) ?? { status, state: text.planning }",
  },
  {
    file: taskView,
    from: "faces: { talk: 'Conversation', out: 'Outputs', graph: 'Graph' }",
    to: "faces: { talk: 'Conversation', out: 'Outputs', graph: 'Graph', request: 'Request' }",
  },
  {
    file: taskView,
    from: "facesKbd: { talk: 'c', out: 'o', graph: 'g' }",
    to: "facesKbd: { talk: 'c', out: 'o', graph: 'g', request: 'r' }",
  },
  {
    file: taskView,
    from: "faces={(graph === null ? (['talk', 'out'] as const) : (['talk', 'out', 'graph'] as const)).map(",
    to: "faces={labFacesOf(snapshot.task.slug, graph === null ? (['talk', 'out'] as const) : (['talk', 'out', 'graph'] as const)).map(",
  },
  {
    file: taskView,
    from: "{!embedded && shown === 'graph' && graph !== null ? (",
    to: "{!embedded && shown === 'request' && labHasRequest(snapshot.task.slug) ? (<LabRequestFace slug={snapshot.task.slug} />) : !embedded && shown === 'graph' && graph !== null ? (",
  },
  {
    file: taskView,
    from: "else if (event.key === text.facesKbd.graph && hasGraph) setFace('graph')",
    to: "else if (event.key === text.facesKbd.graph && hasGraph) setFace('graph')\n      else if (event.key === 'r' && labHasRequest(model.snapshot?.task.slug)) setFace('request')",
  },
]

const seams = (): Plugin => ({
  name: 'graph-lab:seams',
  enforce: 'pre',
  resolveId(source, importer) {
    const from = importer?.split('?')[0]
    const swap = swaps.find((one) => one.importer === from && one.source === source)
    return swap === undefined ? null : swap.to
  },
  transform(code, id) {
    const file = id.split('?')[0]
    const mine = patches.filter((one) => one.file === file)
    if (mine.length === 0) return null
    let out = code
    for (const one of mine) {
      if (one.from === '') {
        out = one.to + out
        continue
      }
      if (!out.includes(one.from)) throw new Error(`graph-lab: ${file} no longer has ${one.from}`)
      out = out.replace(one.from, one.to)
    }
    return { code: out, map: null }
  },
})

export default defineConfig({
  root: here,
  plugins: [seams(), react()],
  css: { modules: { localsConvention: 'camelCaseOnly', generateScopedName: '[name]__[local]__[hash:base64:4]' } },
  // The fixtures the tests share make their client with Vitest's spies; on a page, a spy is the function it wraps.
  resolve: { alias: { vitest: join(here, 'vitest.ts'), '@althar/testing': join(here, 'testing.ts') } },
  server: { port: 6171, strictPort: true },
})
