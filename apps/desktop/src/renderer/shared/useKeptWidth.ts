import { useEffect, useState } from 'react'

/*
 * A column's width as the person last dragged it (a ResizeHandle's), kept in
 * this window across launches under `key`: never narrower than `min`, and
 * never so wide that what is beside it has less than `rest` of the window.
 * Where storage won't take it, it holds for this window all the same.
 */

export interface KeptWidth {
  readonly key: string
  /** Its width before the person drags it, and as a double click puts it back. */
  readonly start: number
  readonly min: number
  /** The least of the window left for what is beside it. */
  readonly rest: number
}

const held = new Map<string, number>()

const storedWidth = ({ key, start, min }: KeptWidth): number => {
  const kept = held.get(key)
  if (kept !== undefined) return kept
  try {
    const stored = window.localStorage.getItem(key)
    const width = Number(stored)
    return stored !== null && Number.isFinite(width) && width >= min ? width : start
  } catch {
    return start
  }
}

export const useKeptWidth = (kept: KeptWidth) => {
  const [width, setWidth] = useState(() => storedWidth(kept))
  const [room, setRoom] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setRoom(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const max = Math.max(kept.min, room - kept.rest)
  const keep = (next: number) => {
    setWidth(next)
    try {
      window.localStorage.setItem(kept.key, String(next))
      held.delete(kept.key)
    } catch {
      // Not kept across launches; it still holds for this window.
      held.set(kept.key, next)
    }
  }
  return {
    width: Math.min(Math.max(width, kept.min), max),
    min: kept.min,
    max,
    set: setWidth,
    keep,
    reset: () => keep(kept.start),
  }
}
