import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useRef } from 'react'

import { LINKS, PLATFORMS } from '../content/facts'
import { useDownload } from '../lib/download'
import { OS_NAME, OsMark } from './OsMark'
import { BRAND, CLOSE } from '../content/home'
import { SHIFTS } from './Bar'
import s from './Close.module.css'

/**
 * The download and the repository, as both developer pages end. The download
 * is the latest release's installer for the system the page is read on
 * (useDownload), named; until that is known it reads as the Mac's. Where the
 * release has no build for the reader's system or chip, it goes to the latest
 * release and a line under it says so plainly; where the system or the
 * release can't be known, it is a plain Download to the latest release.
 */
export function Get({ tone }: { tone: 'blue' | 'paper' }) {
  const download = useDownload()
  const os = download.pending ? 'mac' : download.os
  return (
    <div className={tone === 'blue' ? s.getBlue : s.get}>
      <a className={s.primary} href={download.href}>
        {os && <OsMark id={os} size={16} />}
        {os ? `Download for ${OS_NAME[os]}` : download.missing ? 'See the latest release' : 'Download'}
      </a>
      <a className={s.secondary} href={LINKS.repo}>
        <BrandMark brand={Brand.GitHub} size={16} />
        Star on GitHub
      </a>
      {download.missing && <p className={s.missing}>{download.missing}</p>}
    </div>
  )
}

/**
 * Each system, what it needs, and what to download for it (PLATFORMS), as a
 * list beside a Get of the same tone: a system with no build says Coming.
 */
export function Platforms({ tone }: { tone: 'blue' | 'paper' }) {
  return (
    <ul className={tone === 'blue' ? s.systemsBlue : s.systems} aria-label="Systems">
      {PLATFORMS.map((p) => (
        <li key={p.os} className={p.files ? undefined : s.coming}>
          <OsMark id={p.os} size={15} />
          <b>{p.name}</b>
          <span>{p.files ? `${p.needs} · ${p.files}` : p.needs}</span>
        </li>
      ))}
    </ul>
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
            <Platforms tone="blue" />
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
