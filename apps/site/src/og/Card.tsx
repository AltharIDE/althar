import { Logo } from '@althar/ui'
import { useLayoutEffect, useRef, useState } from 'react'

import skyUrl from '../home/hero/plate/sky.webp'
import { CARDS, type OgPage } from './cards'
import s from './Og.module.css'

/*
 * A page's link preview, 1200×630, from orbit: the planet's edge, the
 * hero's own photograph, low across the card, and the words white in the
 * dark of space over it, what matters lit. Once the photograph and the
 * display face are in, the card is marked `data-ready` for the screenshot.
 */

export function Card({ page }: { page: OgPage }) {
  const card = CARDS[page]
  const box = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)

  useLayoutEffect(() => {
    const el = box.current
    if (!el || !loaded) return
    let cancelled = false
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() => {
        if (!cancelled) el.dataset.ready = ''
      }),
    )
    return () => {
      cancelled = true
      delete el.dataset.ready
    }
  }, [loaded])

  return (
    <div ref={box} className={s.card}>
      <img className={s.planet} src={skyUrl} alt="" onLoad={() => setLoaded(true)} />
      <div className={s.words}>
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
