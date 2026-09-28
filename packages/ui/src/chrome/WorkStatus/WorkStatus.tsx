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
  /** Open the first call that waits on you. Without it, the count is words, not a button. */
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
      <Yours yours={yours} onYours={onYours} t={t} />
    </span>
  )
}

function Yours({ yours, onYours, t }: { yours: number; onYours?: () => void; t: WorkStatusText }) {
  if (yours === 0) return <span className={s.none}>{t.none}</span>
  const said = (
    <>
      <span className={s.dot} aria-hidden="true" />
      {t.yours(yours)}
    </>
  )
  if (!onYours) return <span className={s.yoursText}>{said}</span>
  return (
    <ActionButton tone="strong" onClick={onYours}>
      {said}
    </ActionButton>
  )
}
