import { type ReactNode, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from 'react'

import { LOGO_BORE, LOGO_SECTION } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { COLUMNS, drawColumn, drawGrain, PICTURE } from './light'
import { arrivalOf, AT, clamp, lightAt, type Mark, markAt, SET, springEasing } from './timeline'
import s from './Launch.module.css'

/*
 * The window opening. A light rises off the bottom of the window and the
 * mark comes up out of it (see timeline.ts), on a veil over what it opens
 * onto, which is drawn under it as soon as it is given. Once both are done,
 * the light sinks back, the veil's paper goes, and what is behind arrives
 * piece by piece: whatever is marked `data-arrive`, and the children of
 * whatever is marked `data-arrive-each`, top to bottom. Those arrivals are
 * the compositor's animations, so they stay smooth while the window is busy.
 *
 * It plays once a launch. `quick` opens at once, with the mark set and gone
 * in a fade: after a reload, or where motion is reduced (which it also
 * follows on its own). A click or a key skips to the mark set.
 */

/** What arrives on its own when the launch opens onto it. */
export const ARRIVING = '[data-arrive], [data-arrive-each] > *'

/**
 * Starts each piece of `within` arriving, later the further down and across
 * it sits, hidden until it starts. Without the compositor's animations (as
 * in tests) nothing moves, and nothing is hidden.
 */
export const arrive = (within: HTMLElement) => {
  const box = within.getBoundingClientRect()
  const { arrive: a } = AT.open
  const spring = springEasing(a.response, a.damping)
  for (const piece of within.querySelectorAll<HTMLElement>(ARRIVING)) {
    if (typeof piece.animate !== 'function') continue
    const r = piece.getBoundingClientRect()
    // Below the window, it can't be seen arriving.
    if (box.height > 0 && r.top - box.top > box.height) continue
    const delay = box.height > 0 ? arrivalOf((r.top - box.top) / box.height, (r.left - box.left) / box.width) : a.start
    piece.animate([{ transform: `translateY(${a.rise}px) scale(${a.scale})` }, { transform: 'none' }], {
      duration: spring.duration,
      delay,
      easing: spring.easing,
      fill: 'backwards',
    })
    piece.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: a.fade,
      delay,
      easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
      fill: 'backwards',
    })
  }
}

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
  const veil = useRef<HTMLDivElement>(null)
  const paper = useRef<HTMLDivElement>(null)
  const light = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const columns = useRef<Array<HTMLCanvasElement | null>>([])
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

  // The light's columns, each drawn once and soft already, and its grain.
  useLayoutEffect(() => {
    COLUMNS.forEach((column, i) => {
      const context = columns.current[i]?.getContext('2d')
      if (context) drawColumn(context, column)
    })
    const tile = document.createElement('canvas')
    tile.width = tile.height = 128
    const context = tile.getContext('2d')
    if (context && grain.current) {
      drawGrain(context, 128)
      grain.current.style.backgroundImage = `url(${tile.toDataURL()})`
    }
  }, [])

  useEffect(() => {
    const fast = quick || reducedMotion()
    let frame = 0
    let start: number | null = null
    // How far a skip has moved time on; when what is behind was first ready, in real time; and when the opening began, in the launch's.
    let shift = 0
    let readyAt: number | null = null
    let open: number | null = null
    let placed = ''

    const drawMark = (m: Mark, width: number, height: number) => {
      const place = placeIn(width, height)
      const svg = mark.current
      if (svg !== null) {
        // Placed when the window's size changes, not on every frame.
        const where = `${place.x - BORE.x * place.k}px ${place.y - BORE.y * place.k}px ${24 * place.k}px`
        if (where !== placed) {
          placed = where
          svg.style.left = `${place.x - BORE.x * place.k}px`
          svg.style.top = `${place.y - BORE.y * place.k}px`
          svg.style.width = svg.style.height = `${24 * place.k}px`
        }
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

    /** Fades `element` out, on the compositor, starting `delay` ms from now. */
    const fadeOut = (element: HTMLElement | null, length: number, delay = 0) =>
      element?.animate?.([{ opacity: 1 }, { opacity: 0 }], {
        duration: length,
        delay,
        easing: 'cubic-bezier(0.33, 0, 0.67, 1)',
        fill: 'forwards',
      })

    const end = () => {
      setDone(true)
      finished()
    }

    const tick = (now: number) => {
      start ??= now
      if (readyNow.current) readyAt ??= now
      const width = root.current?.clientWidth ?? 0
      const height = root.current?.clientHeight ?? 0
      if (fast) {
        // Set, then the veil fades off what is behind once it is ready.
        drawMark(SET, width, height)
        if (open === null && readyAt !== null && now - start >= AT.quick.hold && now - readyAt >= AT.settle) {
          open = now
          fadeOut(veil.current, AT.quick.fade)
        }
        if (open !== null && now - open >= AT.quick.fade) return end()
        frame = requestAnimationFrame(tick)
        return
      }
      if (skipped.current) shift = Math.max(shift, AT.set - (now - start))
      const t = now - start + shift
      if (open === null && readyAt !== null && t >= AT.set && now - readyAt >= AT.settle) {
        open = t
        if (behind.current) arrive(behind.current)
        fadeOut(paper.current, AT.open.paper.length, AT.open.paper.start)
      }
      const l = lightAt(t, open)
      l.columns.forEach((column, i) => {
        const element = columns.current[i]
        if (element) element.style.transform = `translateX(${column.drift.toFixed(2)}px) scaleY(${column.height.toFixed(4)})`
      })
      if (light.current !== null) light.current.style.opacity = String(l.strength)
      if (grain.current !== null) grain.current.style.opacity = String(l.grain)
      drawMark(markAt(t, open, l.reach), width, height)
      if (open !== null && t - open >= AT.through) return end()
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
      <div ref={behind} className={s.behind} inert={!done}>
        {children}
      </div>
      {!done && (
        // Decoration: what it opens onto is what reads, once it is there.
        <div ref={veil} className={s.veil} aria-hidden="true" onPointerDown={skip}>
          <div ref={paper} className={s.paper} />
          <div ref={light} className={s.light}>
            {COLUMNS.map((column) => {
              // The picture is wider than the column, by the blur's reach either side.
              const width = (column.width * PICTURE.width) / PICTURE.column
              return (
                <canvas
                  key={column.i}
                  ref={(element) => void (columns.current[column.i] = element)}
                  className={s.column}
                  width={PICTURE.width}
                  height={PICTURE.height}
                  style={{ left: `${column.left - width / 2}%`, width: `${width}%` }}
                />
              )
            })}
            <div ref={grain} className={s.grain} />
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
    </div>
  )
}
