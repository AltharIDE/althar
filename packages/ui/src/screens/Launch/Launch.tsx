import { type ReactNode, useEffect, useEffectEvent, useId, useRef, useState } from 'react'

import { LOGO_SECTION } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { BORE, BORE_RADIUS, BOTTOM, circle, faceCircle, POINT_RADIUS, scalePath, SIDES, sideLine, ticks, TOP, turned } from './geometry'
import { AT, clamp, type Drawing, drawingAt, progress, type Through, throughAt } from './timeline'
import s from './Launch.module.css'

/*
 * The window opening. The mark is drawn as it was made, big, over paper
 * (see timeline.ts), while what it opens onto gets ready behind it; once
 * both are done the camera goes in through the bore, and what is behind comes
 * into focus. It plays once a launch. `quick` opens at once, with the mark
 * set and gone in a fade: after a reload, or where motion is reduced (which
 * it also follows on its own). A click or a key skips to the end of the
 * drawing.
 *
 * Every frame is drawn fresh at its size, so nothing is ever an enlarged
 * picture of itself, however far the camera goes in.
 */

export type LaunchProps = RootProps<
  'div',
  {
    /** What it opens onto is ready: once the mark is drawn, the camera goes in. */
    ready: boolean
    /** Open with the mark already set, and fade. */
    quick?: boolean
    /** It is over: what it opened onto is the window's. */
    onDone?: () => void
    /** What it opens onto, drawn under it as soon as it is given, and inert until it opens. */
    children?: ReactNode
  }
>

/** A big rectangle about the mark, in its grid, that the paper is cut from. */
const SHEET = 'M-2000 -2000H2026V2026H-2000Z'

/** Placing the mark in a window: its scale (px per grid unit) and where its bore is. */
const placeIn = (width: number, height: number) => {
  const k = clamp(Math.min(width, height) * 0.019, 8, 20)
  // The section's own middle a little above the window's, as the eye places a middle.
  const bore = { x: width / 2, y: height * 0.47 + (BORE.y - (TOP + BOTTOM) / 2) * k }
  const farthest = Math.max(
    Math.hypot(bore.x, bore.y),
    Math.hypot(width - bore.x, bore.y),
    Math.hypot(bore.x, height - bore.y),
    Math.hypot(width - bore.x, height - bore.y),
  )
  return { k, bore, reach: farthest / k + 4, cover: (farthest / (BORE_RADIUS * k)) * 1.08 }
}

const matrix = (scale: number, at: { x: number; y: number }) =>
  `matrix(${scale} 0 0 ${scale} ${at.x - BORE.x * scale} ${at.y - BORE.y * scale})`

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

