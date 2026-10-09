import { useEffect, useRef } from 'react'

import { drawLandscape, drawLight, type Ground, lightOf } from './engrave'
import s from './Engraving.module.css'
import { STATEMENT } from './Footers'
import { fitCanvas, Links, Signature, still, useOnScreen, YEAR } from './parts'

/*
 * The footer as a print: the words in cobalt ink over a landscape engraved
 * in the same ink, rising from the page's foot. Far hills, a wooded slope,
 * a headland in the water with an altar on it, and on the altar Althar's
 * light, standing in fine broken lines that drift up and breathe, its
 * streak shimmering in the water. The landscape is drawn once for the
 * width; only the light moves, and only while it is seen.
 */

export function Engraving() {
  const box = useRef<HTMLElement>(null)
  const land = useRef<HTMLCanvasElement>(null)
  const glow = useRef<HTMLCanvasElement>(null)
  const words = useRef<HTMLDivElement>(null)
  const ground = useRef<Ground | null>(null)
  const on = useOnScreen(box)

  useEffect(() => {
    const el = land.current
    const footer = box.current
    if (!el || !footer) return
    return fitCanvas(el, (ctx, w, h) => {
      // The landscape keeps below the words.
      const top = footer.getBoundingClientRect().top
      const ends = [...(words.current?.children ?? [])].map((c) => c.getBoundingClientRect().bottom - top)
      ground.current = drawLandscape(ctx, w, h, Math.max(0, ...ends) + 36, getComputedStyle(footer).backgroundColor)
    })
  }, [])

  useEffect(() => {
    const el = glow.current
    if (!el || !on) return
    let frame = 0
    let made: { g: Ground; light: ReturnType<typeof lightOf> } | null = null
    const start = performance.now()
    const tick = (now: number) => {
      const g = ground.current
      const ctx = el.getContext('2d')
      if (g && ctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        if (el.width !== Math.round(g.w * dpr) || el.height !== Math.round(g.h * dpr)) {
          el.width = Math.round(g.w * dpr)
          el.height = Math.round(g.h * dpr)
        }
        if (!made || made.g !== g) made = { g, light: lightOf(g) }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawLight(ctx, g, made.light, still() ? 0 : now - start + 4000)
      }
      if (!still() || !g) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [on])

  return (
    <footer ref={box} className={s.engraving}>
      <canvas ref={land} className={s.canvas} aria-hidden="true" />
      <canvas ref={glow} className={s.canvas} aria-hidden="true" />
      <div ref={words} className={s.words}>
        <div className={s.left}>
          <Signature />
          <h2 className={s.statement}>
            {STATEMENT[0]}
            <br />
            <b>{STATEMENT[1]}</b>
            <br />
            {STATEMENT[2]}
          </h2>
          <p className={s.line}>Althar © {YEAR} · Free and open source.</p>
        </div>
        <Links className={s.links} />
      </div>
    </footer>
  )
}
