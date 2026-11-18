import { useId, type Ref } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Rhythm } from '../../lib/rhythm'
import { NextStep, NextSteps } from '../../primitives/NextStep/NextStep'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import s from './AsideCard.module.css'

/*
 * An aside the coordinator started, in its thread: a quick job on Scratch,
 * off the board. Lighter than a task's card, and plainly not one: a line
 * round it rather than a sheet, no steps, no lead, no pull request. It says
 * it is an aside on Scratch, where it stands, its result or what it is at,
 * and opens it beside the coordinator.
 */

export const AsideState = {
  Running: 'running',
  /** Something in it waits on the person. */
  Yours: 'yours',
  Ready: 'ready',
  /** Its lead ended before it finished, not by the person. */
  Failed: 'failed',
  /** The person stopped it. */
  Stopped: 'stopped',
} as const
export type AsideState = (typeof AsideState)[keyof typeof AsideState]

export interface AsideCardText {
  kicker: string
  state: Record<AsideState, string>
  open: string
  answer: string
  /** Its result while it has none to say: failed, with nothing from its lead. */
  noResult: Record<AsideState, string | undefined>
}

export const asideCardText: AsideCardText = {
  kicker: 'Aside on Scratch',
  state: {
    [AsideState.Running]: 'Running',
    [AsideState.Yours]: 'Needs you',
    [AsideState.Ready]: 'Ready',
    [AsideState.Failed]: 'Failed',
    [AsideState.Stopped]: 'Stopped',
  },
  open: 'Open aside',
  answer: 'Answer',
  noResult: {
    [AsideState.Running]: undefined,
    [AsideState.Yours]: undefined,
    [AsideState.Ready]: undefined,
    [AsideState.Failed]: 'It ended before it finished. Open it to try again.',
    [AsideState.Stopped]: undefined,
  },
}

/** The glyph beside each state, as a task's: a failure is its own mark. */
const GLYPH: Record<Exclude<AsideState, 'failed'>, TaskStatus> = {
  [AsideState.Running]: TaskStatus.Running,
  [AsideState.Yours]: TaskStatus.Yours,
  [AsideState.Ready]: TaskStatus.Done,
  [AsideState.Stopped]: TaskStatus.Stopped,
}

export interface AsideCardProps {
  task: string
  title: string
  state: AsideState
  /** What it came to, or, while it runs, what it is at: its lead's latest words. Up front, a few lines at most. */
  result?: string | undefined
  onOpen?: (task: string) => void
  ref?: Ref<HTMLElement>
  text?: Partial<AsideCardText>
}

export function AsideCard({ task, title, state, result, onOpen, ref, text }: AsideCardProps) {
  const t = { ...asideCardText, ...text }
  const titleId = useId()
  const yours = state === AsideState.Yours
  const said = result?.trim() || t.noResult[state]
  return (
    <article ref={ref} data-task={task} data-rhythm={Rhythm.Card} className={cx(s.card, s[state])} aria-labelledby={titleId}>
      <div className={s.top}>
        <span className={s.kicker}>
          <Icon name="comment" size={12} />
          {t.kicker}
        </span>
        <span className={s.state}>
          {state === AsideState.Failed ? <Icon name="problem" size={11} /> : <TaskGlyph status={GLYPH[state]} />}
          {t.state[state]}
        </span>
      </div>
      <p className={s.title} id={titleId} title={title}>
        {title}
      </p>
      {said !== undefined && <p className={s.result}>{said}</p>}
      {onOpen && (
        <NextSteps className={s.next}>
          <NextStep signal={yours} arrow onPress={() => onOpen(task)}>
            {yours ? t.answer : t.open}
          </NextStep>
        </NextSteps>
      )}
    </article>
  )
}
