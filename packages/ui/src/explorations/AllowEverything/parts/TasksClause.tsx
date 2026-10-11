import type { ReactNode } from 'react'

import type { HeadingLevel } from '../../../primitives/Heading/Heading'
import { LinkButton } from '../../../primitives/LinkButton/LinkButton'
import { Clause } from '../../../setup/Charter/Charter'
import s from './TasksClause.module.css'

/*
 * A sentence for the tasks that don't do as the project says, on the rules
 * page: a task that sets its own mode (B) or stopped asking (C). The page
 * is where the project's rules are read, so what a task set aside for
 * itself is read there too, with the way back beside each.
 */

export interface TaskAside {
  id: string
  /** Its key: 418. */
  task: string
  title: string
  /** What it does instead, straight after its title, with its own punctuation: ": allow everything." */
  says: ReactNode
  /** The way back to what the project says. */
  back?: { label: string; onBack: () => void }
}

export function TasksClause({ label, headingLevel, tasks }: { label: string; headingLevel?: HeadingLevel; tasks: readonly TaskAside[] }) {
  if (tasks.length === 0) return null
  return (
    <Clause label={label} headingLevel={headingLevel}>
      {tasks.map((aside) => (
        <span key={aside.id} className={s.line}>
          <span className={s.key}>{aside.task}</span> {aside.title}
          {aside.says}
          {aside.back && (
            <LinkButton className={s.back} onClick={aside.back.onBack}>
              {aside.back.label}
            </LinkButton>
          )}
        </span>
      ))}
    </Clause>
  )
}
