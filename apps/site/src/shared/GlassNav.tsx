import { Brand, BrandMark, Logo } from '@althar/ui'
import { useEffect, useId, useRef, useState, type RefObject } from 'react'

import { LINKS } from '../content/facts'
import { cx } from '../lib/cx'
import { useHere } from '../lib/pathname'
import pane from './GlassPane.module.css'
import lens from './GlassLens.module.css'
import { PAGES } from './Nav'

/*
 * Two proposals for the site's nav as glass over the hero's light, shown on
 * the homepage in development by `?nav=` (NavPick). Both hold the same
 * things as the island: the mark, the pages with the one being read marked,
 * GitHub, the download, and on a phone a Menu that drops the pages.
 *
 * - The pane: a full-width bar of frosted paper. The light goes under it
 *   blurred and brightened, its ink always reads, and on a phone its menu
 *   is the same frost over the whole page.
 * - The lens: a floating capsule of nearly clear glass. Over paper it is
 *   paper with a rim; once the light is under it, it takes the light's
 *   cobalt as smoked glass and its words turn white.
 *
 * The glass is a layer of its own beside what reads on it, never around it:
 * a box with a backdrop filter is where the boxes in it stop seeing the
 * page, and the phone's menu is glass of its own. Only opacity and
 * transforms move.
 */

export type GlassKind = 'pane' | 'lens'

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

/**
 * Whether the hero's light is under `ref`: from just above the headline,
 * where its strong cobalt starts, to the hero's foot. The homepage's first
 * h1 is the hero's, and the hero is its header's box.
 */
function useOverLight(ref: RefObject<HTMLElement | null>, on: boolean) {
  const [lit, setLit] = useState(false)
  useEffect(() => {
    if (!on) return
    let frame = 0
    const check = () => {
      frame = 0
      const bar = ref.current?.getBoundingClientRect()
      const h1 = document.querySelector('h1')
      const hero = h1?.parentElement?.parentElement
      if (!bar || !h1 || !hero) return setLit(false)
      const middle = bar.top + bar.height / 2
      setLit(h1.getBoundingClientRect().top - 16 < bar.bottom && hero.getBoundingClientRect().bottom > middle)
    }
    const ask = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }
    check()
    window.addEventListener('scroll', ask, { passive: true })
    window.addEventListener('resize', ask)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', ask)
      window.removeEventListener('resize', ask)
    }
  }, [ref, on])
  return on && lit
}

export function GlassNav({ kind }: { kind: GlassKind }) {
  const s = kind === 'pane' ? pane : lens
  const here = useHere()
  const bar = useRef<HTMLElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const sheet = useId()
  const scrolled = useScrolled(8)
  const lit = useOverLight(bar, kind === 'lens')
  const [open, setOpen] = useState(false)

  // Widened past a phone's width, the menu has nothing to drop: it closes.
  useEffect(() => {
    const phone = window.matchMedia('(max-width: 900px)')
    const on = () => {
      if (!phone.matches) setOpen(false)
    }
    phone.addEventListener('change', on)
    return () => phone.removeEventListener('change', on)
  }, [])

  // Escape closes it, and leaves you on its button.
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open])

  const close = () => setOpen(false)
  return (
    <div
      className={cx(s.wrap, scrolled && s.scrolled, lit && s.lit, open && s.open)}
      // Tabbed on out of the menu into the page it covers, it closes.
      onBlur={(e) => {
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) close()
      }}
    >
      <header ref={bar} className={s.bar}>
        <span className={s.glass} aria-hidden="true" />
        <span className={s.tint} aria-hidden="true" />
        <div className={s.row}>
          <a className={s.mark} href="/" aria-label="Althar">
            <Logo size={18} />
            <span>Althar</span>
          </a>
          <nav className={s.links} aria-label="Site">
            {PAGES.map((p) => (
              <a key={p.href} href={p.href} aria-current={here(p.href) ? 'page' : undefined}>
                {p.name}
              </a>
            ))}
          </nav>
          <span className={s.end}>
            <a className={s.github} href={LINKS.repo} aria-label="GitHub">
              <BrandMark brand={Brand.GitHub} size={16} />
            </a>
            <a className={s.download} href={LINKS.releases}>
              <i aria-hidden="true" />
              Download
            </a>
            <button ref={button} type="button" className={s.menu} aria-expanded={open} aria-controls={sheet} onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Menu'}
            </button>
          </span>
        </div>
      </header>
      <div id={sheet} className={s.sheet}>
        <span className={s.glass} aria-hidden="true" />
        <nav aria-label="Site">
          {PAGES.map((p) => (
            <a key={p.href} href={p.href} onClick={close} aria-current={here(p.href) ? 'page' : undefined}>
              {p.name}
            </a>
          ))}
          <a href={LINKS.repo} onClick={close}>
            <BrandMark brand={Brand.GitHub} size={18} />
            GitHub
          </a>
        </nav>
      </div>
    </div>
  )
}
