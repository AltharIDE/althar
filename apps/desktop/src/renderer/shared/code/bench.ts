import { useEffect, useState } from 'react'

/*
 * How wide the conversation's workbench is (the kit's Workbench: what opens
 * beside the thread), as the person last dragged it: this window's own,
 * kept across launches, as the conversation's width beside the board is.
 * It starts at a third of the window, and never leaves the conversation
 * narrower than a readable measure.
 */

export const BENCH = { key: 'althar.bench', min: 360, talk: 420 } as const

/** A third of the window, between 400 and 520: room for a file's lines without taking the conversation's. */
const start = () => Math.round(Math.min(520, Math.max(400, window.innerWidth / 3)))

const stored = (): number => {
  try {
    const kept = Number(window.localStorage.getItem(BENCH.key))
    return Number.isFinite(kept) && kept >= BENCH.min ? kept : start()
  } catch {
    return start()
  }
}

/** The workbench's width: dragged, kept once a move ends, put back by a double click; `room` is what it may take of the window. */
export const useBenchWidth = (room?: number) => {
  const [width, setWidth] = useState(stored)
  const [window_, setWindow] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWindow(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const max = Math.max(BENCH.min, room ?? window_ - BENCH.talk)
  const keep = (next: number) => {
    setWidth(next)
    try {
      window.localStorage.setItem(BENCH.key, String(next))
    } catch {
      // Not kept; it still holds for this window.
    }
  }
  const reset = () => {
    try {
      window.localStorage.removeItem(BENCH.key)
    } catch {
      // Nothing was kept.
    }
    setWidth(start())
  }
  return { width: Math.min(width, max), min: BENCH.min, max, set: setWidth, keep, reset }
}

export type BenchWidth = ReturnType<typeof useBenchWidth>
