import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useRef } from 'react'

import { LINKS } from '../content/facts'
import { useDownload } from '../lib/download'
import { useHere } from '../lib/pathname'
import { cx } from '../lib/cx'
import s from './Bar.module.css'
import { useInkUnder } from './barInk'
import { glassDrop, type GlassDrop } from './glassDrop'
import { lensMap } from './lens'
import { DiscordMark } from './DiscordMark'
import { Nav, PAGES } from './Nav'

/*
 * The site's bar, as the home page's daylight design draws it: the name on
 * the left, the pages in the middle, and on the right Discord and GitHub as
 * their marks and the download in cobalt, the width of the page's measure.
 * It stays at the top as you scroll, on frosted paper. Pointed at or
 * tabbed through, the pages have the site nav's drop of glass over them,
 * gliding from one to the next (glassDrop.ts): a lens, bending the word
 * under it at its rim (lens.ts), where the browser can bend a backdrop
 * (Chromium); elsewhere clear glass. Over a dark section (the home page's
 * review, another page's night head) it turns dark with the scroll, the section's edge passing up
 * through it, its words turning white as the edge crosses them (barInk.ts).
 * Narrower than a tablet the site's own nav, with its menu, takes its place.
 *
 * On the home page it holds its own room at the top (sticky). Every other
 * page opens on a night head (shared/night), which keeps room for it: there
 * the bar floats over the page (`floating`), dark from the first paint
 * (`dark`), before the scroll is read; SiteNav sets both, and the phone's.
 */

/** The bar and, narrower than a tablet, the site's own nav in its place: for every page but the home page, which places its own. */
export function SiteNav() {
  return (
    <>
      <Bar floating dark />
      <div className={s.narrow}>
        <Nav />
      </div>
    </>
  )
}

export function Bar({ floating = false, dark = false }: { floating?: boolean; dark?: boolean } = {}) {
  const here = useHere()
  const download = useDownload()
  const bar = useRef<HTMLElement>(null)
  useInkUnder(bar)
  const row = useRef<HTMLDivElement>(null)
  const drop = useRef<HTMLSpanElement>(null)
  const lens = useRef<GlassDrop>(null)
  const map = useRef<SVGFEImageElement>(null)
  useEffect(() => {
    const el = drop.current
    if (!row.current || !el) return
    const made = glassDrop(row.current, el)
    lens.current = made
    // The lens's map, drawn for the width the drop takes as it is aimed.
    const ro = new ResizeObserver(() => {
      const image = map.current
      const w = Math.round(el.offsetWidth)
      const h = Math.round(el.offsetHeight)
      if (!image || !w || !h) return
      image.setAttribute('width', String(w))
      image.setAttribute('height', String(h))
      image.setAttribute('href', lensMap(w, h))
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      made.stop()
      lens.current = null
    }
  }, [])
  return (
    <header
      ref={bar}
      className={cx(s.bar, floating && s.floating, dark && s.startDark)}
      data-dark={dark ? '' : undefined}
      onPointerLeave={() => lens.current?.point(null)}
    >
      {/* The frost on its own layer: a bar with a backdrop filter of its own would be all the drop could see through. Its paper, and its black where a dark section is under it (barInk.ts). */}
      <span className={s.frost} aria-hidden="true" />
      <span className={s.night} aria-hidden="true" />
      {/* The lens the drop's backdrop goes through (Bar.module.css): its map moves what is under the rim. */}
      <svg className={s.defs} aria-hidden="true" focusable="false">
        <filter id="home-lens" x="0" y="0" width="1" height="1" colorInterpolationFilters="sRGB">
          <feImage ref={map} x="0" y="0" width="60" height="36" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="10" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div
        ref={row}
        className={s.row}
        onPointerOver={(e) => {
          if (e.pointerType === 'touch') return
          const at = e.target as Element
          const item = at.closest('[data-drop]')
          // Between two of them it stays where it was; on the name or the download, it goes.
          if (item || at.closest('a, button')) lens.current?.point(item)
        }}
        onFocus={(e) => lens.current?.focus(e.target.matches('[data-drop]:focus-visible') ? e.target : null)}
        onBlur={() => lens.current?.focus(null)}
      >
        <span ref={drop} className={s.drop} aria-hidden="true" />
        <a className={s.brand} href="/" aria-label="Althar, home">
          <Logo size={26} />
          <span>Althar</span>
        </a>
        <nav aria-label="Pages">
          <ul className={s.links}>
            {PAGES.map((page) => (
              <li key={page.href}>
                <a href={page.href} data-drop aria-current={here(page.href) ? 'page' : undefined}>
                  {page.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <span className={s.end}>
          <a className={s.icon} href={LINKS.discord} data-drop aria-label="Discord">
            <DiscordMark />
          </a>
          <a className={s.icon} href={LINKS.repo} data-drop aria-label="GitHub">
            <BrandMark brand={Brand.GitHub} size={19} />
          </a>
          <a className={s.get} href={download.href}>
            Download
          </a>
        </span>
      </div>
    </header>
  )
}

// Discord's mark has a file of its own (DiscordMark.tsx), as the nav's menu draws it too; it is still had from here.
export { DiscordMark } from './DiscordMark'
