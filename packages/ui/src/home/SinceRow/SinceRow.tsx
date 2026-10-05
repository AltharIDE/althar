import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type ProjectRef, ProjectWord } from '../ProjectWord/ProjectWord'
import s from './SinceRow.module.css'

/*
 * Something the loop did while you were away, as a line on the home: a pull
 * request opened, work moved to another agent at a usage limit, a stalled
 * step started afresh, permission asks a lead answered within the rules. What
 * happened first, then quieter why, then whose and when. Merging is never
 * here: that is the person's own click. Opened, what happened is the target,
 * stretched over the row, as a running task's title is.
 */

export interface SinceRowText {
  /** Read before the task's number, which is shown alone. */
  task: string
  /** Whose it is, when it is every project's: Leads answered 9 asks. */
  everywhere: string
}

export const sinceRowText: SinceRowText = { task: 'Task', everywhere: 'All projects' }

export type SinceRowProps = RootProps<
  'div',
  {
    /** What kind of thing happened, as a glyph: pr, agents, check, clock. */
    icon: IconName
    /** Whose it was; left out for something across every project. */
    project?: ProjectRef
    task?: string
    /** What happened: Pull request #88 opened. */
    what: string
    /** Why, or what came of it, quieter. */
    detail?: string
    /** When: 12:58. */
    at: string
    /** Open what it happened to: the task, or its pull request. Without it, the row is words. */
    onOpen?: () => void
    text?: Partial<SinceRowText>
  }
>

export function SinceRow({ icon, project, task, what, detail, at, onOpen, className, text, ...rest }: SinceRowProps) {
  const t = { ...sinceRowText, ...text }
  return (
    <div className={cx(s.row, onOpen && s.opens, className)} {...rest}>
      <Icon name={icon} size={12} className={s.icon} />
      <span className={s.body}>
        {task && (
          <span className={s.ref}>
            <VisuallyHidden>{t.task} </VisuallyHidden>
            {task}
          </span>
        )}
        {onOpen ? (
          <button type="button" className={cx(s.what, s.open)} onClick={onOpen}>
            {what}
          </button>
        ) : (
          <span className={s.what}>{what}</span>
        )}
        {detail && <span className={s.detail}>{detail}</span>}
      </span>
      {project ? <ProjectWord project={project} className={s.project} /> : <span className={s.everywhere}>{t.everywhere}</span>}
      <span className={s.at}>{at}</span>
    </div>
  )
}
