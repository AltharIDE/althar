import { useLayoutEffect, useRef, useState } from 'react'

import { ALTAR_X } from '../../../shared/footer/engraving'
import b from '../B.module.css'
import { type Box, terrain, type TerrainPaths } from './terrain'

/*
 * Prototype, B: the map sheet drawn under the sections. Its neatline, a
 * graduated border down both sides and across the top and foot, a minute of
 * latitude a segment, labelled in the margin; a graticule's register
 * crosses; the landing site's contours; and at the foot the lake, its
 * headland and the landing mark, in line with the footer's altar. The
 * border's figures zoom in as you go down: each section is mapped at a
 * finer scale than the one above, so the latitudes close in on the landing
 * site's, and each section's head gives where it is. All of it is drawn
 * once for the eye only, and again only when something changes size.
 */

/** Each section's ground per segment of the border, in seconds of arc: finer as the map zooms in. */
export const STEPS: Record<string, number> = { independent: 600, coordinator: 120, review: 30, flow: 10, edge: 5, end: 1 }
/** The landing site: 46°30′N 7°58′E. */
const LAT0 = 46 * 3600 + 30 * 60
const LON0 = 7 * 3600 + 58 * 60

/** An angle as a map writes it, to the second where the scale is finer than a minute a segment. */
export function dms(sec: number, hemi: string, fine: boolean) {
  const d = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d}°${two(m)}′${fine ? `${two(s)}″` : ''}${hemi}`
}

interface Label {
  x: number
  y: number
  text: string
  side: 'l' | 'r' | 't' | 'b'
}

interface Layout {
  width: number
  height: number
  /** The border's crisp paths: its lines, its filled segments, its corners. */
  lines: string
  fills: string
  crosses: [string, string]
  labels: Label[]
  map: TerrainPaths
  mark: { x: number; y: number }
}

const box = (el: Element, o: DOMRect): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left - o.left, top: r.top - o.top, right: r.right - o.left, bottom: r.bottom - o.top }
}

export function Sheet() {
  const self = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<Layout | null>(null)

  useLayoutEffect(() => {
    const main = self.current?.parentElement
    if (!main) return
    let frame = 0
    let last = ''
    const measure = () => {
      frame = 0
      const o = main.getBoundingClientRect()
      const width = main.clientWidth
      const height = main.scrollHeight
      const css = getComputedStyle(main)
      const px = (name: string) => parseFloat(css.getPropertyValue(name)) || 0
      const edge = px('--edge')
      const bandW = px('--band')
      const seg = px('--seg')
      const top = px('--sheet-top')
      const bottom = height - px('--sheet-foot')
      const labelled = css.getPropertyValue('--labels').trim() === '1'
      const narrow = width < 760
      const sections = [...main.querySelectorAll<HTMLElement>('section[id]')]
      const end = main.querySelector<HTMLElement>('#end')
      const clearEls = [...main.querySelectorAll('[data-clear]')]
      if (!end || !sections.length) return
      const clear = clearEls.map((el) => box(el, o))
      const tops = sections.map((s) => ({ id: s.id, top: s.getBoundingClientRect().top - o.top }))
      const endBox = box(end, o)
      const key = `${width}x${height}:${clear.map((c) => `${c.left | 0},${c.top | 0},${c.right | 0},${c.bottom | 0}`).join(';')}`
      if (key === last) return
      last = key

      // The landing mark, under the footer's altar, on the lake's headland in the end's open side.
      const mark = narrow
        ? { x: Math.round(width * 0.64), y: Math.round(endBox.bottom - 150) }
        : { x: Math.round(width * ALTAR_X), y: Math.round(endBox.top + (endBox.bottom - endBox.top) * 0.6) }
      const lake = narrow
        ? { cx: width * 0.52, cy: mark.y - 30, rx: width * 0.44, ry: 112 }
        : {
            cx: mark.x - width * 0.04,
            cy: mark.y - 34,
            rx: Math.max(170, width * 0.19),
            ry: Math.min(200, (endBox.bottom - endBox.top) * 0.36),
          }

      // ---- the border ----
      const L = edge
      const R = width - edge - 1
      const lines: string[] = []
      const fills: string[] = []
      const labels: Label[] = []
      const h = (y: number, x1: number, x2: number) => lines.push(`M${x1} ${y + 0.5}H${x2}`)
      const v = (x: number, y1: number, y2: number) => lines.push(`M${x + 0.5} ${y1}V${y2}`)
      // Down both sides: the outer line, the inner, and between them every other segment filled.
      for (const [outer, inner] of [
        [L, L + bandW],
        [R, R - bandW],
      ] as const) {
        v(outer, top, bottom + 1)
        v(inner, top + bandW, bottom - bandW + 1)
      }
      h(top, L, R + 1)
      h(top + bandW, L + bandW, R - bandW + 1)
      h(bottom - bandW, L + bandW, R - bandW + 1)
      h(bottom, L, R + 1)
      // The corners, solid.
      for (const [x, y] of [
        [L, top],
        [R - bandW + 1, top],
        [L, bottom - bandW + 1],
        [R - bandW + 1, bottom - bandW + 1],
      ] as const)
        fills.push(`M${x} ${y}h${bandW}v${bandW}h${-bandW}Z`)

      // Latitudes, walked up from the foot: each segment as fine as the section it lies in, coarsening only where the figure is round for it.
      const stepAt = (y: number) => {
        let id = sections[0]!.id
        for (const t of tops) if (t.top <= y) id = t.id
        return STEPS[id] ?? 600
      }
      const latAt = new Map<number, { value: number; step: number }>()
      let value = LAT0
      let step = STEPS.end!
      let k = 0
      for (let y = bottom - bandW; y > top + bandW; y -= seg, k++) {
        const want = stepAt(y - seg / 2)
        if (want > step && (value - LAT0) % want === 0) step = want
        latAt.set(Math.round(y), { value, step })
        const y0 = Math.max(top + bandW, y - seg)
        if (k % 2 === 0) {
          fills.push(`M${L + 1} ${y0}h${bandW - 1}v${y - y0}h${1 - bandW}Z`)
          fills.push(`M${R - bandW + 1} ${y0}h${bandW - 1}v${y - y0}h${1 - bandW}Z`)
        }
        if (labelled && (value - LAT0) % (4 * step) === 0 && y < bottom - bandW - 4 && y > top + bandW + 10) {
          const text = dms(value, 'N', step < 60)
          labels.push({ x: L + bandW, y, text, side: 'l' }, { x: R - bandW, y, text, side: 'r' })
        }
        value += step
      }
      // Longitudes across the top, at the top section's scale, and across the foot at the end's, from the landing mark out.
      for (const [y, s, side] of [
        [top, STEPS.independent!, 't'],
        [bottom - bandW + 1, STEPS.end!, 'b'],
      ] as const) {
        const first = Math.ceil((L + bandW - mark.x) / seg)
        for (let m = first; mark.x + m * seg < R - bandW; m++) {
          const x0 = Math.max(L + bandW, mark.x + m * seg)
          const x1 = Math.min(R - bandW + 1, mark.x + (m + 1) * seg)
          if (((m % 2) + 2) % 2 === 0) fills.push(`M${x0} ${y + (side === 't' ? 1 : 0)}h${x1 - x0}v${bandW - 1}h${x0 - x1}Z`)
          if (labelled && m % 4 === 0 && x0 - L > 70 && R - x0 > 70)
            labels.push({ x: mark.x + m * seg, y: side === 't' ? top : bottom, text: dms(LON0 + m * s, 'E', s < 60), side })
        }
      }

      // ---- each section's head: where it is, at its own scale ----
      for (const section of sections) {
        const out = section.querySelector<HTMLElement>('[data-coord]')
        if (!out) continue
        const s = STEPS[section.id] ?? 600
        const y = section.getBoundingClientRect().top - o.top
        let near = { value: LAT0, step: 1 }
        let best = Infinity
        for (const [ly, at] of latAt) {
          if (Math.abs(ly - y) < best) {
            best = Math.abs(ly - y)
            near = at
          }
        }
        const cx = width / 2
        const lon = LON0 + Math.round((cx - mark.x) / seg) * s
        const text = `${dms(near.value, 'N', s < 60)}  ${dms(lon, 'E', s < 60)}`
        if (out.textContent !== text) out.textContent = text
      }

      // ---- the graticule's crosses, clear of the words ----
      const crosses: [string[], string[]] = [[], []]
      const grid = narrow ? 120 : 160
      for (let y = bottom - grid; y > top + 40; y -= grid) {
        for (let x = mark.x + Math.ceil((L + 48 - mark.x) / grid) * grid; x < R - 48; x += grid) {
          let c = Infinity
          for (const b of clear) c = Math.min(c, Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom)))
          if (c < 26) continue
          crosses[c < 70 ? 1 : 0].push(`M${x - 5} ${Math.round(y) + 0.5}h11M${x + 0.5} ${Math.round(y) - 5}v11`)
        }
      }

      const map = terrain({
        width,
        height: bottom - bandW,
        lake,
        mark,
        clear: [
          ...clear,
          // The border and its figures, and round the mark.
          { left: 0, top: 0, right: L + bandW + (labelled ? 70 : 10), bottom: height },
          { left: R - bandW - (labelled ? 70 : 10), top: 0, right: width, bottom: height },
          { left: 0, top: 0, right: width, bottom: top + bandW + 10 },
          { left: mark.x - 18, top: mark.y - 18, right: mark.x + 18, bottom: mark.y + 18 },
        ],
        step: narrow ? 10 : 8,
      })
      setLayout({
        width,
        height,
        lines: lines.join(''),
        fills: fills.join(''),
        crosses: [crosses[0].join(''), crosses[1].join('')],
        labels,
        map,
        mark,
      })
    }
    const later = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    const ro = new ResizeObserver(later)
    ro.observe(main)
    for (const el of main.querySelectorAll('section[id]')) ro.observe(el)
    window.addEventListener('resize', later)
    void document.fonts?.ready.then(later)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', later)
    }
  }, [])

  const m = layout?.map
  return (
    <div ref={self} className={b.sheetArt} aria-hidden="true">
      {layout && m && (
        <>
          <svg
            className={b.art}
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            focusable="false"
          >
            <g className={b.contours}>{m.contour.map((d, i) => d && <path key={i} d={d} data-s={i} />)}</g>
            <g className={b.indexes}>{m.index.map((d, i) => d && <path key={i} d={d} data-s={i} />)}</g>
            <g className={b.water}>{m.water.map((d, i) => d && <path key={i} d={d} data-s={i} />)}</g>
            <g className={b.shore}>{m.shore.map((d, i) => d && <path key={i} d={d} data-s={i} />)}</g>
            <g className={b.crosses} shapeRendering="crispEdges">
              <path d={layout.crosses[0]} />
              <path d={layout.crosses[1]} data-s="1" />
            </g>
            <g className={b.border} shapeRendering="crispEdges">
              <path d={layout.lines} className={b.borderLines} />
              <path d={layout.fills} className={b.borderFills} />
            </g>
            {/* The landing mark: rings round a point, its cross reaching out past them. */}
            <g className={b.mark} transform={`translate(${layout.mark.x} ${layout.mark.y})`}>
              <circle r="22" />
              <circle r="12" />
              <circle r="3.5" className={b.markDot} />
              <path d="M-36 0h18M18 0h18M0 -36v18M0 18v18" />
            </g>
          </svg>
          {layout.labels.map((l, i) => (
            <span key={i} className={b.label} data-side={l.side} style={{ left: l.x, top: l.y }}>
              {l.text}
            </span>
          ))}
          <span className={b.markLabel} style={{ left: layout.mark.x + 30, top: layout.mark.y + 26 }}>
            {dms(LAT0, 'N', true)} {dms(LON0, 'E', true)}
          </span>
        </>
      )}
    </div>
  )
}
