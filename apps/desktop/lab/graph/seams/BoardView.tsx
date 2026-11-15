import type { ComponentProps } from 'react'

import { BoardView as AppBoardView } from '../../../src/renderer/features/board/BoardView'
import { BoardPart } from '../board'
import { PlanBeside, useBesideTalk } from '../chat'

export * from '../../../src/renderer/features/board/BoardView'

/*
 * The project's board draws through here: while a plan is talked over beside
 * the conversation (chat D), the plan in its place; otherwise the board as
 * the board option on show draws it.
 */
export function BoardView(props: ComponentProps<typeof AppBoardView>) {
  if (useBesideTalk()) return <PlanBeside />
  return <BoardPart {...props} />
}
