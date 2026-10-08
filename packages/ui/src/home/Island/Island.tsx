import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useId, useRef } from 'react'

import { Logo } from '../../foundations/Logo/Logo'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import s from './Island.module.css'

/*
 * Althar round the notch, while you work in another app: a black shape the
 * notch seems to grow, with Althar's mark on its left and, on its right, how
 * many calls wait on you, violet and ringing, or with none, how many tasks
 * run, cobalt and still. With nothing going on it is the notch alone. A call
 * that comes in widens it a moment with whose it is and what kind. Pointed
 * at, or its count pressed, it drops open into its sheet: an EdgeSheet in
 * ink. It draws itself at the top of what holds it, centred.
 */

export interface IslandText {
  /** The island's name, as a landmark. */
  label: string
  /** The mark, as a way into the app. */
  openApp: string
  waiting: (n: number) => string
  running: (n: number) => string
  /** The count's name when there is nothing to count: it still opens the sheet. */
  nothing: string
}

export const islandText: IslandText = {
  label: 'Althar',
  openApp: 'Open Althar',
  waiting: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
  running: (n) => `${n} running`,
  nothing: 'Nothing in progress',
}

/** The notch's size, in pixels. */
export interface NotchSize {
  width: number
  height: number
}

/** A call that has just come in, as the island says it: whose, and what kind. */
export interface IslandSaying {
  project: string
  kind: string
}

export type IslandProps = RootProps<
  'section',
  {
    /** The notch the island is drawn round. */
    notch: NotchSize
    /** How many calls wait on you. */
    waiting: number
    /** How many tasks have an agent on them. */
    running: number
    /** A call that has just come in, said beside the notch until the consumer clears it. */
    saying?: IslandSaying | null
    /** Its sheet: an EdgeSheet in ink. */
    children?: ReactNode
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    /** Bring Althar's window forward, from the mark. Without it, the mark is decoration. */
    onOpenApp?: () => void
    text?: Partial<IslandText>
  }
>

/** How long the pointer rests on it before it opens, and is away before it closes. */
export const ISLAND_HOVER = { open: 200, close: 180 }

/** The wings beside the notch: at rest, saying a call, and open. */
const WING = { rest: 64, say: 190 }
const OPEN_WIDTH = 470

export function Island({
  notch,
  waiting,
  running,
  saying = null,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onOpenApp,
  onMouseEnter,
  onMouseLeave,
  className,
  style,
  text,
  ...rest
}: IslandProps) {
  const t = { ...islandText, ...text }
  const [open, setOpen] = useControlled(openProp, defaultOpen, onOpenChange)
  const sheetId = useId()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const later = (next: boolean, wait: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(next), wait)
  }
  const enter = (event: MouseEvent<HTMLElement>) => {
    onMouseEnter?.(event)
    later(true, ISLAND_HOVER.open)
  }
  const leave = (event: MouseEvent<HTMLElement>) => {
    onMouseLeave?.(event)
    later(false, ISLAND_HOVER.close)
  }

  const quiet = waiting === 0 && running === 0 && saying === null && !open
  const width = open
    ? Math.max(OPEN_WIDTH, notch.width + 2 * WING.rest)
    : saying !== null
      ? notch.width + 2 * WING.say
      : quiet
        ? notch.width
        : notch.width + 2 * WING.rest
  const count = waiting > 0 ? t.waiting(waiting) : running > 0 ? t.running(running) : t.nothing

  return (
    // Pointing at it opens it, for the pointer's sake; the count is the way in from the keyboard.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      aria-label={t.label}
      className={cx(s.island, open && s.open, quiet && s.quiet, className)}
      style={{ ...style, width, '--notch-w': `${notch.width}px`, '--notch-h': `${notch.height}px` } as CSSProperties}
      onMouseEnter={enter}
      onMouseLeave={leave}
      {...rest}
    >
      <div className={s.bar}>
        <span className={s.wing}>
          {onOpenApp ? (
            <button type="button" className={s.mark} aria-label={t.openApp} onClick={onOpenApp}>
              <Logo size={15} />
            </button>
          ) : (
            <span className={s.mark}>
              <Logo size={15} />
            </span>
          )}
          {saying !== null && !open && (
            <span key={saying.project} className={s.said}>
              {saying.project}
            </span>
          )}
        </span>
        <span className={s.notch} aria-hidden="true" />
        <span className={cx(s.wing, s.right)}>
          {saying !== null && !open && (
            <span key={saying.kind} className={cx(s.said, s.kind)}>
              {saying.kind}
            </span>
          )}
          <button
            type="button"
            className={s.count}
            aria-expanded={open}
            aria-controls={sheetId}
            aria-label={count}
            onClick={() => {
              clearTimeout(timer.current)
              setOpen(!open)
            }}
          >
            {waiting > 0 ? (
              <>
                <LiveDot signal ping />
                <span aria-hidden="true">{waiting}</span>
              </>
            ) : running > 0 ? (
              <>
                <LiveDot />
                <span aria-hidden="true">{running}</span>
              </>
            ) : null}
          </button>
        </span>
      </div>
      <div id={sheetId} className={s.sheet} inert={!open}>
        <div className={s.inner}>{children}</div>
      </div>
    </section>
  )
}
