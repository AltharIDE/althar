import { type RefObject, useEffect } from 'react'

/*
 * The first screen's two answers to the pointer.
 *
 * A small cobalt dot follows the pointer while it is over the first screen,
 * a little behind it. Over the download, the button takes the dot in where
 * it reaches it: the dot is gone, the button grows at once by the first
 * half of its growth, and its ground (not its label) ripples out from
 * there, as water where a drop has fallen. Leave the
 * button and the dot comes back to the pointer.
 *
 * Come down out of the first screen, by the pointer or by the scroll, and
 * the dot goes on without it: it flies down to the race's heading and
 * becomes its period, after "every time" (story/scenes.tsx), the period
 * being part of the heading from then on. Only as the pointer comes back
 * into the first screen does the dot leave the heading for it again. With
 * no dot in play (no pointer seen yet, or the first screen gone out of sight
 * before the dot could set off, as on a page opened further down) the
 * period is simply there, the dot already in it.
 *
 * Over the download, the agents feed it: dots stream from the agents on
 * their orbits, each along its own curve, into the button, and each one that
 * lands grows the button a little, to a tenth larger at most; full, the
 * feeding stops. Leave the button and what is still on its way turns round,
 * and every dot the button took flies back to the agent that sent it, the
 * button shrinking back as they go. With reduced motion, neither.
 *
 * On a touch screen, with nothing to point with, the agents feed the button
 * by themselves a moment after the page opens, and take back what they gave
 * as you scroll the first screen away; there is no dot.
 */

