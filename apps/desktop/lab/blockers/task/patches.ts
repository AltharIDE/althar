import { join } from 'node:path'

import type { Patch } from '../patching'

/* Lines patched into the task's page (TaskView), each where it says what the task waits for (seams.tsx). */

const here = import.meta.dirname
const taskView = join(here, '../../../src/renderer/features/task/TaskView.tsx')

export const TASK_PATCHES: ReadonlyArray<Patch> = [
  {
    file: taskView,
    from: '',
    to: `import { LabBehind, labBesideOf, labHeaderOf, labStateOf, LabThreadEnd, LabUnderHeader } from '${join(here, 'seams.tsx')}'\n`,
  },
  // A task waiting for others says so in its header, as its row in Up next does.
  {
    file: taskView,
    from: "if (phase === 'drafting' || phase === 'planned' || phase === 'held') return { status, state: text.planning }",
    to: "if (phase === 'drafting' || phase === 'planned' || phase === 'held') return labHeaderOf(snapshot.task.slug) ?? { status, state: text.planning }",
  },
  // A line under the header: what it waits for (A), or what it comes after and what after it (B).
  {
    file: taskView,
    from: "          {/* What a review's lead can reach, in a sentence under the header. */}",
    to: "          {!embedded && <LabUnderHeader slug={snapshot.task.slug} />}\n          {/* What a review's lead can reach, in a sentence under the header. */}",
  },
  // A: what it waits for, a chip on the composer's edge beside the kit's own.
  {
    file: taskView,
    from: '            {aside?.bar}\n            <Behind\n',
    to: '            {aside?.bar}\n            <LabBehind slug={snapshot.task.slug} />\n            <Behind\n',
  },
  // D: the header's words open what it waits for; on a task others wait for, a part after them says who.
  { file: taskView, from: '                  state={state}\n', to: '                  state={labStateOf(snapshot.task.slug, state)}\n' },
  {
    file: taskView,
    from: '{...(settle === null ? {} : { beside: settle })}',
    to: '{...(settle === null ? labBesideOf(snapshot.task.slug) : { beside: settle })}',
  },
  // B and C: the end of the thread, where its lead's first words will land: what it still waits for (B), or its plan (C).
  {
    file: taskView,
    from: '                  </ThreadWaysContext.Provider>\n                </ThreadShellProvider>\n',
    to: '                  </ThreadWaysContext.Provider>\n                </ThreadShellProvider>\n                {!embedded && <LabThreadEnd slug={snapshot.task.slug} agents={model.agents} />}\n',
  },
]
