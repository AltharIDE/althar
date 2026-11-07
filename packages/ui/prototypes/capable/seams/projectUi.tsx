// Scrappy: the kit as the project's screen sees it here: in situations, with the coordinator off, its Conversation says what the composer does now.
import type { ComponentProps } from 'react'

import { Composer as RealComposer } from '../../../src/composer/Composer/Composer'
import { Thread as RealThread } from '../../../src/thread/Thread/Thread'
import { CoordinatorOff } from '../directions/situations/Situations'
import { useProto } from '../state'

export * from '../../../src/index'

const off = (p: ReturnType<typeof useProto>) => p.surface === 'situations' && p.coordinatorOff

export function Thread(props: ComponentProps<typeof RealThread>) {
  const p = useProto()
  if (!off(p)) return <RealThread {...props} />
  return (
    <RealThread {...props}>
      <CoordinatorOff />
    </RealThread>
  )
}

export function Composer(props: ComponentProps<typeof RealComposer>) {
  const p = useProto()
  return <RealComposer {...props} {...(off(p) ? { placeholder: 'Describe a task' } : {})} />
}
