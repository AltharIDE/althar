import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useRef, useState } from 'react'

import { INSTALL, LINKS } from '../content/facts'
import { detectOs, type Os, OS_NAME, OsMark } from './OsMark'
import { BRAND, CLOSE } from '../content/home'
import { SHIFTS } from './Bar'
import s from './Close.module.css'

/** The download and the repository, as both developer pages end. The download is for the system the page is read on; a phone gets the Mac's. */
export function Get({ tone }: { tone: 'blue' | 'paper' }) {
  const [os] = useState<Os>(() => detectOs() ?? 'mac')
  return (
    <div className={tone === 'blue' ? s.getBlue : s.get}>
      <a className={s.primary} href={LINKS.releases}>
        <OsMark id={os} size={16} />
        Download for {OS_NAME[os]}
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
