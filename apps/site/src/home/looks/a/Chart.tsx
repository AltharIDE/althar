import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import c from '../A.module.css'
import { type Path, plot } from './path'

/*
 * Prototype, A: the chart drawn under the sheets. Down the left margin, the
 * altitude scale: the first screen's 38 km at the top of the sections, the
 * ground at the download's rule, a tick every 100 m, every kilometre
 * labelled, every five a large numeral. Its needle is held in the middle of
 * the window and reads the height where it points, as the first screen's
 * altimeter does. Through the sheets runs the descent's path, flown up to
 * the needle's height and planned below it, crossing each sheet's top rule
 * at a station and touching down on the zero line; the capsule rides it at
 * the needle's height. With reduced motion the path is drawn whole and
 * nothing rides it. All of it is drawn for the eye only.
 */

/** The first screen's altitude at rest, where the scale starts. */
export const TOP_KM = 38
/** How far below the top of the sections the scale starts, and how tall the needle is. */
const ORIGIN = 76
const NEEDLE = 34

interface Layout {
  width: number
  height: number
  spine: number
  zero: number
  /** The ticks, as three paths: every 100 m, every 500 m, every km and every 5 km. */
  ticks: [string, string, string, string]
  /** Every kilometre's height. */
  km: number[]
  path: Path | null
}

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A height on the scale, for a kilometre. */
const heightOf = (km: number, zero: number) => ORIGIN + ((TOP_KM - km) / TOP_KM) * (zero - ORIGIN)

/** The scale's ticks, from the spine, each on a whole pixel so it stays a crisp line. */
function ticksFor(spine: number, zero: number, wide: boolean): Layout['ticks'] {
  const out: [string[], string[], string[], string[]] = [[], [], [], []]
  for (let k = 0; k <= TOP_KM * 10; k++) {
    const y = Math.round(heightOf(k / 10, zero)) + 0.5
    const kind = k % 50 === 0 ? 3 : k % 10 === 0 ? 2 : k % 5 === 0 ? 1 : 0
    const len = (wide ? [6, 11, 17, 26] : [4, 6, 10, 14])[kind]!
    out[kind].push(`M${spine} ${y}h${len}`)
  }
  return out.map((one) => one.join('')) as Layout['ticks']
}

