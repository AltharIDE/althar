import { join } from 'node:path'

import type { Patch } from '../patching'

/* Lines patched into the task's page (TaskView), each a place where a task of the mission shows it (seams.tsx). */

const here = import.meta.dirname
const taskView = join(here, '../../../src/renderer/features/task/TaskView.tsx')

export const TASK_PATCHES: ReadonlyArray<Patch> = [
  {
    file: taskView,
    from: '',
    to: `import { labFacesOf, labHasRequest, labHeaderOf, labWord, LabBesideTitle, LabRequestFace, LabThreadFoot, LabThreadHead, LabUnderHeader } from '${join(here, 'seams.tsx')}'\n`,
  },
  // A task the runtime holds for others says so in its header, as its row in Up next does.
  {
    file: taskView,
    from: "if (phase === 'drafting' || phase === 'planned' || phase === 'held') return { status, state: text.planning }",
    to: "if (phase === 'drafting' || phase === 'planned' || phase === 'held') return labHeaderOf(snapshot.task.slug) ?? { status, state: text.planning }",
  },
  // Beside the title, in the bar: which mission and which step (A).
  {
    file: taskView,
    from: '                onBack={onBack}\n              />\n            </TitleBar>',
    to: '                onBack={onBack}\n              />\n              <LabBesideTitle slug={snapshot.task.slug} threadId={snapshot.threadId} />\n            </TitleBar>',
  },
  // A line under the header: the mission as a path (D).
  {
    file: taskView,
    from: "          {/* What a review's lead can reach, in a sentence under the header. */}",
    to: "          {!embedded && <LabUnderHeader slug={snapshot.task.slug} />}\n          {/* What a review's lead can reach, in a sentence under the header. */}",
  },
  // The head of the thread, where an issue's card goes, and its foot: what the plan gave the step, and what merging it starts (B).
  {
    file: taskView,
    from: '                {issue !== null && !snapshot.earlier && (',
    to: '                {!embedded && !snapshot.earlier && <LabThreadHead slug={snapshot.task.slug} />}\n                {issue !== null && !snapshot.earlier && (',
  },
  {
    file: taskView,
    from: '                </ThreadShellProvider>\n                {waitingIssues.length > 1 && (',
    to: '                </ThreadShellProvider>\n                {!embedded && <LabThreadFoot slug={snapshot.task.slug} />}\n                {waitingIssues.length > 1 && (',
  },
  // The mission's view beside Conversation and Outputs (r), named as the mission is (C).
  {
    file: taskView,
    from: "faces: { talk: 'Conversation', out: 'Outputs', graph: 'Graph' }",
    to: "faces: { talk: 'Conversation', out: 'Outputs', graph: 'Graph', get request() { return labWord() } }",
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
