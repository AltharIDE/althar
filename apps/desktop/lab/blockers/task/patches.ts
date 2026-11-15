import { join } from 'node:path'

import type { Patch } from '../patching'

/* Lines patched into the task's page (TaskView), each where it says what the task waits for (seams.tsx). */

const here = import.meta.dirname
const taskView = join(here, '../../../src/renderer/features/task/TaskView.tsx')

export const TASK_PATCHES: ReadonlyArray<Patch> = [
  { file: taskView, from: '', to: `import { labHeaderOf, LabUnderHeader } from '${join(here, 'seams.tsx')}'\n` },
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
]
