import { TaskStatus } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import s from './WorkTicks.module.css'

/*
 * A project's work in progress as still ticks, one a task: filled while an
 * agent is on it, hollow while it stands still (held for a reset, stopped,
 * waiting). Grey, never violet, and nothing on them moves: running asks
 * nothing of the person. Past `max`, how many more, in figures. How many
 * there are is read out, not the ticks.
 */

export interface WorkTicksText {
  label: (n: number) => string
}

export const workTicksText: WorkTicksText = { label: (n) => (n === 1 ? '1 in progress' : `${n} in progress`) }

export type WorkTicksProps = RootProps<
  'span',
  {
    /** Each task's state, in order. */
    tasks: ReadonlyArray<{ readonly status?: TaskStatus }>
    /** The most ticks drawn; the rest are counted. */
    max?: number
    text?: Partial<WorkTicksText>
  }
>

export function WorkTicks({ tasks, max = 6, className, text, ...rest }: WorkTicksProps) {
  const t = { ...workTicksText, ...text }
  return (
    <span role="img" aria-label={t.label(tasks.length)} className={cx(s.ticks, className)} {...rest}>
      {tasks.slice(0, max).map((task, i) => (
        <i key={i} className={cx(s.tick, (task.status ?? TaskStatus.Running) !== TaskStatus.Running && s.still)} />
      ))}
      {tasks.length > max && <span className={s.more}>+{tasks.length - max}</span>}
    </span>
  )
}
