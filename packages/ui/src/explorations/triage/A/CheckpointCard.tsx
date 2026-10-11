import { useId, type RefObject } from 'react'

import { Icon } from '../../../foundations/Icon/Icon'
import { cx } from '../../../lib/cx'
import { Rhythm } from '../../../lib/rhythm'
import { Button } from '../../../primitives/Button/Button'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../../primitives/Fold/Fold'
import { Model, type ModelInfo } from '../../../primitives/Model/Model'
import { Phase, things, type Assumption, type Checkpoint, type CheckpointActions } from '../model'
import { Assumptions } from '../parts/Assumptions'
import { Bar, counting, Ring, shareOf, ticks, When } from '../parts/Clock'
import { useFocusAfterFold } from '../parts/focus'
import s from './CheckpointCard.module.css'

/*
 * A. The checkpoint as a card in the thread, drawn like the plan card: the
 * approach in a line or two, what it is assuming as a numbered list with No
 * on each, and the plan's clock at the foot with Hold and Continue now.
 * Leaving it alone is a yes. Once it carries on it folds to one line, which
 * opens again to what it assumed; an empty checkpoint is that line from the
 * start, so it reads as normal, not as a card left blank.
 */

export interface CheckpointCardText {
  kicker: string
  where: (step: string) => string
  assuming: string
  /** What the coordinator settled in the plan, so the lead doesn't ask it again. */
  decided: (n: number) => string
  hold: string
  continueNow: string
  continue: string
  /** The folded line. */
  carriedOn: (n: number, corrected: number) => string
  nothing: string
  byTime: string
  byYou: string
  /** Beside a question: what it assumes as well, which carries on with your answer. */
  also: string
  alsoNote: string
}

export const checkpointCardText: CheckpointCardText = {
  kicker: 'Checkpoint',
  where: (step) => `start of ${step}`,
  assuming: 'Assuming',
  decided: (n) => `${things(n)} decided in the plan · not asked again`,
  hold: 'Hold',
  continueNow: 'Continue now',
  continue: 'Continue',
  carriedOn: (n, corrected) => `Assumed ${things(n)}${corrected > 0 ? `, ${corrected} corrected by you` : ''}`,
  nothing: 'Nothing assumed worth checking',
  byTime: 'carried on by itself',
  byYou: 'carried on when you said',
  also: 'Also assuming',
  alsoNote: 'carries on with your answer',
}

export interface CheckpointCardProps {
  approach: string
  assumptions: readonly Assumption[]
  checkpoint: Checkpoint
  on: CheckpointActions
  /** The step it is the start of. */
  step: string
  lead: ModelInfo
  wait: number
  due: string
  /** How many things the plan already settled. */
  decided?: number
  still?: boolean
  text?: Partial<CheckpointCardText>
}

export function CheckpointCard({
  approach,
  assumptions,
  checkpoint: c,
  on,
  step,
  lead,
  wait,
  due,
  decided,
  still,
  text,
}: CheckpointCardProps) {
  const t = { ...checkpointCardText, ...text }
  const kicker = useId()
  const folded = c.phase === Phase.Continued || c.phase === Phase.Answered || assumptions.length === 0
  /* the line takes focus when it replaced the card under it */
  const line = useFocusAfterFold<HTMLButtonElement>(folded)

  if (folded) return <Passed approach={approach} assumptions={assumptions} checkpoint={c} on={on} line={line} t={t} />

  const held = c.phase === Phase.Held
  const running = counting(c)
  return (
    <section className={cx(s.card, held && s.held)} aria-labelledby={kicker} data-rhythm={Rhythm.Card}>
      <div className={s.head}>
        <Icon name="think" size={12} />
        <span id={kicker} className={s.kicker}>
          {t.kicker}
        </span>
        <span className={s.where}>· {t.where(step)}</span>
        <Model model={lead} short className={s.who} />
      </div>
      <p className={s.approach}>{approach}</p>
      <div className={s.assuming}>
        <span className={s.label}>{t.assuming}</span>
        <Assumptions assumptions={assumptions} checkpoint={c} on={on} numbered />
      </div>
      <div className={s.foot}>
        <span className={s.decided}>{decided ? t.decided(decided) : null}</span>
        {running && ticks(still) && <Ring share={shareOf(c, wait)} />}
        <When checkpoint={c} wait={wait} due={due} still={still} announce />
        {!held && (
          <Button variant="quiet" onClick={on.hold}>
            {t.hold}
          </Button>
        )}
        <Button onClick={on.go}>{held ? t.continue : t.continueNow}</Button>
        {running && ticks(still) && <Bar share={shareOf(c, wait)} />}
      </div>
    </section>
  )
}

interface PassedProps {
  approach: string
  assumptions: readonly Assumption[]
  checkpoint: Checkpoint
  on: CheckpointActions
  line: RefObject<HTMLButtonElement | null>
  t: CheckpointCardText
}

/** Once it carried on, and an empty checkpoint from the start: one line, which opens to what it assumed. */
function Passed({ approach, assumptions, checkpoint: c, on, line, t }: PassedProps) {
  const corrected = Object.keys(c.corrections).length
  if (assumptions.length === 0)
    return (
      <div className={s.passed} data-rhythm={Rhythm.Fold}>
        <Icon name="check" size={11} />
        <span className={s.said}>{t.nothing}</span>
        <span className={s.approachLine}>· {approach}</span>
      </div>
    )
  return (
    <Disclosure rhythm={Rhythm.Fold}>
      <DisclosureTrigger>
        <button ref={line} type="button" className={cx(s.passed, s.opens)}>
          <Icon name="check" size={11} />
          <span className={s.said}>{t.carriedOn(assumptions.length, corrected)}</span>
          <span className={s.approachLine}>· {c.by === 'you' ? t.byYou : t.byTime}</span>
          <Caret className={s.caret} />
        </button>
      </DisclosureTrigger>
      <Fold>
        <div className={s.after}>
          <p className={s.approach}>{approach}</p>
          <Assumptions assumptions={assumptions} checkpoint={c} on={on} numbered />
        </div>
      </Fold>
    </Disclosure>
  )
}

export interface AlsoCardProps {
  assumptions: readonly Assumption[]
  checkpoint: Checkpoint
  on: CheckpointActions
  text?: Partial<CheckpointCardText>
}

/** Beside a real question: what else it assumes, with no clock of its own. It carries on with your answer. */
export function AlsoCard({ assumptions, checkpoint, on, text }: AlsoCardProps) {
  const t = { ...checkpointCardText, ...text }
  const kicker = useId()
  return (
    <section className={cx(s.card, s.also)} aria-labelledby={kicker} data-rhythm={Rhythm.Card}>
      <div className={s.head}>
        <span id={kicker} className={s.kicker}>
          {t.also}
        </span>
        <span className={s.where}>· {t.alsoNote}</span>
      </div>
      <div className={s.assuming}>
        <Assumptions assumptions={assumptions} checkpoint={checkpoint} on={on} numbered />
      </div>
    </section>
  )
}
