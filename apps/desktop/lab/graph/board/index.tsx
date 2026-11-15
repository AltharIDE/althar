import type { ComponentProps } from 'react'

import { BoardView as AppBoardView } from '../../../src/renderer/features/board/BoardView'

/*
 * The board, as the option on show draws it: the app's own BoardView,
 * with the launched request kept in sight while it runs.
 */
export function BoardPart(props: ComponentProps<typeof AppBoardView>) {
  return <AppBoardView {...props} />
}
