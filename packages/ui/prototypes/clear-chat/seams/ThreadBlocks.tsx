// Scrappy: the thread's blocks as the app draws them, the direction's divider where the conversation was cleared.
import type { ComponentProps } from 'react'

import { ThreadBlocks as RealThreadBlocks } from '../../../../../apps/desktop/src/renderer/shared/ThreadBlocks'
import { Divider } from '../directions/Divider'
import { useProto } from '../state'
import { splits } from './thread'

export * from '../../../../../apps/desktop/src/renderer/shared/ThreadBlocks'

export function ThreadBlocks(props: ComponentProps<typeof RealThreadBlocks>) {
  const p = useProto()
  const at = splits.get(props.blocks)
  if (at === undefined) return <RealThreadBlocks {...props} />
  return (
    <>
      {at > 0 && <RealThreadBlocks {...props} blocks={props.blocks.slice(0, at)} />}
      <Divider direction={p.direction} talk={p.talks[p.direction]} />
      <RealThreadBlocks {...props} blocks={props.blocks.slice(at)} />
    </>
  )
}
