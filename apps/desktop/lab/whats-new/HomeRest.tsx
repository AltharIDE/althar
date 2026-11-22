import { useRouterState } from '@tanstack/react-router'
import { createPortal } from 'react-dom'

import { HomeRest as KitRest, type HomeRestProps } from '../../../../packages/ui/src/home/HomeRest/HomeRest'
import { useLab } from './state'
import { HomeNotes, HomeUpdate } from './WhatsNew'

/*
 * The home at rest, as the kit draws it (vite.config.ts's seam), and in C
 * what it says of the update under what it says already: 0.10.0's name, a
 * line, and What's new, which opens the notes in the home's place.
 */

export type { HomeRestProps }

/** The screen under the window's tabs, which the notes take in the home's place. */
const screen = (): HTMLElement | null => {
  const found = document.querySelector<HTMLElement>('[data-lab-window] [class*="Tabs-module__screen"]')
  if (found !== null) found.style.position = 'relative'
  return found
}

export function HomeRest({ children, ...props }: HomeRestProps) {
  const { d, homeNotes, unseen } = useLab()
  // The notes are the home's: only while the window is on it.
  const onHome = useRouterState({ select: (state) => state.location.pathname }) === '/'
  if (d !== 'c') return <KitRest {...props}>{children}</KitRest>
  return (
    <>
      <KitRest {...props}>
        {children}
        {unseen && <HomeUpdate />}
      </KitRest>
      {homeNotes && onHome && screen() !== null && createPortal(<HomeNotes />, screen()!)}
    </>
  )
}
