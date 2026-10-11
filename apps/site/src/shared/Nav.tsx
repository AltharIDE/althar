import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useState } from 'react'

import { LINKS } from '../content/facts'
import { cx } from '../lib/cx'
import { useHere } from '../lib/pathname'
import s from './Nav.module.css'

/*
 * The site's nav, as Althar's own island: the notch's black capsule hanging
 * from the top of the window with the site's pages, GitHub and the
 * download. It draws in to the mark and the download as you read, and opens
 * out again when pointed at or tabbed into. On a phone, Menu drops the
 * pages under it.
 */

const PAGES = [
  { href: '/', name: 'Home' },
  { href: '/shifts', name: 'Shifts' },
  { href: '/thesis', name: 'Thesis' },
  { href: '/docs', name: 'Docs' },
]

/** Whether the page has scrolled past `past` px. */
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

/** The phone's menu: the pages as a sheet under the island, opened by its button. */
function PhoneMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const here = useHere()
  return (
    <div className={cx(s.sheet, open && s.sheetOpen)} aria-hidden={!open}>
      <nav aria-label="Site">
        {PAGES.map((p) => (
          <a key={p.href} href={p.href} onClick={onClose} tabIndex={open ? 0 : -1} aria-current={here(p.href) ? 'page' : undefined}>
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

export function Nav() {
  const here = useHere()
  const scrolled = useScrolled(120)
  const [pointed, setPointed] = useState(false)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const wide = !scrolled || pointed || focused
  return (
    <div className={s.islandWrap}>
      <header
        className={cx(s.island, wide && s.islandWide, open && s.islandOpen)}
        onPointerEnter={() => setPointed(true)}
        onPointerLeave={() => setPointed(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
        }}
      >
        <div className={s.islandBar}>
          <a className={s.islandMark} href="/" aria-label="Althar">
            <Logo size={18} />
            <span>Althar</span>
          </a>
          <nav className={s.islandLinks} aria-label="Site">
            {PAGES.map((p) => (
              <a key={p.href} href={p.href} aria-current={here(p.href) ? 'page' : undefined}>
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
            <button type="button" className={cx(s.menuButton, s.phoneOnly)} aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Menu'}
            </button>
          </span>
        </div>
        <PhoneMenu open={open} onClose={() => setOpen(false)} />
      </header>
    </div>
  )
}

/** Under the island, the first screen keeps the room a bar would have taken. */
export function NavSpace() {
  return <div className={s.spacer} aria-hidden="true" />
}
