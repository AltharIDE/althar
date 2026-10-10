import { useEffect, useRef } from 'react'

import { drawLandscape, drawLight, type Ground, lightOf } from './engrave'
import s from './Footer.module.css'
import { fitCanvas, Links, Signature, still, useOnScreen, YEAR } from './parts'

/*
 * The page's last word, as a print: the words in cobalt ink over a
 * landscape engraved in the same ink, rising from the page's foot. Far
 * hills over a lake, a wooded slope at the left, a hill at the right, a
 * headland with an altar on it, and on the altar Althar's light, rising
 * from its table in fine lines that break up as they climb, drift and
 * breathe, its streak shimmering in the water. Nothing in it reaches into
 * the words. The landscape is drawn once for the size; only the light
 * moves, and only while it is seen.
 */

const STATEMENT = ['The most beautiful', 'IDE ever built', 'at your fingertips'] as const

export function Footer() {
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
      // The landscape keeps below the words, and nothing in it reaches into them.
      const box = footer.getBoundingClientRect()
      const clear = [...(words.current?.querySelectorAll('a, h2, p, li') ?? [])].flatMap((el) => {
        // The words' own ink, line by line, not the boxes they sit in.
        const range = document.createRange()
        range.selectNodeContents(el)
        return [...range.getClientRects()]
          .filter((r) => r.width > 0)
          .map((r) => ({ left: r.left - box.left, right: r.right - box.left, bottom: r.bottom - box.top }))
      })
      ground.current = drawLandscape(ctx, w, h, clear, getComputedStyle(footer).backgroundColor)
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
    <footer ref={box} className={s.footer}>
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
