import { join } from 'node:path'

import type { Patch } from '../patching'

/* Lines patched into the board (BoardView), each where it shows the request. */

const here = import.meta.dirname
const boardView = join(here, '../../../src/renderer/features/board/BoardView.tsx')

export const BOARD_PATCHES: ReadonlyArray<Patch> = [
  // Up next says what a task waits for, as the runtime will once tasks depend on each other (DEV-228).
  { file: boardView, from: '', to: `import { labReasonOf, labWaitOf } from '${join(here, 'upNext.ts')}'\n` },
  {
    file: boardView,
    from: 'wait={waits || pausedRow || startsAt !== null ? Wait.Workers : Wait.You}\n        reason={reason}',
    to: 'wait={labWaitOf(work) ?? (waits || pausedRow || startsAt !== null ? Wait.Workers : Wait.You)}\n        reason={labReasonOf(work) ?? reason}',
  },
]
