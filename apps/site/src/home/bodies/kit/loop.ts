import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useStill } from '../../../lib/browser'
import { useZoomed } from '../../../lib/zoom'
import { useInView, usePageShown } from './seen'

/*
 * A picture's clock: where it is in its story, in ms. It ticks on every frame
 * the screen draws while the picture is `active`, watched and the page is
 * shown, carrying on where it stopped when it comes back. It plays the story
 * through to `length` and holds there a moment; then what is on the screen
 * (the element marked `data-fade` in the picture's box, under the app's own
 * bar, never its frame) fades out, the story goes back to its start unseen,
 * and it fades in again as the story starts over. While it fades in, the
 * screen stands at its start (`data-starting`): whatever would move there
 * from the end, a page closing up or a list running back, is there at once,
 * its transitions held off and its animations played out, so only the fade
 * is seen. It first comes in at its start, already shown, so a picture is
 * never blank as it comes into view.
 * With motion reduced or a moment held (`?t=`) it stands at `still`.
 *
 * useClock hands back a reader, for what moves on every frame without
 * drawing the picture again (an animation's time); useLoop hands back the
 * moment itself, drawing the picture again only each `step` ms, as its
 * story's steps need.
 */

/** How long it holds at the end (unless a picture says otherwise), how long what is on screen takes to fade in at the start and out at the end, in ms. */
const HOLD_END = 1200
const FADE_IN = 320
const FADE_OUT = 300

/** One round's length for a story of `length` ms: faded in, through, held `hold` ms, faded out. */
export const roundOf = (length: number, hold = HOLD_END) => FADE_IN + length + hold + FADE_OUT

/** Where the story stands `t` ms into a round: at its start while it fades in, at its end while it is held and fades out. */
export function storyAt(t: number, length: number) {
  return Math.min(length, Math.max(0, t - FADE_IN))
}

/** How much of what is on screen shows `t` ms into a round. */
export function shownAt(t: number, length: number, hold = HOLD_END) {
  if (t < FADE_IN) return t / FADE_IN
  const out = t - (FADE_IN + length + hold)
  return out > 0 ? Math.max(0, 1 - out / FADE_OUT) : 1
}

function useTicking(
  box: RefObject<Element | null>,
  length: number,
  still: number,
  active: boolean,
  each: (at: number) => void,
  hold = HOLD_END,
) {
  const watched = useInView(box, 0.2)
  const shown = usePageShown()
  const held = useStill()
  // Pinch-zoomed in, it holds where it is (lib/zoom.ts).
  const zoomed = useZoomed()
  // It first comes in at its start, already shown: not faded in from nothing.
  const ran = useRef(FADE_IN)
  const at = useRef(0)
  const call = useRef(each)
  useEffect(() => {
    call.current = each
  })
  useEffect(() => {
    // What fades: the screen under the app's bar, never the frame round it. Written only as it changes.
    const screen = box.current?.querySelector<HTMLElement>('[data-fade]') ?? null
    let faded = ''
    const fade = (k: number) => {
      const next = k >= 1 ? '' : k.toFixed(3)
      if (!screen || next === faded) return
      faded = next
      screen.style.opacity = next
    }
    // Fading in at its start: what would carry over from the end is put there at once, every frame of the fade (an animation begun as the start is drawn is played out as soon as it shows). One that runs for ever is the screen's own, and left.
    let starting = false
    const start = (on: boolean) => {
      if (!screen) return
      if (on !== starting) {
        starting = on
        if (on) screen.setAttribute('data-starting', '')
        else screen.removeAttribute('data-starting')
      }
      if (!on) return
      for (const one of screen.getAnimations({ subtree: true })) {
        if (one.effect?.getComputedTiming().endTime !== Infinity) one.finish()
      }
    }
    if (held) {
      at.current = still
      call.current(still)
      fade(1)
      return
    }
    if (!watched || !shown || !active || zoomed) return
    const round = roundOf(length, hold)
    const from = performance.now() - ran.current
    let frame = 0
    const tick = (now: number) => {
      ran.current = (now - from) % round
      at.current = storyAt(ran.current, length)
      fade(shownAt(ran.current, length, hold))
      start(ran.current < FADE_IN)
      call.current(at.current)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      start(false)
    }
  }, [box, watched, shown, held, active, zoomed, length, still, hold])
  return at
}

export function useClock(box: RefObject<Element | null>, length: number, still: number, active = true) {
  const at = useTicking(box, length, still, active, () => {})
  return useCallback(() => at.current, [at])
}

export function useLoop(box: RefObject<Element | null>, length: number, still: number, active = true, step = 100) {
  const [at, setAt] = useState(0)
  useTicking(box, length, still, active, (ms) => {
    const next = Math.round(ms / step) * step
    setAt((was) => (was === next ? was : next))
  })
  return at
}

/**
 * The moment, for a story whose picture changes only at `marks` (ms, any
 * order): drawn again only as the clock passes one of them, either way,
 * standing at the last mark passed (0 before the first), so a test of
 * `moment >= mark` holds exactly as it would on every frame. With it, a
 * reader of the clock itself, for what moves between marks without
 * drawing the picture again (text being typed).
 */
export function useMarks(
  box: RefObject<Element | null>,
  length: number,
  still: number,
  marks: readonly number[],
  active = true,
  /** How long it holds at its end before it fades and starts over: a story that ends on what starts it over holds hardly at all. */
  hold = HOLD_END,
) {
  const [at, setAt] = useState(0)
  const sorted = useMemo(() => [...marks].sort((a, b) => a - b), [marks])
  const now = useTicking(
    box,
    length,
    still,
    active,
    (ms) => {
      let next = 0
      for (const m of sorted) if (ms >= m) next = m
      setAt((was) => (was === next ? was : next))
    },
    hold,
  )
  const read = useCallback(() => now.current, [now])
  return [at, read] as const
}
