import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { StepTrack, trackOf } from '../../primitives/StepTrack/StepTrack'
import { TaskGlyph } from '../../primitives/TaskGlyph/TaskGlyph'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import b from '../Board/Board.module.css'
import s from './WorkCard.module.css'

/*
 * A task on the board while it runs: its steps as a track, the step it is on
 * and how far along, and who leads it. When the step it is on is someone
 * else's, like a review, the card says whose. A step a project rule added is
 * counted at the foot, so a graph that grew on its own says so.
 */

export interface WorkCardText {
  status: Record<TaskStatus, string>
  task: (task: string) => string
  of: (step: number, steps: number) => string
  lead: string
  added: (n: number) => string
}

export const workCardText: WorkCardText = {
  status: {
    [TaskStatus.Running]: 'Running',
    [TaskStatus.Yours]: 'Waiting on you',
    [TaskStatus.Done]: 'Done',
    [TaskStatus.Paused]: 'Paused',
    [TaskStatus.Stopped]: 'Stopped by you',
  },
  task: (task) => `Task ${task}`,
  of: (step, steps) => `${step} of ${steps}`,
  lead: 'Lead',
  added: (n) => (n === 1 ? '1 step added by rule' : `${n} steps added by rule`),
}

export interface WorkCardProps {
  task: string
  /** What kind of work, in a word: Delivery, Session. */
  kind?: string
  title: string
  status?: TaskStatus
  /** Its steps, by name, in order. */
  steps: readonly string[]
  /** The step it is on, from 0. */
  at: number
  /** The furthest step it had reached, if it was sent back. */
  seen?: number
  /** How long it has run: 6m. */
  elapsed: string
  lead: ModelInfo
  /** Who is on the step now, when it is not the lead: the reviewers. */
  onStep?: readonly ModelInfo[]
  /** How many of its steps a project rule added. */
  added?: number
  /** A word on why it stands still: resumes at 14:00. */
  note?: string
  current?: boolean
  onOpen?: () => void
  text?: Partial<WorkCardText>
}

export function WorkCard({
  task,
  kind,
  title,
  status = TaskStatus.Running,
  steps,
  at,
  seen,
  elapsed,
  lead,
  onStep,
  added,
  note,
  current,
  onOpen,
  text,
}: WorkCardProps) {
  const t = { ...workCardText, ...text }
  const running = status === TaskStatus.Running
  return (
    <article className={cx(b.card, s.work, s[status])} aria-current={current || undefined}>
      <div className={b.top}>
        <span className={s.status}>
          <TaskGlyph status={status} />
          {running ? <VisuallyHidden>{t.status[status]}</VisuallyHidden> : t.status[status]}
        </span>
        <span className={b.ref}>{t.task(task)}</span>
        {kind && <span>{kind}</span>}
        <span className={cx(b.at, s.elapsed)}>{elapsed}</span>
      </div>
      <button type="button" className={b.open} onClick={onOpen}>
        {title}
      </button>
      <StepTrack steps={trackOf(steps, at, seen)} status={status} className={s.track} />
      <div className={s.step}>
        <span className={s.now}>{steps[at]}</span>
        {onStep?.map((m) => (
          <Model key={m.id} model={m} short className={s.agent} />
        ))}
        <span className={s.of}>{note ?? t.of(at + 1, steps.length)}</span>
      </div>
      <div className={b.foot}>
        <span className={s.lead}>
          {t.lead} <Model model={lead} short className={s.leadModel} />
        </span>
        {!!added && (
          <span className={s.added}>
            <Icon name="plus" size={10} />
            {t.added(added)}
          </span>
        )}
      </div>
    </article>
  )
}
