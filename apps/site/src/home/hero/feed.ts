import { type RefObject, useEffect } from 'react'

/*
 * The first screen's two answers to the pointer.
 *
 * A small cobalt dot follows the pointer while it is over the first screen,
 * a little behind it.
 *
 * Over the download, the agents feed it: dots stream from the agents on
 * their orbits, each along its own curve, into the button, and each one that
 * lands grows the button a little, to a tenth larger at most; full, the
 * feeding stops. Leave the button and what is still on its way turns round,
 * and every dot the button took flies back to the agent that sent it, the
 * button shrinking back as they go. With reduced motion, neither.
 */

/** Deliveries that fill the button, and how much larger it is full. */
const FULL = 24
const GROW = 0.1

interface Dot {
  from: number
  out: boolean
  t: number
  d: number
  size: number
  bend: number
  ox: number
  oy: number
}

const ease = (t: number) => t * t * t * (t * (6 * t - 15) + 10)

export function useFeed(
  hero: RefObject<HTMLElement | null>,
  button: RefObject<HTMLElement | null>,
  canvas: RefObject<HTMLCanvasElement | null>,
  follower: RefObject<HTMLElement | null>,
  still: boolean,
) {
  useEffect(() => {
    const root = hero.current
    const btn = button.current
    const cv = canvas.current
    const dot = follower.current
    if (!root || !btn || !cv || !dot || still) return

    let cx: number | null = null
    let cy = 0
    let moved = -1e9
    const onPointer = (e: PointerEvent) => {
      cx = e.clientX
      cy = e.clientY
      moved = performance.now()
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    let feeding = false
    const on = () => {
      feeding = true
      root.toggleAttribute('data-feeding', true)
    }
    const off = () => {
      feeding = false
      root.toggleAttribute('data-feeding', false)
    }
    btn.addEventListener('pointerenter', on)
    btn.addEventListener('pointerleave', off)
    btn.addEventListener('focus', on)
    btn.addEventListener('blur', off)

    let fx: number | null = null
    let fy = 0
    let full = 0
    let shown = 0
    let emit = 0
    let drawn = false
    let dots: Dot[] = []
    const kept: number[] = []
    let last = performance.now()
    let frame = 0

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(50, now - last) / 1000
      last = now
      const box = root.getBoundingClientRect()

      // The follower.
      if (cx !== null) {
        const x = cx - box.left
        const y = cy - box.top
        const inside = cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom && now - moved < 4000
        if (fx === null) {
          fx = x
          fy = y
        }
        fx += (x - fx) * 0.12
        fy += (y - fy) * 0.12
        dot.style.transform = `translate(${fx.toFixed(1)}px, ${fy.toFixed(1)}px)`
        dot.toggleAttribute('data-in', inside)
      }

      // The button, as large as what it holds.
      shown += (full - shown) * Math.min(1, dt * 6)
      btn.style.transform = shown > 0.001 ? `scale(${(1 + GROW * shown).toFixed(4)})` : ''
      btn.style.marginRight = shown > 0.001 ? `${(btn.offsetWidth * GROW * shown).toFixed(2)}px` : ''
      if (!dots.length && full <= 0 && !feeding) {
        if (drawn) {
          cv.getContext('2d')?.clearRect(0, 0, cv.width, cv.height)
          drawn = false
        }
        return
      }

      const w = root.clientWidth
      const h = root.clientHeight
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
        cv.style.width = `${w}px`
        cv.style.height = `${h}px`
      }
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      drawn = true

      const discs = [...root.querySelectorAll<SVGGElement>('[data-planet]')]
      const centre = (el: Element) => {
        const r = el.getBoundingClientRect()
        return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top] as const
      }
      const [bx, by] = centre(btn)
      const bw = btn.offsetWidth
      const bh = btn.offsetHeight
      const send = (from: number, out: boolean) =>
        dots.push({
          from,
          out,
          t: 0,
          d: 1.5 + Math.random() * 0.9,
          size: 1.6 + Math.random() * 1.8,
          bend: (Math.random() * 0.5 + 0.25) * (Math.random() < 0.5 ? -1 : 1),
          ox: (Math.random() - 0.5) * bw * 0.5,
          oy: (Math.random() - 0.5) * bh * 0.3,
        })

      emit -= dt
      const coming = dots.filter((d) => !d.out).length
      if (feeding) {
        // Fed until full, counting what is already on its way.
        if (emit <= 0 && full + coming / FULL < 1 - 1e-6 && discs.length) {
          emit = 0.11
          send(Math.floor(Math.random() * discs.length), false)
        }
      } else {
        for (const d of dots) {
          if (!d.out) {
            d.out = true
            d.t = 1 - d.t
          }
        }
        if (emit <= 0 && kept.length) {
          emit = 0.09
          send(kept.pop()!, true)
          full = kept.length ? Math.max(0, full - 1 / FULL) : 0
        }
      }

      g.fillStyle = '#2b3bff'
      const next: Dot[] = []
      for (const d of dots) {
        d.t += dt / d.d
        if (d.t >= 1) {
          if (!d.out) {
            full = Math.min(1, full + 1 / FULL)
            kept.push(d.from)
          }
          continue
        }
        const disc = discs[d.from]
        if (!disc) continue
        next.push(d)
        const agent = centre(disc)
        const target = [bx + d.ox, by + d.oy] as const
        const [sx, sy] = d.out ? target : agent
        const [ex, ey] = d.out ? agent : target
        const kx = (sx + ex) / 2 - (ey - sy) * d.bend
        const ky = (sy + ey) / 2 + (ex - sx) * d.bend
        const e = ease(d.t)
        const fade = d.out ? Math.min(1, (1 - d.t) * 8) : Math.min(1, d.t * 6)
        // A short trail behind each dot.
        for (let q = 0; q < 7; q++) {
          const t = Math.max(0, e - q * 0.018)
          const u = 1 - t
          const x = u * u * sx + 2 * u * t * kx + t * t * ex
          const y = u * u * sy + 2 * u * t * ky + t * t * ey
          g.globalAlpha = fade * (1 - q / 7) * 0.9
          g.beginPath()
          g.arc(x, y, d.size * (1 - q * 0.1), 0, Math.PI * 2)
          g.fill()
        }
      }
      dots = next
      g.globalAlpha = 1
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointer)
      btn.removeEventListener('pointerenter', on)
      btn.removeEventListener('pointerleave', off)
      btn.removeEventListener('focus', on)
      btn.removeEventListener('blur', off)
      btn.style.transform = ''
      btn.style.marginRight = ''
      root.removeAttribute('data-feeding')
    }
  }, [hero, button, canvas, follower, still])
}
