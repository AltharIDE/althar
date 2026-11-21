import { Checkbox } from 'radix-ui'
import { type CSSProperties, Fragment, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './OtherTools.module.css'

/*
 * What other tools left for a project, to bring in (docs/decisions/workspaces-and-runs.md, "Bringing in other tools'
 * work"): a tile for each tool, its mark, how much it has and its most pressing fact. A press on a tile takes all of
 * it, or leaves all of it; its chevron opens what's in it in a panel under its row, to pick inside. The panel grows
 * out of its row on the kit's fold, a notch under the tile it opened from; another tile in the row slides the notch
 * over on the spring as what was there fades and what's in it now rises in, a row after another. Escape closes it.
 */

export interface OtherToolItem {
  /** Its key, as picks name it. */
  readonly key: string
  readonly title: string
  /** When it was last worked on, said. */
  readonly at?: string
  /** A line under its title: a branch and folder, how long a conversation is. */
  readonly where?: ReactNode
  /** What's pressing about it, each on the line under. */
  readonly facts?: ReadonlyArray<ReactNode>
  /** Its own mark, where it isn't the tile's: a conversation's agent. */
  readonly brand?: Brand
}

export interface OtherToolGroup {
  readonly title: string
  readonly items: ReadonlyArray<OtherToolItem>
}

export interface OtherToolTile {
  readonly id: string
  readonly name: string
  /** Its mark; without one, `icon`, as a branch for worktrees made by hand. */
  readonly brand?: Brand
  readonly icon?: IconName
  /** How much it has, said: "3 worktrees". */
  readonly size: string
  /** Its most pressing fact, under. */
  readonly fact?: ReactNode
  readonly groups: ReadonlyArray<OtherToolGroup>
}

export interface OtherToolsText {
  heading: string
  all: string
  none: string
  /** The chevron's name: what's in a tool. */
  inside: (tool: string) => string
  lookInside: string
  /** Part of a tool picked. */
  someOf: (picked: number, of: number) => string
}

export const otherToolsText: OtherToolsText = {
  heading: 'Found',
  all: 'All',
  none: 'None',
  inside: (tool) => `What’s in ${tool}`,
  lookInside: 'Look inside',
  someOf: (picked, of) => `${picked} of ${of}`,
}

export type OtherToolsProps = RootProps<
  'div',
  {
    tiles: ReadonlyArray<OtherToolTile>
    /** The keys picked. */
    picked: ReadonlySet<string>
    /** Picks or leaves these keys: a tile's all, a group's All or None, or one row. */
    onPick: (keys: ReadonlyArray<string>, on: boolean) => void
    /** The tile open at first. */
    defaultOpen?: string
    text?: Partial<OtherToolsText>
  }
>

type State = 'on' | 'mixed' | 'off'

const keysOf = (tile: OtherToolTile) => tile.groups.flatMap((group) => group.items.map((item) => item.key))
const stateOf = (keys: ReadonlyArray<string>, picked: ReadonlySet<string>): { state: State; n: number } => {
  const n = keys.filter((key) => picked.has(key)).length
  return { state: n === 0 ? 'off' : n === keys.length ? 'on' : 'mixed', n }
}

function Mark({ brand, icon, size }: { brand?: Brand; icon?: IconName; size: number }) {
  return (
    <span className={s.mark} style={{ width: size, height: size }} aria-hidden="true">
      {brand === undefined ? <Icon name={icon ?? 'branch'} size={size - 2} /> : <BrandMark brand={brand} size={size} />}
    </span>
  )
}

/** The tile's own tick: all of it, some, none. */
function Box({ state }: { state: State }) {
  return (
    <span className={s.box} data-state={state}>
      {state === 'on' ? <Icon name="check" size={11} /> : state === 'mixed' ? <span className={s.dash} /> : null}
    </span>
  )
}

/** How many columns a grid has now. */
const useColumns = (ref: RefObject<HTMLElement | null>) => {
  const [columns, setColumns] = useState(3)
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
  const cx3 = 3 * x1
  const bx = 3 * (x2 - x1) - cx3
  const ax = 1 - cx3 - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  return (t: number) => {
    let at = t
    for (let i = 0; i < 8; i++) {
      const slope = (3 * ax * at + 2 * bx) * at + cx3
      if (Math.abs(slope) < 1e-6) break
      at -= (((ax * at + bx) * at + cx3) * at - t) / slope
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
function Rise({ children, className }: { children: ReactNode; className: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('[data-rise]').forEach((el, i) => el.style.setProperty('--i', String(Math.min(i, 10))))
  }, [])
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}

/** What's in a tool, by group: a head with All and None, and a tick for each. */
function Inside({
  tile,
  picked,
  onPick,
  t,
}: {
  tile: OtherToolTile
  picked: ReadonlySet<string>
  onPick: OtherToolsProps['onPick']
  t: OtherToolsText
}) {
  return (
    <div className={s.groups}>
      {tile.groups
        .filter((group) => group.items.length > 0)
        .map((group) => {
          const keys = group.items.map((item) => item.key)
          return (
            <section key={group.title} className={s.group}>
              <div className={s.head} data-rise>
                <h4 className={s.headTitle}>
                  {group.title}
                  <span className={s.headCount}>{group.items.length}</span>
                </h4>
                <span className={s.grow} />
                {group.items.length > 1 && (
                  <span className={s.allNone}>
                    <LinkButton onClick={() => onPick(keys, true)}>{t.all}</LinkButton>
                    <LinkButton onClick={() => onPick(keys, false)}>{t.none}</LinkButton>
                  </span>
                )}
              </div>
              <ul className={s.list}>
                {group.items.map((item) => {
                  const on = picked.has(item.key)
                  return (
                    <li key={item.key} className={s.row} data-off={!on || undefined} data-rise>
                      <label className={s.rowHit}>
                        <Checkbox.Root className={s.tick} checked={on} onCheckedChange={(next) => onPick([item.key], next === true)}>
                          <Checkbox.Indicator className={s.tickMark}>
                            <Icon name="check" size={10} />
                          </Checkbox.Indicator>
                        </Checkbox.Root>
                        <Mark brand={item.brand ?? tile.brand} {...(tile.icon === undefined ? {} : { icon: tile.icon })} size={16} />
                        <span className={s.main}>
                          <span className={s.titleLine}>
                            <span className={s.name} title={item.title}>
                              {item.title}
                            </span>
                            {item.at !== undefined && <span className={s.at}>{item.at}</span>}
                          </span>
                          {item.where !== undefined && <span className={s.where}>{item.where}</span>}
                          {item.facts !== undefined && item.facts.length > 0 && (
                            <span className={s.facts}>
                              {item.facts.map((fact, i) => (
                                <span key={i} className={s.fact}>
                                  {fact}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
    </div>
  )
}

/**
 * The panel under a row: it grows out of the row on the kit's fold, its notch on the opened tile; another tile in the
 * row slides the notch over, on the spring, and the height morphs to what's in it now. Closing, it folds back, quicker.
 */
function Drawer({
  tile,
  open,
  column,
  columns,
  first,
  picked,
  onPick,
  t,
}: {
  tile: OtherToolTile
  open: boolean
  column: number
  columns: number
  first: boolean
  picked: ReadonlySet<string>
  onPick: OtherToolsProps['onPick']
  t: OtherToolsText
}) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const followed = useRef<string | null>(null)
  // What it showed before another tile in the row took it over: it fades out over what rises in.
  const [was, setWas] = useState<OtherToolTile | null>(null)
  const [last, setLast] = useState(tile)
  if (last.id !== tile.id) {
    setLast(tile)
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
    if (height === 0 || followed.current === tile.id || box.current === null) return
    followed.current = tile.id
    followFold(box.current, height, first)
  }, [open, tile.id, height, first])
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
            <div key={`was-${was.id}`} className={s.was} aria-hidden="true" inert>
              <Inside tile={was} picked={picked} onPick={onPick} t={t} />
            </div>
          )}
          <Rise key={tile.id} className={s.rise}>
            <Inside tile={tile} picked={picked} onPick={onPick} t={t} />
          </Rise>
        </div>
      </div>
    </div>
  )
}

/** What other tools left, a tile each: a press takes all of a tool, its chevron opens what's in it to pick inside. */
export function OtherTools({ tiles, picked, onPick, defaultOpen, text, className, ...rest }: OtherToolsProps) {
  const t = { ...otherToolsText, ...text }
  const [open, setOpen] = useState<string | null>(defaultOpen ?? null)
  // A panel folding shut while another opens in another row.
  const [leaving, setLeaving] = useState<{ readonly row: number; readonly id: string } | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const columns = useColumns(grid)
  const ids = tiles.map((tile) => tile.id)
  const rowOf = (id: string) => Math.floor(ids.indexOf(id) / columns)
  const toggle = (id: string) => {
    const next = id === open ? null : id
    if (open !== null && (next === null || rowOf(next) !== rowOf(open))) setLeaving({ row: rowOf(open), id: open })
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
      if (event.key !== 'Escape' || event.defaultPrevented) return
      setLeaving({ row: Math.floor(ids.indexOf(open) / columns), id: open })
      setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, ids, columns])
  const all = tiles.flatMap(keysOf)
  return (
    <div className={cx(s.wrap, className)} {...rest}>
      <div className={s.top}>
        <h3 className={s.heading}>
          {t.heading}
          <span className={s.headCount}>{tiles.length}</span>
        </h3>
        <span className={s.grow} />
        <span className={s.allNone}>
          <LinkButton onClick={() => onPick(all, true)}>{t.all}</LinkButton>
          <LinkButton onClick={() => onPick(all, false)}>{t.none}</LinkButton>
        </span>
      </div>
      <div className={s.grid} ref={grid}>
        {tiles.map((tile, i) => {
          const keys = keysOf(tile)
          const { state, n } = stateOf(keys, picked)
          const isOpen = open === tile.id
          const row = Math.floor(i / columns)
          const lastOfRow = i === Math.min(tiles.length, (row + 1) * columns) - 1
          const here =
            open !== null && rowOf(open) === row
              ? { id: open, open: true }
              : leaving !== null && leaving.row === row
                ? { id: leaving.id, open: false }
                : null
          const shown = here === null ? undefined : tiles.find((one) => one.id === here.id)
          return (
            <Fragment key={tile.id}>
              <div className={s.tile} data-state={state} data-open={isOpen || undefined}>
                <button type="button" className={s.take} aria-pressed={state === 'on'} onClick={() => onPick(keys, state !== 'on')}>
                  <span className={s.faceTop}>
                    <Mark brand={tile.brand} {...(tile.icon === undefined ? {} : { icon: tile.icon })} size={22} />
                    <Box state={state} />
                  </span>
                  <span className={s.tileName}>{tile.name}</span>
                  <span className={s.size}>
                    {tile.size}
                    {state === 'mixed' && <span className={s.some}> · {t.someOf(n, keys.length)}</span>}
                  </span>
                  <span className={s.tileFact}>{tile.fact}</span>
                </button>
                <button
                  type="button"
                  className={s.open}
                  aria-expanded={isOpen}
                  aria-label={t.inside(tile.name)}
                  title={t.lookInside}
                  onClick={() => toggle(tile.id)}
                >
                  <Icon name="chevronD" size={13} />
                </button>
              </div>
              {lastOfRow && here !== null && shown !== undefined && (
                <Drawer
                  key={`row-${row}`}
                  tile={shown}
                  open={here.open}
                  column={ids.indexOf(here.id) % columns}
                  columns={columns}
                  first={row === 0}
                  picked={picked}
                  onPick={onPick}
                  t={t}
                />
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
