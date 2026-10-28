import { Component, type ReactNode, type RefObject } from 'react'

import { MOTION, reducedMotion, SCALE } from './motion'

/*
 * Lists that move as a whole (DESIGN.md, Motion). Inside `within`, every
 * element with a `data-move` key is an item, keyed the same wherever it
 * shows: a task's id is its card's key in every lane of the board. Each time
 * the component that renders this updates, it takes where every item stands
 * just before the document changes, and once it has:
 *
 * - an item still there, somewhere else, slides from where it stood;
 * - an item drawn again somewhere else (a card that changed lanes) travels
 *   there as a copy drawn above the page, which no lane's edge cuts off,
 *   while the item waits unseen in its place;
 * - a new item comes in, and a gone one fades where it stood, where the
 *   list it was in still shows.
 *
 * Only `translate`, `scale` and `opacity` move, by the Web Animations API:
 * a move already on its way to the same place carries on, one sent
 * elsewhere turns from where it is, the item's own transform stays its own,
 * and nothing is laid out again. Nothing moves when the list is first drawn,
 * while it doesn't show, where an item changed width (the window or a lane
 * did, not the order), or where much of it changed at once: a screen drawn
 * afresh isn't an arrival. With reduced motion nothing travels; what comes
 * and goes only fades.
 */

/** More than this many items coming, or going, at once is a list drawn afresh: they show, or go, at once. */
const FRESH = 6

export type ListEnter = 'rise' | 'grow'

export interface ListMotionProps {
  /** The element its lists are in. */
  readonly within: RefObject<HTMLElement | null>
  /** How a new item comes in: rises a little into its place (a card, a row), or grows there (a chip, a tab). */
  readonly enter?: ListEnter
  readonly children?: ReactNode
}

interface Stood {
  readonly el: HTMLElement
  /** Where it showed, a move of ours under way included. */
  readonly rect: DOMRect
  /** The list it is in, past a list item wrapping it alone: a gone item fades only while this still shows. */
  readonly list: Element | null
}

type Snapshot = ReadonlyMap<string, Stood>

export class ListMotion extends Component<ListMotionProps> {
  override getSnapshotBeforeUpdate(): Snapshot | null {
    const root = this.props.within.current
    if (root === null || !moves(root)) return null
    const stood = new Map<string, Stood>()
    for (const el of itemsIn(root))
      stood.set(el.dataset.move!, { el, rect: running.get(el)?.shown() ?? el.getBoundingClientRect(), list: listOf(el) })
    return stood
  }

  override componentDidUpdate(_props: ListMotionProps, _state: unknown, before: Snapshot | null) {
    const root = this.props.within.current
    if (before === null || root === null || !moves(root)) return
    const items = itemsIn(root)
    // Read everything, then write: where each is laid out now, whatever of ours moves it.
    const to = items.map((el) => running.get(el)?.place() ?? el.getBoundingClientRect())
    const came = items.filter((el) => !before.has(el.dataset.move!))
    const keys = new Set(items.map((el) => el.dataset.move!))
    const went = [...before].filter(([key]) => !keys.has(key)).map(([, was]) => was)
    const reduced = reducedMotion()
    const goes = items.map((el, i) => {
      const was = before.get(el.dataset.move!)
      const now = running.get(el)
      // On its way to where it is laid out already: it carries on.
      if (was === undefined || (now !== undefined && same(now.to, to[i]!))) return null
      now?.stop()
      const from = was.rect
      if (reduced || !moved(from, to[i]!) || resized(from, to[i]!) || (offscreen(from) && offscreen(to[i]!))) return null
      return { el, from, to: to[i]!, again: was.el !== el, far: Math.hypot(from.left - to[i]!.left, from.top - to[i]!.top) }
    })
    const furthest = Math.max(0, ...goes.map((one) => one?.far ?? 0))
    for (const one of goes) {
      if (one === null) continue
      if (one.again) travel(one.el, one.from, one.to)
      else slide(one.el, one.from, one.to, one.far === furthest)
    }
    if (came.length <= FRESH) for (const el of came) enter(el, this.props.enter ?? 'rise', reduced)
    if (went.length <= FRESH)
      for (const was of went) if (!was.el.isConnected && was.list?.isConnected === true) leave(was.el, was.rect, reduced)
  }

  override render() {
    return this.props.children
  }
}

/* ——— What it reads ——— */

/** Whether anything can move here: the browser animates, and the list shows. */
const moves = (root: HTMLElement) => typeof root.animate === 'function' && (root.checkVisibility?.() ?? true)

