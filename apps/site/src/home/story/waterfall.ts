import { type RefObject, useEffect } from 'react'

import { MARK_EYE, MARK_FOOT } from '../hero/markDots'

/*
 * The board's scene, poured cobalt by the pointer.
 *
 * The dot that pours it is the eye of the mark at the middle of the race's
 * orrery (Race.tsx). Once the orrery is whole, the pointer anywhere below
 * the mark takes the eye: it leaves the mark and follows the pointer, a
 * little behind, shrinking to a dot as it goes. Above the eye again, the
 * dot flies back into the mark along a curve, as the first screen's dots
 * fly back to their agents (hero/feed.ts), and the mark has its eye; as
 * the race plays back, so does the dot. Should the page open below the race,
 * the dot appears where the pointer is.
 *
 * As the dot comes over the board's scene it goes under everything in it
 * (the heading, the views), as deep as the cobalt, and swells, and cobalt
 * spills from it, column by column: the columns beside the dot first, those
 * further out a little later and a little lower, as water over a lip, each
 * falling faster as it goes, with a drip at its head. The heading turns
 * white exactly where the cobalt is over it: a white copy of it, cut to the
 * columns. As the pointer leaves, the cobalt drains down from where it left.
 * With reduced motion, none of it.
 *
 * The cobalt is drawn on one canvas, a window tall, held in the pinned
 * picture (Story.module.css): while the scene is pinned it is the window,
 * so scrolling neither moves nor tears it; before and after the pin it
 * travels with the scene. It is drawn only while the cobalt moves: poured,
 * it is filled once and left. Every frame reads what it needs of the page
 * first and writes after, and nothing runs at all while nothing moves (the
 * pointer, the scroll, the cobalt, the dot) or while neither the race nor
 * the scene is near the window.
 *
 * On a touch screen, with no pointer to follow, it pours as the scene pins:
 * from where the screen was last touched, or else from its middle, the dot
 * showing only as it swells; and it drains as the scene lets go.
 */

const ease = (t: number) => t * t * t * (t * (6 * t - 15) + 10)

/** A column's width, in px, and its round end's radius. */
const COLUMN = 22
const ROUND = COLUMN / 2
const END = ROUND + 0.5

/** Each column: still (0), pouring (1), full (2) or draining (3). */
interface Column {
  x: number
  state: 0 | 1 | 2 | 3
  speed: number
  /** Pouring: where it spills from, how far up and down it has reached, and how fast it falls; in the layer's px. */
  from: number
  up: number
  down: number
  v: number
  /** Draining: where the top edge starts, and how far it has fallen. */
  drain: number
  fallen: number
}

