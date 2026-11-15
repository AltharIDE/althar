import { join } from 'node:path'

import type { Patch } from '../patching'

/* Lines patched into the coordinator's task card (Card), where a task that waits for others says what for. */

const here = import.meta.dirname
const card = join(here, '../../../src/renderer/features/project/Card.tsx')

export const PROJECT_PATCHES: ReadonlyArray<Patch> = [
  { file: card, from: '', to: `import { labQueuedOf } from '${join(here, 'seams.ts')}'\n` },
  // A plan that waits for other tasks says what for where its countdown was, as one waiting for a free agent does.
  {
    file: card,
    from: '    return <PlanCard key={card.plan.id} card={card} plan={card.plan} actions={actions} />',
    to: '    return <PlanCard key={card.plan.id} card={card} plan={card.plan} actions={actions} {...labQueuedOf(card.taskId)} />',
  },
]
