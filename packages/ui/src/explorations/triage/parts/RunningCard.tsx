import type { ReactNode } from 'react'

import b from '../../../board/Board/Board.module.css'
import { CardTitle } from '../../../board/Board/CardTitle'
import w from '../../../board/WorkCard/WorkCard.module.css'
import { workCardText } from '../../../board/WorkCard/WorkCard'
import { Icon } from '../../../foundations/Icon/Icon'
import { TaskStatus } from '../../../foundations/vocabulary'
import { cx } from '../../../lib/cx'
import { Model, type ModelInfo } from '../../../primitives/Model/Model'
import { StepTrack, trackOf } from '../../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../../primitives/TaskGlyph/TaskGlyph'
import { VisuallyHidden } from '../../../primitives/VisuallyHidden/VisuallyHidden'
import { clock, Phase, things, type Assumption, type Checkpoint } from '../model'
import { counting, Ring, shareOf, ticks } from './Clock'
import s from './RunningCard.module.css'

/*
 * The task's card in Running, as WorkCard draws it, with one thing more: the
 * line under the track says what the first step is doing while the lead
 * triages. Looking around, then the checkpoint and its time, then the step
 * as usual. A real question turns it violet and says it waits on you; the
 * question itself is in Needs you. Once it has carried on, the foot keeps
 * how many things it assumed.
 *
 * Shipping this would add a phase line and a foot note to WorkCard; the
 * prototype draws the card from WorkCard's own styles so the two can't drift.
 */

export interface RunningCardText {
  looking: string
  checkpoint: (n: number) => string
  correcting: string
  corrected: (n: number, of: number) => string
  held: string
  asked: string
  continues: (time: string) => string
  continuesAt: (at: string) => string
  paused: string
  assumed: (n: number, corrected: number) => string
  answered: string
}

export const runningCardText: RunningCardText = {
  looking: 'Looking around',
  checkpoint: (n) => `Checkpoint · ${things(n, 'assumption', 'assumptions')}`,
  correcting: 'Checkpoint · you’re correcting',
  corrected: (n, of) => `Checkpoint · ${n} of ${of} corrected`,
  held: 'Checkpoint · held by you',
  asked: 'Asked you a question',
  continues: (time) => `continues in ${time}`,
  continuesAt: (at) => `continues at ${at}`,
  paused: 'paused',
  assumed: (n, corrected) => (corrected > 0 ? `${n} assumed · ${corrected} corrected` : `${n} assumed`),
  answered: 'You answered',
}

export interface RunningCardProps {
  task: string
  kind?: string
  title: string
  steps: readonly string[]
  elapsed: string
  lead: ModelInfo
  checkpoint: Checkpoint
  assumptions: readonly Assumption[]
  wait: number
  due: string
  still?: boolean
  /** At the end of the phase line: C's way to open the checkpoint on the card. */
  toggle?: ReactNode
  /** Under the phase line, inside the card: C's checkpoint. */
  tray?: ReactNode
  /** In place of the foot's note on what it assumed: C opens it. */
  marker?: ReactNode
  current?: boolean
  onOpen?: () => void
  text?: Partial<RunningCardText>
}

export function RunningCard({
  task,
  kind,
  title,
  steps,
  elapsed,
  lead,
  checkpoint: c,
  assumptions,
  wait,
  due,
  still,
  toggle,
  tray,
  marker,
  current,
  onOpen,
  text,
}: RunningCardProps) {
  const t = { ...runningCardText, ...text }
  const status = c.phase === Phase.Asking ? TaskStatus.Yours : TaskStatus.Running
  const corrected = Object.keys(c.corrections).length
  const after = c.phase === Phase.Continued || c.phase === Phase.Answered
  /* an empty checkpoint passes straight on: the card goes from looking around to the step */
  const checking = (c.phase === Phase.Open || c.phase === Phase.Held) && assumptions.length > 0

  const line = (() => {
    if (c.phase === Phase.Looking) return { now: t.looking, aside: <>{workCardText.of(1, steps.length)}</> }
    if (c.phase === Phase.Asking) return { now: t.asked, aside: <>{workCardText.of(1, steps.length)}</> }
    if (!checking) return { now: steps[0], aside: <>{workCardText.of(1, steps.length)}</> }
    if (c.phase === Phase.Held) return { now: t.held, glyph: <Icon name="hold" size={11} className={s.glyph} /> }
    if (c.correcting !== undefined) return { now: t.correcting, aside: <>{t.paused}</>, glyph: <Ring share={shareOf(c, wait)} size={12} /> }
    return {
      now: corrected > 0 ? t.corrected(corrected, assumptions.length) : t.checkpoint(assumptions.length),
      aside: <>{ticks(still) ? t.continues(clock(c.left)) : t.continuesAt(due)}</>,
      glyph: <Ring share={counting(c) ? shareOf(c, wait) : 1} size={12} />,
    }
  })()

  return (
    <article className={cx(b.card, w[status])} aria-current={current || undefined}>
      <div className={b.top}>
        <span className={w.status}>
          <TaskGlyph status={status} />
          {status === TaskStatus.Running ? <VisuallyHidden>{workCardText.status[status]}</VisuallyHidden> : workCardText.status[status]}
        </span>
        <span className={b.ref}>{workCardText.task(task)}</span>
        {kind && <span>{kind}</span>}
        <span className={cx(b.at, w.elapsed)}>{elapsed}</span>
      </div>
      <CardTitle onOpen={onOpen}>{title}</CardTitle>
      <StepTrack steps={trackOf(steps, 0)} status={status} className={w.track} />
      <div className={cx(w.step, s.line)}>
        {line.glyph}
        <span className={checking ? s.now : w.now}>{line.now}</span>
        {line.aside && <span className={w.of}>{line.aside}</span>}
        {toggle && <span className={s.over}>{toggle}</span>}
      </div>
      {tray && <div className={s.over}>{tray}</div>}
      <div className={b.foot}>
        <span className={w.lead}>
          {workCardText.lead} <Model model={lead} short className={w.leadModel} />
        </span>
        {marker ??
          (after && (
            <span className={s.assumed}>
              {c.phase === Phase.Answered && `${t.answered} · `}
              {t.assumed(assumptions.length, corrected)}
            </span>
          ))}
      </div>
    </article>
  )
}
