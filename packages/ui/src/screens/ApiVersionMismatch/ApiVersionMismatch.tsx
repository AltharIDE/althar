import { useId } from 'react'

import { TitleBar, type TitleBarWindow } from '../../chrome/TitleBar/TitleBar'
import type { WindowControls } from '../../chrome/WindowButtons/WindowButtons'
import { Logo } from '../../foundations/Logo/Logo'
import { Button } from '../../primitives/Button/Button'
import s from './ApiVersionMismatch.module.css'

/*
 * What the window shows instead of opening when its runtime serves another
 * API version than the window speaks (compatibility is an exact match): the
 * window never half-works against it. It names both versions and says what
 * puts it right, which is the two coming from the same Althar, and offers to
 * try again once they are.
 */

export interface ApiVersionMismatchText {
  title: string
  /** Names both versions. */
  versions: (window: number | null, runtime: number) => string
  /** What to do, after the versions. */
  later: string
  /** Quits Althar, runtime and all, so the next open starts both from the same version. */
  quit: string
  retry: string
}

export const apiVersionMismatchText: ApiVersionMismatchText = {
  title: 'This window and its runtime don’t match',
  versions: (window, runtime) =>
    window === null
      ? `The window didn’t say which API version it speaks; the runtime serves version ${runtime}.`
      : `The window speaks API version ${window}; the runtime serves version ${runtime}.`,
  later: 'Quit Althar and open it again. If this stays, reinstall it so both come from the same version.',
  quit: 'Quit Althar',
  retry: 'Try again',
}

export interface ApiVersionMismatchProps {
  /** The API version the window speaks; null where the runtime was told none. */
  windowVersion: number | null
  /** The API version the runtime serves. */
  runtimeVersion: number
  /** Opens the window again. */
  onTryAgain: () => void
  /** Quits Althar, its runtime too: what puts it right, since the window opened again meets the same runtime. With it, Quit comes first. */
  onQuit?: () => void
  /** Off a Mac, draw the window's own controls; on macOS the system draws its lights. */
  lights?: 'space' | 'drawn' | 'none'
  window?: TitleBarWindow
  /** With lights='drawn': which buttons, whose manner, at which end (the desktop's). */
  controls?: WindowControls
  text?: Partial<ApiVersionMismatchText>
}

export function ApiVersionMismatch({
  windowVersion,
  runtimeVersion,
  onTryAgain,
  onQuit,
  lights = 'space',
  window,
  controls,
  text,
}: ApiVersionMismatchProps) {
  const t = { ...apiVersionMismatchText, ...text }
  const titleId = useId()
  return (
    <div className={s.screen}>
      <TitleBar lights={lights} {...(window === undefined ? {} : { window })} {...(controls === undefined ? {} : { controls })}>
        {null}
      </TitleBar>
      <main className={s.body} aria-labelledby={titleId}>
        <div className={s.page}>
          <Logo size={28} className={s.mark} />
          <div className={s.said} role="alert">
            <h1 id={titleId} className={s.title}>
              {t.title}
            </h1>
            <p className={s.text}>{t.versions(windowVersion, runtimeVersion)}</p>
            <p className={s.text}>{t.later}</p>
          </div>
          <div className={s.actions}>
            {onQuit && <Button onClick={onQuit}>{t.quit}</Button>}
            <Button variant={onQuit ? 'quiet' : 'default'} onClick={onTryAgain}>
              {t.retry}
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
