import { type ReactNode, useEffect, useEffectEvent, useId, useRef, useState } from 'react'

import { LOGO_BORE, LOGO_SECTION } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { COLUMNS } from './light'
import { AT, behindAt, clamp, lightAt, type Mark, markAt, progress, SET } from './timeline'
import s from './Launch.module.css'

/*
 * The window opening. A light rises off the bottom of the window and the
 * mark comes up out of it (see timeline.ts), while what it opens onto gets
 * ready behind; once both are done, the light sinks back and what is behind
 * rises in over it. It plays once a launch. `quick` opens at once, with the
 * mark set and gone in a fade: after a reload, or where motion is reduced
 * (which it also follows on its own). A click or a key skips to the mark set.
 */

export type LaunchProps = RootProps<
  'div',
  {
    /** What it opens onto is ready: once the mark is up, it opens. */
    ready: boolean
    /** Open with the mark already set, and fade. */
    quick?: boolean
    /** It is over: what it opened onto is the window's. */
    onDone?: () => void
    /** What it opens onto, drawn under it as soon as it is given, and inert until it opens. */
    children?: ReactNode
  }
>

/** The bore's middle, on the mark's 24 grid (foundations/Logo), and the sizes drawn about it. */
const BORE = { x: 12, y: 14.4 }
const BORE_RADIUS = 1.8
const POINT_RADIUS = 0.8

/** Placing the mark in a window: px per grid unit, and where its bore is, a little above the middle. */
const placeIn = (width: number, height: number) => ({
  k: clamp(Math.min(width, height) * 0.0088, 4.5, 8.5),
  x: width / 2,
  y: height * 0.43,
})

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

