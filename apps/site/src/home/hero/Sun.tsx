import { LOGO_BORE, LOGO_SECTION } from '@althar/ui'
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { askedSecond } from '../../lib/browser'
import type { Clock } from './clock'
import { makeSun, pose, rest, ROOM, type SunGl } from './gl'
import s from './Sun.module.css'

/*
 * The first screen's sun: the mark as a thing floating in the middle of
 * the system, a solid drawn on the graphics card (gl.ts), turning with the
 * hero's clock and held a quarter turned with reduced motion. Where there
 * is no WebGL 2, or the card takes the canvas back, it is the flat mark,
 * until the card gives the canvas back.
 */

interface Props {
  /** The bore's place in the frame, and the mark's size (its 24 grid), in CSS px. */
  cx: number
  cy: number
  size: number
  /** How far it is tipped toward you, in radians: as far as the orbits are seen from above. */
  tilt: number
  clock: Clock
  still: boolean
}

/** Device pixels to a CSS pixel, following the window to another screen; at most two, which is sharp at this size. */
const dprNow = () => Math.min(window.devicePixelRatio || 1, 2)
function onDpr(on: () => void) {
  let q: MediaQueryList | null = null
  const watch = () => {
    q?.removeEventListener('change', changed)
    q = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    q.addEventListener('change', changed)
  }
  const changed = () => {
    watch()
    on()
  }
  watch()
  return () => q?.removeEventListener('change', changed)
}
const useDpr = () => useSyncExternalStore(onDpr, dprNow, () => 1)

/** Its pose held still: at the second the address asks for (`?t=`), else a quarter turned. */
const held = (clock: Clock, tilt: number) => (askedSecond() !== null ? pose(clock.t, tilt) : rest(tilt))

export function Sun({ cx, cy, size, tilt, clock, still }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [gl, setGl] = useState<SunGl | null>(null)
  const [flat, setFlat] = useState(false)
  const dpr = useDpr()
  const box = Math.round(size * ROOM)

  // Made once; made again when the card gives back a canvas it took.
  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    let made: SunGl | null = null
    const start = () => {
      made = makeSun(el)
      setGl(made)
      setFlat(!made)
    }
    const lost = (event: Event) => {
      // Asks for the canvas back; what it held on the card went with it.
      event.preventDefault()
      made = null
      setGl(null)
      setFlat(true)
    }
    el.addEventListener('webglcontextlost', lost)
    el.addEventListener('webglcontextrestored', start)
    start()
    return () => {
      el.removeEventListener('webglcontextlost', lost)
      el.removeEventListener('webglcontextrestored', start)
      made?.drop()
    }
  }, [])

  // Fitted to its size and the screen's pixels, and drawn at once, so it never shows a blank frame.
  useLayoutEffect(() => {
    if (!gl) return
    gl.size(box, dpr)
    gl.draw(still ? held(clock, tilt) : pose(clock.t, tilt))
  }, [gl, box, dpr, tilt, still, clock])

  useEffect(() => {
    if (!gl || still) return
    return clock.on((t) => gl.draw(pose(t, tilt)))
  }, [gl, clock, tilt, still])

  return (
    <>
      <canvas
        ref={canvas}
        className={s.solid}
        hidden={flat}
        aria-hidden="true"
        style={{ left: cx - box / 2, top: cy - box / 2, width: box, height: box }}
      />
      {flat && <Flat cx={cx} cy={cy} size={size} />}
    </>
  )
}

/** The mark, flat: its cream face with the bore through it, and the point a cobalt light. Placed by the bore, at (12, 14.4) on its grid. */
function Flat({ cx, cy, size }: Pick<Props, 'cx' | 'cy' | 'size'>) {
  const face = useId()
  const k = size / 24
  return (
    <svg
      className={s.flat}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ left: cx - 12 * k, top: cy - 14.4 * k, width: size, height: size }}
    >
      <defs>
        <linearGradient id={face} x1="0.2" y1="0.1" x2="0.8" y2="0.95">
          <stop offset="0" stopColor="#fffbf4" />
          <stop offset="1" stopColor="#e9dfd1" />
        </linearGradient>
      </defs>
      <path d={LOGO_SECTION + LOGO_BORE} fillRule="evenodd" fill={`url(#${face})`} />
      <circle className={s.halo} cx="12" cy="14.4" r="1.7" />
      <circle className={s.point} cx="12" cy="14.4" r="0.8" />
    </svg>
  )
}
