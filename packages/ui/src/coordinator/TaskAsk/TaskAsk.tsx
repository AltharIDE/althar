import { useState, type ReactNode } from 'react'

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
 * restart it; mark it done, keep it for later, or discard it. One button
 * does it, as the task's own would; Not now leaves it. Once answered, one
 * line: what was done, not now, or that there was nothing to do any more.
 */

/** What the coordinator asks to do to a task. */
export type TaskMove = 'stop' | 'stop_turn' | 'hold' | 'restart' | 'done' | 'keep' | 'discard'

export interface TaskAskText {
  kicker: string
  ask: Readonly<Record<TaskMove, (task: ReactNode) => ReactNode>>
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
  },
  button: {
    stop: 'Stop',
    stop_turn: 'Stop the turn',
    hold: 'Hold',
    restart: 'Restart',
    done: 'Mark done',
    keep: 'Keep for later',
    discard: 'Discard',
  },
  did: {
    stop: 'Stopped.',
    stop_turn: 'Stopped the turn.',
    hold: 'Held.',
    restart: 'Restarted.',
    done: 'Marked done.',
    keep: 'Kept for later.',
    discard: 'Discarded.',
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
}

export type TaskAskProps = RootProps<
  'div',
  {
    /** The task's title. */
    title: string
    move: TaskMove
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

/** The coordinator asking the person to stop, hold, restart or settle a task: one button and Not now; once answered, one line. */
export function TaskAsk({
  title,
  move,
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
    <AskCard icon={ICONS[move]} kicker={t.kicker} what={t.ask[move](named)} className={className} data-rhythm={Rhythm.Card} {...rest}>
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
