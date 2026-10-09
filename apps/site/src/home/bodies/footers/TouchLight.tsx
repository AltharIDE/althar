import { useEffect, useRef } from 'react'

import { STATEMENT } from './Footers'
import { Links, Signature, still, useOnScreen, YEAR } from './parts'
import s from './TouchLight.module.css'

/*
 * The light from the first screen, at the page's end, under your finger:
 * Althar's columns stand low along the foot of the dark, and where you
 * point they rise to meet you, cobalt where you are and paler and warmer
 * away from you, settling back on a spring when you go. Left alone, the
 * light leans slowly across by itself. The name stands huge at the very
 * bottom, and the light is brightest inside its letters.
 */

/** Bottom to top, by how far a column is from the finger: cobalt under it, pale and then warm away. As the first screen's light. */
const TONES: ReadonlyArray<readonly [string, string, string]> = [
  ['#2b3bff', '#5162ff', '#a9b3ff'],
  ['#3a5dff', '#6e9bff', '#cddfff'],
  ['#5aa2ff', '#a2cfff', '#e6f1ff'],
  ['#9fc6ff', '#d4e6ff', '#f3f7ff'],
  ['#ffb995', '#ffd8c0', '#fff3ea'],
]
const SPRITE = { width: 64, height: 256, column: 30, blur: 5 } as const

/** A column's picture, soft already, for each tone: drawn once, stretched on every frame. */
function sprites() {
  return TONES.map(([low, middle, high]) => {
    const c = document.createElement('canvas')
    c.width = SPRITE.width
    c.height = SPRITE.height
    const ctx = c.getContext('2d')!
    const { width, height, column, blur } = SPRITE
    const left = (width - column) / 2
    const cap = height * 0.2
    const fill = ctx.createLinearGradient(0, height, 0, 0)
    fill.addColorStop(0, low)
    fill.addColorStop(0.34, middle)
    fill.addColorStop(0.66, high)
    fill.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.filter = `blur(${blur}px)`
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(left, height + blur * 3)
    ctx.lineTo(left, cap)
    ctx.ellipse(left + column / 2, cap, column / 2, cap, 0, Math.PI, 0)
    ctx.lineTo(left + column, height + blur * 3)
    ctx.closePath()
    ctx.fill()
    return c
  })
}

const vary = (i: number, n: number) => {
  const v = Math.sin(i * 12.9898 + n * 78.233 + 1.7) * 43758.5453
  return v - Math.floor(v)
}

export function TouchLight() {
  const box = useRef<HTMLElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  const pointer = useRef({ x: 0, on: 0, want: 0 })
  const on = useOnScreen(box)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const move = (e: PointerEvent) => {
      pointer.current.x = e.clientX - el.getBoundingClientRect().left
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
    const el = view.current
    if (!el || !on) return
    const pics = sprites()
    const light = document.createElement('canvas')
    const word = document.createElement('canvas')
    let frame = 0
    let heights: Float32Array = new Float32Array(0)
    let speeds: Float32Array = new Float32Array(0)
    let wander = 0.5
    const start = performance.now()
    const tick = (now: number) => {
      const w = el.clientWidth
      const h = el.clientHeight
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const W = Math.round(w * dpr)
      const H = Math.round(h * dpr)
      for (const c of [el, light, word]) {
        if (c.width !== W || c.height !== H) {
          c.width = W
          c.height = H
        }
      }
      const n = Math.max(18, Math.round(w / 26))
      if (heights.length !== n) {
        heights = Float32Array.from({ length: n }, (_, i) => 0.14 + 0.06 * vary(i, 1))
        speeds = new Float32Array(n)
      }
      const t = still() ? 3000 : now - start
      const ptr = pointer.current
      ptr.on += (ptr.want - ptr.on) * 0.06
      // Left alone, the light leans across by itself.
      wander = 0.5 + 0.3 * Math.sin(t / 4300) + 0.1 * Math.sin(t / 1900 + 1)
      const fx = ptr.on > 0.02 ? ptr.x * ptr.on + wander * w * (1 - ptr.on) : wander * w
      const reach = 0.42 + 0.3 * ptr.on

      const lc = light.getContext('2d')!
      lc.setTransform(dpr, 0, 0, dpr, 0, 0)
      lc.clearRect(0, 0, w, h)
      lc.globalCompositeOperation = 'lighter'
      const step = w / (n - 1)
      const colW = step * 1.9
      for (let i = 0; i < n; i++) {
        const x = i * step
        const d = Math.abs(x - fx) / (w * 0.5)
        const rest = 0.13 + 0.06 * vary(i, 1) + 0.03 * Math.sin(t / (3200 + vary(i, 2) * 2600) + vary(i, 3) * 6.28)
        const want = rest + reach * Math.exp(-((d / 0.2) ** 2))
        // A spring: up quickly, a little past, back. Held still, it stands where it would settle.
        speeds[i] = (speeds[i]! + (want - heights[i]!) * 0.05) * 0.84
        heights[i] = still() ? want : heights[i]! + speeds[i]!
        const tall = heights[i]! * h * 1.05
        const tone = Math.min(TONES.length - 1, Math.floor(d * 1.6 * TONES.length))
        lc.globalAlpha = 0.9
        lc.drawImage(pics[tone]!, x - colW / 2, h - tall, colW, tall + 4)
      }
      lc.globalCompositeOperation = 'source-over'
      lc.globalAlpha = 1

      // The name, as wide as the page, standing on the bottom edge.
      const wc = word.getContext('2d')!
      wc.setTransform(dpr, 0, 0, dpr, 0, 0)
      wc.globalCompositeOperation = 'source-over'
      wc.clearRect(0, 0, w, h)
      wc.font = `760 100px 'Inter Display', system-ui`
      wc.letterSpacing = '-5.6px'
      const m = wc.measureText('Althar')
      const gut = w < 700 ? 16 : 48
      const size = (100 * (w - gut * 2)) / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight)
      wc.font = `760 ${size}px 'Inter Display', system-ui`
      wc.letterSpacing = `${-0.056 * size}px`
      const m2 = wc.measureText('Althar')
      const baseline = h + size * 0.02
      wc.fillStyle = '#fff'
      wc.fillText('Althar', gut + m2.actualBoundingBoxLeft, baseline)
      wc.globalCompositeOperation = 'source-in'
      wc.drawImage(light, 0, 0, w, h)

      const ctx = el.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.globalAlpha = 0.38
      ctx.drawImage(light, 0, 0, w, h)
      ctx.globalAlpha = 1
      ctx.font = wc.font
      ctx.letterSpacing = wc.letterSpacing
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
      ctx.fillText('Althar', gut + m2.actualBoundingBoxLeft, baseline)
      ctx.drawImage(word, 0, 0, w, h)

      if (!still()) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [on])

  return (
    <footer ref={box} className={s.touch}>
      <canvas ref={view} className={s.canvas} aria-hidden="true" />
      <div className={s.words}>
        <div className={s.top}>
          <h2 className={s.statement}>
            {STATEMENT[0]}
            <br />
            <b>{STATEMENT[1]}</b>
            <br />
            {STATEMENT[2]}
          </h2>
          <div className={s.side}>
            <Signature className={s.signature} />
            <Links />
            <p className={s.line}>© {YEAR} · Free and open source</p>
          </div>
        </div>
      </div>
    </footer>
  )
}
