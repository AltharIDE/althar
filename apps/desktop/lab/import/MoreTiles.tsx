import { type CSSProperties, Fragment, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Icon, LinkButton } from '@althar/ui'

import { AllNone, ByKind, Mark, type Picks, SectionHead, Tick, WorktreeFacts } from './Found'
import { text as shortcut } from './Shortcuts'
import { narrowed, tileState, text as variants } from './Variants'
import { isAgent, nameOf, type Source, SOURCES, when } from './world'
import s from './tiles.module.css'

/*
 * More of H, the tiles (K–M): a tile a tool, a press takes all of it. K opens
 * a tile's list in a panel under its row, on the kit's fold and spring. L shows the latest few things on
 * the tile itself, each tickable. M starts with what's under way, a meter on
 * each tile for how much of it comes.
 */

export const text = {
  found: 'Found',
  lookInside: 'Look inside',
  hideList: 'Hide the list',
  inside: (who: string) => `What’s in ${who}`,
  more: (n: number) => `${n} more`,
  fewer: 'Fewer',
  older: (n: number) => `${n} older conversations`,
  backToUnderway: 'Back to what’s under way',
  allOf: (n: string) => `All ${n}`,
}

type State = 'on' | 'mixed' | 'off'

/** The sources with anything here, in the order of the lab's world. */
const offered = (picks: Picks) => SOURCES.filter((who) => tileState(picks, who).of > 0)

const takeAll = (picks: Picks, sources: readonly Source[], on: boolean) => {
  for (const who of sources) picks.source(who, on)
}

/** How much a source has, said: an agent's conversations, a tool's worktrees. */
const sizeOf = (picks: Picks, who: Source) =>
  isAgent(who) ? shortcut.conversations(tileState(picks, who).of) : shortcut.worktrees(tileState(picks, who).of)

/** A source's most telling fact: a tool's newest worktree's, else when it was last used. */
function Fact({ picks, who }: { picks: Picks; who: Source }) {
  const t = picks.things(who)
  const newest = [...t.worktrees].sort((a, b) => b.touched.localeCompare(a.touched))[0]
  if (!isAgent(who) && newest !== undefined) return <WorktreeFacts one={newest} first />
  const latest = [...t.worktrees.map((one) => one.touched), ...t.conversations.map((one) => one.at)].sort().at(-1)
  return latest === undefined ? null : <>{variants.latest(when(latest))}</>
}

/** The tile's own tick: all of it, some, none. */
function Box({ state }: { state: State }) {
  return (
    <span className={s.box} data-state={state}>
      {state === 'on' ? <Icon name="check" size={11} /> : state === 'mixed' ? <span className={s.dash} /> : null}
    </span>
  )
}

/** H's face: mark and tick, name, how much, a fact. */
function Face({ picks, who, line }: { picks: Picks; who: Source; line?: ReactNode }) {
  const { state, picked, of } = tileState(picks, who)
  return (
    <>
      <span className={s.top}>
        <Mark of={who} size={22} />
        <Box state={state} />
      </span>
      <span className={s.name}>{nameOf(who)}</span>
      <span className={s.count}>
        {line ?? (
          <>
            {sizeOf(picks, who)}
            {state === 'mixed' && <span className={s.some}> · {shortcut.someOf(picked, of)}</span>}
          </>
        )}
      </span>
      <span className={s.fact}>
        <Fact picks={picks} who={who} />
      </span>
    </>
  )
}

/** How many columns a grid has now. */
const useColumns = (ref: RefObject<HTMLElement | null>) => {
  const [columns, setColumns] = useState(4)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const read = () => setColumns(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length))
    read()
    const watch = new ResizeObserver(read)
    watch.observe(el)
    return () => watch.disconnect()
  }, [ref])
  return columns
}

/** A cubic Bézier easing, as CSS draws one. */
const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  return (t: number) => {
    let at = t
    for (let i = 0; i < 8; i++) {
      const slope = (3 * ax * at + 2 * bx) * at + cx
      if (Math.abs(slope) < 1e-6) break
      at -= (((ax * at + bx) * at + cx) * at - t) / slope
    }
    at = Math.min(1, Math.max(0, at))
    return ((ay * at + by) * at + cy) * at
  }
}
/** The kit's --ease-fold, for a scroll that keeps pace with the fold. */
const easeFold = bezier(0.32, 0.72, 0, 1)

