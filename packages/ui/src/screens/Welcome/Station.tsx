import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import s from './Station.module.css'

/*
 * Where a tour page's scene is drawn. As it arrives, every box and every
 * line of text its real components draw is measured and traced in pencil,
 * top to bottom, and then the components themselves are uncovered over the
 * sketch. Then its scene plays: a script that changes the scene's state the
 * way Althar would.
 */

/* ---- the stage a scene's script drives ----------------------------------- */

export class Cancelled extends Error {}

export interface Stage {
  /** Waits, unless the scene is left first. */
  wait: (ms: number) => Promise<void>
}

/* ---- the station ---------------------------------------------------------- */

export interface StationProps {
  /** Arrive uncovered, with no sketch: stills and reduced motion. */
  instant: boolean
  /** The scene: its components, at their real size. */
  children: ReactNode
}

export function Station({ instant, children }: StationProps) {
  const content = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  /* station pixels per screen pixel: the card may draw the scene smaller */
  const unscale = useCallback(() => {
    const el = frame.current
    return el && el.getBoundingClientRect().width ? el.offsetWidth / el.getBoundingClientRect().width : 1
  }, [])
  return (
    <div ref={frame} data-stop="" className={cx(s.station, instant && s.instant)}>
      <div ref={content} className={s.content} inert aria-hidden="true">
        {children}
      </div>
      {!instant && <Sketch contentRef={content} unscale={unscale} />}
    </div>
  )
}

/* ---- the sketch: the real layout, traced ------------------------------------ */

interface Shape {
  kind: 'box' | 'text'
  x: number
  y: number
  w: number
  h: number
  r: number
}

const MAX_SHAPES = 180

function measure(root: HTMLElement, unscale: number): Shape[] {
  const shapes: Shape[] = []
  const a = root.getBoundingClientRect()
  const at = (r: DOMRect) => ({ x: (r.left - a.left) * unscale, y: (r.top - a.top) * unscale, w: r.width * unscale, h: r.height * unscale })
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (shapes.length >= MAX_SHAPES) break
    const css = getComputedStyle(el)
    if (css.display === 'none' || css.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    const filled = css.backgroundColor !== 'rgba(0, 0, 0, 0)' && css.backgroundColor !== 'transparent'
    const edged = css.boxShadow !== 'none' || parseFloat(css.borderTopWidth) > 0
    if (filled || edged) shapes.push({ kind: 'box', ...at(r), r: Math.min(parseFloat(css.borderTopLeftRadius) || 0, 14) })
  }
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  /* a page that cannot measure a run of text gets its boxes alone */
  if (typeof range.getClientRects !== 'function') return shapes
  for (let t = walk.nextNode(); t && shapes.length < MAX_SHAPES; t = walk.nextNode()) {
    if (!t.textContent?.trim()) continue
    range.selectNodeContents(t)
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 4) continue
      shapes.push({ kind: 'text', ...at(r), r: 0 })
    }
  }
  return shapes
}

function Sketch({ contentRef, unscale }: { contentRef: RefObject<HTMLDivElement | null>; unscale: () => number }) {
  const [shapes, setShapes] = useState<Shape[]>([])
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    setShapes(measure(el, unscale()))
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
  }, [contentRef, unscale])
  if (!shapes.length) return null
  return (
    <svg className={s.sketch} viewBox={`0 0 ${size.w} ${size.h}`} width={size.w} height={size.h} aria-hidden="true">
      {shapes.map((p, i) => {
        /* pencil moves down the sheet, so each line starts by where it is */
        const style = cssVars({ '--d': `${Math.round((p.y / Math.max(size.h, 1)) * 620 + (p.x / Math.max(size.w, 1)) * 120)}ms` })
        return p.kind === 'box' ? (
          <rect
            key={i}
            x={p.x + 0.5}
            y={p.y + 0.5}
            width={p.w - 1}
            height={p.h - 1}
            rx={p.r}
            pathLength={1}
            className={s.box}
            style={style}
          />
        ) : (
          <path key={i} d={`M${p.x} ${p.y + p.h * 0.62}H${p.x + p.w}`} pathLength={1} className={s.text} style={style} />
        )
      })}
    </svg>
  )
}

/* ---- the script ------------------------------------------------------------ */

/** Runs a scene's script once it is live; if the scene is left or arrives instant, jumps to its end instead. */
export function useScene(live: boolean, instant: boolean, script: (stage: Stage) => Promise<void>, end: () => void) {
  const started = useRef(false)
  const finished = useRef(false)
  const scriptRef = useRef(script)
  const endRef = useRef(end)
  useLayoutEffect(() => {
    scriptRef.current = script
    endRef.current = end
  })

  useEffect(() => {
    if (finished.current) return
    const finish = () => {
      finished.current = true
      endRef.current()
    }
    if (instant) return finish()
    /* left before it finished: show how it ends */
    if (!live) {
      if (started.current) finish()
      return
    }
    started.current = true
    let gone = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const wait = (ms: number) =>
      new Promise<void>((done, fail) => {
        if (gone) return fail(new Cancelled())
        const t = setTimeout(() => {
          timers.delete(t)
          if (gone) fail(new Cancelled())
          else done()
        }, ms)
        timers.add(t)
      })
    scriptRef
      .current({ wait })
      .then(() => {
        if (!gone) finish()
      })
      .catch((e: unknown) => {
        if (!(e instanceof Cancelled)) throw e
      })
    /* torn down mid-run (or by StrictMode's second mount): the next run starts again, or the scene is left and ends */
    return () => {
      gone = true
      timers.forEach(clearTimeout)
    }
  }, [live, instant])
}
