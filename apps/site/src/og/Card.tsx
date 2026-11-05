import { Logo } from '@althar/ui'
import { useLayoutEffect, useRef, useState } from 'react'

import { AGENTS } from '../content/agents'
import { BRAND, HERO } from '../content/home'
import { heldAt } from '../home/hero/clock'
import { Orrery } from '../home/hero/Orrery'
import { type Frame, type Plate, plate } from '../home/hero/plate'
import { CARDS, type OgPage } from './cards'
import s from './Og.module.css'

/*
 * A page's link preview, 1200×630, as the first screen opens: the orrery in
 * the night sky, the mark a solid at its middle and the agents on their
 * orbits, held at one moment, and under it the first screen's band, the
 * figure's caption on its rule, the card's headline at the left, what
 * matters heavy, and its line at the right. The orrery is laid out for the
 * room the band leaves once the display face is in, and drawn larger than
 * the first screen draws it; once it is drawn, the card is marked
 * `data-ready` for the screenshot.
 */

/** Where the picture may start: under the sign. */
const TOP = 76
/** How much larger than the first screen draws it: a feed shows the card at 500px or so, where the first screen's sun and names would be small. Laid out for a frame this much smaller, and drawn this much larger. */
export const ZOOM = 1.3

/** The frame the orrery is laid out for: the card's, `ZOOM` times smaller, the band's words beginning at `foot`. */
export const frameOf = (w: number, h: number, foot: number): Frame => ({
  w: w / ZOOM,
  h: h / ZOOM,
  top: TOP / ZOOM,
  foot: foot / ZOOM,
  phone: false,
})
/** The moment the cards hold: one when every agent is on the card, none behind the sun, and each has room for its name (tests/og.test.tsx). */
export const MOMENT = 10.5
const CLOCK = heldAt(MOMENT)

export function Card({ page }: { page: OgPage }) {
  const card = CARDS[page]
  const box = useRef<HTMLDivElement>(null)
  const band = useRef<HTMLDivElement>(null)
  const [p, setP] = useState<Plate | null>(null)

  // Laid out once the display face has set the band, then drawn, then ready.
  useLayoutEffect(() => {
    const el = box.current
    const words = band.current
    if (!el || !words) return
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (cancelled) return
      setP(plate(frameOf(el.clientWidth, el.clientHeight, words.offsetTop)))
    })
    return () => {
      cancelled = true
    }
  }, [])

  useLayoutEffect(() => {
    const el = box.current
    if (!el || !p) return
    // The sun draws in the frame it is made; the next is the drawn one.
    const frame = requestAnimationFrame(() => (el.dataset.ready = ''))
    return () => {
      cancelAnimationFrame(frame)
      delete el.dataset.ready
    }
  }, [p])

  return (
    <div ref={box} className={s.card}>
      <div className={s.sky} aria-hidden="true" />
      <div className={s.zoom} style={{ width: `${100 / ZOOM}%`, height: `${100 / ZOOM}%`, transform: `scale(${ZOOM})` }}>
        <Orrery p={p} clock={CLOCK} still />
      </div>
      <p className={s.sign}>
        <Logo size={24} />
        {BRAND}
      </p>
      <div ref={band} className={s.band}>
        <p className={s.caption} aria-hidden="true">
          <b>Fig. 1</b>
          <span>{BRAND}</span>
          <i className={s.rule} />
          <span>
            {HERO.agents} <b>{AGENTS.length}</b>
          </span>
        </p>
        <h1 className={s.title}>{card.title}</h1>
        <p className={s.lead}>{card.lead}</p>
      </div>
    </div>
  )
}
