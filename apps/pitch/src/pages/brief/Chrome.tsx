import { useEffect, useRef, useState, type RefObject } from 'react'

import { Logo } from '../../components/Logo'
import { cx } from '../../lib/cx'
import { homeHref, researchHref } from '../../paths'
import s from './Chrome.module.css'
import { pad2 } from './model/lib'
import { onFrame } from './scroll'
import type { Tone } from './Slide'

interface At {
  index: number
  tone: Tone
  name: string
}

/** Masthead, progress bar and slide counter, following the panel under them. */
export function Chrome({ deck, total, first }: { deck: RefObject<HTMLElement | null>; total: number; first: string }) {
  const [at, setAt] = useState<At>({ index: 0, tone: 'light', name: first })
  const bar = useRef<HTMLElement>(null)

  useEffect(
    () =>
      onFrame(() => {
        const slides = deck.current?.querySelectorAll<HTMLElement>('[data-slide]') ?? []
        let index = 0
        slides.forEach((el, k) => {
          if (el.getBoundingClientRect().top <= 64) index = k
        })
        const el = slides[index]
        if (el) {
          const tone = el.dataset.tone === 'dark' ? 'dark' : 'light'
          const name = el.dataset.name ?? ''
          setAt((prev) => (prev.index === index && prev.tone === tone && prev.name === name ? prev : { index, tone, name }))
        }
        const max = document.documentElement.scrollHeight - window.innerHeight
        if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? window.scrollY / max : 0})`
      }),
    [deck],
  )

  return (
    <>
      <header className={s.mast} data-tone={at.tone}>
        <a className={s.brand} href={homeHref}>
          <Logo />
          Charrette
        </a>
        <nav className={s.pages} aria-label="Pages">
          <a href={homeHref} aria-current="page">
            Brief
          </a>
          <a href={researchHref}>Research note</a>
        </nav>
      </header>
      <div className={s.prog} data-tone={at.tone} aria-hidden="true">
        <i ref={bar} />
      </div>
      <p className={cx(s.count, at.index === total - 1 && s.last)} data-tone={at.tone} aria-hidden="true">
        {pad2(at.index + 1)} / {total}
        <b>{at.name}</b>
      </p>
    </>
  )
}
