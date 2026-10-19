import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import b from '../Board/Board.module.css'
import s from './NextLine.module.css'

/*
 * The line up next: the tasks waiting for a free agent, in the order they
 * start, which the person puts in the order they want. Pointing at a row
 * shows its grip in the lane's margin. Dragging the grip lifts the row; the
 * others make room as it goes, and each row's place says where it would be.
 * Let go, and the line keeps that order. A click on the grip, or Enter on
 * it, opens the same moves as a menu, the way without dragging. Escape while
 * dragging puts the row back. Pointer events, not the browser's drag and
 * drop, followed on the window, so the row moves with the pointer however far
 * it goes and is let go wherever the pointer is.
 */

export interface NextLineText {
  /** The grip's name: what it moves. */
  grip: (title: string) => string
  menu: string
  front: string
  up: string
  down: string
  back: string
}

export const nextLineText: NextLineText = {
  grip: (title) => `Move ${title} in the line`,
  menu: 'Move in the line',
  front: 'Move to the front of the line',
  up: 'Move up',
  down: 'Move down',
  back: 'Move to the back of the line',
}

export interface NextLineRow {
  readonly id: string
  /** What the row's grip names. */
  readonly title: string
}

export interface NextLineProps {
  /** The rows in line, in the order they start. */
  rows: ReadonlyArray<NextLineRow>
  /** A row at its place in line, from 1: while one is dragged, the place it would take. */
  render: (id: string, place: number) => ReactNode
  /**
   * The person moved a row to a place, from 0, the rest keeping their order:
   * the line shows it so at once, and goes back where a promise it gives
   * fails. Without it, nothing moves and no grip shows.
   */
  onMove?: (id: string, to: number) => void | Promise<unknown>
  text?: Partial<NextLineText>
}

/** How far the pointer goes before a press on the grip is a drag rather than a click, in pixels. */
const SLOP = 4

/** How long an acknowledged move shows before the line given rules again, should it never say otherwise, in milliseconds. */
export const SETTLE = 2000

const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.length === b.length && a.every((id, i) => id === b[i])

/** The line with `id` moved to `to`, from 0. */
const moved = (order: ReadonlyArray<string>, id: string, to: number) => {
  const others = order.filter((one) => one !== id)
  const at = Math.max(0, Math.min(others.length, to))
  return [...others.slice(0, at), id, ...others.slice(at)]
}

/**
 * An order the person gave, shown at once, before the line given says it:
 * what the line was when they gave it, or once the move was acknowledged, the
 * line then. The next line given after the acknowledgement is the runtime's
 * word, whatever joined or left meanwhile, so the order put goes then, or
 * shortly after the acknowledgement where the line given never changes.
 */
interface Put {
  readonly order: ReadonlyArray<string>
  readonly from: ReadonlyArray<string>
  readonly settled: boolean
}

interface Press {
  readonly id: string
  readonly pointer: number
  readonly y: number
  moving: boolean
  order: ReadonlyArray<string>
  /** Stops following the pointer. */
  readonly stop: () => void
}