/** The chart, laid as the first thing in the sections' main, which it measures. */
export function Chart() {
  const self = useRef<HTMLDivElement>(null)
  const tape = useRef<HTMLDivElement>(null)
  const needle = useRef<HTMLDivElement>(null)
  const read = useRef<HTMLElement>(null)
  const flown = useRef<SVGPathElement>(null)
  const capsule = useRef<SVGGElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)

  // Measures the sheets and draws the chart for them; again whenever anything changes size.
  useLayoutEffect(() => {
    const main = self.current?.parentElement
    if (!main) return
    let frame = 0
    let last = ''
    const measure = () => {
      frame = 0
      const box = main.getBoundingClientRect()
      const width = main.clientWidth
      const height = main.scrollHeight
      const end = main.querySelector<HTMLElement>('#end')
      const spineEl = tape.current
      if (!end || !spineEl) return
      const zero = Math.round(end.getBoundingClientRect().top - box.top)
      const spine = Math.round(spineEl.getBoundingClientRect().left - box.left)
      const wide = getComputedStyle(main).getPropertyValue('--chart-wide').trim() === '1'
      const sheets = [...main.querySelectorAll<HTMLElement>('[data-sheet]')]
      const first = main.querySelector<HTMLElement>('[data-box]')?.getBoundingClientRect()
      const get = end.querySelector<HTMLElement>('[data-land]')?.getBoundingClientRect()
      let path: Path | null = null
      if (wide && first && get) {
        const contentLeft = first.left - box.left
        const contentRight = first.right - box.left
        const stops = sheets.map((sheet) => {
          const r = sheet.getBoundingClientRect()
          const pad = parseFloat(getComputedStyle(sheet).paddingBottom) || 0
          return { rule: r.top - box.top, foot: r.bottom - box.top - pad }
        })
        path = plot({
          start: ORIGIN,
          // Midway between the scale's longest ticks and the crop marks, and as far out at the right.
          left: Math.round((spine + 26 + contentLeft - 22) / 2),
          right: Math.round(Math.min((contentRight + 22 + width) / 2, contentRight + 72)),
          stops,
          zero,
          land: Math.round(get.left - box.left + get.width / 2),
        })
      }
      const key = `${width}x${height}:${zero}:${spine}:${wide}:${path?.d.length ?? 0}:${path?.length.toFixed(0) ?? ''}`
      if (key === last) return
      last = key
      setLayout({
        width,
        height,
        spine,
        zero,
        ticks: ticksFor(spine, zero, wide),
        km: Array.from({ length: TOP_KM + 1 }, (_, km) => Math.round(heightOf(km, zero))),
        path,
      })
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    const ro = new ResizeObserver(later)
    ro.observe(main)
    for (const sheet of main.querySelectorAll('[data-sheet], #end')) ro.observe(sheet)
    window.addEventListener('resize', later)
    void document.fonts?.ready.then(later)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', later)
    }
  }, [])

  // Each sheet's title block: the heights it spans, from its rule to the next.
  useLayoutEffect(() => {
    const main = self.current?.parentElement
    if (!main || !layout) return
    const sheets = [...main.querySelectorAll<HTMLElement>('[data-sheet]')]
    const box = main.getBoundingClientRect()
    const kmAt = (y: number) => Math.max(0, TOP_KM * (1 - (y - ORIGIN) / (layout.zero - ORIGIN)))
    sheets.forEach((sheet, i) => {
      const from = sheet.getBoundingClientRect().top - box.top
      const to = (sheets[i + 1]?.getBoundingClientRect().top ?? box.top + layout.zero) - box.top
      const out = sheet.querySelector<HTMLElement>('[data-span]')
      if (out) out.textContent = `${kmAt(from).toFixed(1)}–${kmAt(to).toFixed(1)}`
    })
  }, [layout])

  // The needle's reading, the path flown and the capsule on it: on scroll, at most once a frame.
  useEffect(() => {
    const main = self.current?.parentElement
    if (!main || !layout) return
    let frame = 0
    const quiet = still()
    const update = () => {
      frame = 0
      const at = needle.current?.getBoundingClientRect()
      const top = main.getBoundingClientRect().top
      if (!at) return
      const y = at.top + at.height / 2 - top
      const km = Math.max(0, Math.min(TOP_KM, TOP_KM * (1 - (y - ORIGIN) / (layout.zero - ORIGIN))))
      const text = km.toFixed(2)
      if (read.current && read.current.textContent !== text) read.current.textContent = text
      // The large figures fade as they pass under the needle, as a tape's do under its window.
      for (const figure of tape.current?.querySelectorAll<HTMLElement>('[data-figure]') ?? []) {
        const near = Math.abs(Number(figure.dataset.figure) - y)
        const opacity = near > 110 ? '' : Math.max(0, Math.min(1, (near - 34) / 76)).toFixed(2)
        if (figure.style.opacity !== opacity) figure.style.opacity = opacity
      }
      const path = layout.path
      if (!path || !flown.current) return
      if (quiet) {
        flown.current.style.strokeDasharray = 'none'
        return
      }
      const point = path.at(y)
      flown.current.style.strokeDasharray = `${point.length.toFixed(1)} ${(path.length + 10).toFixed(0)}`
      capsule.current?.setAttribute('transform', `translate(${point.x.toFixed(1)} ${y.toFixed(1)})`)
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', later, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', later)
    }
  }, [layout])

  const path = layout?.path
  return (
    <div ref={self} className={c.chart} aria-hidden="true">
      {layout && (
        <svg
          className={c.plot}
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          focusable="false"
        >
          <g className={c.ticks} shapeRendering="crispEdges">
            <path d={`M${layout.spine + 0.5} ${ORIGIN}V${layout.zero}`} className={c.spineLine} />
            {layout.ticks.map((d, i) => (
              <path key={i} d={d} data-kind={i} />
            ))}
          </g>
          {path && (
            <g className={c.flight}>
              <path d={path.d} className={c.planned} />
              <path ref={flown} d={path.d} className={c.flown} />
              {path.stations.map(([x, y], i) => (
                <g key={i} className={c.station} transform={`translate(${x} ${Math.round(y) + 0.5})`}>
                  <path d="M-11 0h22M0 -11v22" />
                  <circle r="5" />
                </g>
              ))}
              {/* Where it sets off: the first screen's height. */}
              <g className={c.station} transform={`translate(${layout.path ? path.at(ORIGIN).x : 0} ${ORIGIN + 0.5})`}>
                <path d="M-11 0h22M0 -11v22" />
                <circle r="5" />
              </g>
              <g className={c.touchdown} transform={`translate(${path.touchdown[0]} ${path.touchdown[1]})`}>
                <path d="M-14 0.5h28M0 -14v14" />
                <circle r="5.5" />
              </g>
              <g ref={capsule} className={c.capsule} transform={`translate(${path.stations[0]?.[0] ?? 0} ${ORIGIN})`}>
                <circle r="10" className={c.halo} />
                <circle r="4" />
              </g>
            </g>
          )}
        </svg>
      )}
      {/* The scale's figures, and the needle held in the window's middle; the tape spans the scale. */}
      <div ref={tape} className={c.tape} style={layout ? { top: ORIGIN - NEEDLE / 2, height: layout.zero - ORIGIN + NEEDLE } : undefined}>
        {/* The ground's zero is the zero line itself, where the needle comes to rest. */}
        {layout?.km.map((y, km) =>
          km === 0 ? null : (
            <span
              key={km}
              className={km % 5 === 0 || km === TOP_KM ? c.numeral : c.km}
              style={{ top: y - ORIGIN + NEEDLE / 2 }}
              data-figure={km % 5 === 0 || km === TOP_KM ? y : undefined}
            >
              {km}
            </span>
          ),
        )}
        <div ref={needle} className={c.needle}>
          <b ref={read}>{TOP_KM.toFixed(2)}</b>
          <i>km</i>
        </div>
      </div>
    </div>
  )
}