export function useWaterfall(
  section: RefObject<HTMLElement | null>,
  layer: RefObject<HTMLElement | null>,
  follower: RefObject<HTMLElement | null>,
  copy: RefObject<HTMLElement | null>,
  still: boolean,
) {
  useEffect(() => {
    const sec = section.current
    const pool = layer.current
    const dot = follower.current
    const white = copy.current
    const stick = pool?.parentElement
    if (!sec || !pool || !dot || !white || !stick || still) return
    const canvas = document.createElement('canvas')
    pool.replaceChildren(canvas)
    const g = canvas.getContext('2d')
    if (!g) return

    // The loop runs only while something moves, and the race or the scene is near the window; anything that could move it wakes it.
    let frame = 0
    let last = 0
    let near = false
    const wake = () => {
      if (frame || !near) return
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }

    let cx: number | null = null
    let cy = 0
    let moved = -1e9
    const onPointer = (e: PointerEvent) => {
      cx = e.clientX
      cy = e.clientY
      moved = performance.now()
      wake()
    }
    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('pointerdown', onPointer, { passive: true })
    // The pointer leaving the window counts as leaving the section; resting still inside it doesn't.
    const away = (e: MouseEvent) => {
      if (e.relatedTarget) return
      cx = null
      wake()
    }
    document.addEventListener('mouseout', away)
    window.addEventListener('scroll', wake, { passive: true })
    const touch = window.matchMedia('(pointer: coarse)').matches

    // The race's orrery, and its mark's eye, where the dot is kept.
    const race = document.getElementById('race')
    const eye = race?.querySelector<SVGElement>('[data-orrery] [data-eye]') ?? null
    const orrery = eye?.closest<HTMLElement>('[data-orrery]') ?? null
    let held: 'home' | 'out' | 'back' = 'home'
    let sc = 1
    const back = { x: 0, y: 0, s: 1, t: 0, bend: 0 }
    let snap = false
    const sit = (on: boolean) => {
      if (eye) eye.style.opacity = on ? '' : '0'
    }

    const seen = new Map<Element, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target, e.isIntersecting)
        near = [...seen.values()].some(Boolean)
        if (near) wake()
        else {
          cancelAnimationFrame(frame)
          frame = 0
          dot.removeAttribute('data-in')
        }
      },
      { rootMargin: '50% 0px' },
    )
    io.observe(sec)
    if (race) io.observe(race)

    // Where the white heading sits in the layer, and its size: read again only when the layout changes.
    let heading: { x: number; y: number; w: number; h: number } | null = null
    let width = -1
    let height = -1
    const ro = new ResizeObserver(() => {
      heading = null
      width = -1
      wake()
    })
    ro.observe(stick)
    ro.observe(white)
    window.addEventListener('resize', wake)

    let cols: Column[] = []
    let inside = false
    let since = 0
    let set = false
    let ox = 0
    let oy = 0
    let dx = 0
    let dy = 0
    let mx = 0
    let swell = 0
    let clipped = ''
    let drawn: 'none' | 'full' | 'some' = 'none'

    const build = (w: number, h: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = getComputedStyle(pool).getPropertyValue('--cobalt').trim() || '#2b3bff'
      drawn = 'some'
      if (cols.length === Math.ceil((w + COLUMN) / COLUMN)) return
      cols = []
      for (let x = 0; x < w + COLUMN; x += COLUMN)
        cols.push({ x, state: 0, speed: 0.75 + Math.random() * 0.6, from: 0, up: 0, down: 0, v: 0, drain: 0, fallen: 0 })
    }

    /** Where a column's cobalt runs, top and bottom, with its round ends, or null where it has none. */
    const span = (c: Column, h: number) =>
      c.state === 1
        ? { y0: Math.max(0, c.from - c.up), y1: Math.min(h, c.from + c.down), head: true, tail: c.from - c.up > 0 }
        : c.state === 2
          ? { y0: 0, y1: h, head: false, tail: false }
          : c.state === 3
            ? { y0: c.drain + c.fallen, y1: h, head: false, tail: true }
            : null

    /** Draws the cobalt: filled once when it is all poured, cleared once when it is all gone, and column by column between. */
    const paint = (w: number, h: number) => {
      const full = cols.every((c) => c.state === 2)
      const empty = cols.every((c) => c.state === 0)
      if (full || empty) {
        const now = full ? 'full' : 'none'
        if (drawn === now) return
        drawn = now
        g.clearRect(0, 0, w, h)
        if (full) g.fillRect(0, 0, w, h)
        return
      }
      drawn = 'some'
      g.clearRect(0, 0, w, h)
      g.beginPath()
      for (const c of cols) {
        const s = span(c, h)
        if (!s || s.y1 <= s.y0) continue
        g.rect(c.x - 0.5, s.y0, COLUMN + 1, s.y1 - s.y0)
        if (s.head) {
          g.moveTo(c.x + ROUND + END, s.y1)
          g.arc(c.x + ROUND, s.y1, END, 0, Math.PI * 2)
        }
        if (s.tail) {
          g.moveTo(c.x + ROUND + END, s.y0)
          g.arc(c.x + ROUND, s.y0, END, 0, Math.PI * 2)
        }
      }
      g.fill()
    }

    const show = (on: boolean, sharp: boolean) => {
      if (sharp && dot.hasAttribute('data-in') !== on) {
        dot.style.transition = 'none'
        snap = true
      }
      dot.toggleAttribute('data-in', on)
    }

    const tick = (now: number) => {
      frame = 0
      const dt = Math.min(50, now - last) / 1000
      last = now
      if (snap) {
        dot.style.removeProperty('transition')
        snap = false
      }

      // Everything read of the page, first.
      const vh = window.innerHeight
      const r = sec.getBoundingClientRect()
      const L = pool.getBoundingClientRect()
      const rr = touch ? null : race?.getBoundingClientRect()
      const whole = !touch && !!orrery && Number(orrery.style.opacity || 0) > 0.95
      const e = !touch && eye && (whole || held !== 'home') ? eye.getBoundingClientRect() : null
      if (!heading) {
        const b = white.getBoundingClientRect()
        heading = { x: b.left - L.left, y: b.top - L.top, w: b.width, h: b.height }
      }
      const under = stick.style.top || '76px'

      // Then everything written.
      if (pool.style.top !== `-${under}`) pool.style.top = `-${under}`
      const w = L.width
      const h = L.height
      if (width !== w || height !== h) {
        width = w
        height = h
        build(w, h)
      }

      // The dot, in the window's px; and whether the pointer is over the scene.
      let over: boolean
      let settled = true
      if (touch) {
        over = r.top <= vh * 0.3 && r.bottom >= vh * 0.7
        const recent = cx !== null && now - moved < 4000
        mx = recent ? cx! : r.left + r.width / 2
        const my = recent ? cy : vh * 0.5
        dx += (mx - dx) * 0.12
        dy += (my - dy) * 0.12
        settled = Math.abs(mx - dx) < 0.3 && Math.abs(my - dy) < 0.3
        dot.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`
        show(over && now - since < 700, false)
        if (over && now - since < 700) settled = false
        dot.toggleAttribute('data-under', over)
      } else {
        over = cx !== null && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom
        const overRace = cx !== null && !!rr && cy >= rr.top && cy <= rr.bottom
        // The eye: its middle, its size against the dot's, and the mark's foot.
        const hx = e ? e.left + e.width / 2 : 0
        const hy = e ? e.top + e.height / 2 : 0
        const hs = e ? Math.max(0.4, e.width / 12) : 1
        const foot = e ? hy + ((MARK_FOOT - MARK_EYE.y) * e.height) / (2 * MARK_EYE.r) : 0
        if (cx !== null) {
          if (held !== 'out') {
            // Taken: below the mark while the orrery is whole, or over the board when there is no eye to take.
            const take = whole && e ? (over || overRace) && cy > foot : held === 'home' && over
            if (take) {
              if (held === 'home') {
                if (whole && e) {
                  dx = hx
                  dy = Math.max(-16, hy)
                  sc = hs
                  sit(false)
                  show(true, true)
                } else {
                  dx = cx
                  dy = cy
                  sc = 0.3
                }
              }
              held = 'out'
            }
          } else if (e && ((whole && hy > 0 && hy < vh && cy < hy) || (!whole && !!rr && rr.bottom > 0 && rr.top < vh))) {
            // Given back: above the eye, or as the race plays back.
            held = 'back'
            back.x = dx
            back.y = dy
            back.s = sc
            back.t = 0
            back.bend = (0.18 + Math.random() * 0.2) * (dx < hx ? 1 : -1)
          }
        }
        if (held === 'out' && cx !== null) {
          dx += (cx - dx) * 0.12
          dy += (cy - dy) * 0.12
          sc += (1 - sc) * 0.1
          settled = Math.abs(cx - dx) < 0.3 && Math.abs(cy - dy) < 0.3 && Math.abs(1 - sc) < 0.005
        } else if (held === 'back') {
          settled = false
          back.t = Math.min(1, back.t + dt / 0.7)
          const k = ease(back.t)
          const kx = (back.x + hx) / 2 - (hy - back.y) * back.bend
          const ky = (back.y + hy) / 2 + (hx - back.x) * back.bend
          const u = 1 - k
          dx = u * u * back.x + 2 * u * k * kx + k * k * hx
          dy = u * u * back.y + 2 * u * k * ky + k * k * hy
          sc = back.s + (hs - back.s) * k
          if (back.t >= 1) {
            held = 'home'
            sit(true)
            show(false, true)
          }
        }
        if (held !== 'home') dot.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sc.toFixed(3)})`
        // Over the board's scene the dot goes under everything in it, with the cobalt; over the race it is the mark's eye, on top.
        dot.toggleAttribute('data-under', dx >= r.left && dx <= r.right && dy >= r.top && dy <= r.bottom)
        if (held === 'back') show(true, false)
        else if (held === 'out') show(over || overRace, false)
        mx = dx
      }

      // The pour starts from the dot, a moment after it comes over the scene, swelling.
      if (over !== inside) {
        inside = over
        since = now
        set = false
        ox = mx - L.left
        if (inside) {
          swell = now
          dot.toggleAttribute('data-swell', true)
        }
      }
      if (swell && now - swell > 180) {
        swell = 0
        dot.removeAttribute('data-swell')
      }
      const t = (now - since) / 1000
      const lead = inside ? 0.14 : 0
      if (inside && t >= lead && !set) {
        set = true
        ox = dx - L.left
        oy = dy - L.top
      }

      // The columns; a column is full once it covers the layer, top to bottom.
      let filled = 0
      let busy = false
      for (const c of cols) {
        const off = c.x + ROUND - ox
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
          c.drain = -30
          c.fallen = 0
        }
        if (c.state === 1) {
          c.v += 4200 * dt
          c.down += c.v * dt
          c.up += (750 + 350 * c.speed) * dt
          if (c.from - c.up <= 0 && c.from + c.down >= h) {
            c.state = inside ? 2 : 3
            c.drain = -30
            c.fallen = 0
          }
        } else if (c.state === 3) {
          c.v = Math.max(c.v, 600)
          c.fallen += (dt * c.speed * (vh + 60)) / 0.42
          if (c.drain + c.fallen >= h + 30) c.state = 0
        }
        if (c.state === 2) filled++
        else if (c.state === 1) filled += 0.5
        if (inside ? c.state !== 2 : c.state !== 0) busy = true
      }
      paint(w, h)
      sec.toggleAttribute('data-poured', filled / cols.length > 0.42)

      // The white heading, cut to the cobalt; written only when the cobalt over it changes.
      let path = ''
      let all = true
      for (const c of cols) {
        if (c.state !== 2) all = false
        const s = span(c, h)
        if (!s) continue
        const x0 = c.x - heading.x - 0.5
        const x1 = c.x + COLUMN - heading.x + 0.5
        const y0 = Math.max(-2, s.y0 - (s.tail ? END : 0) - heading.y)
        const y1 = Math.min(heading.h + 2, s.y1 + (s.head ? END : 0) - heading.y)
        if (x1 < 0 || x0 > heading.w || y1 <= y0) continue
        path += `M${x0.toFixed(1)} ${y0.toFixed(1)}H${x1.toFixed(1)}V${y1.toFixed(1)}H${x0.toFixed(1)}Z`
      }
      const clip = all ? 'none' : path ? `path('${path}')` : ''
      if (clip !== clipped) {
        clipped = clip
        if (clip) white.style.clipPath = clip
        else white.style.removeProperty('clip-path')
      }

      if (busy || !settled || swell || snap) frame = requestAnimationFrame(tick)
    }

    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      ro.disconnect()
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('scroll', wake)
      window.removeEventListener('resize', wake)
      document.removeEventListener('mouseout', away)
      white.style.removeProperty('clip-path')
      sit(true)
      dot.removeAttribute('data-in')
      dot.removeAttribute('data-under')
      dot.removeAttribute('data-swell')
      dot.style.removeProperty('transition')
      sec.removeAttribute('data-poured')
      pool.replaceChildren()
    }
  }, [section, layer, follower, copy, still])
}
