import type { CSSProperties, ReactNode } from 'react'

import { cx } from '../../../lib/cx'
import s from './Mac.module.css'

/*
 * The Mac around the app, for the pictures: a desktop with the brand's
 * wallpaper, its menu bar (the notch where the island hangs), and windows
 * on it. Drawn plainly, as macOS draws them, so the app is what reads.
 */

export type Wallpaper = 'light' | 'dark' | 'none'

export function Desktop({
  wallpaper = 'light',
  clock = 'Thu 14:02',
  app = 'Althar',
  island,
  compact = false,
  children,
  className,
  style,
}: {
  /** A narrow screen's menu bar: the app's name and the time only. */
  compact?: boolean
  wallpaper?: Wallpaper
  clock?: string
  /** The app the menu bar names, frontmost. */
  app?: string
  /** What hangs from the notch: an Island. Without it, the menu bar has none. */
  island?: ReactNode
  children?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={cx(s.desktop, s[wallpaper], className)} style={style}>
      <div className={s.menuBar}>
        <span className={s.menus}>
          {!compact && <b>{app}</b>}
          {!compact && (
            <>
              <span>File</span>
              <span>Edit</span>
              <span>View</span>
              <span>Window</span>
              <span>Help</span>
            </>
          )}
        </span>
        <span className={s.status}>
          {!compact && <i className={s.battery} />}
          <span>{clock}</span>
        </span>
      </div>
      <div className={s.screen}>{children}</div>
      {island && <div className={s.edge}>{island}</div>}
    </div>
  )
}

/** A window: rounded, with the system's shadow. Its content draws its own bar. */
export function MacWindow({
  children,
  className,
  style,
  front = true,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Behind another: its shadow lighter. */
  front?: boolean
}) {
  return (
    <div className={cx(s.window, !front && s.behind, className)} style={style}>
      {children}
    </div>
  )
}

/** Another app's window, for behind Althar's: a code editor, its text as bars. */
export function EditorWindow({ className, style }: { className?: string; style?: CSSProperties }) {
  const lines = [62, 48, 0, 30, 72, 66, 54, 0, 40, 76, 58, 0, 44, 70, 36, 64, 50, 0, 28, 60, 74, 46, 0, 38, 68, 52]
  return (
    <div className={cx(s.window, s.editor, className)} style={style}>
      <div className={s.editorBar}>
        <span className={s.lights}>
          <i />
          <i />
          <i />
        </span>
        <span className={s.editorTitle}>router.ts — meridian-api</span>
      </div>
      <div className={s.editorBody}>
        <div className={s.files}>
          {['src', 'refunds', 'router.ts', 'limit.ts', 'idempotency.ts', 'charges', 'tests'].map((f, i) => (
            <span key={f} style={{ paddingLeft: i > 0 && i < 5 ? 12 : 0 }} className={f === 'router.ts' ? s.fileOn : undefined}>
              {f}
            </span>
          ))}
        </div>
        <div className={s.code}>
          {lines.map((w, i) => (
            <span key={i} className={s.line}>
              <em>{i + 18}</em>
              {w > 0 && <i style={{ width: `${w}%`, marginLeft: `${((i * 7) % 4) * 14}px` }} />}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
