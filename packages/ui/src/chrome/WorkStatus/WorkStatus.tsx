import { HoverCard as H } from 'radix-ui'

import { cx } from '../../lib/cx'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import s from './WorkStatus.module.css'

/*
 * The project's work in two words, at the right of the bar: how many tasks
 * are running, and how many calls wait on you. The second is a way in: it
 * opens the first of them. Pointed at, it shows what they are, each a way
 * into its own; the click still opens the first, so the keyboard loses
 * nothing. With none, it says so and does nothing.
 */

export interface WorkStatusText {
  running: (n: number) => string
  yours: (n: number) => string
  none: string
  /** The preview's name, for its landmark. */
  preview: string
}

export const workStatusText: WorkStatusText = {
  running: (n) => `${n} running`,
  yours: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
  /* scoped to this project: another one may still need you, and says so beside it */
  none: 'Nothing here needs you',
  preview: 'What needs you',
}

/** One thing that waits on you, as the preview lists it. */
export interface WorkNeed {
  id: string
  /** What it is, in a word or two: Approval, Ready to accept. */
  kind: string
  title: string
  /** A quiet line under the title: the task a call comes from, or the pull request or branch of work ready to accept. */
  meta?: string
  /** How long it has waited, as words: 4m ago. */
  at?: string
  onOpen: () => void
}

export interface WorkStatusProps {
  running: number
  yours: number
  /** Open the first call that waits on you. Without it, the count is words, not a button. */
  onYours?: () => void
  /** What waits on you, shown while the count is pointed at; without them, no preview. */
  needs?: ReadonlyArray<WorkNeed>
  className?: string
  text?: Partial<WorkStatusText>
}

export function WorkStatus({ running, yours, onYours, needs, className, text }: WorkStatusProps) {
  const t = { ...workStatusText, ...text }
  return (
    <span className={cx(s.status, className)}>
      {running > 0 && (
        <span className={s.running}>
          <LiveDot ping />
          {t.running(running)}
        </span>
      )}
      <Yours yours={yours} onYours={onYours} needs={needs} t={t} />
    </span>
  )
}

function Yours({ yours, onYours, needs, t }: { yours: number; onYours?: () => void; needs?: ReadonlyArray<WorkNeed>; t: WorkStatusText }) {
  if (yours === 0) return <span className={s.none}>{t.none}</span>
  const said = (
    <>
      <span className={s.dot} aria-hidden="true" />
      {t.yours(yours)}
    </>
  )
  if (!onYours) return <span className={s.yoursText}>{said}</span>
  const button = (
    <ActionButton tone="strong" onClick={onYours}>
      {said}
    </ActionButton>
  )
  if (needs === undefined || needs.length === 0) return button
  return (
    <H.Root openDelay={180} closeDelay={160}>
      <H.Trigger asChild>{button}</H.Trigger>
      <H.Portal>
        <H.Content side="bottom" align="end" sideOffset={6} collisionPadding={8} className={cx('ch-root', s.preview)}>
          <ul className={s.needs} aria-label={t.preview}>
            {needs.map((need) => (
              <li key={need.id}>
                <button type="button" className={s.need} onClick={need.onOpen}>
                  <span className={s.needHead}>
                    <span className={s.kind}>{need.kind}</span>
                    {need.at !== undefined && need.at !== '' && <span className={s.at}>{need.at}</span>}
                  </span>
                  <span className={s.title}>{need.title}</span>
                  {need.meta !== undefined && need.meta !== '' && <span className={s.meta}>{need.meta}</span>}
                </button>
              </li>
            ))}
          </ul>
        </H.Content>
      </H.Portal>
    </H.Root>
  )
}
