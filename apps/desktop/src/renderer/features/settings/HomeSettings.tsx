import type { ReactNode } from 'react'

import { LAST_WITHOUT_HOME_SETTINGS } from '../../../homes'
import { behindText, HomeBehind } from '../homes/HomeBehind'
import { Held } from '../homes/HomeHolds'
import { useHomeTakes } from './home'
import s from './Settings.module.css'

/**
 * A home's own settings, as it has them. Where it doesn't take a change from this window yet (a home from before it
 * did), they show as they stand there, unchangeable, under one strip that offers its update.
 */
export function HomeSettings({ children, inset = false }: { children: ReactNode; inset?: boolean }) {
  const takes = useHomeTakes('SetPlansAndReviews')
  if (takes) return <>{children}</>
  return (
    // Inset, inside a card of its own (the home opened out in Computers): the strip clear of the card's edge.
    <div className={inset ? s.heldInset : s.heldPage}>
      <HomeBehind line={behindText.settings} since={LAST_WITHOUT_HOME_SETTINGS} />
      <Held>{children}</Held>
    </div>
  )
}
