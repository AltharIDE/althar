import { useId } from 'react'

import { TitleBar, type TitleBarWindow } from '../../chrome/TitleBar/TitleBar'
import { Logo } from '../../foundations/Logo/Logo'
import { Button } from '../../primitives/Button/Button'
import s from './ProfileInUse.module.css'

/*
 * What the window shows instead of opening when another Althar, or the
 * command line, has the person's profile open: one runtime at a time can use
 * a profile. The person can put it right by closing that one, so it says
 * what it is and offers to try again. Nothing else of Althar runs behind it.
 */

export interface ProfileInUseText {
  title: string
  /** What to do, after what was said. */
  later: string
  retry: string
}

export const profileInUseText: ProfileInUseText = {
  title: 'Althar is open somewhere else',
  later: 'Close it, then try again.',
  retry: 'Try again',
}

export interface ProfileInUseProps {
  /** What the runtime said, as the person reads it. */
  reason: string
  /** Tries to open the profile again. */
  onTryAgain: () => void
  /** Off a Mac, draw the window's own controls; on macOS the system draws its lights. */
  lights?: 'space' | 'drawn'
  window?: TitleBarWindow
  text?: Partial<ProfileInUseText>
}

export function ProfileInUse({ reason, onTryAgain, lights = 'space', window, text }: ProfileInUseProps) {
  const t = { ...profileInUseText, ...text }
  const titleId = useId()
  return (
    <div className={s.screen}>
      <TitleBar lights={lights} {...(window === undefined ? {} : { window })}>
        {null}
      </TitleBar>
      <main className={s.body} aria-labelledby={titleId}>
        <div className={s.page}>
          <Logo size={28} className={s.mark} />
          <div className={s.said} role="alert">
            <h1 id={titleId} className={s.title}>
              {t.title}
            </h1>
            <p className={s.text}>{reason}</p>
            <p className={s.text}>{t.later}</p>
          </div>
          <Button onClick={onTryAgain}>{t.retry}</Button>
        </div>
      </main>
    </div>
  )
}