const scrollerOf = (el: HTMLElement): HTMLElement | null => {
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    const y = getComputedStyle(at).overflowY
    if (y === 'auto' || y === 'scroll') return at
  }
  return null
}

/**
 * Brings a panel into view as it opens, frame by frame at the fold's own pace, so the page and the panel move as one;
 * never so far that the row it opened from leaves the top, nor, over the first row, the heading above it.
 */
const followFold = (drawer: HTMLElement, height: number, first: boolean) => {
  const scroller = scrollerOf(drawer)
  if (scroller === null) return
  const view = scroller.getBoundingClientRect()
  const top = drawer.getBoundingClientRect().top
  // What stays in sight: the row the panel opened from, and over the first row, the heading above the grid too.
  const keep = first ? drawer.parentElement?.previousElementSibling : drawer.previousElementSibling
  const row = keep?.getBoundingClientRect().top ?? top
  const by = Math.min(top + height + 16 - view.bottom, row - view.top - 12)
  if (by <= 0) return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    requestAnimationFrame(() => scroller.scrollBy({ top: by }))
    return
  }
  const takes = Number.parseFloat(getComputedStyle(scroller).getPropertyValue('--fold')) || 320
  const start = performance.now()
  // By steps, not to a place: a panel folding shut above moves the page too, and the browser's scroll anchoring keeps that.
  let gone = 0
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / takes)
    const to = by * easeFold(t)
    scroller.scrollTop += to - gone
    gone = to
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** Numbers what's inside as it mounts, so its rows rise in one after another. */
function Rise({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    ref.current
      ?.querySelectorAll<HTMLElement>('section > :first-child, li')
      .forEach((el, i) => el.style.setProperty('--i', String(Math.min(i, 10))))
  }, [])
  return (
    <div ref={ref} className={s.rise}>
      {children}
    </div>
  )
}

/**
 * The panel under a row: it grows out of the row on the kit's fold, its notch on the opened tile; another tile in the
 * row slides the notch over, on the kit's spring, and the height morphs to what's in it now. Closing, it folds back,
 * quicker than it came.
 */
