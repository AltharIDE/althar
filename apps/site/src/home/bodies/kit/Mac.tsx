import { Logo } from '@althar/ui'
import appIcon from '../../../../../desktop/resources/icons/cobalt.svg?url'
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
  menu,
  dock = false,
  compact = false,
  children,
  className,
  style,
}: {
  /** A narrow screen's menu bar: the app's name and the time only. */
  compact?: boolean
  /** The Dock along the bottom, Althar's icon in it, running. */
  dock?: boolean
  wallpaper?: Wallpaper
  clock?: string
  /** The app the menu bar names, frontmost. */
  app?: string
  /** What hangs from the notch: an Island. Without it, the menu bar has none. */
  island?: ReactNode
  /** Althar in the menu bar instead: its mark among the status items, and what drops from it when open. */
  menu?: { open: ReactNode | null; waiting: number }
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
          {menu && (
            <span className={cx(s.statusItem, menu.open != null && s.statusOn)}>
              <Logo size={14} />
              {menu.waiting > 0 && <i className={s.statusDot} />}
            </span>
          )}
          {!compact && <i className={s.battery} />}
          <span>{clock}</span>
        </span>
      </div>
      <div className={s.screen}>{children}</div>
      {dock && (
        <div className={s.dock}>
          {['#5aa9f6', '#f4f4f2', '#3ec46d', '#f2b33d', 'icon', '#22262e', '#e9e6de'].map((c, i) => (
            <i key={i} className={c === 'icon' ? s.dockOn : undefined} style={c === 'icon' ? undefined : { background: c }}>
              {c === 'icon' && <img src={appIcon} alt="" />}
            </i>
          ))}
        </div>
      )}
      {island && <div className={s.edge}>{island}</div>}
      {menu?.open && <div className={s.menuSheet}>{menu.open}</div>}
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

/** A browser's window, for behind Althar: tabs, an address, and a page, its text as bars. */
export function BrowserWindow({
  className,
  style,
  url = 'github.com/meridian/meridian-api/pull/1191',
}: {
  className?: string
  style?: CSSProperties
  url?: string
}) {
  return (
    <div className={cx(s.window, s.browser, className)} style={style}>
      <div className={s.browserTabs}>
        <span className={s.lights}>
          <i />
          <i />
          <i />
        </span>
        <span className={cx(s.tab, s.tabOn)}>Pull request #1191 · meridian-api</span>
        <span className={s.tab}>Refunds · Stripe Docs</span>
        <span className={s.tab}>Partner dashboard</span>
      </div>
      <div className={s.address}>
        <span>{url}</span>
      </div>
      <div className={s.page}>
        <div className={s.pageHead}>
          <b>Return 409 when a refund idempotency key is reused</b>
          <span>#1191 · althar wants to merge 3 commits into main</span>
        </div>
        <div className={s.pageBody}>
          {[88, 72, 0, 64, 80, 52, 0, 76, 60, 84, 0, 46, 70, 0, 82, 66, 74, 0, 58, 86, 40, 0, 70, 62].map((w, i) => (
            <i key={i} style={{ width: w ? `${w}%` : 0 }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** A terminal's window, for behind Althar. */
export function TerminalWindow({ className, style }: { className?: string; style?: CSSProperties }) {
  const lines = [
    ['$', 'bun test refunds'],
    ['', ' ✓ refunds › 409 on a reused key (12 ms)'],
    ['', ' ✓ refunds › retries keep the key (8 ms)'],
    ['', ' ✓ limit › refunds share the partner budget (21 ms)'],
    ['', ''],
    ['', ' 48 pass · 0 fail · 1.21s'],
    ['$', 'git log --oneline -3'],
    ['', 'a91f2c0 Return 409 when a refund key is reused'],
    ['', '7d03e11 Rate-limit refunds like charges'],
    ['', '19ba7f4 Backfill idempotency keys before 1184'],
    ['$', ''],
  ]
  return (
    <div className={cx(s.window, s.terminal, className)} style={style}>
      <div className={s.editorBar}>
        <span className={s.lights}>
          <i />
          <i />
          <i />
        </span>
        <span className={s.editorTitle}>meridian-api — zsh</span>
      </div>
      <div className={s.termBody}>
        {lines.map(([p, l], i) => (
          <span key={i}>
            {p && <b>{p} </b>}
            {l}
            {i === lines.length - 1 && <em className={s.cursor} />}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Windows 11's desktop: the wallpaper, windows on it, and the taskbar along the bottom with Althar's icon in it. */
export function WindowsDesktop({
  wallpaper = 'light',
  clock = ['14:02', '09/10/2026'],
  children,
  className,
}: {
  wallpaper?: Wallpaper
  clock?: [string, string]
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cx(s.desktop, s.windows, s[wallpaper], className)}>
      <div className={s.winScreen}>{children}</div>
      <div className={s.taskbar}>
        <span className={s.taskIcons}>
          <i className={s.start}>
            <b />
            <b />
            <b />
            <b />
          </i>
          <i className={s.search} />
          <i className={s.taskApp} style={{ background: '#f2b33d' }} />
          <i className={s.taskApp} style={{ background: '#3b7ddd' }} />
          <i className={cx(s.taskApp, s.taskOn)}>
            <img src={appIcon} alt="" />
          </i>
          <i className={s.taskApp} style={{ background: '#22262e' }} />
        </span>
        <span className={s.tray}>
          <span>{clock[0]}</span>
          <span>{clock[1]}</span>
        </span>
      </div>
    </div>
  )
}

/** GNOME's desktop: the top bar, Activities, the clock in the middle; windows under it. */
export function LinuxDesktop({
  wallpaper = 'dark',
  clock = 'Thu 14:02',
  children,
  className,
}: {
  wallpaper?: Wallpaper
  clock?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cx(s.desktop, s.gnome, s[wallpaper], className)}>
      <div className={s.topBar}>
        <span className={s.activities}>
          <i />
          <i />
          <i />
        </span>
        <span>{clock}</span>
        <span className={s.gnomeStatus}>
          <i />
          <i />
          <i className={s.gnomeBattery} />
        </span>
      </div>
      <div className={s.ubuntuDock}>
        {['#e95420', '#3b7ddd', 'icon', '#77216f', '#f4f4f2', '#22262e'].map((c, i) => (
          <i key={i} className={c === 'icon' ? s.dockOn : undefined} style={c === 'icon' ? undefined : { background: c }}>
            {c === 'icon' && <img src={appIcon} alt="" />}
          </i>
        ))}
        <b className={s.apps}>
          {Array.from({ length: 9 }, (_, i) => (
            <em key={i} />
          ))}
        </b>
      </div>
      <div className={s.gnomeScreen}>{children}</div>
    </div>
  )
}
