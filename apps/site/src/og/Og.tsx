import { addDisplay } from '../home/display'
import { Card } from './Card'
import { OG_PAGES, type OgPage } from './cards'
import s from './Og.module.css'
import { Takes } from './Takes'

/*
 * The link previews, drawn by the site's own pieces. In development only:
 * `/og?page=home` is one card alone, at the page's corner, as
 * scripts/og.ts screenshots it; `/og` shows every card; `/og?take=a`
 * shows the directions on the footer's engraving (Takes.tsx).
 */

addDisplay()

export function Og() {
  if (new URLSearchParams(window.location.search).has('take')) return <Takes />
  const page = new URLSearchParams(window.location.search).get('page')
  if (page && (OG_PAGES as string[]).includes(page)) return <Card page={page as OgPage} />
  return (
    <div className={s.all}>
      {OG_PAGES.map((p) => (
        <Card key={p} page={p} />
      ))}
    </div>
  )
}
