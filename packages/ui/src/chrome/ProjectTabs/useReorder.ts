import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react'

/*
 * Dragging a project's tab along the bar. Pointer events, not the browser's
 * drag and drop: the bar is the window's drag region, and only its buttons
 * take the pointer, so a tab's button is what is held, and the pointer stays
 * with it (captured) however far it goes. The tab follows the pointer; the
 * others give way by a tab's width, so the gap shows where it would land;
 * let go there and it lands. The list scrolls when the pointer is held at
 * its edge. A press that doesn't move is a click, and still switches to the
 * tab. ⌥⇧← and ⌥⇧→ on a focused tab move it one place; Escape while
 * dragging puts it back.
 */

/** How far the pointer goes before a press is a drag, in pixels. */
const SLOP = 4
/** How near the list's edge the pointer scrolls it, and how fast, in pixels. */
const EDGE = 28
const SCROLL = 10

export interface Dragging {
  id: string
  /** How far the dragged tab is from its place, in pixels. */
  offset: number
  /** How far each of the others gives way, by id. */
  shifts: Readonly<Record<string, number>>
}

interface Press {
  id: string
  pointer: number
  startX: number
  clientX: number
  scroll: number
  /** Each tab's left and width in the list's own scrolled space, in order. */
  lefts: number[]
  widths: number[]
  from: number
  /** Where the tabs between the dragged one and its place end up: the dragged tab's width and a gap. */
  step: number
  to: number
  moving: boolean
  frame: number
}

export interface ReorderOptions {
  /** The tabs' ids, in order. */
  ids: readonly string[]
  /** How many from the start may move; the rest, such as a project still being made, stay at the end. */
  movable: number
  list: RefObject<HTMLUListElement | null>
  /** `id` goes before `beforeId`; at the end where that is null or isn't there. */
  onReorder?: ((id: string, beforeId: string | null) => void) | undefined
}

export function useReorder({ ids, movable, list, onReorder }: ReorderOptions) {
  const [dragging, setDragging] = useState<Dragging | null>(null)
  const press = useRef<Press | null>(null)
  // A drag ends in the click the browser sends to the button: that one is not a press to switch.
  const dragged = useRef(false)
  const latest = useRef({ ids, movable, onReorder })
  latest.current = { ids, movable, onReorder }

  const place = useCallback(() => {
    const p = press.current
    const element = list.current
    if (p === null || element === null || !p.moving) return
    const { movable: count } = latest.current
    const first = p.lefts[0] ?? 0
    const last = Math.max(count - 1, 0)
    const width = p.widths[p.from] ?? 0
    const lowest = first
    const highest = (p.lefts[last] ?? 0) + (p.widths[last] ?? 0) - width
    const offset = Math.min(
      Math.max(p.clientX - p.startX + element.scrollLeft - p.scroll, lowest - (p.lefts[p.from] ?? 0)),
      highest - (p.lefts[p.from] ?? 0),
    )
    const left = (p.lefts[p.from] ?? 0) + offset
    const right = left + width
    // Its place is past every tab on the side it goes whose middle its leading edge has passed.
    let to = p.from
    for (let i = 0; i < count; i++) {
      const middle = (p.lefts[i] ?? 0) + (p.widths[i] ?? 0) / 2
      if (i > p.from && right > middle) to = i
      if (i < p.from && left < middle) to = Math.min(to, i)
    }
    p.to = to
    const shifts: Record<string, number> = {}
    latest.current.ids.forEach((id, i) => {
      if (i === p.from) return
      if (p.from < to && i > p.from && i <= to) shifts[id] = -p.step
      else if (p.from > to && i >= to && i < p.from) shifts[id] = p.step
    })
    setDragging({ id: p.id, offset, shifts })
  }, [list])

  const finish = useCallback((commit: boolean) => {
    const p = press.current
    if (p === null) return
    cancelAnimationFrame(p.frame)
    press.current = null
    if (p.moving) {
      dragged.current = true
      // The click that follows has come by the next turn.
      setTimeout(() => (dragged.current = false), 0)
      if (commit && p.to !== p.from) {
        const others = latest.current.ids.filter((id) => id !== p.id)
        latest.current.onReorder?.(p.id, others[p.to] ?? null)
      }
    }
    setDragging(null)
  }, [])

  // Scrolls while the pointer is held at an edge of the list.
  const scrolling = useCallback(() => {
    const p = press.current
    const element = list.current
    if (p === null || element === null || !p.moving) return
    const box = element.getBoundingClientRect()
    const by = p.clientX < box.left + EDGE ? -SCROLL : p.clientX > box.right - EDGE ? SCROLL : 0
    if (by !== 0) {
      const was = element.scrollLeft
      element.scrollLeft += by
      if (element.scrollLeft !== was) place()
    }
    p.frame = requestAnimationFrame(scrolling)
  }, [list, place])

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
  useEffect(() => () => cancelAnimationFrame(press.current?.frame ?? 0), [])

  /** What a tab's button takes to be held and moved, and moved by key. */
  const bind = (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const element = list.current
      const from = latest.current.ids.indexOf(id)
      if (
        element === null ||
        event.button !== 0 ||
        !event.isPrimary ||
        from < 0 ||
        from >= latest.current.movable ||
        latest.current.onReorder === undefined
      )
        return
      const box = element.getBoundingClientRect()
      const tabs = Array.from(element.children).map((child) => child.getBoundingClientRect())
      const lefts = tabs.map((rect) => rect.left - box.left + element.scrollLeft)
      const widths = tabs.map((rect) => rect.width)
      const next = tabs[from + 1]
      const gap = next === undefined ? 2 : next.left - (tabs[from]?.right ?? 0)
      press.current = {
        id,
        pointer: event.pointerId,
        startX: event.clientX,
        clientX: event.clientX,
        scroll: element.scrollLeft,
        lefts,
        widths,
        from,
        step: (widths[from] ?? 0) + gap,
        to: from,
        moving: false,
        frame: 0,
      }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const p = press.current
      if (p === null || p.pointer !== event.pointerId) return
      p.clientX = event.clientX
      if (!p.moving) {
        if (Math.abs(event.clientX - p.startX) < SLOP) return
        p.moving = true
        event.currentTarget.setPointerCapture(event.pointerId)
        p.frame = requestAnimationFrame(scrolling)
      }
      place()
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (press.current?.pointer === event.pointerId) finish(true)
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (press.current?.pointer === event.pointerId) finish(false)
    },
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!dragged.current) return
      event.preventDefault()
      event.stopPropagation()
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const { ids: all, movable: count, onReorder: move } = latest.current
      const at = all.indexOf(id)
      if (move === undefined || at < 0 || at >= count) return
      event.preventDefault()
      if (event.key === 'ArrowLeft') {
        if (at > 0) move(id, all[at - 1] ?? null)
      } else if (at < count - 1) move(id, all[at + 2] ?? null)
    },
  })

  return { dragging, bind }
}