/** Deliveries that fill the button, and how much larger it is full. */
const FULL = 24
const GROW = 0.1
/** What the button takes at once as it takes the dot in: a quarter of its growth (to 2.5% larger), the feeding growing it the rest. */
const TAKE = 0.25

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
    // Whether the pointer has left the window: the dot hides then, and nothing is taken from the heading for a pointer that isn't there. Resting still, or scrolling under it, it is still there.
    let away = false
    const onAway = (e: MouseEvent) => {
      if (!e.relatedTarget) away = true
    }
    document.addEventListener('mouseout', onAway)
    const onPointer = (e: PointerEvent) => {
      away = false
      cx = e.clientX
      cy = e.clientY
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    let feeding = false
    const touch = window.matchMedia('(pointer: coarse)').matches
    const opened = performance.now()
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
    // With no dot to take in (from the keyboard), it takes the first of its growth as it is focused.
    const focused = () => {
      on()
      take()
    }
    btn.addEventListener('focus', focused)
    btn.addEventListener('blur', off)

    let fx: number | null = null
    let fy = 0
    let fs = 1
    // Where the dot is: following the pointer, flying down to the race's heading, or parked there as its period.
    const period = document.querySelector<HTMLElement>('#race [data-period]')
    let measure: CanvasRenderingContext2D | null = null
    /** The period's ink, in the window's px: its middle and its size, measured from the glyph in its own font (and its stroke), so the dot lands as exactly it. */
    const ink = (el: HTMLElement) => {
      const css = getComputedStyle(el)
      measure ??= document.createElement('canvas').getContext('2d')
      const r = el.getBoundingClientRect()
      if (!measure) return { x: r.left + r.width / 2, y: r.top + r.height / 2, d: r.width }
      measure.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
      const m = measure.measureText('.')
      const stroke = parseFloat(css.getPropertyValue('-webkit-text-stroke-width')) || 0
      const baseline = r.top + m.fontBoundingBoxAscent
      const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + stroke
      const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + stroke
      return {
        x: r.left + (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2,
        y: baseline + (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2,
        d: (w + h) / 2,
      }
    }
    let place: 'free' | 'going' | 'parked' = 'free'
    const flight = { x: 0, y: 0, s: 1, t: 0, bend: 0 }
    let snap = false
    const sharp = () => {
      dot.style.transition = 'none'
      snap = true
    }
    /** The dot already the period, with no flight: there is none to see. */
    const park = () => {
      if (!period || touch) return
      place = 'parked'
      period.toggleAttribute('data-on', true)
      dot.removeAttribute('data-in')
    }
    let gone = false
    let pop = false
    let took = false
    /** How full the button is: what it took at once, and what the agents have fed it. */
    const fill = () => {
      full = Math.min(1, (took ? TAKE : 0) + kept.length / FULL)
    }
    /** Grows the button at once to the first of its growth, the feeding to carry it on from there. */
    const take = () => {
      if (took) return
      took = true
      pop = true
      fill()
    }
    const pool = btn.querySelector<HTMLElement>('[data-pool]')

    /** Ripples the button's ground out from a point in the window's px: a glow where the drop fell, then two rings. */
    const ripple = (x: number, y: number) => {
      if (!pool) return
      const b = btn.getBoundingClientRect()
      const k = b.width / Math.max(1, btn.offsetWidth)
      const w = btn.offsetWidth
      const h = btn.offsetHeight
      const px = Math.min(w, Math.max(0, (x - b.left) / k))
      const py = Math.min(h, Math.max(0, (y - b.top) / k))
      const reach = Math.hypot(Math.max(px, w - px), Math.max(py, h - py))
      const waves = [
        { kind: 'glow', r: reach * 0.9, ms: 1000, delay: 0, from: 1 },
        { kind: 'ring', r: reach, ms: 1150, delay: 0, from: 1 },
        { kind: 'ring', r: reach * 0.85, ms: 1150, delay: 190, from: 0.75 },
        { kind: 'ring', r: reach * 0.7, ms: 1150, delay: 380, from: 0.5 },
      ]
      for (const v of waves) {
        const el = document.createElement('i')
        el.dataset.kind = v.kind
        el.style.width = el.style.height = `${(v.r * 2).toFixed(1)}px`
        el.style.left = `${(px - v.r).toFixed(1)}px`
        el.style.top = `${(py - v.r).toFixed(1)}px`
        el.style.opacity = '0'
        pool.appendChild(el)
        el.animate(
          [
            { transform: 'scale(0.04)', opacity: v.from },
            { transform: 'scale(1)', opacity: 0 },
          ],
          { duration: v.ms, delay: v.delay, easing: 'cubic-bezier(0.3, 0.55, 0.4, 1)' },
        ).onfinish = () => el.remove()
      }
    }
    let full = 0
    let shown = 0
    let emit = 0
    let drawn = false
    let dots: Dot[] = []
    const kept: number[] = []
    let last = performance.now()
    let frame = 0

    let onScreen = false
    const tick = (now: number) => {
      // Off screen it stops, unless the dot is still on its way down to the heading.
      frame = onScreen || place === 'going' ? requestAnimationFrame(tick) : 0
      const dt = Math.min(50, now - last) / 1000
      last = now
      const box = root.getBoundingClientRect()

      // On a touch screen, fed while the first screen is in view, a moment after it opens.
      if (touch) {
        const want = now - opened > 1200 && box.bottom > window.innerHeight * 0.65
        if (want !== feeding) {
          ;(want ? on : off)()
          if (want) take()
        }
      }

      // The follower, in the window's px.
      if (snap) {
        dot.style.removeProperty('transition')
        snap = false
      }
      // No pointer seen yet: no dot in play, and the period is there.
      if (cx === null && place === 'free') park()
      if (cx !== null && !touch) {
        const over = cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom
        if (fx === null) {
          fx = cx
          fy = cy
        }
        // Down out of the first screen: off to the heading. Back into it: out of the heading, to the pointer.
        if (period && place === 'free' && cy > box.bottom && !feeding) {
          place = 'going'
          flight.x = fx
          flight.y = fy
          flight.s = fs
          flight.t = 0
          flight.bend = (0.15 + Math.random() * 0.15) * (Math.random() < 0.5 ? -1 : 1)
        } else if (place === 'going' && over) place = 'free'
        else if (period && place === 'parked' && over && !away) {
          // Out of the heading, from where it stands; or, the heading out of sight (as the pointer first moves on a page just opened), at the pointer at once.
          const p = ink(period)
          const seen = p.y > 0 && p.y < window.innerHeight
          fx = seen ? p.x : cx
          fy = seen ? p.y : cy
          fs = seen ? p.d / 12 : 1
          period.removeAttribute('data-on')
          sharp()
          place = 'free'
        }
        if (place === 'going' && period) {
          // Along a curve to where the period stands now, shrinking to exactly its size.
          const p = ink(period)
          const tx = p.x
          const ty = p.y
          flight.t = Math.min(1, flight.t + dt / 0.7)
          const k = ease(flight.t)
          const kx = (flight.x + tx) / 2 - (ty - flight.y) * flight.bend
          const ky = (flight.y + ty) / 2 + (tx - flight.x) * flight.bend
          const u = 1 - k
          fx = u * u * flight.x + 2 * u * k * kx + k * k * tx
          fy = u * u * flight.y + 2 * u * k * ky + k * k * ty
          fs = flight.s + (p.d / 12 - flight.s) * k
          if (flight.t >= 1) {
            place = 'parked'
            period.toggleAttribute('data-on', true)
            sharp()
          }
        } else if (place === 'free') {
          fx += (cx - fx) * 0.12
          fy += (cy - fy) * 0.12
          fs += (1 - fs) * 0.12
        }
        dot.style.transform = `translate(${fx.toFixed(1)}px, ${fy.toFixed(1)}px) scale(${fs.toFixed(3)})`
        dot.toggleAttribute('data-in', place === 'going' || (place === 'free' && over && !away))
        // Taken in as it reaches the download, with a ripple from where it touched; given back as the pointer leaves.
        if (feeding && !gone) {
          const b = btn.getBoundingClientRect()
          if (fx >= b.left - 6 && fx <= b.right + 6 && fy >= b.top - 6 && fy <= b.bottom + 6) {
            gone = true
            take()
            ripple(fx, fy)
          }
        } else if (!feeding && gone) gone = false
        dot.toggleAttribute('data-gone', gone)
      }

      // The button, as large as what it holds; let go, back to its size at once, as fast and as smoothly as it took the dot in, while the agents take back what they fed it.
      const size = feeding ? full : 0
      // Eased the same on any screen, whatever its frame rate: quick for what it takes or lets go at once (about a tenth of a second), slower as the agents feed it.
      shown += (size - shown) * (1 - Math.exp(-dt * (pop || !feeding ? 36 : 6.5)))
      if (pop && Math.abs(shown - size) < 0.01) pop = false
      // Written only as it changes: an unchanged write every frame would still have the page restyled.
      const grown = shown > 0.001 ? `scale(${(1 + GROW * shown).toFixed(4)})` : ''
      if (btn.style.transform !== grown) {
        btn.style.transform = grown
        btn.style.marginRight = shown > 0.001 ? `${(btn.offsetWidth * GROW * shown).toFixed(2)}px` : ''
      }
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
          fill()
        }
        // The feeding given back, what it took at once goes too.
        if (!kept.length && took) {
          took = false
          pop = false
          fill()
        }
      }

      g.fillStyle = '#2b3bff'
      const next: Dot[] = []
      for (const d of dots) {
        d.t += dt / d.d
        if (d.t >= 1) {
          if (!d.out) {
            kept.push(d.from)
            fill()
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
    // Off screen nothing runs: nothing is read or drawn there, and it carries on where it was as the first screen comes back.
    const io = new IntersectionObserver(([e]) => {
      onScreen = !!e?.isIntersecting
      // Gone out of sight before the dot set off (scrolled past at once, opened further down, the pointer away or never seen): it is the period already.
      if (!onScreen && place === 'free') park()
      if (!onScreen || frame) return
      last = performance.now()
      frame = requestAnimationFrame(tick)
    })
    io.observe(root)

    return () => {
      io.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointer)
      document.removeEventListener('mouseout', onAway)
      btn.removeEventListener('pointerenter', on)
      btn.removeEventListener('pointerleave', off)
      btn.removeEventListener('focus', focused)
      btn.removeEventListener('blur', off)
      btn.style.transform = ''
      btn.style.marginRight = ''
      root.removeAttribute('data-feeding')
      dot.removeAttribute('data-gone')
      dot.style.removeProperty('transition')
      period?.removeAttribute('data-on')
      pool?.replaceChildren()
    }
  }, [hero, button, canvas, follower, still])
}
