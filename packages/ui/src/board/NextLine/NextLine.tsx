import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { ListMotion } from '../../lib/ListMotion'
import { useReorder } from '../../lib/useReorder'
import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import b from '../Board/Board.module.css'
import s from './NextLine.module.css'

/*
 * The line up next: the tasks waiting for a free agent, in the order they
 * start, which the person puts in the order they want. Any part of a row
 * takes hold of it: pressed and moved, the row lifts and follows the pointer,
 * the others slide aside to show where it would land, and the lane scrolls
 * when the pointer is held at its edge. Let go, and it settles into its place
 * and the line keeps that order; a press that doesn't move is a click, and
 * still opens the task. Pointing at a row shows its grip in the lane's margin:
 * a click on it, or Enter on it, opens the same moves as a menu, the way
 * without dragging, and ⌥⇧↑ and ⌥⇧↓ on a row's grip move it a place. Escape
 * while dragging puts the row back. How the row is followed is the project
 * tabs' (`useReorder`), down a column instead of along a bar. Moved by its
 * menu or by key, or put back where a move failed, a row slides to its place
 * (ListMotion, the board's where it is in one); dragged, it is the drag's.
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
  /** A row at its place in line, from 1: while one is dragged, its place as it stands, and the new one once it is let go. */
  render: (id: string, place: number) => ReactNode
  /**
   * The person moved a row to a place, from 0, the rest keeping their order:
   * the line shows it so at once, and goes back where a promise it gives
   * fails. Without it, nothing moves and no grip shows.
   */
  onMove?: (id: string, to: number) => void | Promise<unknown>
  text?: Partial<NextLineText>
}

/** How long a row takes to settle into its place once let go, in milliseconds: the others' slide (`--base`). */
export const LAND = 180

/**
 * How long an acknowledged move shows before the line given rules again,
 * should the runtime never say otherwise, in milliseconds. A backstop, not
 * the way a move ends: the line shows the order put until the runtime's
 * list says it, however long that takes.
 */
export const SETTLE = 15000

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
 * after a long while where the line given never changes.
 */
interface Put {
  readonly order: ReadonlyArray<string>
  readonly from: ReadonlyArray<string>
  readonly settled: boolean
}

export function NextLine({ rows, render, onMove, text }: NextLineProps) {
  const t = { ...nextLineText, ...text }
  const ids = rows.map((row) => row.id)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const [put, setPut] = useState<Put | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const list = useRef<HTMLOListElement>(null)
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

  const { dragging, bind, cancel } = useReorder({
    ids: shown,
    movable: movable ? shown.length : 0,
    list,
    axis: 'y',
    settle: LAND,
    // The rows hold buttons of their own (the title opens the task): a click on one must still reach it.
    grab: 'drag',
    onReorder: (id, beforeId) => {
      const others = shown.filter((one) => one !== id)
      const at = beforeId === null ? -1 : others.indexOf(beforeId)
      move(id, at < 0 ? others.length : at)
    },
  })

  // Rows measured at the press are no longer the rows there are, where one joined or left under the pointer.
  const line = shown.join('\n')
  const measured = useRef(line)
  useEffect(() => {
    if (measured.current !== line) cancel()
    measured.current = line
  }, [line, cancel])

  // A row moved by key has been taken out of the document and put back where it goes: its grip is given the focus again.
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    if (refocus.current === null) return
    const row = Array.from(list.current?.children ?? []).find((one) => (one as HTMLElement).dataset.row === refocus.current)
    row?.querySelector<HTMLElement>('[data-grip]')?.focus()
    refocus.current = null
  })

  const shifted = (id: string): CSSProperties | undefined => {
    if (dragging === null) return undefined
    const y = dragging.id === id ? dragging.offset : (dragging.shifts[id] ?? 0)
    return y === 0 ? undefined : { transform: `translateY(${y}px)` }
  }

  return (
    <ListMotion within={list} still={dragging !== null}>
      <ol ref={list} className={cx(b.list, s.list, dragging !== null && s.sorting)}>
        {shown.map((id, index) => {
          const row = byId.get(id)
          if (row === undefined) return null
          const held = movable ? bind(id) : undefined
          const lifted = dragging?.id === id
          return (
            <li
              key={id}
              data-row={id}
              data-move={id}
              className={cx(s.item, lifted && s.lifted, lifted && dragging.settling && s.settling)}
              style={shifted(id)}
              {...(held === undefined
                ? {}
                : {
                    onPointerDown: held.onPointerDown,
                    onPointerMove: held.onPointerMove,
                    onPointerUp: held.onPointerUp,
                    onPointerCancel: held.onPointerCancel,
                    onLostPointerCapture: held.onLostPointerCapture,
                    onClickCapture: held.onClickCapture,
                    // Ahead of the grip's own: ⌥⇧↓ must not open its menu.
                    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => {
                      // Not the menu's, which React sends up through its portal.
                      if (!event.currentTarget.contains(event.target as Node)) return
                      held.onKeyDown(event)
                      if (!event.defaultPrevented) return
                      event.stopPropagation()
                      refocus.current = id
                    },
                  })}
            >
              {movable && (
                <Menu
                  label={t.menu}
                  open={menu === id}
                  onOpenChange={(open) => setMenu(open ? id : null)}
                  placement="below"
                  align="start"
                  trigger={
                    <button
                      type="button"
                      data-grip=""
                      className={s.grip}
                      aria-label={t.grip(row.title)}
                      // Opened by its click, which a drag from it doesn't make, rather than by the press that may start one.
                      onPointerDown={(event: PointerEvent<HTMLElement>) => event.button === 0 && event.preventDefault()}
                      onClick={() => setMenu(id)}
                    />
                  }
                >
                  <MenuItem icon="up" disabled={index === 0} onSelect={() => move(id, 0)}>
                    {t.front}
                  </MenuItem>
                  <MenuItem disabled={index === 0} onSelect={() => move(id, index - 1)}>
                    {t.up}
                  </MenuItem>
                  <MenuItem disabled={index === shown.length - 1} onSelect={() => move(id, index + 1)}>
                    {t.down}
                  </MenuItem>
                  <MenuItem icon="down" disabled={index === shown.length - 1} onSelect={() => move(id, shown.length - 1)}>
                    {t.back}
                  </MenuItem>
                </Menu>
              )}
              {render(id, index + 1)}
            </li>
          )
        })}
      </ol>
    </ListMotion>
  )
}
