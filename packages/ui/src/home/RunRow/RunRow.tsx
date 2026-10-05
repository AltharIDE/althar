import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { StepTrack, trackOf } from '../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type ProjectRef, ProjectWord } from '../ProjectWord/ProjectWord'
import s from './RunRow.module.css'

/*
 * A task running in any project, as a row on the home: its title, whose it
 * is, its steps as a track with the one it is on and who is on it, and how
 * long it has run. A task that stands still says why in a word: held for a
 * reset, waiting on you. The whole row opens the task.
 */

export interface RunRowText {
  /** Read before the task's number, which is shown alone. */
  task: string
}

export const runRowText: RunRowText = { task: 'Task' }

export type RunRowProps = RootProps<
  'div',
  {
    project: ProjectRef
    task: string
    title: string
    status?: TaskStatus
    /** Its steps, by name, in order. */
    steps: readonly string[]
    /** The step it is on, from 0. */
    at: number
    /** Who is on that step: the lead, or a reviewer. */
    who: ModelInfo
    /** How long it has run: 41m. */
    elapsed: string
    /** Why it stands still, in a few words: Waits for Claude Code's reset at 14:20. */
    note?: string
    /** Open the task. Without it, the row is words. */
    onOpen?: () => void
    /** It is open in the dock. */
    current?: boolean
    text?: Partial<RunRowText>
  }
>

export function RunRow({
  project,
  task,
  title,
  status = TaskStatus.Running,
  steps,
  at,
  who,
  elapsed,
  note,
  onOpen,
  current,
  className,
  text,
  ...rest
}: RunRowProps) {
  const t = { ...runRowText, ...text }
  return (
    <div className={cx(s.row, className)} data-status={status} aria-current={current || undefined} {...rest}>
      <span className={s.glyph}>{status === TaskStatus.Running ? <LiveDot /> : <TaskGlyph status={status} />}</span>
      <div className={s.main}>
        {onOpen ? (
          <button type="button" className={cx(s.title, s.open)} onClick={onOpen}>
            {title}
          </button>
        ) : (
          <span className={s.title}>{title}</span>
        )}
        <span className={s.meta}>
          <ProjectWord project={project} />
          <span className={s.ref}>
            <VisuallyHidden>{t.task} </VisuallyHidden>
            {task}
          </span>
          {note && <span className={status === TaskStatus.Yours ? s.noteYou : s.note}>{note}</span>}
        </span>
      </div>
      <div className={s.step}>
        <StepTrack steps={trackOf(steps, at)} status={status} />
        <span className={s.stepName}>
          {steps[at]}
          <Model model={who} short />
        </span>
      </div>
      <span className={s.elapsed}>{elapsed}</span>
    </div>
  )
}
