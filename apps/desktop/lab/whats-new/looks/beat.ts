import { useEffect, useState } from 'react'

/*
 * A drawing's beats, in time: a loop of moments, each starting at its time,
 * played only while the drawing is on screen, in a shown tab, with motion
 * allowed; otherwise it rests on one of them. From the site's changelog
 * pictures (#1097's branch), for the Where picture.
 */

/** A loop's beats: when each starts, in ms; the loop's length; the beat it rests on. */
export interface Timeline {
  readonly beats: readonly number[]
  readonly loop: number
  readonly rest: number
}

/** The beat it is on: it plays only while on screen, in a shown tab, with motion allowed; otherwise it rests on `rest`. */
export function useBeat(ref: { readonly current: HTMLElement | null }, { beats, loop, rest }: Timeline): number {
  const [beat, setBeat] = useState(rest)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const still = matchMedia('(prefers-reduced-motion: reduce)')
    // It starts where the drawing rests, so nothing jumps when it wakes.
    let t: number = beats[rest] ?? 0
    let since = 0
    let timer = 0
    let seen = false
    const step = () => {
      const now = performance.now()
      t = (t + now - since) % loop
      since = now
      const at = beats.findLastIndex((start) => start <= t)
      setBeat(at)
      timer = window.setTimeout(step, (beats[at + 1] ?? loop) - t + 1)
    }
    const sync = () => {
      window.clearTimeout(timer)
      if (seen && !document.hidden && !still.matches) {
        since = performance.now()
        step()
      } else if (still.matches) setBeat(rest)
    }
    const io = new IntersectionObserver((seen_) => {
      seen = seen_.at(-1)?.isIntersecting ?? false
      sync()
    })
    io.observe(el)
    document.addEventListener('visibilitychange', sync)
    still.addEventListener('change', sync)
    return () => {
      window.clearTimeout(timer)
      io.disconnect()
      document.removeEventListener('visibilitychange', sync)
      still.removeEventListener('change', sync)
    }
  }, [ref, beats, loop, rest])
  return beat
}
