import { TaskFace as RealFace, TaskHeader as RealHeader, TaskStatus } from '@althar/ui'
import type { ComponentProps } from 'react'

import { MAYA_TITLE, whoIsHere } from '../data'
import { useLab } from '../state'
import { Guardrail, HandOff, SendToAna, WithAna } from './team'

/*
 * A task's header and face. Maya's own task, as she sees it: one way on,
 * Send to Ana, in place of Ship, merge and pull requests (B); once sent,
 * where it is over her composer; and in D, the guardrail she meets.
 */
export function TaskHeader<F extends string>(props: ComponentProps<typeof RealHeader<F>>) {
  const { d, m } = useLab()
  if (props.title !== MAYA_TITLE) return <RealHeader {...props} />
  // Ana, on Maya's change: it is Maya's ask of Ana, not Ana's own work to accept.
  if (whoIsHere() === 'ana')
    return <RealHeader {...props} {...(m === 2 ? { state: 'Merged', status: TaskStatus.Done } : { state: 'Maya asks you' })} />
  const sent = d === 'b' && m === 2
  return (
    <>
      <RealHeader
        {...props}
        {...(sent ? { state: 'With Ana', status: TaskStatus.Paused } : { state: 'Ready to send' })}
        actions={sent ? null : <SendToAna />}
        parts={null}
      />
      {d === 'b' && m === 1 && <HandOff />}
    </>
  )
}

export function TaskFace(props: ComponentProps<typeof RealFace>) {
  const { d, m } = useLab()
  if (whoIsHere() !== 'maya') return <RealFace {...props} />
  if (d === 'b' && m === 2)
    return (
      <RealFace
        {...props}
        composer={
          <>
            <WithAna />
            {props.composer}
          </>
        }
      />
    )
  if (d === 'd' && m === 1) return <RealFace {...props} composer={<Guardrail composer={props.composer} />} />
  return <RealFace {...props} />
}
