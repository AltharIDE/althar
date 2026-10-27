import {
  Children,
  createContext,
  type CSSProperties,
  isValidElement,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { BoardLane, unreachable } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Board.module.css'

/*
 * The board: every piece of a project's work, in the order it moves. Up
 * next, running, waiting on you, settled. Each lane holds its own kind of
 * object, because each is read differently: a queue says what it waits for,
 * a running task where it is, a call its choices, and settled work what it
 * came to. There is no held lane: a task held on a call stays in Up next,
 * and the call itself is what waits on you.
 *
 * The board lays the lanes side by side. Where they don't fit at their
 * narrowest, it collapses some to rails, so it never scrolls sideways while
 * it can help it: an empty lane first, then Settled, Up next and Running.
 * Needs you never collapses while something waits in it. The person collapses
 * a lane from the chevron its head shows on hover, and opens one from its
 * rail; one they opened stays open, and another collapses instead. Each lane
 * scrolls on its own. It says which lane the pointer is in, for a consumer
 * that keeps a card from moving out from under the person's hand.
 */

export interface BoardText {
  lane: Record<BoardLane, string>
  /** An empty lane. */
  empty: Record<BoardLane, string>
  /** The chevron on a lane's head, by the lane's name. */
  collapse: (lane: string) => string
  /** A collapsed lane's rail, by the lane's name and how many it holds. */
  expand: (lane: string, count: number) => string
  /** The chevron on Needs you's head while something waits in it. */
  stays: string
}

export const boardText: BoardText = {
  lane: {
    [BoardLane.Next]: 'Up next',
    [BoardLane.Running]: 'Running',
    [BoardLane.Yours]: 'Needs you',
    [BoardLane.Settled]: 'Settled',
  },
  empty: {
    [BoardLane.Next]: 'Nothing is waiting to start.',
    [BoardLane.Running]: 'Nothing is running.',
    [BoardLane.Yours]: 'Nothing needs you.',
    [BoardLane.Settled]: 'Nothing has settled yet.',
  },
  collapse: (lane) => `Collapse ${lane}`,
  expand: (lane, count) => `Expand ${lane}, ${count}`,
  stays: 'Needs you stays open while something waits on you',
}

/** What the person chose about the lanes: those they collapsed, and those they opened from a rail, kept open while another collapses instead. */
export interface BoardFolds {
  readonly collapsed: ReadonlyArray<BoardLane>
  readonly opened: ReadonlyArray<BoardLane>
}

export const NO_FOLDS: BoardFolds = { collapsed: [], opened: [] }

/** A collapsed lane's width, in px: a rail. */
export const RAIL = 40
/** A lane's narrowest, in px, where the board's container doesn't set `--lane-min`. */
const NARROWEST = 260
/** A lane's widest, in px. */
const WIDEST = 460

/** Which lanes collapse first when the board runs out of room, after what's empty. */
const FIRST: Record<BoardLane, number> = { [BoardLane.Settled]: 0, [BoardLane.Next]: 1, [BoardLane.Running]: 2, [BoardLane.Yours]: 3 }

/** A lane as the board counts it. */
export interface LaneCount {
  readonly lane: BoardLane
  readonly count: number
  /** Whether it has anything to show, where that is more than its count says (Settled, with what was kept for later). */
  readonly filled?: boolean
}

/** A lane with nothing to show: the first to collapse. */
const emptyOf = ({ count, filled = count > 0 }: LaneCount) => !filled

/** Needs you, while something waits in it: it can't be collapsed, and opens by itself when something arrives. */
const heldOf = ({ lane, count }: LaneCount) => lane === BoardLane.Yours && count > 0

/**
 * The lanes shown as rails: those the person collapsed, and, where the lanes
 * don't fit `width` at `narrowest` each, as many more as it takes, an empty
 * lane first, then Settled, Up next and Running. Never Needs you while
 * something waits in it; never by itself a lane the person opened. A width
 * not known yet (0) collapses nothing by itself.
 */
export function railsOf(lanes: ReadonlyArray<LaneCount>, folds: BoardFolds, width: number, narrowest: number): ReadonlySet<BoardLane> {
  const rails = new Set(lanes.filter((one) => folds.collapsed.includes(one.lane) && !heldOf(one)).map((one) => one.lane))
  if (width <= 0) return rails
  const fits = () => (lanes.length - rails.size) * narrowest + rails.size * RAIL <= width
  const candidates = lanes
    .filter((one) => !rails.has(one.lane) && !heldOf(one) && !folds.opened.includes(one.lane))
    .toSorted((a, b) => Number(emptyOf(b)) - Number(emptyOf(a)) || FIRST[a.lane] - FIRST[b.lane])
  for (const one of candidates) {
    if (fits()) break
    rails.add(one.lane)
  }
  return rails
}

/** A lane folded or opened by the person: off the other list, and on its own. */
const chose = (folds: BoardFolds, lane: BoardLane, collapse: boolean): BoardFolds => {
  const without = (list: ReadonlyArray<BoardLane>) => list.filter((one) => one !== lane)
  return collapse
    ? { collapsed: [...without(folds.collapsed), lane], opened: without(folds.opened) }
    : { collapsed: without(folds.collapsed), opened: [...without(folds.opened), lane] }
}

/** How wide the board is, and a lane's narrowest there (its container's `--lane-min`); 0 wide until it is measured. */
function useRoom(ref: RefObject<HTMLElement | null>) {
  const [room, setRoom] = useState({ width: 0, narrowest: NARROWEST })
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const width = element.clientWidth
      const narrowest = Number.parseFloat(getComputedStyle(element).getPropertyValue('--lane-min')) || NARROWEST
      setRoom((was) => (was.width === width && was.narrowest === narrowest ? was : { width, narrowest }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return room
}

interface Folding {
  /** Shown as a rail. */
  readonly rail: (lane: BoardLane) => boolean
  readonly fold: (lane: BoardLane, collapse: boolean) => void
}

const FoldingContext = createContext<Folding | null>(null)

export interface BoardProps {
  /** Its lanes: BoardLane elements. */
  children: ReactNode
  /** What the board is, for assistive technology. */
  label: string
  /** The lanes the person collapsed and opened, where the consumer keeps them; otherwise the board keeps them, from `defaultFolds`. */
  folds?: BoardFolds
  defaultFolds?: BoardFolds
  /** Each time the person collapses or opens a lane. */
  onFoldsChange?: (folds: BoardFolds) => void
  /** Each time the pointer goes into a lane, or out of the board (null); while a row is dragged, it stays in the lane the drag began in. */
  onPointerLane?: (lane: BoardLane | null) => void
  className?: string
}

const LANES: ReadonlySet<string> = new Set(Object.values(BoardLane))

/** The lane an element is in, by its column's `data-lane`; null outside any. */
const laneUnder = (target: EventTarget | null): BoardLane | null => {
  const lane = target instanceof Element ? target.closest('[data-lane]')?.getAttribute('data-lane') : null
  return lane != null && LANES.has(lane) ? (lane as BoardLane) : null
}

export function Board({ children, label, folds, defaultFolds = NO_FOLDS, onFoldsChange, onPointerLane, className }: BoardProps) {
  const [chosen, setChosen] = useControlled(folds, defaultFolds, onFoldsChange)
  const ref = useRef<HTMLElement>(null)
  // The lane last said, so each crossing is said once.
  const pointed = useRef<BoardLane | null>(null)
  const point = (lane: BoardLane | null) => {
    if (pointed.current === lane) return
    pointed.current = lane
    onPointerLane?.(lane)
  }
  const room = useRoom(ref)
  const lanes: ReadonlyArray<LaneCount> = Children.toArray(children).flatMap((child) =>
    isValidElement<BoardColumnProps>(child) && child.type === BoardColumn
      ? [{ lane: child.props.lane, count: child.props.count, ...(child.props.filled === undefined ? {} : { filled: child.props.filled }) }]
      : [],
  )
  const rails = railsOf(lanes, chosen, room.width, room.narrowest)
  const style: CSSProperties | undefined =
    lanes.length === 0
      ? undefined
      : {
          gridTemplateColumns: lanes
            .map((one) => (rails.has(one.lane) ? `minmax(${RAIL}px, ${RAIL}px)` : `minmax(var(--lane-min, ${NARROWEST}px), ${WIDEST}px)`))
            .join(' '),
        }
  return (
    <section
      ref={ref}
      aria-label={label}
      className={cx(s.board, className)}
      style={style}
      {...(onPointerLane === undefined
        ? {}
        : { onPointerOver: (event: PointerEvent) => point(laneUnder(event.target)), onPointerLeave: () => point(null) })}
    >
      <FoldingContext.Provider
        value={{ rail: (lane) => rails.has(lane), fold: (lane, collapse) => setChosen(chose(chosen, lane, collapse)) }}
      >
        {children}
      </FoldingContext.Provider>
    </section>
  )
}

function Glyph({ lane }: { lane: BoardLane }) {
  switch (lane) {
    case BoardLane.Next:
      return <span className={s.ring} aria-hidden="true" />
    case BoardLane.Running:
      return <LiveDot />
    case BoardLane.Yours:
      return <span className={s.you} aria-hidden="true" />
    case BoardLane.Settled:
      return <Icon name="check" size={11} className={s.settledGlyph} />
    default:
      return unreachable(lane)
  }
}

/** One of two things a lane holds and shows one at a time, as its head names it: Settled, or what was kept for later. */
export interface LaneShelf {
  readonly value: string
  readonly label: string
  readonly count: number
  /** Its glyph in the lane's head while it shows, in place of the lane's own. */
  readonly icon?: IconName
}

export interface BoardColumnProps {
  lane: BoardLane
  /** How many it holds. */
  count: number
  /** Whether it has anything to show, where that is more than its count says (Settled, with what was kept for later beside it). */
  filled?: boolean
  /**
   * What it holds, where it holds two things and shows one: each named in
   * its head with its count, in place of the lane's own name and count, the
   * one showing in ink. Pressing the other shows it instead.
   */
  shelves?: {
    /** What choosing between them is: Settled or kept for later. */
    readonly label: string
    readonly options: ReadonlyArray<LaneShelf>
    readonly value: string
    readonly onChange: (value: string) => void
  }
  children?: ReactNode
  /** The lane's name's rank in the page's outline. */
  headingLevel?: HeadingLevel
  text?: Partial<BoardText>
}

/**
 * One lane: its name and count, then its cards or rows. Empty, it says so.
 * On a board, its head shows a chevron on hover that collapses it to a rail:
 * its glyph, its count and its name written down it, the whole of it the
 * button that opens it again. The focus goes with it either way, and where
 * the board collapses or opens it by itself from under the focus, too.
 */
export function BoardColumn({ lane, count, filled = count > 0, shelves, children, headingLevel = 2, text }: BoardColumnProps) {
  const t = { ...boardText, ...text }
  const id = useId()
  const bodyId = useId()
  const folding = useContext(FoldingContext)
  const rail = folding?.rail(lane) ?? false
  const held = heldOf({ lane, count })
  const self = useRef<HTMLElement>(null)
  // Collapsed or opened from its own control, or by the board from under what had the focus in it, the focus goes to
  // the control that took their place. Focus elsewhere stays where it is.
  const moved = useRef(false)
  // What has the focus in the lane, while it does: forgotten when the focus goes elsewhere, or to nothing, unless it
  // went because the lane took it off the page.
  const focused = useRef<Element | null>(null)
  useLayoutEffect(() => {
    const element = self.current
    if (element === null) return
    const into = (event: FocusEvent) => {
      focused.current = event.target instanceof Element ? event.target : null
    }
    const out = ({ target, relatedTarget }: FocusEvent) => {
      if (relatedTarget instanceof Node && element.contains(relatedTarget)) return
      if (relatedTarget !== null) focused.current = null
      else
        queueMicrotask(() => {
          if (focused.current === target && target instanceof Element && target.isConnected) focused.current = null
        })
    }
    element.addEventListener('focusin', into)
    element.addEventListener('focusout', out)
    return () => {
      element.removeEventListener('focusin', into)
      element.removeEventListener('focusout', out)
    }
  }, [rail])
  useLayoutEffect(() => {
    const active = document.activeElement
    const lost = focused.current !== null && !focused.current.isConnected && (active === null || active === document.body)
    if (!moved.current && !lost) return
    moved.current = false
    focused.current = null
    self.current?.querySelector<HTMLButtonElement>(`[data-fold="${rail ? 'expand' : 'collapse'}"]`)?.focus()
  }, [rail])
  const fold = (collapse: boolean) => {
    if (folding === null || (collapse && held)) return
    moved.current = true
    folding.fold(lane, collapse)
  }
  const name = t.lane[lane]
  const shown = shelves?.options.find((one) => one.value === shelves.value)

  if (rail)
    return (
      <section ref={self} aria-labelledby={id} data-lane={lane} className={cx(s.column, s[lane], s.collapsed)}>
        <span className={s.railGlyph}>
          <Glyph lane={lane} />
        </span>
        <span className={cx(s.count, count === 0 && s.none)}>{count}</span>
        <Heading level={headingLevel} id={id} className={cx(s.title, s.railName)}>
          {name}
        </Heading>
        <button
          type="button"
          className={s.expand}
          data-fold="expand"
          aria-expanded="false"
          aria-label={t.expand(name, count)}
          onClick={() => fold(false)}
        />
      </section>
    )

  return (
    <section ref={self} aria-labelledby={id} data-lane={lane} className={cx(s.column, s[lane])}>
      <header className={s.head}>
        {shown?.icon === undefined ? <Glyph lane={lane} /> : <Icon name={shown.icon} size={11} className={s.settledGlyph} />}
        {shelves === undefined ? (
          <>
            <Heading level={headingLevel} id={id} className={s.title}>
              {name}
            </Heading>
            <span className={cx(s.count, count === 0 && s.none)}>{count}</span>
          </>
        ) : (
          <>
            {/* The lane keeps its name in the page's outline; what shows are the two it holds. */}
            <VisuallyHidden>
              <Heading level={headingLevel} id={id}>
                {name}
              </Heading>
            </VisuallyHidden>
            <fieldset className={s.shelves}>
              <VisuallyHidden as="legend">{shelves.label}</VisuallyHidden>
              {shelves.options.map((one) => (
                <button
                  key={one.value}
                  type="button"
                  className={s.shelf}
                  aria-pressed={one.value === shelves.value}
                  onClick={() => shelves.onChange(one.value)}
                >
                  {one.label} <span className={cx(s.shelfCount, one.count === 0 && s.none)}>{one.count}</span>
                </button>
              ))}
            </fieldset>
          </>
        )}
        {folding !== null && (
          <IconButton
            icon="chevronL"
            size="small"
            tooltip="below"
            tooltipAlign="end"
            label={held ? t.stays : t.collapse(name)}
            className={s.collapse}
            data-fold="collapse"
            aria-expanded="true"
            aria-controls={bodyId}
            {...(held ? { 'aria-disabled': true } : {})}
            onClick={() => fold(true)}
          />
        )}
      </header>
      <div className={s.body} id={bodyId}>
        {filled ? children : <p className={s.empty}>{t.empty[lane]}</p>}
      </div>
    </section>
  )
}

/** A list of rows in a lane: the queue up next, the settled ledger. Each child is one item of the list. */
export function BoardList({ children }: { children: ReactNode }) {
  return (
    <ol className={s.list}>
      {Children.map(children, (row) => (
        <li>{row}</li>
      ))}
    </ol>
  )
}

/** A quiet line between groups in a lane, naming the group under it: what starts when an agent is free; at its end, what to do with the group. */
export function BoardDivider({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <p className={s.divider}>
      <span className={s.dividerLead}>
        <span className={s.dividerLabel} {...(typeof children === 'string' ? { title: children } : {})}>
          {children}
        </span>
      </span>
      {end !== undefined && end !== null && <span className={s.dividerEnd}>{end}</span>}
    </p>
  )
}
