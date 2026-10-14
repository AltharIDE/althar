// Scrappy seam: the app's own ThreadBlocks draws every block; a message with links is taken apart and put back the direction's way.
import type { ComponentProps, ReactElement } from 'react'

import type { YouProps } from '@althar/ui'

import { ThreadBlocks as Drawn } from '../../../src/renderer/shared/ThreadBlocks'
import { Linked } from '../directions'
import { useProto } from '../state'

/** What the app draws for a message with links: its You, then a row of LinkView cards (ThreadBlocks.tsx, `case 'you'`). */
type Message = ReactElement<{ children: [ReactElement<YouProps>, ReactElement<{ children: ReadonlyArray<ReactElement> }>] }>

export function ThreadBlocks(props: ComponentProps<typeof Drawn>) {
  const { direction, short } = useProto()
  // Called, not rendered, so its elements can be read: it is the same function the app renders, hooks and all.
  const drawn = Drawn(props) as ReadonlyArray<ReactElement>
  return drawn.map((element, at) => {
    const block = props.blocks[at]
    if (direction === 'T' || block?.kind !== 'you' || block.links.length === 0) return element
    const [you, row] = (element as Message).props.children
    return <Linked key={block.id} direction={direction} short={short} block={block} you={you} cards={row.props.children} />
  })
}
