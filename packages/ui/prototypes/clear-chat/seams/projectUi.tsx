// Scrappy: the kit as the project's screen sees it here, with the clear put where each direction says.
import type { ComponentProps } from 'react'
import { useState } from 'react'

import { Composer as RealComposer } from '../../../src/composer/Composer/Composer'
import { ContextRing as RealContextRing } from '../../../src/composer/ContextRing/ContextRing'
import { TaskFace as RealTaskFace } from '../../../src/thread/TaskFace/TaskFace'
import { ClearDialog, ComposerClear, RingClear } from '../directions/Clear'
import { ConversationHead } from '../directions/ThreadHead'
import { hasConversation, useProto } from '../state'
import s from '../directions/directions.module.css'

export * from '../../../src/index'

/** A: the control in the composer's row, and /clear in the field, both opening the one question. */
export function Composer(props: ComponentProps<typeof RealComposer>) {
  const p = useProto()
  const [asking, setAsking] = useState(false)
  if (p.direction !== 'A') return <RealComposer {...props} />
  const slash = (text: string) => text.trim() === '/clear'
  return (
    <>
      <RealComposer
        {...props}
        picker={
          <>
            {props.picker}
            <ComposerClear onAsk={() => setAsking(true)} />
          </>
        }
        onSubmit={(text) => {
          if (slash(text)) {
            props.onChange('')
            if (hasConversation(p.talks.A)) setAsking(true)
            return
          }
          props.onSubmit(text)
        }}
        {...(props.onSendNow === undefined
          ? {}
          : {
              onSendNow: (text: string) => {
                if (slash(text)) {
                  props.onChange('')
                  if (hasConversation(p.talks.A)) setAsking(true)
                  return
                }
                props.onSendNow?.(text)
              },
            })}
      />
      {asking && <ClearDialog talk={p.talks.A} onClose={() => setAsking(false)} />}
    </>
  )
}

/** B: the conversation's bar above the thread, with Clear in it. */
export function TaskFace(props: ComponentProps<typeof RealTaskFace>) {
  const p = useProto()
  if (p.direction !== 'B') return <RealTaskFace {...props} />
  return (
    <div className={s.faceColumn}>
      <ConversationHead />
      <RealTaskFace {...props} />
    </div>
  )
}

/** C: Clear in the context ring's detail, under the numbers and beside Compact. */
export function ContextRing(props: ComponentProps<typeof RealContextRing>) {
  const p = useProto()
  if (p.direction !== 'C') return <RealContextRing {...props} />
  return (
    <RealContextRing
      {...props}
      note={
        <>
          {props.note}
          <RingClear />
        </>
      }
    />
  )
}
