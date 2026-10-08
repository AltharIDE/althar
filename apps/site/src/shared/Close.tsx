import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useRef } from 'react'

import { INSTALL, LINKS } from '../content/facts'
import { BRAND, CLOSE } from '../content/home'
import { SHIFTS } from './Bar'
import s from './Close.module.css'

/** The download and the repository, as both developer pages end. */
export function Get({ tone }: { tone: 'blue' | 'paper' }) {
  return (
    <div className={tone === 'blue' ? s.getBlue : s.get}>
      <a className={s.primary} href={LINKS.releases}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1ZM13.9 4.9c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z"
          />
        </svg>
        Download for macOS
      </a>
      <a className={s.secondary} href={LINKS.repo}>
        <BrandMark brand={Brand.GitHub} size={16} />
        Star on GitHub
      </a>
    </div>
  )
}

/**
 * The name, set as large as the page is wide: an SVG whose box is the ink of
 * the word, measured once the font has loaded, so it sits centred and flush
 * on the page's last edge whatever the width.
 */
function Wordmark() {
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    let live = true
    void document.fonts.ready.then(() => {
      const el = svg.current
      const ctx = document.createElement('canvas').getContext('2d')
      if (!live || !el || !ctx) return
      const size = 400
      const track = -0.058 * size
      ctx.font = `800 ${size}px ${getComputedStyle(el).fontFamily}`
      ctx.letterSpacing = `${track}px`
      const m = ctx.measureText(BRAND)
      el.setAttribute(
        'viewBox',
        `${-m.actualBoundingBoxLeft} ${-m.actualBoundingBoxAscent} ${m.actualBoundingBoxLeft + m.actualBoundingBoxRight} ${m.actualBoundingBoxAscent + m.actualBoundingBoxDescent}`,
      )
      const text = el.querySelector('text')
      text?.setAttribute('font-size', String(size))
      text?.setAttribute('letter-spacing', String(track))
    })
    return () => {
      live = false
    }
  }, [])
  return (
    <svg ref={svg} className={s.word} viewBox="0 0 1000 300" aria-hidden="true" focusable="false">
      <text x="0" y="0">
        {BRAND}
      </text>
    </svg>
  )
}

/** The cobalt end of both developer pages: get it, the links, and the name. */
export function Close() {
  return (
    <footer className={s.close} id="get">
      <div className={s.wrap}>
        <div className={s.cta}>
          <div>
            <p className={s.no}>
              <b>{CLOSE.no}</b>
              {CLOSE.label}
            </p>
            <h2 className={s.h2}>
              <span className={s.dim}>{CLOSE.title[0]}</span>
              <span>{CLOSE.title[1]}</span>
            </h2>
          </div>
          <div>
            <Get tone="blue" />
            <pre className={s.code}>
              <span aria-hidden="true">$ </span>
              {INSTALL.brew}
            </pre>
            <p className={s.platforms}>{INSTALL.platforms}</p>
          </div>
        </div>
        <nav className={s.links} aria-label="More">
          <a className={s.brand} href="/">
            <Logo size={20} className={s.logo} />
            {BRAND}
          </a>
          <a href={SHIFTS}>Shifts</a>
          <a href="/thesis">Thesis</a>
          <a href="/wallpaper">Wallpaper</a>
          <a href={LINKS.repo}>GitHub</a>
          <a href={LINKS.issues}>Issues</a>
        </nav>
        <Wordmark />
      </div>
    </footer>
  )
}