export function Launch({ ready, quick = false, onDone, children, className, ...rest }: LaunchProps) {
  const [done, setDone] = useState(false)
  const id = `launch-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const root = useRef<HTMLDivElement>(null)
  const behind = useRef<HTMLDivElement>(null)
  const light = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const columns = useRef<Array<HTMLDivElement | null>>([])
  const mark = useRef<SVGSVGElement>(null)
  const lit = useRef<SVGGElement>(null)
  const rim = useRef<SVGGElement>(null)
  const bloom = useRef<SVGCircleElement>(null)
  const point = useRef<SVGCircleElement>(null)
  // Read by the frames as they come, not as they were when the frames began.
  const readyNow = useRef(ready)
  useEffect(() => void (readyNow.current = ready), [ready])
  const skipped = useRef(false)
  const finished = useEffectEvent(() => onDone?.())

  useEffect(() => {
    const fast = quick || reducedMotion()
    let frame = 0
    let start: number | null = null
    // How far a skip has moved time on, and when the opening began, in the launch's time.
    let shift = 0
    let open: number | null = null

    const drawMark = (m: Mark, width: number, height: number) => {
      const place = placeIn(width, height)
      const svg = mark.current
      if (svg !== null) {
        svg.style.left = `${place.x - BORE.x * place.k}px`
        svg.style.top = `${place.y - BORE.y * place.k}px`
        svg.style.width = svg.style.height = `${24 * place.k}px`
        svg.style.opacity = String(m.shown)
        svg.style.filter = m.blur > 0.05 ? `blur(${m.blur.toFixed(2)}px)` : ''
        svg.style.transform = `translateY(${(m.drop * height - m.up).toFixed(2)}px) scale(${m.scale.toFixed(4)})`
        svg.style.setProperty('--clear', m.clear.toFixed(3))
      }
      lit.current?.setAttribute('opacity', m.lit.toFixed(3))
      rim.current?.setAttribute('opacity', m.rim.toFixed(3))
      bloom.current?.setAttribute('opacity', m.bloom.toFixed(3))
      bloom.current?.setAttribute('r', (BORE_RADIUS * m.focus).toFixed(3))
      point.current?.setAttribute('r', (POINT_RADIUS * (0.4 + 0.6 * m.point)).toFixed(3))
      point.current?.setAttribute('opacity', m.point.toFixed(3))
    }

    const drawBehind = (style: { rise: number; blur: number; scale: number; strength: number }) => {
      const back = behind.current
      if (back === null) return
      back.style.opacity = String(style.strength)
      back.style.transform = `translateY(${style.rise.toFixed(2)}px) scale(${style.scale.toFixed(4)})`
      back.style.filter = style.blur > 0.05 ? `blur(${style.blur.toFixed(2)}px)` : ''
    }

    const end = () => {
      behind.current?.removeAttribute('style')
      setDone(true)
      finished()
    }

    const tick = (now: number) => {
      start ??= now
      const width = root.current?.clientWidth ?? 0
      const height = root.current?.clientHeight ?? 0
      if (fast) {
        // Set, then what is behind fades in over it once it is ready.
        drawMark(SET, width, height)
        open ??= readyNow.current && now - start >= AT.quick.hold ? now : null
        if (open !== null) {
          const x = progress(now, open, AT.quick.fade)
          drawBehind({ rise: 0, blur: 0, scale: 1, strength: x })
          if (x >= 1) return end()
        }
        frame = requestAnimationFrame(tick)
        return
      }
      if (skipped.current) shift = Math.max(shift, AT.set - (now - start))
      const t = now - start + shift
      open ??= readyNow.current && t >= AT.set ? t : null
      const l = lightAt(t, open)
      l.columns.forEach((column, i) => {
        const element = columns.current[i]
        if (element) element.style.transform = `translateX(${column.drift.toFixed(2)}px) scaleY(${column.height.toFixed(4)})`
      })
      if (light.current !== null) light.current.style.opacity = String(l.strength)
      if (grain.current !== null) grain.current.style.opacity = String(l.grain)
      drawMark(markAt(t, open, l.reach), width, height)
      if (open !== null) {
        drawBehind(behindAt(t - open))
        if (t - open >= AT.through) return end()
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    // A key skips too, while it plays: what is behind can't take it yet.
    const onKey = () => void (skipped.current = true)
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKey)
    }
  }, [quick])

  const skip = () => void (skipped.current = true)

  return (
    <div ref={root} className={cx(s.launch, className)} {...rest}>
      {!done && (
        // Decoration: what it opens onto is what reads, once it is there.
        <div className={s.veil} aria-hidden="true" onPointerDown={skip}>
          <div ref={light} className={s.light}>
            {COLUMNS.map((column) => (
              <div
                key={column.i}
                ref={(element) => void (columns.current[column.i] = element)}
                className={s.column}
                style={{ left: `${column.left - column.width / 2}%`, width: `${column.width}%`, background: column.background }}
              />
            ))}
            <div ref={grain} className={s.grain}>
              <svg width="100%" height="100%">
                <filter id={`${id}-grain`}>
                  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
                  <feColorMatrix type="saturate" values="0" />
                </filter>
                <rect width="100%" height="100%" filter={`url(#${id}-grain)`} />
              </svg>
            </div>
          </div>
          <svg ref={mark} className={s.mark} viewBox="0 0 24 24">
            <defs>
              <clipPath id={`${id}-section`}>
                <path d={LOGO_SECTION + LOGO_BORE} clipRule="evenodd" />
              </clipPath>
              <filter id={`${id}-glow`} x="-1" y="-1" width="3" height="3">
                <feGaussianBlur stdDeviation="0.45" />
              </filter>
              {/* The light on the mark's foot, from below. */}
              <linearGradient id={`${id}-foot`} gradientUnits="userSpaceOnUse" x1="0" y1="19.5" x2="0" y2="14.6">
                <stop offset="0" className={s.footLow} />
                <stop offset="0.35" className={s.footMiddle} />
                <stop offset="1" className={s.footHigh} />
              </linearGradient>
              {/* Its edge, lit only from below. */}
              <linearGradient id={`${id}-under`} gradientUnits="userSpaceOnUse" x1="0" y1="19.5" x2="0" y2="13.5">
                <stop offset="0" stopColor="#fff" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <mask id={`${id}-rim`} maskUnits="userSpaceOnUse" x="-12" y="-12" width="48" height="48">
                <rect x="-12" y="-12" width="48" height="48" fill={`url(#${id}-under)`} />
              </mask>
              {/* The light in the bore, drawn about the glow whatever its size. */}
              <radialGradient id={`${id}-bloom`}>
                <stop offset="0.4" className={s.bloomMiddle} />
                <stop offset="0.62" className={s.bloomEdge} />
                <stop offset="0.85" className={s.bloomOut} />
              </radialGradient>
            </defs>
            <path className={s.ink} d={LOGO_SECTION + LOGO_BORE} fillRule="evenodd" />
            <g ref={lit} clipPath={`url(#${id}-section)`} opacity="0">
              <rect width="24" height="24" fill={`url(#${id}-foot)`} />
            </g>
            <g ref={rim} mask={`url(#${id}-rim)`} opacity="0">
              <path className={s.rimGlow} d={LOGO_SECTION} filter={`url(#${id}-glow)`} />
              <path className={s.rimEdge} d={LOGO_SECTION} />
            </g>
            <circle ref={bloom} cx={BORE.x} cy={BORE.y} r={BORE_RADIUS} fill={`url(#${id}-bloom)`} opacity="0" />
            <circle ref={point} className={s.point} cx={BORE.x} cy={BORE.y} r={0} opacity="0" />
          </svg>
        </div>
      )}
      <div ref={behind} className={cx(s.behind, !done && s.waiting)} inert={!done}>
        {children}
      </div>
    </div>
  )
}
