// Scrappy: the kit as every thread's blocks see it, with B's receipt under the message just sent, where its time goes: Sending, Sent, Opus has it, Thinking · 4s.
import { LiveDot, You as KitYou, type YouProps } from '@althar/ui'

import { Failed, Slow, useLead, words } from '../life/Life'
import s from '../life/life.module.css'
import { useElapsed, useProto } from '../store'
import { AT, seconds } from '../timeline'
import { RECEIPT } from './adjust'

export * from '@althar/ui'

function Receipt() {
  const st = useProto()
  const t = useElapsed()
  const model = useLead()
  const gap = st.gap
  if (gap === null) return null
  if (gap.phase === 'failed') return <Failed screen={gap.screen} text={gap.text} />
  if (gap.phase === 'stopped') return <span className={s.receipt}>{words.stopped}</span>
  // Each step says what is true now: the window has it, the runtime has it, the agent has it, and for how long.
  const now =
    t < AT.stored ? (
      <span key="sending" className={s.step}>
        {words.sending}
      </span>
    ) : t < AT.handed ? (
      <span key="sent" className={s.step}>
        {words.sent}
      </span>
    ) : t < AT.count ? (
      <span key="has" className={`${s.step} ${s.in}`}>
        <LiveDot pulse />
        <span className="lead">{words.has(model.short)}</span>
      </span>
    ) : (
      <span key="thinking" className={`${s.step} ${s.in}`}>
        <LiveDot pulse />
        <span className="lead">{words.thinkingFor(seconds(t))}</span>
        {t >= AT.slow && <Slow screen={gap.screen} />}
      </span>
    )
  return (
    <span className={s.receipt} role="status">
      {now}
    </span>
  )
}

export function You(props: YouProps) {
  if (props.at !== RECEIPT) return <KitYou {...props} />
  return <KitYou {...props} at={(<Receipt />) as unknown as string} />
}
