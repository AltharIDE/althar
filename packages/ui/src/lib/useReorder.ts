import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

import { reducedMotion } from './motion'

/*
 * Dragging an item of a list to another place in it: a project's tab along
 * the bar, a row up next down the lane. Pointer events, not the browser's
 * drag and drop. The items are measured once, when the press is made; the
 * dragged one follows the pointer by an offset, and the others give way by
 * its extent, so the gap shows where it would land. Nothing is reordered in
 * the document until the item is let go, so no item is measured twice and no
 * place flickers at a boundary. Let go there and it lands: it settles into
 * its place first where the list asks for it (`settle`), and only then is the
 * new order given. The list scrolls when the pointer is held at its edge. A
 * press that doesn't move is a click. ⌥⇧ and an arrow along the axis move a
 * focused item one place; Escape while dragging puts it back.
 *
 * The pointer stays with the item (captured) however far it goes: from the
 * press, where the item is itself the button that is held (`grab: 'press'`),
 * or from the first move, where the item holds buttons of its own that a
 * click must still reach (`grab: 'drag'`). Until then the press's moves are
 * followed on the window too: pressed on a grip in the list's margin, the
 * pointer can leave the item before it has gone far enough to drag it.
 */

export type Axis = 'x' | 'y'

/** How far the pointer goes before a press is a drag, in pixels. */
const SLOP = 4
/** How near the list's edge the pointer scrolls it, and how fast, in pixels. */
const EDGE = 28
const SCROLL = 10

/** What an axis is called on a rect, an element and an event, and which arrows move along it. */
const along = {
  x: {
    start: 'left',
    end: 'right',
    size: 'width',
    scroll: 'scrollLeft',
    client: 'clientX',
    overflow: 'overflowX',
    back: 'ArrowLeft',
    forward: 'ArrowRight',
  },
  y: {
    start: 'top',
    end: 'bottom',
    size: 'height',
    scroll: 'scrollTop',
    client: 'clientY',
    overflow: 'overflowY',
    back: 'ArrowUp',
    forward: 'ArrowDown',
  },
} as const

/** The nearest ancestor of the list, itself included, that scrolls along the axis: the list itself where none does. */
const scrollerOf = (list: HTMLElement, axis: Axis): HTMLElement => {
  const { overflow } = along[axis]
  for (let element: HTMLElement | null = list; element !== null && element !== document.documentElement; element = element.parentElement) {
    const style = getComputedStyle(element)[overflow]
    if (style === 'auto' || style === 'scroll' || style === 'overlay') return element
  }
  return list
}

export interface Dragging {
  id: string
  /** How far the dragged item is from its place, in pixels. */
  offset: number
  /** How far each of the others gives way, by id. */
  shifts: Readonly<Record<string, number>>
  /** Let go: the item is settling into its place, and the new order is given when it has. */
  settling: boolean
}

interface Press {
  id: string
  pointer: number
  start: number
  client: number
  scroll: number
  scroller: HTMLElement
  /** Each item's start and size along the axis, in the scroller's own scrolled space, in order. */
  starts: number[]
  sizes: number[]
  from: number
  /** How far the items between the dragged one and its place give way: its size and a gap. */
  step: number
  to: number
  moving: boolean
  frame: number
}

export interface ReorderOptions {
  /** The items' ids, in order. */
  ids: readonly string[]
  /** How many from the start may move; the rest, such as a project still being made, stay at the end. */
  movable: number
  /** The list the items are children of. It, or the nearest ancestor that scrolls along the axis, is scrolled at its edge. */
  list: RefObject<HTMLElement | null>
  /** `id` goes before `beforeId`; at the end where that is null or isn't there. */
  onReorder?: ((id: string, beforeId: string | null) => void) | undefined
  /** Along the bar (`x`, the default) or down a column (`y`). */
  axis?: Axis
  /** How long a dragged item takes to settle into its place once let go, in milliseconds; 0 for no settling, the order given at once. */
  settle?: number
  /** Whether the pointer is captured from the press (the default) or only once the item is dragged. */
  grab?: 'press' | 'drag'
}