export function NextLine({ rows, render, onMove, text }: NextLineProps) {
  const t = { ...nextLineText, ...text }
  const ids = rows.map((row) => row.id)
  const byId = new Map(rows.map((row) => [row.id, row]))
  // While a row is dragged, the order it would make; once moved, that order until the line given says it too.
  const [drag, setDrag] = useState<{ readonly id: string; readonly order: ReadonlyArray<string> } | null>(null)
  const [put, setPut] = useState<Put | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const press = useRef<Press | null>(null)
  const items = useRef(new Map<string, HTMLLIElement>())
  // The line last drawn, for what an acknowledgement waits to see change.
  const drawn = useRef(ids)
  useEffect(() => {
    drawn.current = ids
  })
  // What was put, with what joined since at its end and what left gone.
  const shown = put === null ? ids : [...put.order.filter((id) => byId.has(id)), ...ids.filter((id) => !put.order.includes(id))]
  // The line given says what is shown, or has changed since the move was acknowledged: it rules again.
  if (put !== null && (same(shown, ids) || (put.settled && !same(ids, put.from)))) setPut(null)
  useEffect(() => {
    if (put === null || !put.settled) return
    const done = setTimeout(() => setPut((now) => (now === put ? null : now)), SETTLE)
    return () => clearTimeout(done)
  }, [put])
  const order = drag?.order ?? shown
  const movable = onMove !== undefined && rows.length > 1

  const move = (id: string, to: number) => {
    const next = moved(shown, id, to)
    if (same(next, shown)) return
    const going = onMove?.(id, next.indexOf(id))
    const mine: Put = { order: next, from: ids, settled: going === undefined }
    setPut(mine)
    if (going !== undefined)
      going.then(
        () => setPut((now) => (now === mine ? { ...mine, from: drawn.current, settled: true } : now)),
        () => setPut((now) => (now === mine ? null : now)),
      )
  }

  const finish = (commit: boolean) => {
    const held = press.current
    press.current = null
    setDrag(null)
    if (held === null) return
    held.stop()
    if (!held.moving) {
      if (commit) setMenu(held.id)
      return
    }
    if (commit) move(held.id, held.order.indexOf(held.id))
  }

  const over = (event: globalThis.PointerEvent) => {
    const held = press.current
    if (held === null) return
    // No button down: its release was missed, and this is hover.
    if (event.buttons === 0) return finish(false)
    if (!held.moving && Math.abs(event.clientY - held.y) < SLOP) return
    held.moving = true
    // It goes after every other row whose middle is above the pointer.
    const others = held.order.filter((one) => one !== held.id)
    const at = others.filter((one) => {
      const box = items.current.get(one)?.getBoundingClientRect()
      return box !== undefined && box.top + box.height / 2 < event.clientY
    }).length
    held.order = moved(held.order, held.id, at)
    setDrag({ id: held.id, order: held.order })
  }

  // The window's pointer events reach the latest of these, the line given perhaps changed since the press.
  const live = useRef({ finish, over })
  useEffect(() => {
    live.current = { finish, over }
  })
  useEffect(() => () => press.current?.stop(), [])

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    // Puts the row back; the release after it moves nothing.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      const held = press.current
      if (held !== null) held.moving = false
      live.current.finish(false)
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [dragging])

  const grip = (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !event.isPrimary) return
      // The grip's own press: it drags, or on release opens its menu, rather than the menu opening at once.
      event.preventDefault()
      // Followed on the window, not captured by the grip: moving its row in the list would let a capture go.
      const pointer = event.pointerId
      const moving = (one: globalThis.PointerEvent) => one.pointerId === pointer && live.current.over(one)
      const up = (one: globalThis.PointerEvent) => one.pointerId === pointer && live.current.finish(true)
      const cancel = (one: globalThis.PointerEvent) => one.pointerId === pointer && live.current.finish(false)
      window.addEventListener('pointermove', moving)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
      press.current?.stop()
      press.current = {
        id,
        pointer,
        y: event.clientY,
        moving: false,
        order: shown,
        stop: () => {
          window.removeEventListener('pointermove', moving)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', cancel)
        },
      }
    },
  })

  return (
    <ol className={b.list}>
      {order.map((id, index) => {
        const row = byId.get(id)
        if (row === undefined) return null
        return (
          <li
            key={id}
            ref={(element) => {
              if (element === null) items.current.delete(id)
              else items.current.set(id, element)
            }}
            className={cx(s.item, drag?.id === id && s.lifted)}
          >
            {movable && (
              <Menu
                label={t.menu}
                open={menu === id}
                // Opened from the keyboard at once; a press on the grip opens it on release, where it didn't drag.
                onOpenChange={(open) => setMenu(open ? (press.current === null ? id : null) : null)}
                placement="below"
                align="start"
                trigger={<button type="button" className={s.grip} aria-label={t.grip(row.title)} {...grip(id)} />}
              >
                <MenuItem icon="up" disabled={index === 0} onSelect={() => move(id, 0)}>
                  {t.front}
                </MenuItem>
                <MenuItem disabled={index === 0} onSelect={() => move(id, index - 1)}>
                  {t.up}
                </MenuItem>
                <MenuItem disabled={index === order.length - 1} onSelect={() => move(id, index + 1)}>
                  {t.down}
                </MenuItem>
                <MenuItem icon="down" disabled={index === order.length - 1} onSelect={() => move(id, order.length - 1)}>
                  {t.back}
                </MenuItem>
              </Menu>
            )}
            {render(id, index + 1)}
          </li>
        )
      })}
    </ol>
  )
}
