import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useRef } from 'react'

import { INSTALL, LINKS } from '../content/facts'
import { useDownload } from '../lib/download'
import { OS_NAME, OsMark } from './OsMark'
import { BRAND, CLOSE } from '../content/home'
import s from './Close.module.css'

/** Where the shifts list lives. */
const SHIFTS = '/shifts'

/**
 * The download and the repository, as both developer pages end. The download
 * is the latest release's installer for the system the page is read on
 * (useDownload), named; until that is known it reads as the Mac's, and where
 * there is none it is a plain Download to the releases page.
 */
export function Get({ tone }: { tone: 'blue' | 'paper' }) {
  const download = useDownload()
  const os = download.pending ? 'mac' : download.os
  return (
    <div className={tone === 'blue' ? s.getBlue : s.get}>
      <a className={s.primary} href={download.href}>
        {os && <OsMark id={os} size={16} />}
        {os ? `Download for ${OS_NAME[os]}` : 'Download'}
      </a>
      <a className={s.secondary} href={LINKS.repo}>
        <BrandMark brand={Brand.GitHub} size={16} />
        Star on GitHub
      </a>
    </div>
  )
}

/**
 * On a Mac, the other chip's build, as a quiet line under the download: for
 * an Intel Mac where the browser didn't say (Safari and Firefox never do),
 * or for Apple silicon where it said Intel. Its line is kept on every
 * system, so nothing moves when the answer comes in.
 */
export function OtherMac({ tone }: { tone: 'blue' | 'paper' }) {
  const { other } = useDownload()
  return <p className={tone === 'blue' ? s.otherBlue : s.other}>{other && <a href={other.href}>{other.label}</a>}</p>
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
            <OtherMac tone="blue" />
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
