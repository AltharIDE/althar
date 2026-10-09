import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useState } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import { Bar } from '../../../shared/Bar'
import s from './Navs.module.css'

/*
 * Prototype: ways to carry the site's navigation. Each is a real nav: the
 * page's parts, the shifts and the thesis, GitHub and the download. All but
 * the first stay at the top of the window as you read.
 *
 *  - Bar: today's, in the first screen, and gone as you scroll.
 *  - Frost: a full-width bar, clear over the first screen, frosted paper with
 *    a hairline once you scroll.
 *  - Island: the notch's black capsule hanging from the top of the window;
 *    it draws in to the mark and the download as you read, and opens out
 *    when pointed at, as Althar's own island does.
 *  - Menu bar: the Mac's menu bar, Althar's menus in it, the download where
 *    the status items go.
 *  - Edge: only the name and the download; Menu opens the whole page to
 *    the links, set as large as the headline.
 */

export const NAVS = [
  { id: 'bar', name: 'Bar' },
  { id: 'frost', name: 'Frost' },
  { id: 'island', name: 'Island' },
  { id: 'menubar', name: 'Menu bar' },
  { id: 'edge', name: 'Edge' },
] as const
export type NavId = (typeof NAVS)[number]['id']

const PARTS = [
  { href: '#window', name: 'Product' },
  { href: '#plans', name: 'Your plans' },
  { href: '#review', name: 'Review' },
  { href: '/shifts', name: 'Shifts' },
  { href: '/thesis', name: 'Thesis' },
]

const APPLE = (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      fill="currentColor"
      d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1ZM13.9 4.9c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5Z"
    />
  </svg>
)

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

function Brandname({ className }: { className?: string }) {
  return (
    <a className={cx(s.brand, className)} href="#top">
      <Logo size={22} className={s.logo} />
      <span>Althar</span>
    </a>
  )
}

function Download({ className, short = false }: { className?: string; short?: boolean }) {
  return (
    <a className={cx(s.download, className)} href={LINKS.releases}>
      {APPLE}
      {short ? 'Download' : 'Download for Mac'}
    </a>
  )
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

/* ---- Frost ---- */

function Frost() {
  const scrolled = useScrolled()
  const [open, setOpen] = useState(false)
  return (
    <header className={cx(s.frost, (scrolled || open) && s.frosted)}>
      <div className={s.frostRow}>
        <Brandname />
        <nav className={s.frostLinks} aria-label="Site">
          {PARTS.map((p) => (
            <a key={p.href} href={p.href}>
              {p.name}
            </a>
          ))}
        </nav>
        <div className={s.frostEnd}>
          <a className={s.github} href={LINKS.repo} aria-label="GitHub">
            <BrandMark brand={Brand.GitHub} size={18} />
          </a>
          <Download short />
          <MenuButton open={open} onClick={() => setOpen(!open)} className={s.phoneOnly} />
        </div>
      </div>
      <PhoneMenu open={open} onClose={() => setOpen(false)} />
    </header>
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

/* ---- Menu bar ---- */

function MenuBar() {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  const clock = now.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '')
  return (
    <header className={s.menubar}>
      <div className={s.menubarRow}>
        <span className={s.menus}>
          <a className={s.menubarMark} href="#top" aria-label="Althar">
            <Logo size={15} />
          </a>
          <a className={s.menubarApp} href="#top">
            Althar
          </a>
          <nav aria-label="Site" className={s.menubarLinks}>
            {PARTS.map((p) => (
              <a key={p.href} href={p.href}>
                {p.name}
              </a>
            ))}
          </nav>
        </span>
        <span className={s.menubarStatus}>
          <a href={LINKS.repo} className={s.menubarItem}>
            <BrandMark brand={Brand.GitHub} size={14} />
            <span className={s.wideOnly}>GitHub</span>
          </a>
          <a href={LINKS.releases} className={cx(s.menubarItem, s.menubarDownload)}>
            {APPLE}
            Download
          </a>
          <span className={cx(s.menubarClock, s.wideOnly)}>{clock}</span>
          <MenuButton open={open} onClick={() => setOpen(!open)} className={cx(s.phoneOnly, s.menubarItem)} />
        </span>
      </div>
      <PhoneMenu open={open} onClose={() => setOpen(false)} />
    </header>
  )
}

/* ---- Edge ---- */

function Edge() {
  const [open, setOpen] = useState(false)
  const scrolled = useScrolled()
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])
  return (
    <>
      <header className={cx(s.edge, scrolled && s.edgeScrolled, open && s.edgeOpen)}>
        <Brandname />
        <span className={s.edgeEnd}>
          <Download short className={s.wideOnly} />
          <button type="button" className={s.edgeMenu} aria-expanded={open} onClick={() => setOpen(!open)}>
            <span>{open ? 'Close' : 'Menu'}</span>
            <i aria-hidden="true" />
          </button>
        </span>
      </header>
      <div className={cx(s.overlay, open && s.overlayOpen)} aria-hidden={!open}>
        <nav aria-label="Site" className={s.overlayLinks}>
          {PARTS.map((p, i) => (
            <a
              key={p.href}
              href={p.href}
              onClick={() => setOpen(false)}
              tabIndex={open ? 0 : -1}
              style={{ transitionDelay: open ? `${80 + i * 50}ms` : '0ms' }}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              {p.name}
            </a>
          ))}
        </nav>
        <div className={s.overlayFoot}>
          <Download />
          <a href={LINKS.repo} tabIndex={open ? 0 : -1}>
            <BrandMark brand={Brand.GitHub} size={18} />
            Star on GitHub
          </a>
        </div>
      </div>
    </>
  )
}

/** The nav for the first screen's slot: today's bar in it, or a spacer under one that floats. */
export function heroNavOf(id: NavId) {
  return id === 'bar' ? <Bar tone="paper" /> : <div className={s.spacer} aria-hidden="true" />
}

/** The nav that floats over the page, for all but today's bar. */
export function FloatingNav({ id }: { id: NavId }) {
  if (id === 'frost') return <Frost />
  if (id === 'island') return <IslandNav />
  if (id === 'menubar') return <MenuBar />
  if (id === 'edge') return <Edge />
  return null
}
