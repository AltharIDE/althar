import { useId, type ReactNode, type Ref } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { StepTrack, trackOf } from '../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import { IssueRef, type IssueRefProps } from '../Issue/Issue'
import s from './TaskCard.module.css'
import { Rhythm } from '../../lib/rhythm'

/*
 * A task, once it runs: where it is, who leads it, and a way in. There is one
 * live card per task. When its status changes the coordinator posts a new
 * card, and the old one folds into a TaskMark where it was.
 */

export interface TaskCardText {
  status: Record<TaskStatus, string>
  /** The card's corner: which task, and when it started. */
  task: (task: string, started: string) => string
  lead: string
  /** For a question: who answered it, where a task has a lead. */
  answeredBy: string
  open: string
  answer: string
}

export const taskCardText: TaskCardText = {
  status: {
    [TaskStatus.Running]: 'Running',
    [TaskStatus.Yours]: 'Waiting on you',
    [TaskStatus.Done]: 'Done',
    [TaskStatus.Paused]: 'Paused',
    [TaskStatus.Stopped]: 'Stopped by you',
  },
  task: (task, started) => `Task ${task} · ${started}`,
  lead: 'Lead',
  answeredBy: 'Answered by',
  open: 'Open task',
  answer: 'Answer',
}

export interface TaskCardProps {
  task: string
  title: string
  status: TaskStatus
  /** Its steps, by name, in order. */
  steps: readonly string[]
  /** The step it is on, from 0. */
  at: number
  /** The furthest step it had reached, if it was sent back. */
  seen?: number
  /** What it is doing now, in a line. */
  now?: string
  /** When it started: 2m ago. */
  started: string
  lead: ModelInfo
  /** A question, not a change: its lead is who answered it. */
  question?: boolean
  branch?: string
  /** Where it came from. */
  from?: IssueRefProps
  pr?: string
  /** Anything else for the foot, in a few words. */
  meta?: ReactNode
  /** Just started: it lands, and its track fills in. */
  fresh?: boolean
  /** Just jumped to: it flashes once. */
  found?: boolean
  onOpen?: (task: string) => void
  ref?: Ref<HTMLDivElement>
  text?: Partial<TaskCardText>
}

export function TaskCard({
  task,
  title,
  status,
  steps,
  at,
  seen = at,
  now,
  started,
  lead,
  question,
  branch,
  from,
  pr,
  meta,
  fresh,
  found,
  onOpen,
  ref,
  text,
}: TaskCardProps) {
  const t = { ...taskCardText, ...text }
  const yours = status === TaskStatus.Yours
  const titleId = useId()
  return (
    <article
      ref={ref}
      data-task={task}
      data-rhythm={Rhythm.Card}
      className={cx(s.card, s[status], fresh && s.fresh, found && s.found)}
      aria-labelledby={titleId}
    >
      <div className={s.top}>
        <span className={s.status}>
          <TaskGlyph status={status} />
          {t.status[status]}
        </span>
        {now && <span className={s.nowText}>{now}</span>}
        <span className={s.at}>{t.task(task, started)}</span>
      </div>
      <p className={s.title} id={titleId}>
        {title}
      </p>
      {steps.length > 0 && (
        <StepTrack steps={trackOf(steps, at, seen, status === TaskStatus.Done)} status={status} labels fresh={fresh} className={s.track} />
      )}
      <div className={s.foot}>
        <span className={s.lead}>
          {question ? t.answeredBy : t.lead} <Model model={lead} short className={s.leadModel} />
        </span>
        {branch && (
          <>
            <span className={s.sep} />
            <span className={s.branch}>
              <Icon name="branch" size={10} />
              {branch}
            </span>
          </>
        )}
        {meta && (
          <>
            <span className={s.sep} />
            <span className={s.pr}>{meta}</span>
          </>
        )}
        {from && (
          <>
            <span className={s.sep} />
            <IssueRef {...from} />
          </>
        )}
        {pr && (
          <>
            <span className={s.sep} />
            <span className={s.pr}>
              <Icon name="pr" size={11} />
              {pr}
            </span>
          </>
        )}
        {onOpen && (
          <Button variant={yours ? 'signal' : 'default'} trailingIcon="arrow" className={s.open} onClick={() => onOpen(task)}>
            {yours ? t.answer : t.open}
          </Button>
        )}
      </div>
    </article>
  )
}

export interface TaskMarkText {
  task: (task: string) => string
  now: (step: string) => string
  jump: string
}

export const taskMarkText: TaskMarkText = {
  task: (task) => `Task ${task}`,
  now: (step) => `Now: ${step}`,
  jump: 'Go to the live card',
}

export interface TaskMarkProps {
  task: string
  /** What changed: started, moved to review. */
  verb: string
  detail?: string
  at: string
  steps: readonly string[]
  /** The step it had reached then, from 0. */
  step: number
  seen?: number
  /** Where the task is now. */
  now: string
  /** The most recent mark: says where the task is now without hovering. */
  last?: boolean
  onJump?: () => void
  text?: Partial<TaskMarkText>
}

/**
 * Where a task card used to be: one quiet line saying what changed then, with
 * the step it had reached, and a way down to the live card. Only the most
 * recent line shows where the task is now; older ones show it on hover.
 */
export function TaskMark({ task, verb, detail, at, steps, step, seen = step, now, last, onJump, text }: TaskMarkProps) {
  const t = { ...taskMarkText, ...text }
  return (
    <div className={cx(s.mark, last && s.last)} data-rhythm={Rhythm.Mark}>
      <span className={s.pips} aria-hidden="true">
        {trackOf(steps, step, seen).map((x, i) => (
          <i key={i} className={s[x.state]} />
        ))}
      </span>
      <span className={s.markLabel}>
        <b>{t.task(task)}</b> {verb}
      </span>
      {detail && <span className={s.detail}>{detail}</span>}
      <span className={s.rule} aria-hidden="true" />
      <span className={s.markAt}>{at}</span>
      {onJump && (
        <Tooltip label={t.jump} align="end">
          <ActionButton size="small" flush="end" trailingIcon="down" className={s.go} onClick={onJump}>
            {t.now(now)}
          </ActionButton>
        </Tooltip>
      )}
    </div>
  )
}
