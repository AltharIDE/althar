import { cx } from '../../lib/cx'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import s from './WorkStatus.module.css'

/*
 * The project's work in two words, at the right of the bar: how many tasks
 * are running, and how many calls wait on you. The second is a way in: it
 * opens the first of them. With none, it says so and does nothing.
 */

export interface WorkStatusText {
  running: (n: number) => string
  yours: (n: number) => string
  none: string
}

export const workStatusText: WorkStatusText = {
  running: (n) => `${n} running`,
  yours: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
  /* scoped to this project: another one may still need you, and says so beside it */
  none: 'Nothing here needs you',
}

export interface WorkStatusProps {
  running: number
  yours: number
  /** Open the first call that waits on you. */
  onYours?: () => void
  className?: string
  text?: Partial<WorkStatusText>
}

export function WorkStatus({ running, yours, onYours, className, text }: WorkStatusProps) {
  const t = { ...workStatusText, ...text }
  return (
    <span className={cx(s.status, className)}>
      {running > 0 && (
        <span className={s.running}>
          <LiveDot ping />
          {t.running(running)}
        </span>
      )}
      {yours > 0 ? (
        <ActionButton tone="strong" onClick={onYours}>
          <span className={s.dot} aria-hidden="true" />
          {t.yours(yours)}
        </ActionButton>
      ) : (
        <span className={s.none}>{t.none}</span>
      )}
    </span>
  )
}
