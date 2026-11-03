import { useId } from 'react'

import { TitleBar, type TitleBarWindow } from '../../chrome/TitleBar/TitleBar'
import { Logo } from '../../foundations/Logo/Logo'
import { Button } from '../../primitives/Button/Button'
import s from './DataNotMoved.module.css'

/*
 * What the window shows instead of opening when an update couldn't move the
 * person's data to its new shape: their data is safe, where the copy from
 * before the update is, what stopped it, and a way to report it. Nothing else
 * of Althar runs behind it, so there is nothing to go back to.
 */

export interface DataNotMovedText {
  title: string
  /** A migration stopped, and the copy from before it is kept. */
  copied: string
  /** A migration stopped, with no copy made, as for data no earlier version had moved yet. */
  untouched: string
  /** The copy couldn't be made, so nothing was moved. */
  notCopied: string
  copy: string
  show: string
  stoppedBy: string
  report: string
}

export const dataNotMovedText: DataNotMovedText = {
  title: 'This update couldn’t move your data',
  copied: 'A copy from before the update is kept.',
  untouched: 'Your data is as it was.',
  notCopied: 'Your data is as it was.',
  copy: 'Copy from before the update',
  show: 'Show in Finder',
  stoppedBy: 'What stopped it',
  report: 'Report this',
}

export interface DataNotMovedProps {
  /** What stopped: a migration (`moving`), or the copy before it (`copying`), so nothing was moved. */
  stopped: 'moving' | 'copying'
  /** Where the copy from before the update is, as the person knows the place; null where none was made. */
  backup: string | null
  /** What went wrong, as it was said. */
  reason: string
  /** Shows the copy in the system's file manager. Without it, the page only says where it is. */
  onShowBackup?: () => void
  /** Reports the problem. Without it, nothing offers to. */
  onReport?: () => void
  /** Off a Mac, draw the window's own controls; on macOS the system draws its lights. */
  lights?: 'space' | 'drawn'
  window?: TitleBarWindow
  text?: Partial<DataNotMovedText>
}

export function DataNotMoved({ stopped, backup, reason, onShowBackup, onReport, lights = 'space', window, text }: DataNotMovedProps) {
  const t = { ...dataNotMovedText, ...text }
  const titleId = useId()
  const copyId = useId()
  const reasonId = useId()
  const safe = stopped === 'copying' ? t.notCopied : backup === null ? t.untouched : t.copied
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
            <p className={s.safe}>{safe}</p>
          </div>
          {backup !== null && (
            <section className={s.part} aria-labelledby={copyId}>
              <h2 id={copyId} className={s.label}>
                {t.copy}
              </h2>
              <p className={s.path}>{backup}</p>
              {onShowBackup && (
                <Button size="small" icon="folder" className={s.show} onClick={onShowBackup}>
                  {t.show}
                </Button>
              )}
            </section>
          )}
          <section className={s.part} aria-labelledby={reasonId}>
            <h2 id={reasonId} className={s.label}>
              {t.stoppedBy}
            </h2>
            <p className={s.reason}>{reason}</p>
          </section>
          {onReport && (
            <Button className={s.report} onClick={onReport}>
              {t.report}
            </Button>
          )}
        </div>
      </main>
    </div>
  )
}
