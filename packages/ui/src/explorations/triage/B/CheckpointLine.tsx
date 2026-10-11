import { useState } from 'react'

import { Icon } from '../../../foundations/Icon/Icon'
import { cx } from '../../../lib/cx'
import { Rhythm } from '../../../lib/rhythm'
import { ActionButton } from '../../../primitives/ActionButton/ActionButton'
import { Button } from '../../../primitives/Button/Button'
import { Caret, Disclosure, DisclosureTrigger, Fold } from '../../../primitives/Fold/Fold'
import { LinkButton } from '../../../primitives/LinkButton/LinkButton'
import { Phase, things, type Assumption, type Checkpoint, type CheckpointActions } from '../model'
import { Assumptions } from '../parts/Assumptions'
import { counting, Ring, shareOf, When, type ClockText } from '../parts/Clock'
import { useFocusAfterFold } from '../parts/focus'
import s from './CheckpointLine.module.css'

/*
 * B. The checkpoint as one quiet line in the lead's turn, after it has said
 * its approach in its own words: how many things it is assuming and when it
 * carries on. Review opens the list, with No on each and Hold and Continue
 * now under it. An empty checkpoint adds nothing at all; the running card
 * carries most of the signal.
 */

export interface CheckpointLineText {
  assuming: (n: number) => string
  assumed: (n: number) => string
  corrected: (n: number) => string
  /** Beside a question: what else it assumes. */
  also: (n: number) => string
  alsoNote: string
  byTime: string
  byYou: string
  withAnswer: string
  review: string
  show: string
  hold: string
  continueNow: string
  continue: string
  clock: Partial<ClockText>
}

export const checkpointLineText: CheckpointLineText = {
  assuming: (n) => `Assuming ${things(n)}`,
  assumed: (n) => `Assumed ${things(n)}`,
  corrected: (n) => `${n} corrected`,
  also: (n) => `Also assuming ${things(n)}`,
  alsoNote: 'carries on with your answer',
  byTime: 'carried on by itself',
  byYou: 'carried on when you said',
  withAnswer: 'carried on with your answer',
  review: 'Review',
  show: 'Show',
  hold: 'Hold',
  continueNow: 'Continue now',
  continue: 'Continue',
  clock: {
    continuesIn: (time) => `continues in ${time}`,
    continuesAt: (at) => `continues at ${at}`,
    paused: 'paused while you write',
    held: 'held by you',
  },
}

export interface CheckpointLineProps {
  assumptions: readonly Assumption[]
  checkpoint: Checkpoint
  on: CheckpointActions
  wait: number
  due: string
  still?: boolean
  /** Beside a question, with no clock of its own. */
  also?: boolean
  /** Each shows where it applies: D's readings of the brief. */
  anchored?: boolean
  defaultOpen?: boolean
  text?: Partial<CheckpointLineText>
}

export function CheckpointLine({
  assumptions,
  checkpoint: c,
  on,
  wait,
  due,
  still,
  also = false,
  anchored = false,
  defaultOpen = false,
  text,
}: CheckpointLineProps) {
  const t = { ...checkpointLineText, ...text }
  const [open, setOpen] = useState(defaultOpen)
  const after = c.phase === Phase.Continued || c.phase === Phase.Answered
  const held = c.phase === Phase.Held
  /* focus goes to Show when Continue now, which it was on, goes */
  const trigger = useFocusAfterFold<HTMLButtonElement>(after)
  if (assumptions.length === 0) return null

  const corrected = Object.keys(c.corrections).length
  const glyph = (() => {
    if (after) return <Icon name="check" size={11} className={s.glyph} />
    if (held) return <Icon name="hold" size={11} className={s.glyph} />
    if (also) return <Icon name="think" size={11} className={s.glyph} />
    return <Ring share={counting(c) ? shareOf(c, wait) : 1} size={12} />
  })()
  const head = (() => {
    if (after) return t.assumed(assumptions.length)
    if (also) return t.also(assumptions.length)
    return t.assuming(assumptions.length)
  })()
  const when = (() => {
    if (c.phase === Phase.Answered) return t.withAnswer
    if (after) return c.by === 'you' ? t.byYou : t.byTime
    if (also) return t.alsoNote
    return <When checkpoint={c} wait={wait} due={due} still={still} announce text={t.clock} className={s.when} />
  })()

  return (
    <Disclosure open={open || c.correcting !== undefined} onOpenChange={setOpen} rhythm={Rhythm.Change} className={s.wrap}>
      <div className={cx(s.line, after && s.after)}>
        {glyph}
        <span className={s.head}>{head}</span>
        {corrected > 0 && <span className={s.part}>· {t.corrected(corrected)}</span>}
        <span className={s.part}>· {when}</span>
        <span className={s.acts}>
          {held && <LinkButton onClick={on.go}>{t.continue}</LinkButton>}
          <DisclosureTrigger>
            <ActionButton ref={trigger} size="small" flush="end">
              {after ? t.show : t.review}
              <Caret />
            </ActionButton>
          </DisclosureTrigger>
        </span>
      </div>
      <Fold>
        <div className={s.body}>
          <Assumptions assumptions={assumptions} checkpoint={c} on={on} anchored={anchored} />
          {!after && !also && (
            <div className={s.foot}>
              {!held && (
                <Button size="small" variant="quiet" onClick={on.hold}>
                  {t.hold}
                </Button>
              )}
              <Button size="small" onClick={on.go}>
                {held ? t.continue : t.continueNow}
              </Button>
            </div>
          )}
        </div>
      </Fold>
    </Disclosure>
  )
}
