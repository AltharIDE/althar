import { join } from 'node:path'

import type { Patch } from '../patching'

/* Lines patched into the board (BoardView), each where it shows the mission. */

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

  // Every card and Up next row draws through the lab's (seam.tsx), which marks a task of the mission as its (A, C, D).
  { file: boardView, from: '', to: `import { BoardCard, NextRow, LaneLead, laneOf, labUpNextEmpty } from '${join(here, 'seam.tsx')}'\n` },
  { file: boardView, from: '  BoardCard,\n  boardCardText,', to: '  boardCardText,' },
  { file: boardView, from: '  NextLine,\n  NextRow,\n', to: '  NextLine,\n' },

  // Each lane starts with what the option puts at its head (A's card for the mission, B's row), and counts it.
  {
    file: boardView,
    from: 'count={shown.upNext}\n        filled={shown.next.length > 0 || lanes.stopped.length > 0}',
    to: '{...laneOf(BoardLane.Next, shown.upNext, shown.next.length > 0 || lanes.stopped.length > 0)}',
  },
  // Up next with nothing left in it but what an option folded away says where that went, rather than that nothing is queued.
  {
    file: boardView,
    from: 'title={text.upNextEmpty.title}',
    to: 'title={labUpNextEmpty()?.title ?? text.upNextEmpty.title}',
  },
  { file: boardView, from: '{text.upNextEmpty.how}', to: '{labUpNextEmpty()?.how ?? text.upNextEmpty.how}' },
  {
    file: boardView,
    from: '        {line?.failed != null && <Problem',
    to: '        <LaneLead lane={BoardLane.Next} />\n        {line?.failed != null && <Problem',
  },
  {
    file: boardView,
    from: '<BoardColumn lane={BoardLane.Running} count={shown.atWork} filled={shown.running.length > 0}>',
    to: '<BoardColumn lane={BoardLane.Running} {...laneOf(BoardLane.Running, shown.atWork, shown.running.length > 0)}>\n        <LaneLead lane={BoardLane.Running} />',
  },
  {
    file: boardView,
    from: '<BoardColumn lane={BoardLane.Yours} count={yoursOf(lanes)}>',
    to: '<BoardColumn lane={BoardLane.Yours} {...laneOf(BoardLane.Yours, yoursOf(lanes), yoursOf(lanes) > 0)}>\n        <LaneLead lane={BoardLane.Yours} />',
  },
  {
    file: boardView,
    from: 'count={lanes.settledTotal}\n        filled={lanes.settledTotal > 0 || lanes.kept.length > 0}',
    to: '{...laneOf(BoardLane.Settled, lanes.settledTotal, lanes.settledTotal > 0 || lanes.kept.length > 0)}',
  },
  {
    file: boardView,
    from: "        {shelf === 'kept' && lanes.kept.length > 0 ? (",
    to: "        <LaneLead lane={BoardLane.Settled} />\n        {shelf === 'kept' && lanes.kept.length > 0 ? (",
  },
]
