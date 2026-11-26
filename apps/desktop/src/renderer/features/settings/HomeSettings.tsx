import type { ReactNode } from 'react'

import { LAST_WITHOUT_HOME_SETTINGS } from '../../../homes'
import { behindText, HomeBehind } from '../homes/HomeBehind'
import { useHomeTakes } from './home'
import s from './Settings.module.css'

/**
 * A home's own settings, as it has them. Where it doesn't take a change from this window yet (a home from before it
 * did), they show as they stand there, unchangeable, under one strip that offers its update.
 */
export function HomeSettings({ children }: { children: ReactNode }) {
  const takes = useHomeTakes('SetPlansAndReviews')
  if (takes) return <>{children}</>
  return (
    <>
      <HomeBehind line={behindText.settings} since={LAST_WITHOUT_HOME_SETTINGS} />
      <fieldset disabled className={s.held}>
        {children}
      </fieldset>
    </>
  )
}
