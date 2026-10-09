import { useEffect, useRef } from 'react'

import { STATEMENT } from './Footers'
import { fitCanvas, Links, noise, Signature, still, useOnScreen, YEAR } from './parts'
import s from './Print.module.css'

/*
 * At your fingertips, taken at its word: a fingertip's print, large, in fine
 * pale ridges on the dark, pressed up from the page's foot. Where you point
 * (or touch), the ridges under it light in Althar's cobalt, as a reader
 * lights under a finger; left alone, a reading line passes up it now and
 * then. The ridges are drawn once for the size; the light over them is
 * composed on every frame, only while it is seen.
 */

interface Print {
  base: HTMLCanvasElement
  bright: HTMLCanvasElement
  mask: HTMLCanvasElement
  temp: HTMLCanvasElement
  /** The print's box, for the reading line. */
  top: number
  bottom: number
  cx: number
  w: number
  h: number
  dpr: number
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Draws the ridges, dim and lit, into two canvases the size of the footer. */
function makePrint(w: number, h: number, dpr: number): Print {
  const phone = w < 700
  const k = Math.min(1.1, Math.max(0.7, w / 1440))
  const cx = phone ? w * 0.6 : w * 0.74
  const cy = phone ? h * 0.9 : h * 0.8
  const R = phone ? Math.min(w * 0.66, 320) : Math.min(w * 0.33, h * 0.68)
  const rx = R * 0.8
  const ry = R * 1.08
  const core = { x: cx - R * 0.04, y: cy - R * 0.14 }
  const S = 9.5 * k
  const { n2 } = noise(31)

  /** The ridges' field: its whole numbers are the ridges. `turn` 1 measures the angle from 0 to a full turn, so its seam is on the other side. */
  const field = (x: number, y: number, turn = 0) => {
    const wx = x + (n2(x / 95, y / 95) - 0.5) * 16 * k
    const wy = y + (n2(x / 95 + 40, y / 95 + 40) - 0.5) * 16 * k
    const dx = wx - core.x
    const dy = (wy - core.y) / 1.32
    let angle = Math.atan2(dy, dx)
    if (turn && angle < 0) angle += Math.PI * 2
    const spiral = Math.hypot(dx, dy) + (S * angle) / (Math.PI * 2)
    const flat = dy + (0.16 * dx * dx) / R
    const t = smooth(R * 0.2, R * 0.62, wy - core.y) * smooth(R * 0.1, R * 0.45, Math.hypot(dx, dy))
    return (spiral + (flat - spiral) * t) / S
  }
  const edge = (x: number, y: number) => Math.hypot((x - cx) / rx, (y - cy) / ry)

  // Marching squares over the print's box, in buckets of how faded each piece is toward the print's edge.
  const step = phone ? 2.2 : 2.6
  const x0 = Math.max(0, cx - rx)
  const x1 = Math.min(w, cx + rx)
  const y0 = Math.max(0, cy - ry)
  const y1 = Math.min(h, cy + ry)
  const cols = Math.ceil((x1 - x0) / step) + 1
  const rows = Math.ceil((y1 - y0) / step) + 1
  // The field twice, with its seam on either side of the core: each piece is drawn from whichever is whole there.
  const values = new Float32Array(cols * rows)
  const other = new Float32Array(cols * rows)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      values[j * cols + i] = field(x0 + i * step, y0 + j * step)
      other[j * cols + i] = field(x0 + i * step, y0 + j * step, 1)
    }
  const buckets: number[][] = Array.from({ length: 6 }, () => [])
  const cut = noise(57).n2
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      let grid = values
      if (
        Math.max(values[j * cols + i]!, values[(j + 1) * cols + i]!) - Math.min(values[j * cols + i]!, values[(j + 1) * cols + i]!) >
        0.62
      )
        grid = other
      const a = grid[j * cols + i]!
      const b = grid[j * cols + i + 1]!
      const c = grid[(j + 1) * cols + i + 1]!
      const d = grid[(j + 1) * cols + i]!
      const lo = Math.min(a, b, c, d)
      const hi = Math.max(a, b, c, d)
      const x = x0 + i * step
      const y = y0 + j * step
      const e = edge(x, y)
      // Across the spiral's seam the field jumps by a whole ridge: nothing to draw there.
      if (e > 1 || hi - lo > 0.62) continue
      const fade = smooth(1, 0.78, e)
      const bucket = buckets[Math.min(5, Math.floor(fade * 6))]!
      for (let level = Math.ceil(lo); level <= Math.floor(hi); level++) {
        // Ridge endings: each ridge stops here and there, on its own.
        if (cut(x / 16 + level * 3.7, y / 16 - level * 1.3) > 0.8) continue
        const pts: number[] = []
        const cross = (va: number, vb: number, ax: number, ay: number, bx: number, by: number) => {
          if ((va - level) * (vb - level) < 0 || (va === level && vb !== level)) {
            const t = (level - va) / (vb - va)
            pts.push(ax + (bx - ax) * t, ay + (by - ay) * t)
          }
        }
        cross(a, b, x, y, x + step, y)
        cross(b, c, x + step, y, x + step, y + step)
        cross(c, d, x + step, y + step, x, y + step)
        cross(d, a, x, y + step, x, y)
        if (pts.length >= 4) bucket.push(pts[0]!, pts[1]!, pts[2]!, pts[3]!)
        if (pts.length >= 8) bucket.push(pts[4]!, pts[5]!, pts[6]!, pts[7]!)
      }
    }
  }

  const canvas = () => {
    const c = document.createElement('canvas')
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    return c
  }
  const stroke = (target: HTMLCanvasElement, style: string, width: number, alpha: number) => {
    const ctx = target.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.strokeStyle = style
    ctx.lineWidth = width
    buckets.forEach((segs, b) => {
      ctx.globalAlpha = alpha * ((b + 1) / 6)
      ctx.beginPath()
      for (let i = 0; i < segs.length; i += 4) {
        ctx.moveTo(segs[i]!, segs[i + 1]!)
        ctx.lineTo(segs[i + 2]!, segs[i + 3]!)
      }
      ctx.stroke()
    })
  }
  const base = canvas()
  stroke(base, '#ffffff', 1.6 * k, 0.3)
  const bright = canvas()
  stroke(bright, '#4f5dff', 5 * k, 0.5)
  stroke(bright, '#dfe3ff', 1.6 * k, 1)
  return { base, bright, mask: canvas(), temp: canvas(), top: cy - ry, bottom: Math.min(h, cy + ry * 0.4), cx, w, h, dpr }
}