/** Its items, each key once, the first in the document's order. */
const itemsIn = (root: HTMLElement) => {
  const seen = new Set<string>()
  return [...root.querySelectorAll<HTMLElement>('[data-move]')].filter((el) => {
    const key = el.dataset.move!
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const listOf = (el: HTMLElement) => {
  const parent = el.parentElement
  return parent !== null && parent.tagName === 'LI' && parent.childElementCount === 1 ? parent.parentElement : parent
}

const moved = (from: DOMRect, to: DOMRect) => Math.abs(from.left - to.left) >= 0.5 || Math.abs(from.top - to.top) >= 0.5
const same = (one: DOMRect, other: DOMRect) => !moved(one, other)
const resized = (from: DOMRect, to: DOMRect) => Math.abs(from.width - to.width) >= 1
const offscreen = (r: DOMRect) => r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth

const clear = (color: string) => color === 'transparent' || color === 'rgba(0, 0, 0, 0)'
/** The first background behind it, for a see-through row that passes others. */
const backdrop = (el: Element) => {
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    const color = getComputedStyle(at).backgroundColor
    if (color !== '' && !clear(color)) return color
  }
  return 'var(--paper)'
}

/** How far a `translate` of ours has it from its place. */
const translated = (el: Element) => {
  const [x = 0, y = 0] = getComputedStyle(el)
    .translate.split(' ')
    .map((one) => Number.parseFloat(one) || 0)
  return { x, y }
}
const shift = (r: DOMRect, x: number, y: number) => new DOMRect(r.left + x, r.top + y, r.width, r.height)

/* ——— Where copies are drawn: above the page, below its dialogs, to the eye alone ——— */

let shelf: HTMLElement | null = null
const layer = () => {
  if (shelf?.isConnected === true) return shelf
  shelf = document.createElement('div')
  shelf.className = 'ch-root'
  shelf.setAttribute('aria-hidden', 'true')
  shelf.inert = true
  Object.assign(shelf.style, { position: 'fixed', inset: '0', zIndex: 'var(--z-float)', pointerEvents: 'none', overflow: 'hidden' })
  document.body.append(shelf)
  return shelf
}

/** Lays it in the layer where `at` is, keyed by nothing and naming nothing. */
const lay = (el: HTMLElement, at: DOMRect) => {
  el.removeAttribute('data-move')
  for (const named of [el, ...el.querySelectorAll('[id]')]) named.removeAttribute('id')
  Object.assign(el.style, {
    position: 'absolute',
    left: `${at.left}px`,
    top: `${at.top}px`,
    width: `${at.width}px`,
    height: `${at.height}px`,
    margin: '0',
    boxSizing: 'border-box',
  })
  layer().append(el)
  return el
}

/* ——— What it does ——— */

interface Running {
  /** Where it is going. */
  readonly to: DOMRect
  /** Where it shows now. */
  readonly shown: () => DOMRect
  /** Where it is laid out now, without us. */
  readonly place: () => DOMRect
  readonly stop: () => void
}

/** What of ours is moving each item. */
const running = new Map<HTMLElement, Running>()

const journey = (el: HTMLElement, one: Animation, ran: Omit<Running, 'stop'>, done: () => void) => {
  const end = () => {
    if (running.get(el)?.to !== ran.to) return
    running.delete(el)
    done()
  }
  // Stopped, it puts back what it changed at once: its cancel event comes later, after the next move began.
  running.set(el, {
    ...ran,
    stop: () => {
      end()
      one.cancel()
    },
  })
  one.addEventListener('finish', end)
  one.addEventListener('cancel', end)
}

/** Slides from where it stood; the one going furthest rides above the rest, each with what is behind it. */
const slide = (el: HTMLElement, from: DOMRect, to: DOMRect, above: boolean) => {
  const was = { background: el.style.background, zIndex: el.style.zIndex, position: el.style.position }
  if (clear(getComputedStyle(el).backgroundColor)) el.style.background = backdrop(el)
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
  el.style.zIndex = above ? '2' : '1'
  const one = el.animate([{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: '0px 0px' }], MOTION.move)
  journey(
    el,
    one,
    {
      to,
      shown: () => el.getBoundingClientRect(),
      place: () => {
        const by = translated(el)
        return shift(el.getBoundingClientRect(), -by.x, -by.y)
      },
    },
    () => Object.assign(el.style, was),
  )
}

/** Travels from where it stood, as a copy above the page, while it waits unseen in its new place. */
const travel = (el: HTMLElement, from: DOMRect, to: DOMRect) => {
  const twin = lay(el.cloneNode(true) as HTMLElement, to)
  if (clear(getComputedStyle(el).backgroundColor)) twin.style.background = backdrop(el)
  const hidden = el.style.visibility
  el.style.visibility = 'hidden'
  const one = twin.animate([{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: '0px 0px' }], MOTION.move)
  journey(el, one, { to, shown: () => twin.getBoundingClientRect(), place: () => el.getBoundingClientRect() }, () => {
    twin.remove()
    el.style.visibility = hidden
  })
}

const enter = (el: HTMLElement, how: ListEnter, reduced: boolean) => {
  if (reduced) return void el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.exit.duration, easing: 'linear' })
  const from = how === 'rise' ? { opacity: 0, translate: '0px 6px', scale: String(SCALE.pop) } : { opacity: 0, scale: '0.9' }
  el.animate([from, { opacity: 1, translate: '0px 0px', scale: '1' }], MOTION.enter)
}

/** Fades where it stood: no longer the page's, it is its own copy. */
const leave = (el: HTMLElement, at: DOMRect, reduced: boolean) => {
  for (const one of el.getAnimations()) one.cancel()
  lay(el, at)
  const one = el.animate(
    reduced ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1 }, { opacity: 0, scale: String(SCALE.pop) }],
    reduced ? { duration: MOTION.exit.duration, easing: 'linear' } : MOTION.exit,
  )
  const gone = () => el.remove()
  one.addEventListener('finish', gone)
  one.addEventListener('cancel', gone)
}
