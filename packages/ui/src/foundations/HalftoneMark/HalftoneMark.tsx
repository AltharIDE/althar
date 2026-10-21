import { useEffect, useRef } from 'react'

import { cx } from '../../lib/cx'
import { reducedMotion } from '../../lib/motion'
import type { RootProps } from '../../lib/props'
import { useTheme } from '../../lib/theme'
import { BORE, DOTS, POINT_RADIUS } from './halftone'
import s from './HalftoneMark.module.css'

/*
 * Althar's mark printed as a halftone, as the launch sets it: the dots in
 * the ink around it, the point cobalt in the bore. It comes up once, the
 * base first and the tip last, each dot growing into place, then the point.
 * With motion reduced it is simply there. Decoration, like the Logo: what
 * reads is the words beside it.
 */

/** How long it takes to come up: the dots, then the point. */
export const HALFTONE_RISE = { dots: 620, spread: 160, dot: 420, point: { start: 820, length: 360 } } as const
/** The smallest dot drawn, in px on screen, so the tip's palest dots still show. */
const LEAST_DOT = 0.6

export type HalftoneMarkProps = RootProps<
  'canvas',
  {
    /** Its side, in px. */
    size?: number
    /** Come up dot by dot; without it, it is drawn set. */
    rise?: boolean
  }
>

const easeOut = (x: number) => 1 - (1 - x) ** 3
const clamp = (x: number) => Math.min(1, Math.max(0, x))

/** Draws the mark as it is `t` ms into coming up, in the mark's 24 grid scaled by `k`. */
export const drawHalftone = (context: CanvasRenderingContext2D, k: number, t: number, ink: string, live: string) => {
  const least = LEAST_DOT / (k / (window.devicePixelRatio || 1))
  context.setTransform(k, 0, 0, k, 0, 0)
  context.clearRect(0, 0, 24, 24)
  context.fillStyle = ink
  for (const dot of DOTS) {
    const x = clamp((t - ((1 - dot.down) * HALFTONE_RISE.dots + dot.jitter[0] * HALFTONE_RISE.spread)) / HALFTONE_RISE.dot)
    if (x === 0) continue
    const e = easeOut(x)
    context.globalAlpha = e
    context.beginPath()
    context.arc(dot.x, dot.y + (1 - e) * 0.6, Math.max(dot.r, least) * e, 0, Math.PI * 2)
    context.fill()
  }
  const p = clamp((t - HALFTONE_RISE.point.start) / HALFTONE_RISE.point.length)
  if (p > 0) {
    context.globalAlpha = p
    context.fillStyle = live
    context.beginPath()
    context.arc(BORE.x, BORE.y, POINT_RADIUS * easeOut(p), 0, Math.PI * 2)
    context.fill()
  }
  context.globalAlpha = 1
}

export function HalftoneMark({ size = 136, rise = true, className, style, ...rest }: HalftoneMarkProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Drawn again, risen already, in another theme: its ink and cobalt are the theme's.
  const theme = useTheme()
  const drawn = useRef<string | null>(null)
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const css = getComputedStyle(element)
    // The ink as a fill: the words' own black on paper, a softer light on dark, so the mark never glares.
    const ink = css.getPropertyValue('--ink-fill').trim() || '#141417'
    const live = css.getPropertyValue('--live').trim() || '#2b3bff'
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(size * ratio)
    element.height = Math.round(size * ratio)
    const k = (size * ratio) / 24
    const end = HALFTONE_RISE.point.start + HALFTONE_RISE.point.length
    const again = drawn.current !== null && drawn.current !== theme
    drawn.current = theme
    if (!rise || again || reducedMotion()) {
      drawHalftone(context, k, end, ink, live)
      return
    }
    let frame = 0
    let start: number | null = null
    const tick = (now: number) => {
      start ??= now
      const t = now - start
      drawHalftone(context, k, t, ink, live)
      if (t < end) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [size, rise, theme])
  return (
    <canvas ref={canvas} className={cx(s.mark, className)} style={{ width: size, height: size, ...style }} aria-hidden="true" {...rest} />
  )
}
