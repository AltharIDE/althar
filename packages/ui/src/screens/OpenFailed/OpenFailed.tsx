import { TitleBar } from '../../chrome/TitleBar/TitleBar'
import { Logo } from '../../foundations/Logo/Logo'
import { Button } from '../../primitives/Button/Button'
import s from './OpenFailed.module.css'

/*
 * What shows in the launch's place when the window couldn't open: the
 * runtime never sent its port, or connecting or the first reads failed.
 * It says so, with what went wrong, and offers to try again; the launch
 * never plays on as if still loading.
 */

export interface OpenFailedText {
  title: string
  retry: string
}

export const openFailedText: OpenFailedText = {
  title: 'Althar couldn’t open',
  retry: 'Try again',
}

export interface OpenFailedProps {
  /** What went wrong, as it was said. */
  reason: string
  onRetry: () => void
  text?: Partial<OpenFailedText>
}

export function OpenFailed({ reason, onRetry, text }: OpenFailedProps) {
  const t = { ...openFailedText, ...text }
  return (
    <div className={s.screen}>
      <TitleBar lights="space">{null}</TitleBar>
      <main className={s.body}>
        <div className={s.box} role="alert">
          <Logo size={28} className={s.mark} />
          <h1 className={s.title}>{t.title}</h1>
          <p className={s.reason}>{reason}</p>
          <Button onClick={onRetry}>{t.retry}</Button>
        </div>
      </main>
    </div>
  )
}
