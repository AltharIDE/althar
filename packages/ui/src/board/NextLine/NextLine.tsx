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
 * drop, so the row moves with the pointer captured however far it goes.
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

const same = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => a.length === b.length && a.every((id, i) => id === b[i])

/** The line with `id` moved to `to`, from 0. */
const moved = (order: ReadonlyArray<string>, id: string, to: number) => {
  const others = order.filter((one) => one !== id)
  const at = Math.max(0, Math.min(others.length, to))
  return [...others.slice(0, at), id, ...others.slice(at)]
}

interface Press {
  readonly id: string
  readonly pointer: number
  readonly y: number
  moving: boolean
  order: ReadonlyArray<string>
}

export function NextLine({ rows, render, onMove, text }: NextLineProps) {
  const t = { ...nextLineText, ...text }
  const ids = rows.map((row) => row.id)
  const byId = new Map(rows.map((row) => [row.id, row]))
  // While a row is dragged, the order it would make; once moved, that order until the line given says it too.
  const [drag, setDrag] = useState<{ readonly id: string; readonly order: ReadonlyArray<string> } | null>(null)
  const [put, setPut] = useState<ReadonlyArray<string> | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const press = useRef<Press | null>(null)
  const items = useRef(new Map<string, HTMLLIElement>())
  if (put !== null && same(put, ids)) setPut(null)
  // What was put, with what joined since at its end and what left gone.
  const shown = put === null ? ids : [...put.filter((id) => byId.has(id)), ...ids.filter((id) => !put.includes(id))]
  const order = drag?.order ?? shown
  const movable = onMove !== undefined && rows.length > 1

  const move = (id: string, to: number) => {
    const next = moved(shown, id, to)
    if (same(next, shown)) return
    setPut(next)
    const going = onMove?.(id, next.indexOf(id))
    if (going !== undefined) going.catch(() => setPut((now) => (now === next ? null : now)))
  }

  const finish = (commit: boolean) => {
    const held = press.current
    press.current = null
    setDrag(null)
    if (held === null) return
    if (!held.moving) {
      if (commit) setMenu(held.id)
      return
    }
    if (commit) move(held.id, held.order.indexOf(held.id))
  }

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      const held = press.current
      if (held !== null) held.moving = true
      press.current = null
      setDrag(null)
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [dragging])

  const grip = (id: string) => ({
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !event.isPrimary) return
      // The grip's own press: it drags, or on release opens its menu, rather than the menu opening at once.
      event.preventDefault()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Not an active pointer (a synthetic one): its release still reaches the grip.
      }
      press.current = { id, pointer: event.pointerId, y: event.clientY, moving: false, order: shown }
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const held = press.current
      if (held === null || held.pointer !== event.pointerId) return
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
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (press.current?.pointer === event.pointerId) finish(true)
    },
    onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
      if (press.current?.pointer === event.pointerId) finish(false)
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
