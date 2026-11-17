import { monitorEventLoopDelay } from 'node:perf_hooks'

/*
 * How late the main process's thread ran (docs/decisions/foundations.md,
 * The UI is instant): it carries every window's messages and the runtime's,
 * and work that holds it holds every one of them. Every few seconds main.log
 * says how late its event loop ran, where it ran late at all, as the
 * runtime's log says of its own (`lag.ts` in the runtime), with the same
 * 100 ms: in a packaged build as in development, so a slowness a person
 * reports has its evidence in the logs they send. Only on this computer.
 * Beside it, what the window says of its own slow frames and presses
 * (renderer/shared/frames.ts), as main takes it: only what that says, and
 * only in the words it may use.
 */

/** How late the loop may run before a window of it is said. */
export const LATE_MS = 100

/** How long each window of it is. */
export const EVERY_MS = 5_000

/** How late the loop ran over the last window: its worst, its p99 and its mean, in milliseconds. */
export interface Lag {
  readonly maxMs: number
  readonly p99Ms: number
  readonly meanMs: number
}

/** What a histogram of the loop's delay says, as a window of it. */
export const lagOf = (histogram: { readonly max: number; readonly mean: number; percentile(p: number): number }): Lag => {
  const ms = (ns: number) => Math.round(ns / 1e5) / 10
  return { maxMs: ms(histogram.max), p99Ms: ms(histogram.percentile(99)), meanMs: Number.isNaN(histogram.mean) ? 0 : ms(histogram.mean) }
}

/** Calls `tick` every `every` milliseconds, without keeping the process open, until the returned function is called. */
const everyFew = (tick: () => void, every: number) => {
  const timer = setInterval(tick, every)
  timer.unref()
  return () => clearInterval(timer)
}

export interface LagWatch {
  readonly every?: number
  readonly late?: number
  /** How a window is read: the loop's own histogram unless a test says. */
  readonly read?: () => Lag
  readonly schedule?: (tick: () => void, every: number) => () => void
}

/** Says each window in which the loop ran later than `late`, until the returned function is called. */
export const watchLag = (said: (lag: Lag) => void, { every = EVERY_MS, late = LATE_MS, read, schedule = everyFew }: LagWatch = {}) => {
  const histogram = read === undefined ? monitorEventLoopDelay({ resolution: 20 }) : undefined
  histogram?.enable()
  const take =
    read ??
    (() => {
      const lag = lagOf(histogram ?? { max: 0, mean: 0, percentile: () => 0 })
      histogram?.reset()
      return lag
    })
  const stop = schedule(() => {
    const lag = take()
    if (lag.maxMs > late) said(lag)
  }, every)
  return () => {
    stop()
    histogram?.disable()
  }
}

/** A slow frame or press of the window's, as main keeps it in its log. */
export interface WindowFrame {
  readonly kind: 'frame' | 'task' | 'press'
  readonly ms: number
  readonly blockingMs?: number
  readonly event?: string
  readonly on?: string
  readonly script?: string
}

const KINDS = new Set(['frame', 'task', 'press'])
/** The most a batch may hold, as the window sends at most. */
const MOST = 20
/** What the window may say of what a frame or press was on, and nothing else: the marks `frames.ts` keeps. */
const WORD = /^[\w.:#$<>-]{1,120}$/

const msIn = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), 600_000) : null
const wordIn = (value: unknown) => (typeof value === 'string' && WORD.test(value) ? value : undefined)

/** What the window sent of its slow frames, as far as it is what `frames.ts` sends; nothing for anything else. */
export const framesIn = (said: unknown): { readonly frames: ReadonlyArray<WindowFrame>; readonly more: number } | null => {
  if (typeof said !== 'object' || said === null) return null
  const { frames, more } = said as Record<string, unknown>
  if (!Array.isArray(frames)) return null
  const kept = frames.slice(0, MOST).flatMap((one: unknown): ReadonlyArray<WindowFrame> => {
    if (typeof one !== 'object' || one === null) return []
    const { kind, ms, blockingMs, event, on, script } = one as Record<string, unknown>
    const took = msIn(ms)
    if (typeof kind !== 'string' || !KINDS.has(kind) || took === null) return []
    const blocking = msIn(blockingMs)
    const [named, where, ran] = [wordIn(event), wordIn(on), wordIn(script)]
    return [
      {
        kind: kind as WindowFrame['kind'],
        ms: took,
        ...(blocking === null ? {} : { blockingMs: blocking }),
        ...(named === undefined ? {} : { event: named }),
        ...(where === undefined ? {} : { on: where }),
        ...(ran === undefined ? {} : { script: ran }),
      },
    ]
  })
  return { frames: kept, more: (msIn(more) ?? 0) + Math.max(0, frames.length - MOST) }
}
