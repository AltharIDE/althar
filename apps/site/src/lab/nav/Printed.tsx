import { Brand, BrandMark, HalftoneMark } from '@althar/ui'

import { LINKS } from '../../content/facts'
import { cx } from '../../lib/cx'
import s from './Printed.module.css'
import { type NavProps, PAGES, useMenu } from './shared'

/*
 * The printed bar: the README banner's masthead, two inks on paper stock.
 * The mark is the halftone, coming up dot by dot as the page opens; the
 * name and the pages are set in the banner's spaced mono capitals, and the
 * page you're on is printed over with a screen of cobalt dots. Pointed at,
 * a page is screened in black. On a phone the menu is the banner's big
 * cobalt words, the one you're on printed as a halftone. Only the screens'
 * transforms move.
 */

export function Printed({ here, onGo }: NavProps) {
  const { open, button, toggle, close } = useMenu()
  return (
    <header className={s.bar}>
      <a className={s.brand} href="/" aria-label="Althar" onClick={(e) => onGo?.('/', e)}>
        <HalftoneMark size={30} />
        <span>Althar</span>
      </a>
      <nav className={s.pages} aria-label="Site">
        {PAGES.map((p) => (
          <a key={p.href} href={p.href} aria-current={p.href === here ? 'page' : undefined} onClick={(e) => onGo?.(p.href, e)}>
            <i className={s.screen} aria-hidden="true" />
            <span>{p.name}</span>
          </a>
        ))}
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
        <nav aria-label="Site">
          {PAGES.map((p) => (
            <a
              key={p.href}
              href={p.href}
              aria-current={p.href === here ? 'page' : undefined}
              onClick={(e) => {
                close()
                onGo?.(p.href, e)
              }}
            >
              {p.name}
            </a>
          ))}
          <a className={s.sheetGithub} href={LINKS.repo} onClick={close}>
            <BrandMark brand={Brand.GitHub} size={16} />
            GitHub
          </a>
        </nav>
      </div>
    </header>
  )
}
