import { useEffect, useState } from 'react'

/*
 * How wide the conversation's workbench is (the kit's Workbench: what opens
 * beside the thread), as the person last dragged it: this window's own,
 * kept across launches, as the conversation's width beside the board is.
 * It starts at a third of the window, and never leaves the conversation
 * narrower than a readable measure.
 */

export const BENCH = { key: 'althar.bench', min: 360, talk: 420 } as const

/**
 * A web page beside the conversation has a width of its own (ADR-100): it
 * starts at half the window, a page being wider than a document, and leaves
 * the conversation a little more.
 */
export const PAGE_BENCH = { key: 'althar.bench.page', min: 360, talk: 440 } as const

type Bench = typeof BENCH | typeof PAGE_BENCH

/** A third of the window, between 400 and 520: room for a file's lines without taking the conversation's; for a page, half of it. */
const startOf = (bench: Bench) => () =>
  bench === PAGE_BENCH
    ? Math.round(Math.max(bench.min, Math.min(window.innerWidth / 2, window.innerWidth - bench.talk)))
    : Math.round(Math.min(520, Math.max(400, window.innerWidth / 3)))

const storedOf = (bench: Bench) => (): number => {
  try {
    const kept = Number(window.localStorage.getItem(bench.key))
    return Number.isFinite(kept) && kept >= bench.min ? kept : startOf(bench)()
  } catch {
    return startOf(bench)()
  }
}

/** The workbench's width: dragged, kept once a move ends, put back by a double click; `room` is what it may take of the window. */
export const useBenchWidth = (room?: number, bench: Bench = BENCH) => {
  const start = startOf(bench)
  const [width, setWidth] = useState(storedOf(bench))
  const [window_, setWindow] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = () => setWindow(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const max = Math.max(bench.min, room ?? window_ - bench.talk)
  const keep = (next: number) => {
    setWidth(next)
    try {
      window.localStorage.setItem(bench.key, String(next))
    } catch {
      // Not kept; it still holds for this window.
    }
  }
  const reset = () => {
    try {
      window.localStorage.removeItem(bench.key)
    } catch {
      // Nothing was kept.
    }
    setWidth(start())
  }
  return { width: Math.min(width, max), min: bench.min, max, set: setWidth, keep, reset }
}

export type BenchWidth = ReturnType<typeof useBenchWidth>
