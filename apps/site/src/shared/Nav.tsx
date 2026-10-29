import { Brand, BrandMark, Logo } from '@althar/ui'
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react'

import { LINKS } from '../content/facts'
import { useHydrated, useStill } from '../lib/browser'
import { cx } from '../lib/cx'
import { useDownload } from '../lib/download'
import { useHere } from '../lib/pathname'
import { glassDrop, type GlassDrop } from './glassDrop'
import { useLightUnder } from './lightUnder'
import { scrolledAway } from './menuScroll'
import s from './Nav.module.css'

/*
 * The site's nav, the lens: a capsule of nearly clear glass floating under
 * the top edge, with the mark, the pages with the one being read marked,
 * GitHub, the download, and on a phone a Menu that drops the pages. Over
 * paper it is paper with a rim; once a head's light is under it
 * (useLightUnder) it takes the light's cobalt as smoked glass and its words
 * turn white, and over a dark section it is smoked graphite, white on it.
 *
 * Pointed at or tabbed through, the pages and GitHub have a drop of the
 * same glass under them, gliding from one to the next (glassDrop). It comes
 * in as the page opens: after the first screen, on the homepage (`opening`).
 *
 * The glass is a layer of its own beside what reads on it, never around it:
 * a box with a backdrop filter is where the boxes in it stop seeing the
 * page, and the phone's menu is glass of its own. Only opacity and
 * transforms move.
 */

export const PAGES = [
  { href: '/', name: 'Home' },
  { href: '/shifts', name: 'Shifts' },
  { href: '/docs', name: 'Docs' },
]

/** Whether the page has scrolled past `past` px. */
function useScrolled(past: number) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > past)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [past])
  return scrolled
}

/** Where each thing on the bar comes in, one after another. */
const nth = (i: number) => ({ '--i': i }) as CSSProperties

/** `opening`: the page opens with its first screen coming up out of the dark, and the nav comes in after it. */
export function Nav({ opening = false }: { opening?: boolean } = {}) {
  const here = useHere()
  const bar = useRef<HTMLElement>(null)
  const sheetEl = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const drop = useRef<HTMLSpanElement>(null)
  const lens = useRef<GlassDrop>(null)
  const button = useRef<HTMLButtonElement>(null)
  const sheet = useId()
  const scrolled = useScrolled(8)
  const under = useLightUnder(bar)
  // The card hangs below the bar, so it asks for itself: over the light it is smoked cobalt, over a dark section graphite, and on paper it stays paper.
  const sheetUnder = useLightUnder(sheetEl, true)
  const [open, setOpen] = useState(false)
  // The hero's opening starts once the page's script runs; so does the nav's entrance, timed to follow it. Held still, it is simply there.
  const opened = useHydrated()
  const held = useStill()
  // The reader's own installer once known, the releases page until then. It reads Download either way: the capsule keeps its width.
  const download = useDownload()

  useEffect(() => {
    if (!row.current || !drop.current) return
    const made = glassDrop(row.current, drop.current)
    lens.current = made
    return () => {
      made.stop()
      lens.current = null
    }
  }, [])

  // Widened past a phone's width, the menu has nothing to drop: it closes.
  useEffect(() => {
    const phone = window.matchMedia('(max-width: 900px)')
    const on = () => {
      if (!phone.matches) setOpen(false)
    }
    phone.addEventListener('change', on)
    return () => phone.removeEventListener('change', on)
  }, [])

  // Escape closes it, and leaves you on its button. The page keeps scrolling under the card: a short move stays, and past that the menu closes. A tap beside the card closes it without following what is underneath.
  useEffect(() => {
    if (!open) return
    const openedAt = window.scrollY
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const scroll = () => {
      if (scrolledAway(openedAt, window.scrollY)) setOpen(false)
    }
    const outside = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (bar.current?.contains(target) || sheetEl.current?.contains(target)) return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, { passive: true })
    document.addEventListener('click', outside, true)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll)
      document.removeEventListener('click', outside, true)
    }
  }, [open])

  const close = () => setOpen(false)
  return (
    <div
      className={cx(
        s.wrap,
        opening && s.opening,
        held && s.still,
        scrolled && s.scrolled,
        under && s.lit,
        under === 'ink' && s.ink,
        open && s.open,
      )}
      data-opened={opened ? '' : undefined}
      // Tabbed on out of the menu into the page it covers, it closes.
      onBlur={(e) => {
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) close()
      }}
    >
      <div className={s.scrim} aria-hidden="true" />
      <header ref={bar} className={s.bar} onPointerLeave={() => lens.current?.point(null)}>
        <span className={s.glass} aria-hidden="true" />
        <span className={s.tint} aria-hidden="true" />
        <span className={s.graphite} aria-hidden="true" />
        <div
          ref={row}
          className={s.row}
          onPointerOver={(e) => {
            if (e.pointerType === 'touch') return
            const at = e.target as Element
            const item = at.closest('[data-drop]')
            // Between two of them it stays where it was; on the mark or the download, it goes.
            if (item || at.closest('a, button')) lens.current?.point(item)
          }}
          onFocus={(e) => lens.current?.focus(e.target.matches('[data-drop]:focus-visible') ? e.target : null)}
          onBlur={() => lens.current?.focus(null)}
        >
          <span ref={drop} className={s.drop} aria-hidden="true" />
          <a className={s.mark} href="/" aria-label="Althar" style={nth(0)}>
            <Logo size={18} />
            <span>Althar</span>
          </a>
          <nav className={s.links} aria-label="Site">
            {PAGES.map((p, i) => (
              <a key={p.href} href={p.href} data-drop aria-current={here(p.href) ? 'page' : undefined} style={nth(1 + i)}>
                {p.name}
              </a>
            ))}
          </nav>
          <span className={s.end}>
            <a className={s.github} href={LINKS.repo} data-drop aria-label="GitHub" style={nth(1 + PAGES.length)}>
              <BrandMark brand={Brand.GitHub} size={16} />
            </a>
            <a className={s.download} href={download.href} title={download.os ? download.label : undefined} style={nth(2 + PAGES.length)}>
              <i aria-hidden="true" />
              Download
            </a>
            <button
              ref={button}
              type="button"
              className={s.menu}
              style={nth(3 + PAGES.length)}
              aria-expanded={open}
              aria-controls={sheet}
              onClick={() => setOpen(!open)}
            >
              {open ? 'Close' : 'Menu'}
            </button>
          </span>
        </div>
      </header>
      <div id={sheet} ref={sheetEl} inert={!open} className={cx(s.sheet, sheetUnder && s.lit, sheetUnder === 'ink' && s.ink)}>
        <span className={s.glass} aria-hidden="true" />
        <span className={s.tint} aria-hidden="true" />
        <span className={s.graphite} aria-hidden="true" />
        <nav aria-label="Site">
          {PAGES.map((p, i) => (
            <a key={p.href} href={p.href} style={nth(i)} onClick={close} aria-current={here(p.href) ? 'page' : undefined}>
              {p.name}
            </a>
          ))}
          <a href={LINKS.repo} style={nth(PAGES.length)} onClick={close}>
            <BrandMark brand={Brand.GitHub} size={16} />
            GitHub
          </a>
        </nav>
      </div>
    </div>
  )
}

/** Under the nav, the first screen keeps the room it floats in. */
export function NavSpace() {
  return <div className={s.space} aria-hidden="true" />
}
