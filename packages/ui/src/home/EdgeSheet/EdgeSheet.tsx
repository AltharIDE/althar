import type { ReactNode } from 'react'

import { HomeLane } from '../../foundations/vocabulary'
import { Logo } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { HomeSection } from '../HomeSection/HomeSection'
import s from './EdgeSheet.module.css'

/*
 * What the edge of the screen opens to, while you work in another app: the
 * home in small. What waits on you, across every project, answered in place
 * where a click will do; what is in progress; and at the foot, the way into
 * Althar. Paper under Althar's item in the menu bar; ink in the island,
 * which is the notch's black. Its rows are EdgeRows, and a call just
 * answered folds to an AskAnswered line, as on the home.
 */

export interface EdgeSheetText {
  /** The foot's way into the app. */
  openApp: string
}

export const edgeSheetText: EdgeSheetText = { openApp: 'Open Althar' }

export type EdgeSheetProps = RootProps<
  'div',
  {
    /** How many wait on you, for the first section's count. */
    waiting: number
    /** How many are in progress, for the second's. */
    working: number
    /** What waits on you: EdgeRows, and lines for the calls just answered. The section shows only with something in it. */
    needs?: ReactNode
    /** What is in progress: EdgeRows. With none, the section says so. */
    work?: ReactNode
    /** Paper under the menu bar; ink round the notch. */
    tone?: 'paper' | 'ink'
    /** Bring Althar's window forward. Without it, there is no foot. */
    onOpenApp?: () => void
    text?: Partial<EdgeSheetText>
  }
>

export function EdgeSheet({ waiting, working, needs, work, tone = 'paper', onOpenApp, className, text, ...rest }: EdgeSheetProps) {
  const t = { ...edgeSheetText, ...text }
  const hasNeeds = needs !== undefined && needs !== null && needs !== false && (!Array.isArray(needs) || needs.length > 0)
  return (
    <div className={cx(s.sheet, tone === 'ink' && s.ink, className)} {...rest}>
      {hasNeeds && (
        <HomeSection lane={HomeLane.Yours} count={waiting} className={s.section}>
          {needs}
        </HomeSection>
      )}
      <HomeSection lane={HomeLane.Running} count={working} className={s.section}>
        {work}
      </HomeSection>
      {onOpenApp && (
        <footer className={s.foot}>
          <LinkButton className={s.openApp} onClick={onOpenApp}>
            <Logo size={14} />
            {t.openApp}
          </LinkButton>
        </footer>
      )}
    </div>
  )
}
