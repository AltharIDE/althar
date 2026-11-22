import { type RefObject, useEffect } from 'react'

/*
 * The board's scene, poured cobalt by the pointer. While the pointer is over
 * the section a dot follows it, a little behind; as it comes in the dot
 * swells, and cobalt spills from it, column by column: the columns beside
 * the dot first, those further out a little later and a little lower, as
 * water over a lip, each falling faster as it goes, with a drip at its head
 * and streaks running down it. The heading turns white exactly where the
 * cobalt is over it: a white copy of it, cut to the columns. As the pointer
 * leaves, the cobalt drains down from where it left. Drawn only in the band
 * of the section on screen. With reduced motion, none of it.
 */

/** A column's width, in px. */
const COLUMN = 22

/** Each column: still (0), pouring (1), full (2) or draining (3). */
interface Column {
  x: number
  state: 0 | 1 | 2 | 3
  /** Draining: how far, 0 to 1. */
  f: number
  speed: number
  phase: number
  /** Pouring: where it spills from, how far up and down it has reached, and how fast it falls. */
  from: number
  up: number
  down: number
  v: number
}

export function useWaterfall(
  section: RefObject<HTMLElement | null>,
  canvas: RefObject<HTMLCanvasElement | null>,
  follower: RefObject<HTMLElement | null>,
  copy: RefObject<HTMLElement | null>,
  still: boolean,
) {
  useEffect(() => {
    const sec = section.current
    const cv = canvas.current
    const dot = follower.current
    const white = copy.current
    if (!sec || !cv || !dot || !white || still) return

    let cx: number | null = null
    let cy = 0
    let moved = -1e9
    const onPointer = (e: PointerEvent) => {
      cx = e.clientX
      cy = e.clientY
      moved = performance.now()
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    let cols: Column[] = []
    let width = -1
    let inside = false
    let since = 0
    let set = false
    let ox = 0
    let oy = 0
    let dx: number | null = null
    let dy = 0
    let drawn = false
    let swell = 0
    let last = performance.now()
    let frame = 0
    const hide = 'inset(0 0 100% 0)'

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(50, now - last) / 1000
      last = now
      const r = sec.getBoundingClientRect()
      const vh = window.innerHeight
      if (r.bottom < -vh || r.top > vh * 2) return
      const w = sec.offsetWidth
      const h = sec.offsetHeight

      // The dot, following.
      let mx = 0
      let my = 0
      let over = false
      if (cx !== null) {
        mx = cx - r.left
        my = cy - r.top
        over = cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom && now - moved < 4000
      }
      if (dx === null) {
        dx = mx
        dy = my
      }
      dx += (mx - dx) * 0.12
      dy += (my - dy) * 0.12
      dot.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`
      dot.toggleAttribute('data-in', over)

      if (width !== w) {
        width = w
        cols = []
        for (let x = 0; x < w + COLUMN; x += COLUMN)
          cols.push({ x, state: 0, f: 0, speed: 0.75 + Math.random() * 0.6, phase: Math.random() * 6.28, from: 0, up: 0, down: 0, v: 0 })
      }
      if (over !== inside) {
        inside = over
        since = now
        set = false
        ox = mx
        if (inside) {
          swell = now
          dot.toggleAttribute('data-swell', true)
        }
      }
      if (now - swell > 180) dot.removeAttribute('data-swell')
      const t = (now - since) / 1000
      // The dot swells, then pours.
      const lead = inside ? 0.14 : 0
      const top = Math.max(0, -r.top)
      const bottom = Math.min(h, top + vh)
      const band = Math.max(1, bottom - top)
      if (inside && t >= lead && !set) {
        set = true
        ox = dx
        oy = dy
      }

      let filled = 0
      let busy = false
      for (const c of cols) {
        const off = c.x + COLUMN / 2 - ox
        const ready = t > lead + Math.abs(off) / 3600
        if (inside) {
          if (c.state === 0 && ready) {
            c.state = 1
            c.from = oy + Math.min(160, off * off * 0.00028)
            c.up = 0
            c.down = 0
            c.v = 500 + 300 * c.speed
          }
        } else if (c.state === 2 && ready) {
          c.state = 3
          c.f = 0
        }
        if (c.state === 1) {
          c.v += 4200 * dt
          c.down += c.v * dt
          c.up += (750 + 350 * c.speed) * dt
          if (c.from - c.up <= top && c.from + c.down >= bottom + 30) {
            c.state = inside ? 2 : 3
            c.f = 0
          }
          busy = true
        } else if (c.state === 3) {
          c.f += (dt * c.speed) / 0.42
          if (c.f >= 1) {
            c.f = 0
            c.state = 0
          }
          busy = true
        }
        if (c.state === 2) filled++
        else if (c.state === 1) filled += Math.min(1, (Math.min(bottom, c.from + c.down) - Math.max(top, c.from - c.up)) / band)
        else if (c.state === 3) filled += 1 - c.f
        if (c.state === 0 && inside) busy = true
      }
      sec.toggleAttribute('data-poured', filled / cols.length > 0.42)

      if (!busy && !cols.some((c) => c.state !== 0)) {
        if (drawn) {
          cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height)
          white.style.clipPath = hide
          drawn = false
        }
        return
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const ch = Math.ceil(band)
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(ch * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(ch * dpr)
        cv.style.width = `${w}px`
        cv.style.height = `${ch}px`
      }
      cv.style.top = `${top}px`
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, ch)
      drawn = true
      const fall = (f: number) => 1 - Math.pow(1 - f, 2.2)
      const s = now / 1000
      const spans: Array<[number, number, number]> = []
      g.fillStyle = '#2b3bff'
      for (const c of cols) {
        if (c.state === 0) continue
        const wob = Math.sin(s * 3 + c.phase) * 8
        let y0 = 0
        let y1 = ch
        if (c.state === 1) {
          y0 = c.from - c.up - top
          y1 = c.from + c.down - top + wob
        }
        if (c.state === 3) y0 = fall(c.f) * (ch + 60) + wob - 30
        if (y1 <= y0) continue
        g.fillRect(c.x - 0.5, y0, COLUMN + 1, y1 - y0)
        spans.push([c.x, y0 > 0 ? y0 - COLUMN / 2 : y0, c.state === 1 ? y1 + COLUMN / 2 : y1])
        // A drip at a falling head, a round top on a draining one.
        if (c.state === 1 || c.state === 3) {
          const ends = c.state === 1 ? [y1, ...(y0 > 0 ? [y0] : [])] : [y0]
          for (const y of ends) {
            g.beginPath()
            g.arc(c.x + COLUMN / 2, y, COLUMN / 2 + 0.5, 0, Math.PI * 2)
            g.fill()
          }
        }
      }
      // Streaks, while it pours or drains.
      g.strokeStyle = 'rgba(180, 188, 255, 0.22)'
      g.lineWidth = 1.2
      for (const c of cols) {
        if (c.state !== 1 && c.state !== 3) continue
        const lo = c.state === 1 ? Math.max(0, c.from - top) : fall(c.f) * (ch + 60) - 30
        const hi = c.state === 1 ? Math.min(ch, c.from + c.down - top) : ch
        if (hi - lo < 20) continue
        for (let k = 0; k < 2; k++) {
          const y = lo + ((s * 380 * c.speed + c.phase * 90 + k * 260) % Math.max(40, hi - lo))
          const x = c.x + 5 + k * 11
          g.beginPath()
          g.moveTo(x, y)
          g.lineTo(x, Math.min(hi, y + 46))
          g.stroke()
        }
      }

      // The white heading, cut to the cobalt.
      if (cols.every((c) => c.state === 2)) white.style.clipPath = 'none'
      else {
        const box = white.getBoundingClientRect()
        const ex = box.left - r.left
        const ey = box.top - r.top - top
        let path = ''
        for (const [x, a, b] of spans) {
          const x0 = x - ex - 0.5
          const x1 = x + COLUMN - ex + 0.5
          const y0 = Math.max(-2, a - ey)
          const y1 = Math.min(box.height + 2, b - ey)
          if (x1 < 0 || x0 > box.width || y1 <= y0) continue
          path += `M${x0.toFixed(1)} ${y0.toFixed(1)}H${x1.toFixed(1)}V${y1.toFixed(1)}H${x0.toFixed(1)}Z`
        }
        white.style.clipPath = path ? `path('${path}')` : hide
      }
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointer)
      white.style.removeProperty('clip-path')
      sec.removeAttribute('data-poured')
    }
  }, [section, canvas, follower, copy, still])
}