function Drawer({
  picks,
  who,
  open,
  column,
  columns,
  first,
}: {
  picks: Picks
  who: Source
  open: boolean
  column: number
  columns: number
  /** Under the first row. */
  first: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const followed = useRef<Source | null>(null)
  // What it showed before another tile in the row took it over: it fades out over what rises in.
  const [was, setWas] = useState<Source | null>(null)
  const [last, setLast] = useState(who)
  if (last !== who) {
    setLast(who)
    setWas(last)
  }
  useEffect(() => {
    if (was === null) return
    const done = setTimeout(() => setWas(null), 260)
    return () => clearTimeout(done)
  }, [was])
  useLayoutEffect(() => {
    const el = inner.current
    if (el === null) return
    // Measured after the first layout, at no height: the change to its height is the fold.
    const watch = new ResizeObserver(() => setHeight(el.offsetHeight))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  useEffect(() => {
    if (!open) {
      followed.current = null
      return
    }
    if (height === 0 || followed.current === who || box.current === null) return
    followed.current = who
    followFold(box.current, height, first)
  }, [open, who, height, first])
  return (
    <div
      ref={box}
      className={s.drawer}
      data-open={open || undefined}
      inert={!open}
      style={{ '--h': `${open ? height : 0}px`, '--notch': (column + 0.5) / columns } as CSSProperties}
    >
      <div ref={inner} className={s.drawerInner}>
        <div className={s.inside}>
          <span className={s.notch} aria-hidden="true" />
          {was !== null && open && (
            <div key={`was-${was}`} className={s.was} aria-hidden="true" inert>
              <ByKind picks={narrowed(picks, picks.setsOf([was]))} setup={false} />
            </div>
          )}
          <Rise key={who}>
            <ByKind picks={narrowed(picks, picks.setsOf([who]))} setup={false} />
          </Rise>
        </div>
      </div>
    </div>
  )
}

/** K: H's tiles; a tile's chevron opens what's in it in a panel under its row, to pick inside. */
export function OpeningTiles({ picks }: { picks: Picks }) {
  const [open, setOpen] = useState<Source | null>(null)
  // A panel folding shut while another opens in another row.
  const [leaving, setLeaving] = useState<{ readonly row: number; readonly who: Source } | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const columns = useColumns(grid)
  const sources = offered(picks)
  const rowOf = (who: Source) => Math.floor(sources.indexOf(who) / columns)
  const toggle = (who: Source | null) => {
    const next = who === open ? null : who
    if (open !== null && (next === null || rowOf(next) !== rowOf(open))) setLeaving({ row: rowOf(open), who: open })
    setOpen(next)
  }
  useEffect(() => {
    if (leaving === null) return
    const done = setTimeout(() => setLeaving(null), 420)
    return () => clearTimeout(done)
  }, [leaving])
  useEffect(() => {
    if (open === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setLeaving({ row: Math.floor(sources.indexOf(open) / columns), who: open })
      setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, sources, columns])
  return (
    <div className={s.wrap}>
      <SectionHead title={text.found} count={sources.length}>
        <AllNone onAll={() => takeAll(picks, sources, true)} onNone={() => takeAll(picks, sources, false)} />
      </SectionHead>
      <div className={s.openGrid} ref={grid}>
        {sources.map((who, i) => {
          const { state } = tileState(picks, who)
          const isOpen = open === who
          const row = Math.floor(i / columns)
          const lastOfRow = i === Math.min(sources.length, (row + 1) * columns) - 1
          const here =
            open !== null && rowOf(open) === row
              ? { who: open, open: true }
              : leaving !== null && leaving.row === row
                ? { who: leaving.who, open: false }
                : null
          return (
            <Fragment key={who}>
              <div className={s.tile} data-state={state} data-open={isOpen || undefined}>
                <button type="button" className={s.take} aria-pressed={state === 'on'} onClick={() => picks.source(who, state !== 'on')}>
                  <Face picks={picks} who={who} />
                </button>
                <button
                  type="button"
                  className={s.open}
                  aria-expanded={isOpen}
                  aria-label={text.inside(nameOf(who))}
                  title={text.lookInside}
                  onClick={() => toggle(who)}
                >
                  <Icon name="chevronD" size={13} />
                </button>
              </div>
              {lastOfRow && here !== null && (
                <Drawer
                  key={`row-${row}`}
                  picks={picks}
                  who={here.who}
                  open={here.open}
                  column={sources.indexOf(here.who) % columns}
                  columns={columns}
                  first={row === 0}
                />
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

interface Thing {
  readonly key: string
  readonly title: string
  readonly at: string
  readonly fact?: ReactNode
  readonly on: boolean
  readonly set: (on: boolean) => void
  /** How many it stands for: the older conversations are one line. */
  readonly weight: number
}

/** What a tile has inside, newest first: an agent's conversations, then its older ones as a line; a tool's worktrees. */
const thingsIn = (picks: Picks, who: Source): readonly Thing[] => {
  const t = picks.things(who)
  if (!isAgent(who))
    return [...t.worktrees]
      .sort((a, b) => b.touched.localeCompare(a.touched))
      .map((one) => ({
        key: one.id,
        title: one.title,
        at: when(one.touched),
        fact: <WorktreeFacts one={one} first />,
        on: picks.worktrees.has(one.id),
        set: (on: boolean) => picks.worktree(one.id, on),
        weight: 1,
      }))
  const listed = [...t.conversations]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((one) => ({
      key: one.id,
      title: one.title,
      at: when(one.at),
      on: picks.conversations.has(one.id),
      set: (on: boolean) => picks.conversation(one.id, on),
      weight: 1,
    }))
  return t.older > 0
    ? [
        ...listed,
        {
          key: 'older',
          title: text.older(t.older),
          at: '',
          on: picks.olderOf(who),
          set: (on: boolean) => picks.setOlderOf(who, on),
          weight: t.older,
        },
      ]
    : listed
}

const PEEK = 3

function PeekTile({ picks, who }: { picks: Picks; who: Source }) {
  const [full, setFull] = useState(false)
  const { state, picked, of } = tileState(picks, who)
  const things = thingsIn(picks, who)
  const shown = full ? things : things.slice(0, PEEK)
  const hidden = things.slice(shown.length).reduce((n, one) => n + one.weight, 0)
  return (
    <div className={s.peek} data-state={state}>
      <button type="button" className={s.peekHead} aria-pressed={state === 'on'} onClick={() => picks.source(who, state !== 'on')}>
        <Mark of={who} size={20} />
        <span className={s.peekTitle}>
          <span className={s.name}>{nameOf(who)}</span>
          <span className={s.count}>
            {sizeOf(picks, who)}
            {state === 'mixed' && <span className={s.some}> · {shortcut.someOf(picked, of)}</span>}
          </span>
        </span>
        <Box state={state} />
      </button>
      <ul className={s.peekList}>
        {shown.map((one) => (
          <li key={one.key}>
            <label className={s.peekItem} data-off={!one.on || undefined}>
              <Tick on={one.on} onChange={one.set} label={one.title} />
              <span className={s.peekMain}>
                <span className={s.peekLine}>
                  <span className={s.peekName} title={one.title}>
                    {one.title}
                  </span>
                  <span className={s.peekAt}>{one.at}</span>
                </span>
                {one.fact !== undefined && <span className={s.peekFact}>{one.fact}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {(hidden > 0 || full) && things.length > PEEK && (
        <div className={s.peekFoot}>
          <LinkButton onClick={() => setFull((now) => !now)}>{full ? text.fewer : text.more(hidden)}</LinkButton>
        </div>
      )}
    </div>
  )
}

/** L: bigger tiles, each showing its latest few things, tickable on the tile; a tile's head takes all of it. */
export function PeekTiles({ picks }: { picks: Picks }) {
  const sources = offered(picks)
  return (
    <div className={s.wrap}>
      <SectionHead title={text.found} count={sources.length}>
        <AllNone onAll={() => takeAll(picks, sources, true)} onNone={() => takeAll(picks, sources, false)} />
      </SectionHead>
      <div className={s.peekGrid}>
        {sources.map((who) => (
          <PeekTile key={who} picks={picks} who={who} />
        ))}
      </div>
    </div>
  )
}

/** M's line on a tile: how much of it comes, in its own unit. */
function MeterLine({ picks, who }: { picks: Picks; who: Source }) {
  const { state, picked, of } = tileState(picks, who)
  const unit = isAgent(who) ? shortcut.conversations : shortcut.worktrees
  if (state === 'on' && of > 1) return <>{text.allOf(unit(of))}</>
  if (state === 'mixed') return <>{`${picked} of ${unit(of)}`}</>
  return <>{unit(of)}</>
}

/** M: what's under way at first, grouped by kind; a meter on each tile says how much of it comes. */
export function MeterTiles({ picks }: { picks: Picks }) {
  const [list, setList] = useState(false)
  const sources = offered(picks)
  const groups = [
    { title: shortcut.agents, sources: sources.filter(isAgent) },
    { title: shortcut.tools, sources: sources.filter((who) => !isAgent(who)) },
  ]
  return (
    <div className={s.wrap}>
      {groups.map((group) => (
        <section key={group.title} className={s.group}>
          <SectionHead title={group.title} count={group.sources.length}>
            <AllNone onAll={() => takeAll(picks, group.sources, true)} onNone={() => takeAll(picks, group.sources, false)} />
          </SectionHead>
          <div className={s.grid}>
            {group.sources.map((who) => {
              const { state, picked, of } = tileState(picks, who)
              return (
                <div key={who} className={s.tile} data-state={state}>
                  <button type="button" className={s.take} aria-pressed={state === 'on'} onClick={() => picks.source(who, state !== 'on')}>
                    <Face picks={picks} who={who} line={<MeterLine picks={picks} who={who} />} />
                    <span className={s.meter}>
                      <span className={s.meterFill} style={{ width: `${of === 0 ? 0 : (picked / of) * 100}%` }} />
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      <div className={s.foot}>
        {!picks.is('underway') && <LinkButton onClick={() => picks.pick('underway')}>{text.backToUnderway}</LinkButton>}
        <span className={s.grow} />
        <LinkButton onClick={() => setList((now) => !now)}>{list ? text.hideList : text.lookInside}</LinkButton>
      </div>
      {list && (
        <div className={s.listUnder}>
          <ByKind picks={picks} />
        </div>
      )}
    </div>
  )
}
