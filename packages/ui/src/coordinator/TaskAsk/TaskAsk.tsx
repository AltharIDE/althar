import { useState, type ReactNode } from 'react'

import { device } from '../../foundations/device'
import type { IconName } from '../../foundations/Icon/Icon'
import { Rhythm } from '../../lib/rhythm'
import type { RootProps } from '../../lib/props'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../../primitives/Ask/Ask'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './TaskAsk.module.css'

/*
 * The coordinator asking the person to move a task on, in its conversation,
 * where nothing they said in that turn asked it to: news, a lead or a pull
 * request made it think so. Stop it, or only its lead's turn; hold its plan;
 * restart it; mark it done, keep it for later, or discard it; accept it by
 * merging it here, or push what merged; or answer its stuck step. One button
 * does it, as the task's own would; Not now leaves it. Once answered, one
 * line: what was done, not now, or that there was nothing to do any more.
 */

/** What the coordinator asks to do to a task. */
export type TaskMove =
  | 'stop'
  | 'stop_turn'
  | 'hold'
  | 'restart'
  | 'done'
  | 'keep'
  | 'discard'
  | 'merge_here'
  | 'push_here'
  | 'as_is'
  | 'skip_review'
  | 'again'
  | 'hand_on'

export interface TaskAskText {
  kicker: string
  /** The question, with the task's title; `to` names where it goes, for a merge here (its branch) or a step handed on (the model). */
  ask: Readonly<Record<TaskMove, (task: ReactNode, to?: string) => ReactNode>>
  button: Readonly<Record<TaskMove, string>>
  did: Readonly<Record<TaskMove, string>>
  notNow: string
  declined: string
  /** Pressed, but the task already stood so, or the move no longer applied. */
  moot: string
  openLabel: (title: string) => string
}

export const taskAskText: TaskAskText = {
  kicker: 'Task',
  ask: {
    stop: (task) => <>Stop {task}?</>,
    stop_turn: (task) => <>Stop the lead’s turn on {task}?</>,
    hold: (task) => <>Hold {task}?</>,
    restart: (task) => <>Restart {task}?</>,
    done: (task) => <>Mark {task} done?</>,
    keep: (task) => <>Keep {task} for later?</>,
    discard: (task) => <>Discard {task}?</>,
    merge_here: (task, to) => (
      <>
        Accept {task}, merging it into {to ?? 'its default branch'} on {device.this}?
      </>
    ),
    push_here: (task) => (
      <>
        Push what {task} merged on {device.this}?
      </>
    ),
    as_is: (task) => <>Accept {task} as it is, without another review?</>,
    skip_review: (task) => <>Skip the review of {task}?</>,
    again: (task) => <>Try the stuck step of {task} again?</>,
    hand_on: (task, to) => (
      <>
        Hand the stuck step of {task} to {to ?? 'another model'}?
      </>
    ),
  },
  button: {
    stop: 'Stop',
    stop_turn: 'Stop the turn',
    hold: 'Hold',
    restart: 'Restart',
    done: 'Mark done',
    keep: 'Keep for later',
    discard: 'Discard',
    merge_here: 'Accept and merge',
    push_here: 'Push',
    as_is: 'Accept it as it is',
    skip_review: 'Skip the review',
    again: 'Try again',
    hand_on: 'Hand it on',
  },
  did: {
    stop: 'Stopped.',
    stop_turn: 'Stopped the turn.',
    hold: 'Held.',
    restart: 'Restarted.',
    done: 'Marked done.',
    keep: 'Kept for later.',
    discard: 'Discarded.',
    merge_here: 'Accepted and merged.',
    push_here: 'Pushed.',
    as_is: 'Accepted as it is.',
    skip_review: 'Skipped the review.',
    again: 'Trying again.',
    hand_on: 'Handed on.',
  },
  notNow: 'Not now',
  declined: 'Not now.',
  moot: 'Nothing to do.',
  openLabel: (title) => `Open ${title}`,
}

const ICONS: Readonly<Record<TaskMove, IconName>> = {
  stop: 'stop',
  stop_turn: 'stop',
  hold: 'hold',
  restart: 'play',
  done: 'check',
  keep: 'pin',
  discard: 'remove',
  merge_here: 'branch',
  push_here: 'up',
  as_is: 'check',
  skip_review: 'check',
  again: 'play',
  hand_on: 'agents',
}

export type TaskAskProps = RootProps<
  'div',
  {
    /** The task's title. */
    title: string
    move: TaskMove
    /** Where it goes, where the move names it: the branch a merge here goes into, or the model a stuck step is handed to. */
    to?: string
    /** Why the coordinator asks, in a line. */
    why?: string
    state?: 'open' | 'done' | 'declined' | 'moot'
    /** Where there was nothing to do, why: it was stopped already. */
    said?: string
    /** Yes does it; no leaves the task as it is. Without it, no buttons. */
    onAnswer?: (yes: boolean) => void
    /** The answer is on its way. */
    busy?: boolean
    /** Opens the task. Without it, its title is plain text. */
    onOpen?: () => void
    text?: Partial<TaskAskText>
  }
>

/** The coordinator asking the person to move a task on: one button and Not now; once answered, one line. */
export function TaskAsk({
  title,
  move,
  to,
  why,
  state = 'open',
  said,
  onAnswer,
  busy = false,
  onOpen,
  text,
  className,
  ...rest
}: TaskAskProps) {
  const t = { ...taskAskText, ...text }
  // Answered here, focus goes on to the line it folds to.
  const [answered, setAnswered] = useState(false)
  const named = onOpen ? (
    <LinkButton className={s.title} aria-label={t.openLabel(title)} onClick={onOpen}>
      {title}
    </LinkButton>
  ) : (
    <b>{title}</b>
  )
  if (state !== 'open')
    return (
      <AskAnswered
        className={className}
        data-rhythm={Rhythm.Fold}
        denied={state === 'declined'}
        said={state === 'done' ? t.did[move] : state === 'declined' ? t.declined : t.moot}
        wrap={state === 'moot'}
        focusOnMount={answered}
        {...rest}
      >
        <AskNote>{state === 'moot' && said !== undefined ? said : title}</AskNote>
      </AskAnswered>
    )
  const answer = (yes: boolean) => {
    setAnswered(true)
    onAnswer?.(yes)
  }
  return (
    <AskCard icon={ICONS[move]} kicker={t.kicker} what={t.ask[move](named, to)} className={className} data-rhythm={Rhythm.Card} {...rest}>
      {why !== undefined && <p className={s.why}>{why}</p>}
      {onAnswer !== undefined && (
        <AskFoot>
          <Button variant="quiet" disabled={busy} onClick={() => answer(false)}>
            {t.notNow}
          </Button>
          <Button variant={move === 'discard' ? 'danger' : 'signal'} busy={busy} onClick={() => answer(true)}>
            {t.button[move]}
          </Button>
        </AskFoot>
      )}
    </AskCard>
  )
}
