import { Brand, BrandMark, Logo } from '@althar/ui'
import { type CSSProperties, useState } from 'react'

import { LINKS } from '../../content/facts'
import { cx } from '../../lib/cx'
import s from './Scale.module.css'
import { type NavProps, PAGES, useMenu } from './shared'

/*
 * The scale: the mark is the section through a scale ruler, so the bar is
 * the ruler's edge. The pages are numbered like a set's sheets along a track
 * of ticks, and the mark stands on the track under the page you're on,
 * pointing up at it. Pointed at or tabbed to, it slides to that page. On a
 * phone the track stands upright down the menu. Only its transform moves.
 */

export function Scale({ here, onGo }: NavProps) {
  const current = PAGES.findIndex((p) => p.href === here)
  const [over, setOver] = useState<number | null>(null)
  const at = over ?? current
  const { open, button, toggle, close } = useMenu()
  const track = { '--at': Math.max(at, 0) } as CSSProperties
  return (
    <header className={s.bar}>
      <a className={s.brand} href="/" aria-label="Althar" onClick={(e) => onGo?.('/', e)}>
        <Logo size={22} />
        <span>Althar</span>
      </a>
      <nav
        className={s.pages}
        aria-label="Site"
        style={track}
        onPointerLeave={() => setOver(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setOver(null)
        }}
      >
        {PAGES.map((p, i) => (
          <a
            key={p.href}
            className={s.page}
            href={p.href}
            aria-current={i === current ? 'page' : undefined}
            onPointerEnter={() => setOver(i)}
            onFocus={() => setOver(i)}
            onClick={(e) => onGo?.(p.href, e)}
          >
            <span className={s.no}>{p.no}</span>
            {p.name}
          </a>
        ))}
        <span className={s.track} aria-hidden="true">
          <span className={cx(s.cursor, at < 0 && s.away)}>
            <Logo size={18} />
          </span>
        </span>
      </nav>
      <span className={s.end}>
        <a className={s.github} href={LINKS.repo} aria-label="GitHub">
          <BrandMark brand={Brand.GitHub} size={17} />
        </a>
        <a className={s.download} href={LINKS.releases}>
          <i aria-hidden="true" />
          Download
        </a>
        <button ref={button} type="button" className={s.menuButton} aria-expanded={open} onClick={toggle}>
          {open ? 'Close' : 'Menu'}
        </button>
      </span>
      <div className={cx(s.sheet, open && s.sheetOpen)} inert={!open}>
        <nav aria-label="Site" style={{ '--at': Math.max(current, 0) } as CSSProperties}>
          <span className={s.upright} aria-hidden="true">
            <span className={cx(s.cursor, current < 0 && s.away)}>
              <Logo size={16} />
            </span>
          </span>
          {PAGES.map((p, i) => (
            <a
              key={p.href}
              href={p.href}
              aria-current={i === current ? 'page' : undefined}
              onClick={(e) => {
                close()
                onGo?.(p.href, e)
              }}
            >
              <span className={s.no}>{p.no}</span>
              {p.name}
            </a>
          ))}
          <a href={LINKS.repo} onClick={close}>
            <span className={s.no}>
              <BrandMark brand={Brand.GitHub} size={14} />
            </span>
            GitHub
          </a>
        </nav>
      </div>
    </header>
  )
}
