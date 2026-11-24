import { type RefObject, useEffect, useRef, useState } from 'react'

import { useReducedMotion } from './motion'
import { useOnScreen } from './onScreen'

/*
 * A drawing's beats, in time: a loop of moments, each starting at its time,
 * played only while the drawing is on screen and motion is allowed. Off
 * screen it holds where it was, and goes on from there when it's back; with
 * motion reduced it rests on one beat, its most telling.
 */

/** A loop's beats: when each starts, in ms from the loop's start; the loop's length; the beat it rests on. */
export interface Timeline {
  readonly beats: readonly number[]
  readonly loop: number
  readonly rest: number
}

/** The beat a drawing is on. It starts on its rest, so nothing jumps when it wakes. */
export function useBeat(ref: RefObject<Element | null>, { beats, loop, rest }: Timeline): number {
  const onScreen = useOnScreen(ref)
  const still = useReducedMotion()
  const [beat, setBeat] = useState(rest)
  // Where in the loop it is, kept across a pause off screen.
  const t = useRef(beats[rest] ?? 0)
  useEffect(() => {
    if (still || !onScreen) return
    let since = performance.now()
    let timer = 0
    const step = () => {
      const now = performance.now()
      t.current = (t.current + now - since) % loop
      since = now
      const at = Math.max(
        0,
        beats.findLastIndex((start) => start <= t.current),
      )
      setBeat(at)
      timer = window.setTimeout(step, (beats[at + 1] ?? loop) - t.current + 1)
    }
    step()
    return () => {
      window.clearTimeout(timer)
      t.current = (t.current + performance.now() - since) % loop
    }
  }, [onScreen, still, beats, loop])
  return still ? rest : beat
}
