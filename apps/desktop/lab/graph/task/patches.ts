import { join } from 'node:path'

import type { Patch } from '../patching'

/* Lines patched into the task's page (TaskView), each where a task of the request shows it. */

const here = import.meta.dirname
const taskView = join(here, '../../../src/renderer/features/task/TaskView.tsx')

export const TASK_PATCHES: ReadonlyArray<Patch> = [
  {
    file: taskView,
    from: '',
    to: `import { labFacesOf, labHasRequest, labHeaderOf, LabRequestFace } from '${join(here, 'seams.tsx')}'\n`,
  },
  // A task the runtime holds for others says so in its header, as its row in Up next does.
  {
    file: taskView,
    from: "if (phase === 'drafting' || phase === 'planned' || phase === 'held') return { status, state: text.planning }",
    to: "if (phase === 'drafting' || phase === 'planned' || phase === 'held') return labHeaderOf(snapshot.task.slug) ?? { status, state: text.planning }",
  },
  // The Request view beside Conversation and Outputs (r).
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
