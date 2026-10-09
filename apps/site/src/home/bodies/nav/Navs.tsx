import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useState } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import s from './Navs.module.css'

/*
 * The site's nav, as Althar's own island: the notch's black capsule hanging
 * from the top of the window with the page's parts, GitHub and the download.
 * It draws in to the mark and the download as you read, and opens out again
 * when pointed at. On a phone, Menu drops the parts under it.
 */

const PARTS = [
  { href: '#window', name: 'Product' },
  { href: '#plans', name: 'Your plans' },
  { href: '#review', name: 'Review' },
  { href: '/shifts', name: 'Shifts' },
  { href: '/thesis', name: 'Thesis' },
]

/** How far the page has scrolled past the top, as a yes past `past` px. */
function useScrolled(past = 40) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > past)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [past])
  return scrolled
}

/** The phone's menu: the parts as a sheet under the nav, opened by its button. */
function PhoneMenu({ open, onClose, tone = 'paper' }: { open: boolean; onClose: () => void; tone?: 'paper' | 'ink' }) {
  return (
    <div className={cx(s.sheet, open && s.sheetOpen, tone === 'ink' && s.sheetInk)} aria-hidden={!open}>
      <nav aria-label="Site">
        {PARTS.map((p) => (
          <a key={p.href} href={p.href} onClick={onClose} tabIndex={open ? 0 : -1}>
            {p.name}
          </a>
        ))}
        <a href={LINKS.repo} onClick={onClose} tabIndex={open ? 0 : -1}>
          <BrandMark brand={Brand.GitHub} size={18} />
          GitHub
        </a>
      </nav>
    </div>
  )
}

function MenuButton({ open, onClick, className }: { open: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" className={cx(s.menuButton, className)} aria-expanded={open} onClick={onClick}>
      {open ? 'Close' : 'Menu'}
    </button>
  )
}

/* ---- Island ---- */

function IslandNav() {
  const scrolled = useScrolled(120)
  const [pointed, setPointed] = useState(false)
  const [open, setOpen] = useState(false)
  const wide = !scrolled || pointed
  return (
    <div className={s.islandWrap}>
      <header
        className={cx(s.island, wide && s.islandWide, open && s.islandOpen)}
        onPointerEnter={() => setPointed(true)}
        onPointerLeave={() => setPointed(false)}
      >
        <div className={s.islandBar}>
          <a className={s.islandMark} href="#top" aria-label="Althar">
            <Logo size={18} />
            <span>Althar</span>
          </a>
          <nav className={s.islandLinks} aria-label="Site">
            {PARTS.map((p) => (
              <a key={p.href} href={p.href} tabIndex={wide ? 0 : -1}>
                {p.name}
              </a>
            ))}
          </nav>
          <span className={s.islandEnd}>
            <a className={s.islandGithub} href={LINKS.repo} aria-label="GitHub">
              <BrandMark brand={Brand.GitHub} size={16} />
            </a>
            <a className={s.islandDownload} href={LINKS.releases}>
              <i aria-hidden="true" />
              Download
            </a>
            <MenuButton open={open} onClick={() => setOpen(!open)} className={cx(s.phoneOnly, s.islandMenu)} />
          </span>
        </div>
        <PhoneMenu open={open} onClose={() => setOpen(false)} tone="ink" />
      </header>
    </div>
  )
}

/** Under the island, the first screen keeps the room a bar would have taken. */
export function NavSpace() {
  return <div className={s.spacer} aria-hidden="true" />
}

export { IslandNav as Nav }
