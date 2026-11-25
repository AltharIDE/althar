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

/** Discord's mark, from Simple Icons (CC0), in the text's colour, as the desktop app's About draws it. */
export function DiscordMark({ size = 21 }: { size?: number } = {}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  )
}