export function Print() {
  const box = useRef<HTMLElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const print = useRef<Print | null>(null)
  const pointer = useRef({ x: 0, y: 0, on: 0, want: 0 })
  const on = useOnScreen(box)

  useEffect(() => {
    const el = view.current
    if (!el) return
    return fitCanvas(el, (_ctx, w, h) => {
      print.current = makePrint(w, h, Math.min(2, window.devicePixelRatio || 1))
    })
  }, [])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      pointer.current.x = e.clientX - r.left
      pointer.current.y = e.clientY - r.top
      pointer.current.want = 1
    }
    const leave = () => {
      pointer.current.want = 0
    }
    // A touch lights where it lands, and lets go when the finger lifts.
    const lift = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') leave()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerdown', move)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('pointerup', lift)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerdown', move)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('pointerup', lift)
    }
  }, [])

  useEffect(() => {
    const el = view.current
    if (!el || !on) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = print.current
      const ctx = el.getContext('2d')
      if (p && ctx) {
        const t = still() ? 2600 : now - start
        const ptr = pointer.current
        ptr.on += (ptr.want - ptr.on) * 0.08
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, el.width, el.height)
        ctx.drawImage(p.base, 0, 0)
        // Where it lights: under the pointer, and the reading line passing up now and then.
        const m = p.mask.getContext('2d')!
        m.setTransform(p.dpr, 0, 0, p.dpr, 0, 0)
        m.clearRect(0, 0, p.w, p.h)
        m.globalCompositeOperation = 'lighter'
        if (ptr.on > 0.01) {
          const r = 190
          const g = m.createRadialGradient(ptr.x, ptr.y, 0, ptr.x, ptr.y, r)
          g.addColorStop(0, `rgba(0,0,0,${ptr.on})`)
          g.addColorStop(0.5, `rgba(0,0,0,${0.55 * ptr.on})`)
          g.addColorStop(1, 'rgba(0,0,0,0)')
          m.fillStyle = g
          m.fillRect(ptr.x - r, ptr.y - r, r * 2, r * 2)
        }
        const cycle = 7000
        const q = (t % cycle) / 2600
        if (q < 1) {
          const ease = 1 - (1 - q) ** 3
          const y = p.bottom - (p.bottom - p.top) * ease
          const band = 60
          const g = m.createLinearGradient(0, y - band, 0, y + band)
          const a = 0.9 * Math.sin(Math.PI * Math.min(1, q * 1.15))
          g.addColorStop(0, 'rgba(0,0,0,0)')
          g.addColorStop(0.5, `rgba(0,0,0,${a.toFixed(3)})`)
          g.addColorStop(1, 'rgba(0,0,0,0)')
          m.fillStyle = g
          m.fillRect(0, y - band, p.w, band * 2)
        }
        m.globalCompositeOperation = 'source-over'
        const tc = p.temp.getContext('2d')!
        tc.setTransform(1, 0, 0, 1, 0, 0)
        tc.globalCompositeOperation = 'source-over'
        tc.clearRect(0, 0, p.temp.width, p.temp.height)
        tc.drawImage(p.bright, 0, 0)
        tc.globalCompositeOperation = 'destination-in'
        tc.drawImage(p.mask, 0, 0)
        tc.globalCompositeOperation = 'source-over'
        ctx.drawImage(p.temp, 0, 0)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [on])

  return (
    <footer ref={box} className={s.print}>
      <canvas ref={view} className={s.canvas} aria-hidden="true" />
      <div className={s.words}>
        <Signature className={s.signature} />
        <h2 className={s.statement}>
          {STATEMENT[0]}
          <br />
          <b>{STATEMENT[1]}</b>
          <br />
          {STATEMENT[2]}
        </h2>
        <div className={s.foot}>
          <Links />
          <p className={s.line}>Althar © {YEAR} · Free and open source</p>
        </div>
      </div>
    </footer>
  )
}
