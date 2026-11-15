import type { ComponentProps } from 'react'

import { BoardView as AppBoardView } from '../../../src/renderer/features/board/BoardView'
import { Band } from '../directions/OverBoard'
import b from '../directions/OverBoard.module.css'
import { Threads } from '../directions/Threads'
import { direction, useStore } from '../state'

export * from '../../../src/renderer/features/board/BoardView'

/*
 * The project's board draws through here: in B with the request's band
 * over its lanes, in D with the request's lines drawn between its cards,
 * and as it is everywhere else.
 */
export function BoardView(props: ComponentProps<typeof AppBoardView>) {
  const picked = useStore(direction)
  if (picked === 'b')
    return (
      <div className={b.withBand}>
        <Band />
        <AppBoardView {...props} />
      </div>
    )
  if (picked === 'd')
    return (
      <Threads>
        <AppBoardView {...props} />
      </Threads>
    )
  return <AppBoardView {...props} />
}
