import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useId, useRef } from 'react'

import { Logo } from '../../foundations/Logo/Logo'
import { ProjectMark } from '../../foundations/ProjectMark/ProjectMark'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import type { ProjectRef } from '../ProjectWord/ProjectWord'
import s from './Island.module.css'

/*
 * Althar round the notch, while you work in another app: a black shape the
 * notch seems to grow, only for what needs you. With nothing waiting on you
 * it is the notch alone, however much is in progress: running doesn't need
 * you. With calls waiting, short wings: Althar's mark, faint, and a violet
 * dot with how many, still. A call that comes in widens it a moment: whose
 * it is by its project's mark, and what kind beside a ringing dot. Pointed
 * at, or its count pressed, it drops open into its sheet: an EdgeSheet in
 * ink. It draws itself at the top of what holds it, centred.
 */

export interface IslandText {
  /** The island's name, as a landmark. */
  label: string
  /** The mark, as a way into the app. */
  openApp: string
  waiting: (n: number) => string
  /** The count's name when nothing waits: it still opens the sheet. */
  nothing: string
}

export const islandText: IslandText = {
  label: 'Althar',
  openApp: 'Open Althar',
  waiting: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
  nothing: 'Nothing needs you',
}

/** The notch's size, in pixels. */
export interface NotchSize {
  width: number
  height: number
}

/** A call that has just come in, as the island says it: whose, and what kind. */
export interface IslandSaying {
  project: ProjectRef
  kind: string
}

export type IslandProps = RootProps<
  'section',
  {
    /** The notch the island is drawn round. */
    notch: NotchSize
    /** How many calls wait on you. */
    waiting: number
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

/** The wings beside the notch, at rest and saying a call, and how wide it opens. */
const WING = { rest: 36, say: 84 }
const OPEN_WIDTH = 360

/** Room for the count's every digit past the first, and for a kind's words beside its dot, roughly. */
const DIGIT = 7
const kindWidth = (kind: string) => 26 + Math.ceil(kind.length * 6.6)

export function Island({
  notch,
  waiting,
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

  const said = saying !== null && !open
  const quiet = waiting === 0 && !said && !open
  const wing = WING.rest + DIGIT * (String(waiting).length - 1)
  const width = open
    ? Math.max(OPEN_WIDTH, notch.width + 2 * wing)
    : said
      ? notch.width + 2 * Math.max(WING.say, kindWidth(saying.kind))
      : quiet
        ? notch.width
        : notch.width + 2 * wing
  const count = waiting > 0 ? t.waiting(waiting) : t.nothing

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
          {said ? (
            <span key={saying.project.seed} className={s.said}>
              <ProjectMark seed={saying.project.seed} ink={saying.project.ink} size={14} />
              <VisuallyHidden>{saying.project.name}</VisuallyHidden>
            </span>
          ) : onOpenApp ? (
            <button type="button" className={s.mark} aria-label={t.openApp} onClick={onOpenApp}>
              <Logo size={13} />
            </button>
          ) : (
            <span className={s.mark}>
              <Logo size={13} />
            </span>
          )}
        </span>
        <span className={s.notch} aria-hidden="true" />
        <span className={cx(s.wing, s.right)}>
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
            {said ? (
              // Only a call coming in rings; at rest the count is still.
              <span key={saying.kind} className={s.said}>
                <LiveDot signal ping urgent />
                <span>{saying.kind}</span>
              </span>
            ) : waiting > 0 ? (
              <>
                <LiveDot signal />
                <span aria-hidden="true">{waiting}</span>
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
