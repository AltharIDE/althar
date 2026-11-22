import { Logo } from '@althar/ui'

import { useDownload } from '../lib/download'
import { useHere } from '../lib/pathname'
import { PAGES } from '../shared/Nav'
import s from './Bar.module.css'

/*
 * The home page's own bar, as the daylight design draws it: the name on the
 * left, the pages in the middle, the download in cobalt on the right, the
 * width of the page's measure. It stays at the top as you scroll, on frosted
 * paper. Narrower than a tablet the site's own nav, with its menu, takes its
 * place (Home.tsx).
 */

export function Bar() {
  const here = useHere()
  const download = useDownload()
  return (
    <header className={s.bar}>
      <nav className={s.row} aria-label="Pages">
        <a className={s.brand} href="/" aria-label="Althar, home">
          <Logo size={26} />
          <span>Althar</span>
        </a>
        <ul className={s.links}>
          {PAGES.map((page) => (
            <li key={page.href}>
              <a href={page.href} aria-current={here(page.href) ? 'page' : undefined}>
                {page.name}
              </a>
            </li>
          ))}
        </ul>
        <a className={s.get} href={download.href}>
          Download
        </a>
      </nav>
    </header>
  )
}
