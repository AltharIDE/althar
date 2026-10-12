import { Brand, BrandMark, Logo } from '@althar/ui'
import { useState } from 'react'

import { LINKS } from '../../content/facts'
import { cx } from '../../lib/cx'
import s from './Crew.module.css'
import { type Figure, type NavProps, PAGES, REVIEWER, useMenu, useScrolled } from './shared'

/*
 * The crew: the island as it is, black from the top of the window, with a
 * member of the crew for each page. The one for the page you're on hangs
 * down under its name, blinking and fidgeting; point at another page, or at
 * GitHub (the reviewer), and its figure drops too. Once you're reading they
 * go back up behind the island, and come down again when it's pointed at.
 * On a phone the menu lists the pages beside their figures, in their pools
 * of light. Only transforms move.
 */

/** A figure, hanging under what it stands for, or drawn up behind the island. */
function Hang({ figure, down }: { figure: Figure; down: boolean }) {
  return (
    <span className={s.hang} aria-hidden="true">
      <img className={cx(s.figure, down && s.down)} src={figure.light} alt="" width={60} height={56} />
    </span>
  )
}

export function Crew({ here, onGo }: NavProps) {
  const scrolled = useScrolled(120)
  const [pointed, setPointed] = useState(false)
  const [focused, setFocused] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  const { open, button, toggle, close } = useMenu()
  const showing = !scrolled || pointed || focused
  return (
    <div className={s.wrap}>
      <header
        className={s.island}
        onPointerEnter={() => setPointed(true)}
        onPointerLeave={() => {
          setPointed(false)
          setOver(null)
        }}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return
          setFocused(false)
          setOver(null)
        }}
      >
        <div className={s.bar}>
          <a className={s.brand} href="/" aria-label="Althar" onClick={(e) => onGo?.('/', e)}>
            <Logo size={18} />
            <span>Althar</span>
          </a>
          <nav className={s.pages} aria-label="Site">
            {PAGES.map((p) => (
              <a
                key={p.href}
                href={p.href}
                aria-current={p.href === here ? 'page' : undefined}
                onPointerEnter={() => setOver(p.href)}
                onFocus={() => setOver(p.href)}
                onClick={(e) => onGo?.(p.href, e)}
              >
                {p.name}
                <Hang figure={p.crew} down={over === p.href || (showing && p.href === here)} />
              </a>
            ))}
          </nav>
          <span className={s.end}>
            <a
              className={s.github}
              href={LINKS.repo}
              aria-label="GitHub"
              onPointerEnter={() => setOver('github')}
              onFocus={() => setOver('github')}
            >
              <BrandMark brand={Brand.GitHub} size={16} />
              <Hang figure={REVIEWER} down={over === 'github'} />
            </a>
            <a className={s.download} href={LINKS.releases}>
              <i aria-hidden="true" />
              Download
            </a>
            <button ref={button} type="button" className={s.menuButton} aria-expanded={open} onClick={toggle}>
              {open ? 'Close' : 'Menu'}
            </button>
          </span>
        </div>
        <div className={cx(s.sheet, open && s.sheetOpen)} inert={!open}>
          <nav aria-label="Site">
            {[...PAGES, { href: LINKS.repo, name: 'GitHub', crew: REVIEWER }].map((p) => (
              <a
                key={p.href}
                href={p.href}
                aria-current={p.href === here ? 'page' : undefined}
                onClick={(e) => {
                  close()
                  if (p.href.startsWith('/')) onGo?.(p.href, e)
                }}
              >
                <img src={p.crew.dark} alt="" width={52} height={48} />
                {p.name}
              </a>
            ))}
          </nav>
        </div>
      </header>
    </div>
  )
}
