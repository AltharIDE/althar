import { useEffect, useRef } from 'react'

import { STATEMENT } from './Footers'
import s from './Lens.module.css'
import { Links, Signature, still, useOnScreen, YEAR } from './parts'

/*
 * The words at your fingertips: the three lines set as wide as the page, in
 * the display face's hairline, and under your pointer (or finger) the
 * letters swell to its heaviest and turn cobalt, as if pressed. Left alone,
 * the press wanders over the words by itself. With motion reduced, the
 * middle line simply stands heavy, as the other headings do.
 */

const LIGHT = 200
const HEAVY = 780

export function Lens() {
  const box = useRef<HTMLElement>(null)
  const words = useRef<HTMLHeadingElement>(null)
  const pointer = useRef({ x: 0, y: 0, on: 0, want: 0 })
  const on = useOnScreen(box)

  useEffect(() => {
    const el = words.current
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
    const el = words.current
    if (!el) return
    const letters = [...el.querySelectorAll<HTMLElement>('[data-ch]')]
    if (still()) {
      for (const l of letters) l.style.fontWeight = String(l.dataset.line === '1' ? 720 : LIGHT)
      return
    }
    if (!on) return
    // Where each letter's middle is, at rest, in the words' box: measured with every letter light, again on resize.
    let centres: Array<[number, number]> = []
    const measure = () => {
      for (const l of letters) l.style.fontWeight = String(LIGHT)
      const r = el.getBoundingClientRect()
      centres = letters.map((l) => {
        const b = l.getBoundingClientRect()
        return [b.left - r.left + b.width / 2, b.top - r.top + b.height / 2]
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    let frame = 0
    let lx = el.clientWidth / 2
    let ly = el.clientHeight / 2
    let last = ''
    const start = performance.now()
    const tick = (now: number) => {
      const t = now - start
      const w = el.clientWidth
      const h = el.clientHeight
      const ptr = pointer.current
      ptr.on += (ptr.want - ptr.on) * 0.08
      const wx = w * (0.5 + 0.4 * Math.sin(t / 3900)) + w * 0.06 * Math.sin(t / 1300)
      const wy = h * (0.5 + 0.36 * Math.sin(t / 2700 + 1.2))
      const tx = ptr.x * ptr.on + wx * (1 - ptr.on)
      const ty = ptr.y * ptr.on + wy * (1 - ptr.on)
      lx += (tx - lx) * 0.14
      ly += (ty - ly) * 0.14
      const key = `${Math.round(lx)},${Math.round(ly)}`
      if (key !== last) {
        last = key
        const size = parseFloat(getComputedStyle(el).fontSize)
        const reach = size * 1.25
        letters.forEach((l, i) => {
          const [cx, cy] = centres[i] ?? [0, 0]
          const p = Math.exp(-((Math.hypot((cx - lx) * 0.9, (cy - ly) * 1.25) / reach) ** 2))
          l.style.fontWeight = String(Math.round(LIGHT + (HEAVY - LIGHT) * p))
          l.style.color = p > 0.02 ? `color-mix(in oklab, var(--live) ${Math.round(p * 100)}%, var(--t-1))` : ''
        })
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [on])

  return (
    <footer ref={box} className={s.lens}>
      <h2 ref={words} className={s.statement} aria-label={STATEMENT.join(' ')}>
        {STATEMENT.map((line, n) => (
          <span key={line} className={s.line} aria-hidden="true">
            {line.split('').map((ch, i) => (
              <span key={i} data-ch="" data-line={n}>
                {ch}
              </span>
            ))}
          </span>
        ))}
      </h2>
      <div className={s.foot}>
        <Signature />
        <Links />
        <p className={s.mono}>Althar © {YEAR} · Free and open source</p>
      </div>
    </footer>
  )
}