export function useReorder({ ids, movable, list, onReorder, axis = 'x', settle = 0, grab = 'press' }: ReorderOptions) {
  const [dragging, setDragging] = useState<Dragging | null>(null)
  const press = useRef<Press | null>(null)
  // A drag ends in the click the browser sends to the button: that one is not a press to switch.
  const dragged = useRef(false)
  // Let go, settling into its place: no new press until it has.
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ ids, movable, onReorder, axis, settle, grab })
  latest.current = { ids, movable, onReorder, axis, settle, grab }

  const place = useCallback(() => {
    const p = press.current
    if (p === null || !p.moving) return
    const { movable: count, axis: a } = latest.current
    const at = along[a]
    const first = p.starts[0] ?? 0
    const last = Math.max(count - 1, 0)
    const size = p.sizes[p.from] ?? 0
    const lowest = first
    const highest = (p.starts[last] ?? 0) + (p.sizes[last] ?? 0) - size
    const offset = Math.min(
      Math.max(p.client - p.start + p.scroller[at.scroll] - p.scroll, lowest - (p.starts[p.from] ?? 0)),
      highest - (p.starts[p.from] ?? 0),
    )
    const near = (p.starts[p.from] ?? 0) + offset
    const far = near + size
    // Its place is past every item on the side it goes whose middle its leading edge has passed.
    let to = p.from
    for (let i = 0; i < count; i++) {
      const middle = (p.starts[i] ?? 0) + (p.sizes[i] ?? 0) / 2
      if (i > p.from && far > middle) to = i
      if (i < p.from && near < middle) to = Math.min(to, i)
    }
    p.to = to
    const shifts: Record<string, number> = {}
    latest.current.ids.forEach((id, i) => {
      if (i === p.from) return
      if (p.from < to && i > p.from && i <= to) shifts[id] = -p.step
      else if (p.from > to && i >= to && i < p.from) shifts[id] = p.step
    })
    setDragging({ id: p.id, offset, shifts, settling: false })
    // The words under a dragged item are not for selecting.
    window.getSelection?.()?.removeAllRanges()
  }, [])

  const finish = useCallback((commit: boolean) => {
    const p = press.current
    if (p === null) return
    cancelAnimationFrame(p.frame)
    press.current = null
    if (!p.moving) {
      setDragging(null)
      return
    }
    dragged.current = true
    // The click that follows has come by the next turn.
    setTimeout(() => (dragged.current = false), 0)
    const lands = commit && p.to !== p.from
    const done = () => {
      if (lands) {
        const others = latest.current.ids.filter((id) => id !== p.id)
        latest.current.onReorder?.(p.id, others[p.to] ?? null)
      }
      setDragging(null)
    }
    const { settle: ms } = latest.current
    if (ms <= 0 || reducedMotion()) return done()
    // To the place it lands in, or back to its own, the others with it.
    const from = p.starts[p.from] ?? 0
    const target = lands
      ? p.to > p.from
        ? (p.starts[p.to] ?? 0) + (p.sizes[p.to] ?? 0) - (p.sizes[p.from] ?? 0) - from
        : (p.starts[p.to] ?? 0) - from
      : 0
    setDragging((now) => (now === null ? now : { ...now, offset: target, shifts: lands ? now.shifts : {}, settling: true }))
    settling.current = setTimeout(() => {
      settling.current = null
      done()
    }, ms)
  }, [])

  // Scrolls while the pointer is held at an edge of the list.
  const scrolling = useCallback(() => {
    const p = press.current
    if (p === null || !p.moving) return
    const at = along[latest.current.axis]
    const box = p.scroller.getBoundingClientRect()
    const by = p.client < box[at.start] + EDGE ? -SCROLL : p.client > box[at.end] - EDGE ? SCROLL : 0
    if (by !== 0) {
      const was = p.scroller[at.scroll]
      p.scroller[at.scroll] += by
      if (p.scroller[at.scroll] !== was) place()
    }
    p.frame = requestAnimationFrame(scrolling)
  }, [place])

  /** Drops the drag where it is, for the list changed under it: nothing is given, nothing settles. */
  const cancel = useCallback(() => {
    cancelAnimationFrame(press.current?.frame ?? 0)
    press.current = null
    if (settling.current !== null) clearTimeout(settling.current)
    settling.current = null
    setDragging(null)
  }, [])

  const active = dragging !== null
  useEffect(() => {
    if (!active) return
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      finish(false)
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [active, finish])
  useEffect(
    () => () => {
      cancelAnimationFrame(press.current?.frame ?? 0)
      if (settling.current !== null) clearTimeout(settling.current)
    },
    [],
  )

  /** The held pointer moved: a drag once it has gone far enough, which then takes the pointer (`hold`) where the item asks. */
  const moved = (pointer: number, buttons: number, client: number, hold: () => void) => {
    const p = press.current
    if (p === null || p.pointer !== pointer) return
    // The button is no longer down, so its release was missed: this is hover, not a drag.
    if (buttons === 0) {
      finish(false)
      return
    }
    p.client = client
    if (!p.moving) {
      if (Math.abs(p.client - p.start) < SLOP) return
      p.moving = true
      p.frame = requestAnimationFrame(scrolling)
      if (latest.current.grab === 'drag') hold()
    }
    place()
  }

  /** What an item (or the button in it) takes to be held and moved, and moved by key. */
  const bind = (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const element = list.current
      const { ids: all, movable: count, onReorder: move, axis: a, grab: how } = latest.current
      const from = all.indexOf(id)
      if (
        element === null ||
        settling.current !== null ||
        event.button !== 0 ||
        !event.isPrimary ||
        from < 0 ||
        from >= count ||
        move === undefined ||
        // A menu or popover in a portal sends its presses up through React's tree, not the document's.
        !event.currentTarget.contains(event.target as Node)
      )
        return
      const at = along[a]
      const scroller = scrollerOf(element, a)
      const box = scroller.getBoundingClientRect()
      const items = Array.from(element.children).map((child) => child.getBoundingClientRect())
      const starts = items.map((rect) => rect[at.start] - box[at.start] + scroller[at.scroll])
      const sizes = items.map((rect) => rect[at.size])
      const next = items[from + 1]
      const gap = next === undefined ? (a === 'x' ? 2 : 0) : next[at.start] - (items[from]?.[at.end] ?? 0)
      const held: Press = {
        id,
        pointer: event.pointerId,
        start: event[at.client],
        client: event[at.client],
        scroll: scroller[at.scroll],
        scroller,
        starts,
        sizes,
        from,
        step: (sizes[from] ?? 0) + gap,
        to: from,
        moving: false,
        frame: 0,
      }
      press.current = held
      // Held from the press, so the release reaches this button wherever the pointer has gone.
      if (how === 'press') {
        capture(event)
        return
      }
      // Off the item, until it is dragged and takes the pointer, its moves reach none of its handlers: followed here.
      const item = event.currentTarget
      const follow = (move: globalThis.PointerEvent) => {
        if (press.current !== held || held.moving) {
          window.removeEventListener('pointermove', follow, true)
          return
        }
        if (item.contains(move.target as Node)) return
        moved(move.pointerId, move.buttons, move[along[latest.current.axis].client], () => {
          try {
            item.setPointerCapture(move.pointerId)
          } catch {
            // Not an active pointer: the buttons check on a move still ends a missed press.
          }
        })
      }
      window.addEventListener('pointermove', follow, true)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) =>
      moved(event.pointerId, event.buttons, event[along[latest.current.axis].client], () => capture(event)),
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (press.current?.pointer === event.pointerId) finish(true)
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (press.current?.pointer === event.pointerId) finish(false)
    },
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
      if (press.current?.pointer === event.pointerId) finish(false)
    },
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!dragged.current) return
      event.preventDefault()
      event.stopPropagation()
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return
      const { ids: all, movable: count, onReorder: move, axis: a } = latest.current
      const at = along[a]
      if (event.key !== at.back && event.key !== at.forward) return
      const index = all.indexOf(id)
      if (move === undefined || index < 0 || index >= count) return
      event.preventDefault()
      if (event.key === at.back) {
        if (index > 0) move(id, all[index - 1] ?? null)
      } else if (index < count - 1) move(id, all[index + 2] ?? null)
    },
  })

  return { dragging, bind, cancel }
}

function capture(event: PointerEvent<HTMLElement>) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    // Not an active pointer (a synthetic one): the buttons check on a move still ends a missed press.
  }
}
