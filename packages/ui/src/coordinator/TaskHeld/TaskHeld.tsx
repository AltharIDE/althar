import { useId } from 'react'

import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import s from './TaskHeld.module.css'

export interface TaskHeldText {
  kicker: (task: string) => string
  note: string
  start: string
}

export const taskHeldText: TaskHeldText = {
  kicker: (task) => `Task ${task} · held before it started`,
  note: 'You held the plan in the coordinator. Nothing has run yet; tell the lead how to start, or start it as planned.',
  start: 'Start as planned',
}

export interface TaskHeldProps {
  task: string
  title: string
  /** The plan in a line: 4 steps · Opus 5 leads · draft PR at the end. */
  plan: string
  onStart: () => void
  /** Starting is under way: Start shows it and ignores presses. */
  starting?: boolean
  /** The title's rank in the page's outline. */
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<TaskHeldText>
}

/** The top of a task's thread while its plan is held: nothing has run, so the composer below is how it starts, or it starts as planned. */
export function TaskHeld({ task, title, plan, onStart, starting = false, headingLevel = 2, className, text }: TaskHeldProps) {
  const t = { ...taskHeldText, ...text }
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className={cx(s.held, className)}>
      <span className={s.kicker}>{t.kicker(task)}</span>
      <Heading level={headingLevel} id={titleId} className={s.title}>
        {title}
      </Heading>
      <p className={s.note}>{t.note}</p>
      <div className={s.acts}>
        <Button busy={starting} onClick={onStart}>
          {t.start}
        </Button>
        <span>{plan}</span>
      </div>
    </section>
  )
}