export function Launch({ ready, quick = false, onDone, children, className, ...rest }: LaunchProps) {
  const [done, setDone] = useState(false)
  const inkId = `launch-ink-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  const root = useRef<HTMLDivElement>(null)
  const behind = useRef<HTMLDivElement>(null)
  const veil = useRef<SVGSVGElement>(null)
  const sheet = useRef<SVGGElement>(null)
  const drawing = useRef<SVGGElement>(null)
  const construction = useRef<SVGGElement>(null)
  const paper = useRef<SVGPathElement>(null)
  const ink = useRef<SVGPathElement>(null)
  const spread = useRef<SVGCircleElement>(null)
  const outline = useRef<SVGPathElement>(null)
  const ring = useRef<SVGCircleElement>(null)
  const point = useRef<SVGCircleElement>(null)
  const sides = useRef<Array<SVGPathElement | null>>([])
  const circles = useRef<Array<SVGPathElement | null>>([])
  const scales = useRef<Array<SVGPathElement | null>>([])
  const majors = useRef<Array<SVGPathElement | null>>([])
  // Read by the frames as they come, not as they were when the frames began.
  const readyNow = useRef(ready)
  useEffect(() => void (readyNow.current = ready), [ready])
  const skipped = useRef(false)
  const finished = useEffectEvent(() => onDone?.())

  useEffect(() => {
    const at = (element: Element | null | undefined, name: string, value: string | number) => element?.setAttribute(name, String(value))
    const fast = quick || reducedMotion()
    let frame = 0
    let start: number | null = null
    let goingIn: number | null = null
    let marks = ticks(0)
    let marksReach = 0

    const draw = (d: Drawing, through: Through | null, size: { width: number; height: number }) => {
      const place = placeIn(size.width, size.height)
      if (place.reach > marksReach) {
        marksReach = place.reach
        marks = ticks(place.reach)
      }
      const zoom = through?.zoom ?? 1
      const scale = place.k * d.camera
      at(veil.current, 'viewBox', `0 0 ${size.width} ${size.height}`)
      at(sheet.current, 'transform', matrix(scale * zoom, place.bore))
      at(drawing.current, 'transform', matrix(scale * zoom, place.bore))
      at(drawing.current, 'stroke-width', 1.25 / (scale * zoom))
      // The construction lags the camera a little going in, as farther things do. Its lines stay hairlines.
      const far = scale * zoom ** 0.82
      at(construction.current, 'transform', matrix(far, place.bore))
      at(construction.current, 'stroke-width', 1 / far)
      at(construction.current, 'opacity', d.construction * (through?.construction ?? 1))
      veil.current?.style.setProperty('--settled', String(d.settled))
      const bore = circle(BORE, BORE_RADIUS * clamp(d.bore, 0, 1.2))
      at(paper.current, 'd', SHEET + bore)
      at(ink.current, 'd', LOGO_SECTION + bore)
      at(spread.current, 'r', d.ink)
      at(outline.current, 'stroke-dasharray', `${d.outline} 1`)
      at(ring.current, 'r', POINT_RADIUS * d.ring.radius)
      at(ring.current, 'stroke-opacity', d.ring.strength * (through?.point ?? 1))
      // The point has no size: going in, it stays as it was and slips by.
      at(point.current, 'cx', place.bore.x)
      at(point.current, 'cy', place.bore.y)
      at(point.current, 'r', POINT_RADIUS * scale * d.point)
      at(point.current, 'opacity', through?.point ?? 1)
      SIDES.forEach((side, i) => {
        const run = d.sides[i] ?? 0
        const swung = turned(side, d.swings[i] ?? 0)
        at(sides.current[i], 'd', run <= 0 ? '' : sideLine(swung, run))
        at(circles.current[i], 'stroke-dasharray', `${d.circles[i] ?? 0} 1`)
        at(scales.current[i], 'd', scalePath(swung, marks, Math.min(d.scale, run), false))
        at(majors.current[i], 'd', scalePath(swung, marks, Math.min(d.scale, run), true))
      })
      const back = behind.current
      if (back !== null) {
        back.style.transformOrigin = `${place.bore.x}px ${place.bore.y}px`
        back.style.transform = through === null ? '' : `scale(${through.behind.scale})`
        back.style.filter = through === null || through.behind.blur < 0.05 ? '' : `blur(${through.behind.blur}px)`
        back.style.opacity = through === null ? '' : String(through.behind.strength)
      }
      if (through?.gone === true) at(veil.current, 'visibility', 'hidden')
    }

    const end = () => {
      const back = behind.current
      if (back !== null) back.removeAttribute('style')
      setDone(true)
      finished()
    }

    const tick = (now: number) => {
      start ??= now
      const size = { width: root.current?.clientWidth ?? 0, height: root.current?.clientHeight ?? 0 }
      const t = fast || skipped.current ? Math.max(now - start, AT.drawn) : now - start
      if (fast) {
        // Set, then gone in a fade once what is behind is ready.
        draw(drawingAt(AT.drawn + 1000, 0), null, size)
        goingIn ??= readyNow.current && now - start >= AT.quick.hold ? now : null
        if (goingIn !== null) {
          const x = progress(now, goingIn, AT.quick.fade)
          at(veil.current, 'opacity', 1 - x)
          if (x >= 1) return end()
        }
        frame = requestAnimationFrame(tick)
        return
      }
      goingIn ??= readyNow.current && t >= AT.drawn ? now : null
      const through = goingIn === null ? null : throughAt(progress(now, goingIn, AT.through), placeIn(size.width, size.height).cover)
      draw(drawingAt(t, placeIn(size.width, size.height).reach), through, size)
      if (goingIn !== null && now - goingIn >= AT.through) return end()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [quick])

  const skip = () => void (skipped.current = true)

  return (
    <div ref={root} className={cx(s.launch, className)} {...rest}>
      <div ref={behind} className={s.behind} inert={!done}>
        {children}
      </div>
      {!done && (
        // Decoration: what it opens onto is what reads, once it is there.
        <svg ref={veil} className={s.veil} aria-hidden="true" onPointerDown={skip} onKeyDown={skip}>
          <g ref={sheet}>
            <path ref={paper} className={s.paper} d={SHEET} fillRule="evenodd" />
          </g>
          <g ref={construction}>
            {SIDES.map((side, i) => (
              <g key={i}>
                <path
                  ref={(element) => void (circles.current[i] = element)}
                  className={s.circle}
                  d={faceCircle(side)}
                  pathLength={1}
                  strokeDasharray="0 1"
                />
                <path ref={(element) => void (sides.current[i] = element)} className={s.side} />
                <path ref={(element) => void (scales.current[i] = element)} className={s.scale} />
                <path ref={(element) => void (majors.current[i] = element)} className={s.major} />
              </g>
            ))}
          </g>
          <g ref={drawing}>
            {/* The ink spreads from the bore's middle, with a clean edge. */}
            <clipPath id={inkId}>
              <circle ref={spread} cx={BORE.x} cy={BORE.y} r={0} />
            </clipPath>
            <path ref={ink} className={s.ink} fillRule="evenodd" clipPath={`url(#${inkId})`} />
            <path ref={outline} className={s.outline} d={LOGO_SECTION} pathLength={1} strokeDasharray="0 1" />
            <circle ref={ring} className={s.ring} cx={BORE.x} cy={BORE.y} r={POINT_RADIUS} strokeOpacity={0} />
          </g>
          <circle ref={point} className={s.point} r={0} />
        </svg>
      )}
    </div>
  )
}
