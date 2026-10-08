import { type KeyboardEvent, type PointerEvent, useRef } from 'react'

import { cx } from '../../lib/cx'
import s from './ResizeHandle.module.css'

/*
 * The edge of a column, to drag it wider or narrower: the hairline between
 * two panes, with room to catch it. It sits over its column's edge, so the
 * column must be positioned. The arrow keys move it a step, Home and End to
 * its narrowest and widest, and a double click puts it back. The width is
 * the consumer's: `onChange` follows the drag, and `onCommit` says where it
 * ended (the pointer let go, a key moved it), so it is kept once a move.
 */

export interface ResizeHandleProps {
  /** The column's width now, in px. */
  value: number
  min: number
  max: number
  onChange: (width: number) => void
  /** Where a move ended, once: the pointer let go, or a key moved it. Keep the width here, not on every change. */
  onCommit?: (width: number) => void
  /** Puts the width back, on a double click; without it, a double click does nothing. */
  onReset?: () => void
  /** What it resizes, as its name: Width of the conversation. */
  label: string
  /** Which edge of its column it is on: the end widens the column to the right. */
  edge?: 'start' | 'end'
  /** How far an arrow key moves it, in px. */
  step?: number
  className?: string
}

const clamp = (width: number, min: number, max: number) => Math.round(Math.min(Math.max(width, min), Math.max(min, max)))

export function ResizeHandle({
  value,
  min,
  max,
  onChange,
  onCommit,
  onReset,
  label,
  edge = 'end',
  step = 16,
  className,
}: ResizeHandleProps) {
  const drag = useRef<{ readonly x: number; readonly width: number; at: number } | null>(null)
  const sign = edge === 'end' ? 1 : -1

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width: value, at: value }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    if (from === null) return
    from.at = clamp(from.width + (event.clientX - from.x) * sign, min, max)
    onChange(from.at)
  }
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (from !== null && from.at !== from.width) onCommit?.(from.at)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const to =
      event.key === 'ArrowLeft'
        ? value - step * sign
        : event.key === 'ArrowRight'
          ? value + step * sign
          : event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : null
    if (to === null) return
    event.preventDefault()
    const width = clamp(to, min, max)
    onChange(width)
    onCommit?.(width)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={clamp(value, min, max)}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      tabIndex={0}
      className={cx(s.handle, edge === 'end' ? s.end : s.start, className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => (drag.current = null)}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  )
}
