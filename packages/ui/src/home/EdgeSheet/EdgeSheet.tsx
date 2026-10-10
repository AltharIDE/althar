import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { NeedList } from '../NeedLine/NeedLine'
import s from './EdgeSheet.module.css'

/*
 * What the edge of the screen opens to, while you work in another app: only
 * what needs you, across every project. A head says how many, with the way
 * into Althar; then each call as a NeedLine, answered in place where a click
 * will do; and at the foot, one quiet line for the work in progress, which
 * doesn't need you. Paper under Althar's item in the menu bar; ink in the
 * island, which is the notch's black. A call just answered folds to an
 * AskAnswered line, as on the home.
 */

/** The work in progress, counted for the foot: how many, and of those, how many are held or stopped. */
export interface EdgeWork {
  inProgress: number
  held?: number
  stopped?: number
}

export interface EdgeSheetText {
  waiting: (n: number) => string
  /** The head, when nothing waits. */
  rest: string
  /** The way into the app. */
  openApp: string
  /** The foot: the work in progress, in one line. */
  work: (work: EdgeWork) => string
}

export const edgeSheetText: EdgeSheetText = {
  waiting: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
  rest: 'Nothing needs you',
  openApp: 'Open Althar',
  work: ({ inProgress, held = 0, stopped = 0 }) =>
    inProgress === 0
      ? 'Nothing in progress'
      : [`${inProgress} in progress`, held > 0 && `${held} held`, stopped > 0 && `${stopped} stopped`].filter(Boolean).join(' · '),
}

export type EdgeSheetProps = RootProps<
  'div',
  {
    /** How many wait on you, for the head. */
    waiting: number
    /** What waits on you: NeedLines, and lines for the calls just answered. */
    needs?: ReactNode
    /** The work in progress, said in one line at the foot. */
    work: EdgeWork
    /** Paper under the menu bar; ink round the notch. */
    tone?: 'paper' | 'ink'
    /** Bring Althar's window forward. Without it, the head has no way in. */
    onOpenApp?: () => void
    /** What went wrong, said first: an answer that didn't go through. */
    failure?: string | null
    text?: Partial<EdgeSheetText>
  }
>

export function EdgeSheet({ waiting, needs, work, tone = 'paper', onOpenApp, failure, className, text, ...rest }: EdgeSheetProps) {
  const t = { ...edgeSheetText, ...text }
  const hasNeeds = needs !== undefined && needs !== null && needs !== false && (!Array.isArray(needs) || needs.length > 0)
  return (
    <div className={cx(s.sheet, tone === 'ink' && s.ink, className)} {...rest}>
      <header className={s.head}>
        <h2 className={s.title}>
          {waiting > 0 && <LiveDot signal />}
          {waiting > 0 ? t.waiting(waiting) : t.rest}
        </h2>
        {onOpenApp && (
          <LinkButton className={s.openApp} onClick={onOpenApp}>
            {t.openApp}
          </LinkButton>
        )}
      </header>
      {failure && (
        <p role="alert" className={s.failure}>
          {failure}
        </p>
      )}
      {hasNeeds && (
        <NeedList bare className={s.calls}>
          {needs}
        </NeedList>
      )}
      <footer className={s.foot}>{t.work(work)}</footer>
    </div>
  )
}
