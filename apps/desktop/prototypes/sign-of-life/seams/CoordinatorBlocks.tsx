// Scrappy: the coordinator's thread as ProjectView draws it, then the direction's sign of life where the reply will start.
import type { ComponentProps } from 'react'

import { ThreadBlocks as Drawn } from '../../../src/renderer/shared/ThreadBlocks'
import { SignOfLife } from '../life/Life'
import { useProto } from '../store'
import { adjust } from './adjust'

export * from '../../../src/renderer/shared/ThreadBlocks'

export function ThreadBlocks(props: ComponentProps<typeof Drawn>) {
  const st = useProto()
  return (
    <>
      <Drawn {...props} blocks={adjust(props.blocks, st, 'coordinator')} />
      <SignOfLife screen="coordinator" />
    </>
  )
}
