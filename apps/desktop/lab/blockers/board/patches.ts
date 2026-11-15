import { join } from 'node:path'

import type { Patch } from '../patching'

/* Lines patched into the board (BoardView), each where a direction draws a waiting task (seam.tsx). */

const here = import.meta.dirname
const boardView = join(here, '../../../src/renderer/features/board/BoardView.tsx')

export const BOARD_PATCHES: ReadonlyArray<Patch> = [
  {
    file: boardView,
    from: '',
    to: `import { BoardCard, NextRow, labAsks, labPlanRows, labReasonOf, labUpNext, labWaitOf, LabWaiting, LabYours } from '${join(here, 'seam.tsx')}'\n`,
  },
  // Every card and Up next row draws through the lab's.
  { file: boardView, from: '  BoardCard,\n  boardCardText,', to: '  boardCardText,' },
  { file: boardView, from: '  NextLine,\n  NextRow,\n', to: '  NextLine,\n' },
  // A row says what it waits for, with the kit's own glyph for after another task.
  {
    file: boardView,
    from: 'wait={waits || pausedRow || startsAt !== null ? Wait.Workers : Wait.You}\n        reason={reason}',
    to: 'wait={labWaitOf(work) ?? (waits || pausedRow || startsAt !== null ? Wait.Workers : Wait.You)}\n        reason={labReasonOf(work) ?? reason}',
  },
  // A and B take what waits for other tasks out of the line: A lists it under its own heading, B under its blockers' cards.
  {
    file: boardView,
    from: 'const planRows = shown.next.slice(continuing + free, shown.next.length - paused)',
    to: 'const planRows = labPlanRows(shown.next.slice(continuing + free, shown.next.length - paused))',
  },
  { file: boardView, from: 'count={shown.upNext}', to: 'count={labUpNext(shown.upNext, shown.next)}' },
  {
    file: boardView,
    from: '        {[halted, forLocal].map(',
    to: '        <LabWaiting rows={shown.next.slice(continuing + free, shown.next.length - paused)} render={(work) => nextRow(work, shown.next.indexOf(work))} />\n        {[halted, forLocal].map(',
  },
  // Needs you starts with the asks about abandoned blockers (A, B), and counts them.
  {
    file: boardView,
    from: '<BoardColumn lane={BoardLane.Yours} count={yoursOf(lanes)}>',
    to: '<BoardColumn lane={BoardLane.Yours} count={yoursOf(lanes) + labAsks()} filled={yoursOf(lanes) + labAsks() > 0}>\n        <LabYours />',
  },
]
