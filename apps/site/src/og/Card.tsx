import { Logo } from '@althar/ui'
import { useLayoutEffect, useRef } from 'react'

import { drawLandscape, drawLight, lightOf } from '../shared/footer/engrave'
import { CARDS, type OgPage } from './cards'
import s from './Og.module.css'

/*
 * A page's link preview, 1200×630, as the footer's print: the words in
 * cobalt ink at the top, the engraved landscape under them in the same ink,
 * and the altar's light rising beside them, held at one moment. The drawing
 * is wider than the card, so the altar (at 64% of the drawing) stands at 80%
 * of the card, clear of the words, and its light reaches the top. Once
 * drawn, the card is marked `data-ready` for the screenshot.
 */

/** Where the light is held: a moment of its breathing. */
const AT = 5200

export function Card({ page }: { page: OgPage }) {
  const card = CARDS[page]
  const box = useRef<HTMLDivElement>(null)
  const land = useRef<HTMLCanvasElement>(null)
  const glow = useRef<HTMLCanvasElement>(null)
  const words = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    let cancelled = false
    const draw = () => {
      if (cancelled || !land.current || !glow.current) return
      const w = land.current.clientWidth
      const h = el.clientHeight
      // Nothing in the landscape reaches into the words: their own ink, line by line.
      const at = el.getBoundingClientRect()
      const clear = [...(words.current?.querySelectorAll('h1, p') ?? [])].flatMap((line) => {
        const range = document.createRange()
        range.selectNodeContents(line)
        return [...range.getClientRects()]
          .filter((r) => r.width > 0)
          .map((r) => ({ left: r.left - at.left, right: r.right - at.left, bottom: r.bottom - at.top }))
      })
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      for (const canvas of [land.current, glow.current]) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const ground = land.current.getContext('2d')
      const light = glow.current.getContext('2d')
      if (!ground || !light) return
      ground.setTransform(dpr, 0, 0, dpr, 0, 0)
      light.setTransform(dpr, 0, 0, dpr, 0, 0)
      const g = drawLandscape(ground, w, h, clear, getComputedStyle(el).backgroundColor)
      drawLight(light, g, lightOf(g), AT)
      el.dataset.ready = ''
    }
    // The words are measured in the display face, so wait for it.
    void document.fonts.ready.then(() => requestAnimationFrame(draw))
    return () => {
      cancelled = true
    }
  }, [page])

  return (
    <div ref={box} className={s.card}>
      <canvas ref={land} className={s.canvas} />
      <canvas ref={glow} className={s.canvas} />
      <div ref={words} className={s.words}>
        <p className={s.sign}>
          <Logo size={24} />
          Althar
        </p>
        <h1 className={s.title}>{card.title}</h1>
        <p className={s.lead}>{card.lead}</p>
      </div>
    </div>
  )
}
