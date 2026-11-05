import { type RefObject, useEffect, useState } from 'react'

import { askedSecond } from '../../lib/browser'

/*
 * The first screen's clock: one frame loop for the system and its sun, so
 * they turn together. It runs only while the first screen is on screen, and
 * marks it `data-off` while it isn't, so its CSS animations pause too. It
 * starts at `?t=` where the address asks for a frame, and goes on across a
 * resize.
 */

export interface Clock {
  /** The seconds the system has turned. */
  readonly t: number
  /** Calls `draw` on each frame the clock moves, with the second and the time since the last; returns the way to stop. */
  on(draw: (t: number, dt: number) => void): () => void
}

/** A clock held at second `t`, which never moves: for a picture of one moment, as the link previews are. */
export const heldAt = (t: number): Clock => ({ t, on: () => () => {} })

/** The longest a frame counts for: after a stall, or a tab coming back, the system moves on smoothly rather than leaping. */
const LONGEST = 0.1

function makeClock(from: number) {
  const draws = new Set<(t: number, dt: number) => void>()
  let t = from
  const clock = {
    get t() {
      return t
    },
    on(draw: (t: number, dt: number) => void) {
      draws.add(draw)
      return () => void draws.delete(draw)
    },
    /** Runs while `el` is on screen; returns the way to stop. */
    run(el: HTMLElement) {
      let frame = 0
      let last = 0
      let shown = false
      const tick = (now: number) => {
        const dt = last ? Math.min(LONGEST, (now - last) / 1000) : 0
        last = now
        if (dt > 0) {
          t += dt
          for (const draw of draws) draw(t, dt)
        }
        frame = requestAnimationFrame(tick)
      }
      const io = new IntersectionObserver(([entry]) => {
        const on = entry?.isIntersecting ?? false
        if (on === shown) return
        shown = on
        el.toggleAttribute('data-off', !on)
        cancelAnimationFrame(frame)
        last = 0
        if (on) frame = requestAnimationFrame(tick)
      })
      io.observe(el)
      return () => {
        cancelAnimationFrame(frame)
        io.disconnect()
        el.removeAttribute('data-off')
      }
    },
  }
  return clock
}

/** The clock, running while `running` and `root` is on screen. */
export function useClock(root: RefObject<HTMLElement | null>, running: boolean): Clock {
  const [clock] = useState(() => makeClock(askedSecond() ?? 0))
  useEffect(() => {
    const el = root.current
    if (!running || !el) return
    return clock.run(el)
  }, [clock, root, running])
  return clock
}
